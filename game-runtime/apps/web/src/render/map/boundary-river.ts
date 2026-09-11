import { MAP_BOUNDARY, type MapPointMm, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { createFlowWaterMaterial } from '../shading/flow-water';
import type { MapMaterialLibrary } from './map-palette';
import { regionBlendAt } from './map-regions';

/**
 * The map edge as a river that spills over a cliff into the sea.
 *
 * Immediately outside the boundary polygon a grassy bank steps down to a
 * river running the whole rim, then the water drops as a waterfall the camera
 * can read from inside the map and lands in the sea built by `ocean.ts`. The
 * player still cannot leave: the sim clamps every move inside MAP_BOUNDARY,
 * so this only has to make that limit look like a real one — nobody walks
 * into a river that is visibly going over a fall.
 *
 * Layers, all static geometry with animated shaders where they move:
 *  - a grass bank top that carries the district ground colour past the polygon
 *    (the ground lattice overhangs the boundary by up to one 4 m cell, so this
 *    strip hides that ragged edge and the map no longer ends on bare rock),
 *  - the rock face from the bank crest down to the river bed,
 *  - the cliff under the lip, which the fall sheet tears open to show,
 *  - the river sheet + waterfall face in one strip so the flow attribute is
 *    continuous over the lip,
 *  - spray mist hanging below the lip and a second plume rising off the
 *    plunge pool.
 *
 * The rim's ground level varies by more than fifteen metres, so the fall is
 * not a fixed drop: every column falls exactly as far as it needs to reach
 * the one flat sea level, and `FALL_DROP_METERS` is the drop at the lowest
 * point of the rim.
 *
 * Nothing here is sampled by the simulation.
 */

const MM = 1_000;
const RIM_STEP_METERS = 4;
/** Bank from the polygon outward to the water's edge. */
export const BANK_WIDTH_METERS = 4.6;
/** River width out to the lip. Kept short so the fall sits in the rim view. */
export const RIVER_WIDTH_METERS = 5.4;
/** Waterfall drop at the lowest point of the rim; taller columns fall further. */
export const FALL_DROP_METERS = 48;
/** Fall face leans back outward as it descends. Small so the curtain stays readable. */
export const FALL_LEAN_METERS = 2.4;
export const RIVER_SURFACE_BELOW_BANK = 0.9;
const BANK_HEIGHT_ABOVE_GROUND = 0.55;
const BANK_CREST_OFFSET_METERS = BANK_WIDTH_METERS - 0.2;
const NEUTRAL_LIGHT = new THREE.Color(0xeee9d7);

export interface RimSample {
  readonly x: number;
  readonly z: number;
  readonly outX: number;
  readonly outZ: number;
  readonly groundY: number;
  readonly distance: number;
}

type Track = <T extends THREE.BufferGeometry>(geometry: T) => T;

/** Offset of the waterfall lip from the boundary polygon, metres. */
export function riverLipOffsetMeters(): number {
  return BANK_WIDTH_METERS + RIVER_WIDTH_METERS;
}

export function buildBoundaryRiver(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: Track,
): void {
  const rim = sampleRim();
  if (rim.length < 3) {
    return;
  }
  const levels = smoothedLevels(rim);
  const surfaces = riverSurfaceLevels(rim, levels);
  const sea = seaLevelMeters(surfaces);
  buildBankTop(group, materials, track, rim, levels);
  buildBankFace(group, materials, track, rim, levels);
  buildCliff(group, materials, track, rim, surfaces, sea);
  buildRiverAndFall(group, track, rim, surfaces, sea);
  buildMist(group, track, rim, surfaces);
  buildPlungeMist(group, track, rim, sea);
}

/** Levelled water height along the rim so the sheet never runs uphill. */
export function smoothedLevels(rim: readonly RimSample[]): Float32Array {
  const count = rim.length;
  const levels = new Float32Array(count);
  const window = 9;
  for (let index = 0; index < count; index += 1) {
    let sum = 0;
    for (let offset = -window; offset <= window; offset += 1) {
      sum += (rim[(index + offset + count) % count] as RimSample).groundY;
    }
    levels[index] = sum / (window * 2 + 1);
  }
  return levels;
}

/** River surface height per rim sample. */
export function riverSurfaceLevels(
  rim: readonly RimSample[],
  levels: Float32Array = smoothedLevels(rim),
): Float32Array {
  const surfaces = new Float32Array(levels.length);
  for (let index = 0; index < levels.length; index += 1) {
    surfaces[index] = (levels[index] as number) - RIVER_SURFACE_BELOW_BANK;
  }
  return surfaces;
}

/**
 * The one sea level every fall reaches: the lowest river surface on the rim
 * less the authored drop. Higher stretches of rim fall further to meet it.
 */
export function seaLevelMeters(surfaces: Float32Array): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (const surface of surfaces) {
    lowest = Math.min(lowest, surface);
  }
  return (Number.isFinite(lowest) ? lowest : 0) - FALL_DROP_METERS;
}

interface RingProfileStep {
  readonly offset: number;
  readonly y: number;
  readonly shade: number;
  readonly v: number;
}

function ringGeometry(
  rim: readonly RimSample[],
  profile: (sample: RimSample, index: number) => readonly RingProfileStep[],
  colourAt: (sample: RimSample, step: RingProfileStep) => THREE.Color,
  uvAt: (
    sample: RimSample,
    step: RingProfileStep,
    x: number,
    z: number,
  ) => readonly [number, number],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const count = rim.length;
  let ringSize = 0;
  for (let index = 0; index < count; index += 1) {
    const sample = rim[index] as RimSample;
    const steps = profile(sample, index);
    ringSize = steps.length;
    for (const step of steps) {
      const x = sample.x + sample.outX * step.offset;
      const z = sample.z + sample.outZ * step.offset;
      positions.push(x, step.y, z);
      const uv = uvAt(sample, step, x, z);
      uvs.push(uv[0], uv[1]);
      const colour = colourAt(sample, step);
      colours.push(colour.r, colour.g, colour.b);
    }
  }
  for (let index = 0; index < count; index += 1) {
    const a = index * ringSize;
    const b = ((index + 1) % count) * ringSize;
    for (let ring = 0; ring < ringSize - 1; ring += 1) {
      indices.push(a + ring, b + ring, a + ring + 1, b + ring, b + ring + 1, a + ring + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Grass shelf from under the ground lattice out to the bank crest, coloured
 * from the same district palette as the ground so the playfield runs
 * continuously to the water instead of stopping on a rock kerb.
 */
function buildBankTop(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: Track,
  rim: readonly RimSample[],
  levels: Float32Array,
): void {
  const primary = new THREE.Color();
  const secondary = new THREE.Color();
  const colour = new THREE.Color();
  const geometry = ringGeometry(
    rim,
    (sample, index) => {
      const level = levels[index] as number;
      const shelfY = Math.max(sample.groundY, level);
      return [
        { offset: -2.2, y: sample.groundY - 0.35, shade: 0.92, v: 0 },
        { offset: 1.6, y: shelfY + 0.28, shade: 1, v: 0.4 },
        {
          offset: BANK_CREST_OFFSET_METERS,
          y: shelfY + BANK_HEIGHT_ABOVE_GROUND,
          shade: 0.9,
          v: 1,
        },
      ];
    },
    (sample, step) => {
      const blend = regionBlendAt(sample.x, sample.z);
      primary.setHex(blend.primary.ground);
      secondary.setHex(blend.secondary.ground);
      colour.copy(primary).lerp(secondary, blend.mix).lerp(NEUTRAL_LIGHT, 0.38);
      return colour.multiplyScalar(step.shade);
    },
    (_sample, _step, x, z) => [x / 15, z / 15],
  );
  const mesh = new THREE.Mesh(track(geometry), materials.riverBank ?? materials.boundaryCliffFace);
  mesh.name = 'boundary-river-bank-top';
  mesh.receiveShadow = true;
  group.add(mesh);
}

/** Rock from the bank crest down into the river bed. */
function buildBankFace(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: Track,
  rim: readonly RimSample[],
  levels: Float32Array,
): void {
  const colour = new THREE.Color();
  const geometry = ringGeometry(
    rim,
    (sample, index) => {
      const level = levels[index] as number;
      const crestY = Math.max(sample.groundY, level) + BANK_HEIGHT_ABOVE_GROUND;
      const bedY = level - RIVER_SURFACE_BELOW_BANK - 1.2;
      return [
        { offset: BANK_CREST_OFFSET_METERS, y: crestY, shade: 0.95, v: 0 },
        { offset: BANK_CREST_OFFSET_METERS + 0.35, y: crestY - 0.6, shade: 0.8, v: 0.25 },
        { offset: BANK_WIDTH_METERS + 0.3, y: bedY, shade: 0.6, v: 0.8 },
        { offset: BANK_WIDTH_METERS + 1.6, y: bedY - 0.5, shade: 0.5, v: 1 },
      ];
    },
    (_sample, step) => colour.setRGB(step.shade, step.shade * 0.98, step.shade * 0.94),
    (sample, step) => [sample.distance / 9, step.v],
  );
  const mesh = new THREE.Mesh(track(geometry), materials.boundaryCliffFace);
  mesh.name = 'boundary-river-bank';
  mesh.receiveShadow = true;
  group.add(mesh);
}

/** Dark rock face under the lip; the water sheet tears open to show it. */
function buildCliff(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: Track,
  rim: readonly RimSample[],
  surfaces: Float32Array,
  sea: number,
): void {
  const lip = riverLipOffsetMeters();
  const colour = new THREE.Color();
  const geometry = ringGeometry(
    rim,
    (_sample, index) => {
      const surface = surfaces[index] as number;
      const drop = surface - sea;
      return [
        { offset: lip - 0.6, y: surface + 0.2, shade: 0.5, v: 0 },
        { offset: lip + 0.4, y: surface - 2.5, shade: 0.38, v: 2.5 / 9 },
        {
          offset: lip + FALL_LEAN_METERS * 0.45,
          y: surface - drop * 0.5,
          shade: 0.24,
          v: (drop * 0.5) / 9,
        },
        { offset: lip + FALL_LEAN_METERS - 0.8, y: sea - 6, shade: 0.12, v: (drop + 6) / 9 },
      ];
    },
    (_sample, step) => colour.setRGB(step.shade, step.shade * 1.02, step.shade * 1.04),
    (sample, step) => [sample.distance / 9, step.v],
  );
  const mesh = new THREE.Mesh(track(geometry), materials.boundaryCliffFace);
  mesh.name = 'boundary-river-cliff';
  mesh.receiveShadow = true;
  group.add(mesh);
}

interface FlowStep {
  readonly offset: number;
  readonly y: number;
  readonly flowY: number;
  readonly kind: number;
}

function flowGeometry(
  rim: readonly RimSample[],
  profile: (sample: RimSample, index: number) => readonly FlowStep[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const flows: number[] = [];
  const kinds: number[] = [];
  const indices: number[] = [];
  const count = rim.length;
  let ringSize = 0;
  for (let index = 0; index < count; index += 1) {
    const sample = rim[index] as RimSample;
    const steps = profile(sample, index);
    ringSize = steps.length;
    for (const step of steps) {
      positions.push(
        sample.x + sample.outX * step.offset,
        step.y,
        sample.z + sample.outZ * step.offset,
      );
      flows.push(sample.distance, step.flowY);
      kinds.push(step.kind);
    }
  }
  for (let index = 0; index < count; index += 1) {
    const a = index * ringSize;
    const b = ((index + 1) % count) * ringSize;
    for (let ring = 0; ring < ringSize - 1; ring += 1) {
      indices.push(a + ring, b + ring, a + ring + 1, b + ring, b + ring + 1, a + ring + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
  geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function buildRiverAndFall(
  group: THREE.Group,
  track: Track,
  rim: readonly RimSample[],
  surfaces: Float32Array,
  sea: number,
): void {
  const lip = riverLipOffsetMeters();
  // Profile across the strip: bank edge → mid river → lip → fall top → fall
  // mid → fall bottom, which lands exactly on the sea.
  const geometry = flowGeometry(rim, (_sample, index) => {
    const surface = surfaces[index] as number;
    const drop = surface - sea;
    return [
      { offset: BANK_WIDTH_METERS - 0.2, y: surface, flowY: 0, kind: 0 },
      {
        offset: BANK_WIDTH_METERS + RIVER_WIDTH_METERS * 0.45,
        y: surface - 0.08,
        flowY: 0.45,
        kind: 0,
      },
      { offset: lip, y: surface - 0.35, flowY: 1, kind: 0 },
      { offset: lip + 0.35, y: surface - 1.1, flowY: 0, kind: 1 },
      { offset: lip + 0.8, y: surface - 5.5, flowY: 0.12, kind: 1 },
      { offset: lip + FALL_LEAN_METERS * 0.45, y: surface - drop * 0.48, flowY: 0.5, kind: 1 },
      { offset: lip + FALL_LEAN_METERS, y: sea, flowY: 1, kind: 1 },
    ];
  });
  const mesh = new THREE.Mesh(track(geometry), createFlowWaterMaterial());
  mesh.name = 'boundary-river';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  group.add(mesh);
}

function buildMist(
  group: THREE.Group,
  track: Track,
  rim: readonly RimSample[],
  surfaces: Float32Array,
): void {
  const lip = riverLipOffsetMeters();
  const geometry = flowGeometry(rim, (_sample, index) => {
    const surface = surfaces[index] as number;
    return [
      { offset: lip - 0.6, y: surface + 0.35, flowY: 0, kind: 0 },
      { offset: lip + 1.2, y: surface - 3.5, flowY: 0.4, kind: 0 },
      { offset: lip + 6, y: surface - 16, flowY: 1, kind: 0 },
    ];
  });
  const mesh = new THREE.Mesh(track(geometry), createFlowWaterMaterial({ mist: true }));
  mesh.name = 'boundary-river-mist';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  group.add(mesh);
}

/** Spray plume rising off the plunge pool where the falls hit the sea. */
function buildPlungeMist(
  group: THREE.Group,
  track: Track,
  rim: readonly RimSample[],
  sea: number,
): void {
  const foot = riverLipOffsetMeters() + FALL_LEAN_METERS;
  const geometry = flowGeometry(rim, () => [
    { offset: foot - 1.4, y: sea - 0.55, flowY: 0, kind: 0 },
    { offset: foot + 4.8, y: sea + 6.8, flowY: 0.32, kind: 0 },
    { offset: foot + 14, y: sea + 9.5, flowY: 0.62, kind: 0 },
    { offset: foot + 26, y: sea + 2.4, flowY: 1, kind: 0 },
  ]);
  const mesh = new THREE.Mesh(track(geometry), createFlowWaterMaterial({ mist: true }));
  mesh.name = 'boundary-river-plunge-mist';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  group.add(mesh);
}

export function sampleRim(): readonly RimSample[] {
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
      const dx = x - centroid.x;
      const dz = z - centroid.z;
      const length = Math.hypot(dx, dz) || 1;
      samples.push({
        x,
        z,
        outX: dx / length,
        outZ: dz / length,
        groundY: terrainHeightMeters(x, z),
        distance,
      });
      distance += edgeLength / steps;
    }
  }
  return samples;
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
