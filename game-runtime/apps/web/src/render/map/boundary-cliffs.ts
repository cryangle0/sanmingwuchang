import { MAP_BOUNDARY, type MapPointMm, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';

/**
 * The boundary as an escarpment that rises, not a chasm that drops.
 *
 * The compiled BOUND pieces are 6 m axis-extruded prisms: right for
 * collision, but drawn they were flat-topped slabs standing on the grass, so
 * the map edge read as stacked blocks. The first replacement fell the other
 * way — a 60 m gorge outside the rim — and that was worse on two counts. It
 * looked like a dune rather than rock, because 26 m of batter spread over the
 * drop left the upper face sitting at barely thirty degrees under smooth
 * normals. And it lied about the rules: a visible drop that a player cannot
 * fall into is a promise the collision does not keep.
 *
 * A wall keeps that promise. It rises far above the play area, leans away as
 * it climbs so its inner face is what the camera sees, and closes the horizon
 * so nothing outside the arena has to be dressed at all.
 *
 * Two things make it read as rock rather than as a ramp. Every vertex is
 * unshared, so each triangle keeps its own hard normal and the face breaks
 * into lit and shadowed facets instead of one smooth sheet. And a
 * high-frequency offset along the rim pushes alternating columns in and out,
 * cutting the vertical flutes and buttresses that give an escarpment its
 * silhouette.
 *
 * Collision is untouched: this is the same boundary the BOUND pieces already
 * enforce, drawn honestly.
 */

const MM = 1_000;
/** Spacing of rim columns. One flute per column, so this sets the rib pitch. */
const RIM_STEP_METERS = 4;
/** Height of the wall above the ground it stands on, before per-column jitter. */
const WALL_BASE_HEIGHT = 34;
const WALL_HEIGHT_JITTER = 15;
/** How far a column's flute can stand proud of, or recede from, the mean face. */
const FLUTE_METERS = 2.8;

/**
 * Tiers up the inner face: fraction of the height, and how far the face has
 * leaned outward by then. The lean is gentle low down and opens up near the
 * top, which is the profile of a weathered scarp — undercut at the foot,
 * broken back at the crest.
 */
const TIERS: readonly { readonly up: number; readonly out: number; readonly shade: number }[] = [
  { up: 0.0, out: 0.0, shade: 0.34 },
  { up: 0.14, out: 0.4, shade: 0.46 },
  { up: 0.34, out: 1.9, shade: 0.63 },
  { up: 0.58, out: 4.4, shade: 0.8 },
  { up: 0.8, out: 7.6, shade: 0.93 },
  { up: 1.0, out: 11.5, shade: 1.0 },
];
/** Depth of the crest cap, so the top edge has thickness against the sky. */
const CREST_CAP_METERS = 9;
/** Scree fan at the foot, blending rock into ground. */
const TALUS_METERS = 4.5;

/** World metres per texture tile on the face. */
const TEXTURE_METERS = 12;

const ROCK_LIT = new THREE.Color(0xa9a493);
const ROCK_SHADOW = new THREE.Color(0x24262a);
const TALUS_COLOUR = new THREE.Color(0x6d6656);

export function buildBoundaryCliffs(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): void {
  const rim = sampleRim();
  if (rim.length < 3) {
    return;
  }

  const builder = new FacetBuilder();
  for (let column = 0; column < rim.length; column += 1) {
    const left = rim[column] as RimSample;
    const right = rim[(column + 1) % rim.length] as RimSample;

    for (let tier = 0; tier + 1 < TIERS.length; tier += 1) {
      const lower = TIERS[tier] as (typeof TIERS)[number];
      const upper = TIERS[tier + 1] as (typeof TIERS)[number];
      builder.quad(
        pointOn(left, lower),
        pointOn(right, lower),
        pointOn(right, upper),
        pointOn(left, upper),
        shadeAt(left, lower.shade),
        shadeAt(right, lower.shade),
        shadeAt(right, upper.shade),
        shadeAt(left, upper.shade),
      );
    }

    // Crest cap: the top edge needs depth or the wall reads as cardboard where
    // it meets the sky.
    const crest = TIERS[TIERS.length - 1] as (typeof TIERS)[number];
    const leftCrest = pointOn(left, crest);
    const rightCrest = pointOn(right, crest);
    builder.quad(
      leftCrest,
      rightCrest,
      offsetOut(rightCrest, right, CREST_CAP_METERS, -1.4),
      offsetOut(leftCrest, left, CREST_CAP_METERS, -1.4),
      shadeAt(left, 1),
      shadeAt(right, 1),
      shadeAt(right, 0.88),
      shadeAt(left, 0.88),
    );

    // Talus: a short skirt inward from the foot so rock meets grass on a slope
    // instead of on a seam.
    const foot = TIERS[0] as (typeof TIERS)[number];
    const leftFoot = pointOn(left, foot);
    const rightFoot = pointOn(right, foot);
    builder.quad(
      inwardSkirt(left),
      inwardSkirt(right),
      rightFoot,
      leftFoot,
      TALUS_COLOUR,
      TALUS_COLOUR,
      shadeAt(right, foot.shade),
      shadeAt(left, foot.shade),
    );
  }

  const mesh = new THREE.Mesh(track(builder.build()), materials.boundaryCliffFace);
  mesh.name = 'boundary-cliff';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

interface RimSample {
  readonly x: number;
  readonly z: number;
  readonly outX: number;
  readonly outZ: number;
  readonly groundY: number;
  readonly height: number;
  /** Outward offset of this column's flute; negative cuts a cleft. */
  readonly flute: number;
  readonly distance: number;
  /** How square-on the sun this stretch of wall faces. */
  readonly light: number;
}

interface FacePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Arc length along the rim, which is what the rock texture runs on. */
  readonly u: number;
}

function pointOn(sample: RimSample, tier: (typeof TIERS)[number]): FacePoint {
  // The flute rides in with the lean, so ribs widen up the face rather than
  // running as parallel grooves.
  const reach = tier.out + sample.flute * (0.35 + tier.up * 0.65);
  return {
    x: sample.x + sample.outX * reach,
    y: sample.groundY + sample.height * tier.up,
    z: sample.z + sample.outZ * reach,
    u: sample.distance,
  };
}

function offsetOut(point: FacePoint, sample: RimSample, reach: number, drop: number): FacePoint {
  return {
    x: point.x + sample.outX * reach,
    y: point.y + drop,
    z: point.z + sample.outZ * reach,
    u: point.u,
  };
}

function inwardSkirt(sample: RimSample): FacePoint {
  const x = sample.x - sample.outX * TALUS_METERS;
  const z = sample.z - sample.outZ * TALUS_METERS;
  return { x, y: terrainHeightMeters(x, z) - 0.1, z, u: sample.distance };
}

function shadeAt(sample: RimSample, tierShade: number): THREE.Color {
  return new THREE.Color()
    .copy(ROCK_SHADOW)
    .lerp(ROCK_LIT, Math.max(0, Math.min(1, tierShade * sample.light)));
}

/** Accumulates unshared triangles, which is what keeps the shading faceted. */
class FacetBuilder {
  private readonly positions: number[] = [];
  private readonly colours: number[] = [];
  private readonly uvs: number[] = [];

  quad(
    a: FacePoint,
    b: FacePoint,
    c: FacePoint,
    d: FacePoint,
    ca: THREE.Color,
    cb: THREE.Color,
    cc: THREE.Color,
    cd: THREE.Color,
  ): void {
    this.triangle(a, b, c, ca, cb, cc);
    this.triangle(a, c, d, ca, cc, cd);
  }

  private triangle(
    a: FacePoint,
    b: FacePoint,
    c: FacePoint,
    ca: THREE.Color,
    cb: THREE.Color,
    cc: THREE.Color,
  ): void {
    for (const [point, colour] of [
      [a, ca],
      [b, cb],
      [c, cc],
    ] as const) {
      this.positions.push(point.x, point.y, point.z);
      this.colours.push(colour.r, colour.g, colour.b);
      // U is arc length along the rim, V is world height. Projecting U from
      // the distance to the world origin instead left it almost constant
      // around a near-circular boundary, which smeared the rock into
      // kilometre-long streaks.
      this.uvs.push(point.u / TEXTURE_METERS, point.y / TEXTURE_METERS);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function sampleRim(): readonly RimSample[] {
  const centroid = boundaryCentroidMeters();
  const samples: RimSample[] = [];
  let distance = 0;
  for (let index = 0; index < MAP_BOUNDARY.length; index += 1) {
    const a = MAP_BOUNDARY[index] as MapPointMm;
    const b = MAP_BOUNDARY[(index + 1) % MAP_BOUNDARY.length] as MapPointMm;
    const ax = a.x / MM;
    const az = a.z / MM;
    const bx = b.x / MM;
    const bz = b.z / MM;
    const edgeLength = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(edgeLength / RIM_STEP_METERS));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const outward = outwardOf(x, z, centroid);
      samples.push({
        x,
        z,
        outX: outward.x,
        outZ: outward.z,
        groundY: terrainHeightMeters(x, z) - 0.4,
        // Two scales of height variation: broad massifs, and a fast one that
        // notches individual columns down into clefts.
        height:
          WALL_BASE_HEIGHT +
          noise(distance * 0.012, 0.5) * WALL_HEIGHT_JITTER +
          (noise(distance * 0.21, 4.5) - 0.5) * 7,
        flute: (noise(distance * 0.33, 7.7) - 0.5) * 2 * FLUTE_METERS,
        distance,
        light: 0.55 + 0.45 * (0.5 + 0.5 * (outward.x * 0.55 + outward.z * 0.83)),
      });
      distance += edgeLength / steps;
    }
  }
  return samples;
}

function outwardOf(
  x: number,
  z: number,
  centroid: { x: number; z: number },
): { x: number; z: number } {
  const dx = x - centroid.x;
  const dz = z - centroid.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

function boundaryCentroidMeters(): { x: number; z: number } {
  let sumX = 0;
  let sumZ = 0;
  for (const point of MAP_BOUNDARY) {
    sumX += point.x;
    sumZ += point.z;
  }
  return { x: sumX / MAP_BOUNDARY.length / MM, z: sumZ / MAP_BOUNDARY.length / MM };
}

/** Deterministic value noise in [0, 1]; the wall must rebuild identically. */
function noise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}
