import * as THREE from 'three';
import { createFlowWaterMaterial } from '../shading/flow-water';
import { noise2 } from '../shading/noise';
import type { MapMaterialLibrary } from './map-palette';
import { regionAt } from './map-regions';
import { type MassifFacet, type MassifVertex, massifModel } from './massif-surface';

/**
 * 封界级 (BOUND) walls drawn as rocky, partly turfed massifs.
 *
 * The shape lives in `massif-surface.ts` so the grass and trees standing on a
 * range are placed on the same facets that are drawn here. This file turns
 * those facets into one flat-shaded mesh and decides, per facet, how much of
 * it is bare rock and how much is turf: steep faces and crest crags stay
 * stone, gentler shoulders and benches green over, and a deterministic patch
 * noise keeps the two from splitting along clean contour lines. The weight
 * goes to the `massif` material as `aVeg`; the vertex colour is pre-mixed to
 * match so the range reads as one hillside.
 */

/** World metres per texture tile on a slope. */
const TEXTURE_METERS = 7;

// The low end of a ridge is shaded stone under an open sky, so it stays a
// readable cool-warm grey rather than sinking toward dark olive.
const SLOPE_LOW = new THREE.Color(0x77806a);
const SLOPE_HIGH = new THREE.Color(0xb3ae99);
/** Turf: mossy green the district scatter tint pulls toward its own hue. */
const TURF_BASE = new THREE.Color(0x3a7a2c);

export function buildInteriorRidges(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): number {
  const model = massifModel();
  if (model.facets.length === 0) {
    return 0;
  }
  const builder = new FacetBuilder();
  for (const facet of model.facets) {
    builder.triangle(facet);
  }
  const mesh = new THREE.Mesh(
    track(builder.build()),
    materials.massif ?? materials.boundaryCliffFace,
  );
  mesh.name = 'interior-ridges';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  buildMassifSeeps(group, track);
  return model.massifs;
}

/** Unshared triangles, so every facet keeps its own hard normal. */
class FacetBuilder {
  private readonly positions: number[] = [];
  private readonly colours: number[] = [];
  private readonly uvs: number[] = [];
  private readonly vegetation: number[] = [];
  private readonly colour = new THREE.Color();
  private readonly turf = new THREE.Color();

  triangle(facet: MassifFacet): void {
    // Facet steepness from its own normal: 1 is flat, 0 is vertical.
    const ux = facet.b.x - facet.a.x;
    const uy = facet.b.y - facet.a.y;
    const uz = facet.b.z - facet.a.z;
    const vx = facet.c.x - facet.a.x;
    const vy = facet.c.y - facet.a.y;
    const vz = facet.c.z - facet.a.z;
    const ny = ux * vz - uz * vx;
    const length = Math.hypot(uy * vz - uz * vy, ny, uz * vx - ux * vz) || 1;
    const flatness = Math.abs(ny) / length;
    for (const point of [facet.a, facet.b, facet.c]) {
      this.vertex(point, facet.reliefMeters, flatness);
    }
  }

  private vertex(point: MassifVertex, reliefMeters: number, flatness: number): void {
    this.positions.push(point.x, point.y, point.z);
    // Vertical bedding. A top-down planar projection smears the texture to
    // nothing on the steep faces, which is most of a mountain.
    this.uvs.push((point.x + point.z) / TEXTURE_METERS, point.y / TEXTURE_METERS);
    // Climb is measured from the ground under this column, not from the
    // lowest corner of the triangle: a per-triangle datum restarts the ramp
    // on every facet and flattens the whole massif to its darkest tone.
    const climbMeters = Math.max(0, point.y - point.footY);
    const climb = Math.min(1, climbMeters / Math.max(1, reliefMeters));

    // Turf takes the gentler facets, thins toward the crags at the crest, and
    // breaks up into patches so no contour line shows where rock ends.
    const gentle = smoothstep(0.26, 0.7, flatness);
    const crest = 1 - 0.42 * smoothstep(0.78, 1, climb);
    const patch = 0.52 + 0.48 * noise2(point.x * 0.09 + 3.1, point.z * 0.09 + 7.7, 0x5eed);
    const vegetation = Math.max(0, Math.min(1, gentle * crest * patch * 1.48));
    this.vegetation.push(vegetation);

    this.colour.copy(SLOPE_LOW).lerp(SLOPE_HIGH, climb ** 0.7);
    this.turf
      .setHex(regionAt(point.x, point.z).scatter)
      .lerp(TURF_BASE, 0.55)
      .multiplyScalar(0.82 + 0.36 * climb);
    this.colour.lerp(this.turf, smoothstep(0.08, 0.58, vegetation));
    this.colours.push(this.colour.r, this.colour.g, this.colour.b);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute('aVeg', new THREE.Float32BufferAttribute(this.vegetation, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/**
 * Thin rills on the wooded shoulders of a massif.
 *
 * A green hillside with no water still reads as a dry mound. These strips sit
 * a few centimetres off the rock, share the boundary-river shader, and never
 * touch the sim: they are the same "wet slope" cue a painted concept would
 * put on the range without inventing new collision.
 */
function buildMassifSeeps(
  group: THREE.Group,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): void {
  const model = massifModel();
  const positions: number[] = [];
  const flows: number[] = [];
  const kinds: number[] = [];
  const indices: number[] = [];
  let seeps = 0;
  for (const facet of model.facets) {
    if (seeps >= 96) {
      break;
    }
    const pick = noise2(facet.a.x * 0.08, facet.a.z * 0.08, 0x51ee);
    if (pick > 0.2) {
      continue;
    }
    const points = [facet.a, facet.b, facet.c];
    points.sort((left, right) => left.y - right.y);
    const low = points[0];
    const high = points[2];
    if (!low || !high) {
      continue;
    }
    const drop = high.y - low.y;
    const run = Math.hypot(high.x - low.x, high.z - low.z);
    if (drop < 1.6 || run < 1.2 || drop / run > 3.6) {
      continue;
    }
    const nx = -(high.z - low.z) / run;
    const nz = (high.x - low.x) / run;
    const half = 0.22 + pick * 0.2;
    const lift = 0.06;
    const highLeft = vertexOffset(high, nx, nz, -half, lift);
    const highRight = vertexOffset(high, nx, nz, half, lift);
    const lowLeft = vertexOffset(low, nx, nz, -half * 1.35, lift);
    const lowRight = vertexOffset(low, nx, nz, half * 1.35, lift);
    const base = positions.length / 3;
    pushSeepVertex(positions, flows, kinds, highLeft, 0, 0);
    pushSeepVertex(positions, flows, kinds, highRight, 0, 1);
    pushSeepVertex(positions, flows, kinds, lowLeft, run, 0);
    pushSeepVertex(positions, flows, kinds, lowRight, run, 1);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    seeps += 1;
  }
  if (positions.length === 0) {
    return;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
  geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(track(geometry), createFlowWaterMaterial());
  mesh.name = 'massif-seeps';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  group.add(mesh);
}

function vertexOffset(
  point: MassifVertex,
  nx: number,
  nz: number,
  width: number,
  lift: number,
): readonly [number, number, number] {
  return [point.x + nx * width, point.y + lift, point.z + nz * width];
}

function pushSeepVertex(
  positions: number[],
  flows: number[],
  kinds: number[],
  point: readonly [number, number, number],
  along: number,
  across: number,
): void {
  positions.push(point[0], point[1], point[2]);
  flows.push(along, across);
  kinds.push(0);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
