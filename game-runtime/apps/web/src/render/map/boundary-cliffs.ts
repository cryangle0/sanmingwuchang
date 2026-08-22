import { MAP_BOUNDARY, type MapPointMm, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';

/**
 * The boundary read as a cliff rather than a wall.
 *
 * The compiled BOUND wall pieces are axis-extruded prisms: correct for
 * collision, but drawn they are flat-topped slabs sitting on the grass, which
 * is what made the map edge look like stacked stone blocks. Collision still
 * comes from those pieces; this module only replaces what the camera sees.
 *
 * The face is a ribbon swept along the boundary polygon and folded through a
 * fixed set of strata. Each stratum steps outward and drops further, so the
 * profile batters back the way a real escarpment does instead of falling as
 * one vertical plate, and the seam between two strata reads as a bedding
 * plane. Two noise fields do the rest: one along the rim, which makes the
 * crest jagged and pushes buttresses out between clefts, and one per stratum,
 * which stops the bedding planes from running as perfect horizontal lines.
 *
 * Vertex colour carries the depth gradient — bright and slightly warm at the
 * lit crest, sinking to near black at the base — so a single opaque material
 * covers the whole drop and the bottom dissolves into the fog without a
 * second pass or any transparency.
 */

const MM = 1_000;
/** Spacing of rim samples. Fine enough for clefts, coarse enough to stay one draw call. */
const RIM_STEP_METERS = 5;
/** How far the rim noise can push a buttress out or cut a cleft in. */
const RIM_SWAY_METERS = 5.5;
/** Crest lift above the adjoining ground, before jitter. */
const CREST_BASE_LIFT = 1.1;
const CREST_JITTER = 2.6;
/** Depth the last stratum reaches. Well past anything the camera can see. */
const ABYSS_DEPTH = 62;

/**
 * Outward push and drop of each stratum as a fraction of the total.
 *
 * Front-loaded on purpose: the top third of the drop carries most of the
 * batter and most of the vertices, because that is the band the player
 * actually looks at. Below it the face steepens and the strata stretch.
 */
const STRATA: readonly { readonly out: number; readonly down: number; readonly shade: number }[] = [
  { out: 0.0, down: 0.0, shade: 1.0 },
  { out: 0.16, down: 0.03, shade: 0.86 },
  { out: 0.34, down: 0.1, shade: 0.72 },
  { out: 0.46, down: 0.22, shade: 0.58 },
  { out: 0.62, down: 0.4, shade: 0.42 },
  { out: 0.74, down: 0.64, shade: 0.26 },
  { out: 0.86, down: 1.0, shade: 0.1 },
];
/** Outward reach of the widest stratum, metres. */
const BATTER_METERS = 26;

const CREST_COLOUR = new THREE.Color(0x9aa093);
const BASE_COLOUR = new THREE.Color(0x14171a);

export function buildBoundaryCliffs(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): void {
  const rim = sampleRim();
  if (rim.length < 3) {
    return;
  }

  const positions: number[] = [];
  const colours: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const colour = new THREE.Color();

  rim.forEach((sample, column) => {
    for (const [row, stratum] of STRATA.entries()) {
      // Bedding planes wander so the strata never read as drawn-on stripes.
      const wobble = stratum.down === 0 ? 0 : (noise(column * 0.31, row * 2.7) - 0.5) * 3.4;
      const reach = BATTER_METERS * stratum.out + (stratum.out === 0 ? 0 : sample.buttress);
      const y = sample.crestY - ABYSS_DEPTH * stratum.down + wobble;
      positions.push(sample.x + sample.outX * reach, y, sample.z + sample.outZ * reach);
      // U runs along the rim so the rock never stretches around corners;
      // V is world height, which keeps bedding at a constant scale.
      uvs.push(sample.distance / 18, y / 18);
      colour.copy(BASE_COLOUR).lerp(CREST_COLOUR, stratum.shade * sample.light);
      colours.push(colour.r, colour.g, colour.b);
    }
  });

  const rows = STRATA.length;
  for (let column = 0; column < rim.length; column += 1) {
    const next = (column + 1) % rim.length;
    for (let row = 0; row < rows - 1; row += 1) {
      const a = column * rows + row;
      const b = column * rows + row + 1;
      const c = next * rows + row + 1;
      const d = next * rows + row;
      // Wound so the face points away from the playfield.
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(track(geometry), materials.boundaryCliffFace);
  mesh.name = 'boundary-cliff';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  buildCrestBrow(group, materials, track, rim);
}

/**
 * A thin lip folded back over the crest.
 *
 * Without it the grass ends on the exact vertex where the face begins and the
 * edge reads as a cut, not an overhang. The brow oversails the drop by half a
 * metre, so the rim casts a hard shadow line onto its own face.
 */
function buildCrestBrow(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  rim: readonly RimSample[],
): void {
  const positions: number[] = [];
  const colours: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const colour = new THREE.Color();

  rim.forEach((sample, column) => {
    const overhang = 0.45 + noise(column * 0.53, 9.1) * 0.7;
    positions.push(
      sample.x - sample.outX * 1.6,
      sample.groundY - 0.05,
      sample.z - sample.outZ * 1.6,
    );
    uvs.push(sample.distance / 18, 0);
    colour.copy(CREST_COLOUR).multiplyScalar(0.86 * sample.light);
    colours.push(colour.r, colour.g, colour.b);

    positions.push(
      sample.x + sample.outX * overhang,
      sample.crestY,
      sample.z + sample.outZ * overhang,
    );
    uvs.push(sample.distance / 18, 0.2);
    colour.copy(CREST_COLOUR).multiplyScalar(sample.light);
    colours.push(colour.r, colour.g, colour.b);
  });

  for (let column = 0; column < rim.length; column += 1) {
    const next = (column + 1) % rim.length;
    const a = column * 2;
    const b = column * 2 + 1;
    const c = next * 2 + 1;
    const d = next * 2;
    indices.push(a, b, c, a, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(track(geometry), materials.boundaryCliffFace);
  mesh.name = 'boundary-cliff-brow';
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
  readonly crestY: number;
  /** Extra outward reach of the strata here; the crest's clefts and spurs. */
  readonly buttress: number;
  /** Distance travelled along the rim, for continuous UVs. */
  readonly distance: number;
  /** Cheap sun-facing term so opposite walls of the bowl do not share a tone. */
  readonly light: number;
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
      const sway = (noise(distance * 0.09, 3.3) - 0.5) * 2 * RIM_SWAY_METERS;
      // Pull the rim inward on clefts and outward on spurs before lifting it,
      // so the crest line itself wanders instead of tracing the 21-point
      // polygon exactly.
      const rimX = x + outward.x * sway;
      const rimZ = z + outward.z * sway;
      const groundY = terrainHeightMeters(rimX, rimZ);
      samples.push({
        x: rimX,
        z: rimZ,
        outX: outward.x,
        outZ: outward.z,
        groundY,
        crestY: groundY + CREST_BASE_LIFT + noise(distance * 0.17, 1.9) * CREST_JITTER,
        buttress: noise(distance * 0.07, 6.1) * 7,
        distance,
        light: 0.72 + 0.28 * (0.5 + 0.5 * (outward.x * 0.6 + outward.z * 0.8)),
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

/** Deterministic value noise in [0, 1]; the cliff must rebuild identically. */
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
