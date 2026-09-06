import { MAP_BOUNDARY, type MapPointMm, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { createFlowWaterMaterial } from '../shading/flow-water';
import type { MapMaterialLibrary } from './map-palette';

/**
 * The map edge as a river that spills over a cliff.
 *
 * Immediately outside the boundary polygon a short river lip runs the whole
 * rim, then drops as a waterfall the camera can read from inside the map.
 * The player still cannot leave: the sim clamps every move inside MAP_BOUNDARY,
 * so this only has to make that limit look like a real one — nobody walks
 * into a river that is visibly going over a fall.
 *
 * Three cheap layers, all static geometry with animated shaders:
 *  - a rock bank lip (the ground overhangs the polygon by up to one 4 m
 *    lattice cell, so the bank covers that ragged edge),
 *  - the river sheet + waterfall face in one strip so the flow attribute is
 *    continuous over the lip,
 *  - a spray mist plane hanging below the lip.
 *
 * Nothing here is sampled by the simulation.
 */

const MM = 1_000;
const RIM_STEP_METERS = 4;
/** Bank rock from the polygon outward, then the river starts. */
export const BANK_WIDTH_METERS = 3.2;
/** River width out to the lip. Kept short so the fall sits in the rim view. */
export const RIVER_WIDTH_METERS = 4.8;
/** How far the waterfall face drops below the lip. */
export const FALL_DROP_METERS = 48;
/** Fall face leans back outward as it descends. Small so the curtain stays readable. */
const FALL_LEAN_METERS = 2.4;
const RIVER_SURFACE_BELOW_BANK = 0.9;
const BANK_HEIGHT_ABOVE_GROUND = 0.55;

interface RimSample {
  readonly x: number;
  readonly z: number;
  readonly outX: number;
  readonly outZ: number;
  readonly groundY: number;
  readonly distance: number;
}

export function buildBoundaryRiver(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): void {
  const rim = sampleRim();
  if (rim.length < 3) {
    return;
  }
  buildBank(group, materials, track, rim);
  buildCliff(group, materials, track, rim);
  buildRiverAndFall(group, track, rim);
  buildMist(group, track, rim);
}

/** Levelled water height along the rim so the sheet never runs uphill. */
function smoothedLevels(rim: readonly RimSample[]): Float32Array {
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

function buildBank(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  rim: readonly RimSample[],
): void {
  const levels = smoothedLevels(rim);
  const positions: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const count = rim.length;
  // Ring vertices: inner (on the polygon, under the ground), crest, outer
  // (dropping to the river bed).
  for (let index = 0; index < count; index += 1) {
    const sample = rim[index] as RimSample;
    const level = levels[index] as number;
    const crestY = Math.max(sample.groundY, level) + BANK_HEIGHT_ABOVE_GROUND;
    const bedY = level - RIVER_SURFACE_BELOW_BANK - 1.2;
    const u = sample.distance / 9;
    const push = (offset: number, y: number, shade: number, v: number): void => {
      positions.push(sample.x + sample.outX * offset, y, sample.z + sample.outZ * offset);
      uvs.push(u, v);
      colours.push(shade, shade * 0.98, shade * 0.94);
    };
    // The ground lattice overhangs the polygon by up to one 4 m cell, so the
    // crest sits past that and the bank hides the ragged edge.
    push(-2.2, sample.groundY - 0.35, 0.72, 0);
    push(4.4, crestY, 0.95, 0.35);
    push(BANK_WIDTH_METERS, bedY, 0.62, 0.8);
    push(BANK_WIDTH_METERS + 1.5, bedY - 0.4, 0.5, 1);
  }
  const ringSize = 4;
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
  const mesh = new THREE.Mesh(track(geometry), materials.boundaryCliffFace);
  mesh.name = 'boundary-river-bank';
  mesh.receiveShadow = true;
  group.add(mesh);
}

/** Dark rock face under the lip; the water sheet tears open to show it. */
function buildCliff(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  rim: readonly RimSample[],
): void {
  const levels = smoothedLevels(rim);
  const positions: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const count = rim.length;
  const lip = BANK_WIDTH_METERS + RIVER_WIDTH_METERS;
  const profile: readonly { offset: number; drop: number; shade: number }[] = [
    { offset: lip - 0.6, drop: -0.2, shade: 0.5 },
    { offset: lip + 0.4, drop: 2.5, shade: 0.38 },
    { offset: lip + FALL_LEAN_METERS * 0.45, drop: FALL_DROP_METERS * 0.5, shade: 0.24 },
    { offset: lip + FALL_LEAN_METERS - 0.8, drop: FALL_DROP_METERS + 6, shade: 0.12 },
  ];
  for (let index = 0; index < count; index += 1) {
    const sample = rim[index] as RimSample;
    const surface = (levels[index] as number) - RIVER_SURFACE_BELOW_BANK;
    const u = sample.distance / 9;
    for (const step of profile) {
      positions.push(
        sample.x + sample.outX * step.offset,
        surface - step.drop,
        sample.z + sample.outZ * step.offset,
      );
      uvs.push(u, step.drop / 9);
      colours.push(step.shade, step.shade * 1.02, step.shade * 1.04);
    }
  }
  const ringSize = profile.length;
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
  const mesh = new THREE.Mesh(track(geometry), materials.boundaryCliffFace);
  mesh.name = 'boundary-river-cliff';
  mesh.receiveShadow = true;
  group.add(mesh);
}

function buildRiverAndFall(
  group: THREE.Group,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  rim: readonly RimSample[],
): void {
  const levels = smoothedLevels(rim);
  const positions: number[] = [];
  const flows: number[] = [];
  const kinds: number[] = [];
  const indices: number[] = [];
  const count = rim.length;
  // Profile across the strip: bank edge → mid river → lip → fall top → fall
  // mid → fall bottom.
  const profile: readonly { offset: number; drop: number; flowY: number; kind: number }[] = [
    { offset: BANK_WIDTH_METERS - 0.2, drop: 0, flowY: 0, kind: 0 },
    { offset: BANK_WIDTH_METERS + RIVER_WIDTH_METERS * 0.45, drop: 0.08, flowY: 0.45, kind: 0 },
    { offset: BANK_WIDTH_METERS + RIVER_WIDTH_METERS, drop: 0.35, flowY: 1, kind: 0 },
    { offset: BANK_WIDTH_METERS + RIVER_WIDTH_METERS + 0.35, drop: 1.1, flowY: 0, kind: 1 },
    { offset: BANK_WIDTH_METERS + RIVER_WIDTH_METERS + 0.8, drop: 5.5, flowY: 0.12, kind: 1 },
    {
      offset: BANK_WIDTH_METERS + RIVER_WIDTH_METERS + FALL_LEAN_METERS * 0.45,
      drop: FALL_DROP_METERS * 0.48,
      flowY: 0.5,
      kind: 1,
    },
    {
      offset: BANK_WIDTH_METERS + RIVER_WIDTH_METERS + FALL_LEAN_METERS,
      drop: FALL_DROP_METERS,
      flowY: 1,
      kind: 1,
    },
  ];
  for (let index = 0; index < count; index += 1) {
    const sample = rim[index] as RimSample;
    const surface = (levels[index] as number) - RIVER_SURFACE_BELOW_BANK;
    for (const step of profile) {
      positions.push(
        sample.x + sample.outX * step.offset,
        surface - step.drop,
        sample.z + sample.outZ * step.offset,
      );
      flows.push(sample.distance, step.flowY);
      kinds.push(step.kind);
    }
  }
  const ringSize = profile.length;
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
  const mesh = new THREE.Mesh(track(geometry), createFlowWaterMaterial());
  mesh.name = 'boundary-river';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  group.add(mesh);
}

function buildMist(
  group: THREE.Group,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  rim: readonly RimSample[],
): void {
  const levels = smoothedLevels(rim);
  const positions: number[] = [];
  const flows: number[] = [];
  const kinds: number[] = [];
  const indices: number[] = [];
  const count = rim.length;
  const lip = BANK_WIDTH_METERS + RIVER_WIDTH_METERS;
  const profile: readonly { offset: number; drop: number; flowY: number }[] = [
    { offset: lip - 0.6, drop: -0.35, flowY: 0 },
    { offset: lip + 1.2, drop: 3.5, flowY: 0.4 },
    { offset: lip + 6, drop: 16, flowY: 1 },
  ];
  for (let index = 0; index < count; index += 1) {
    const sample = rim[index] as RimSample;
    const surface = (levels[index] as number) - RIVER_SURFACE_BELOW_BANK;
    for (const step of profile) {
      positions.push(
        sample.x + sample.outX * step.offset,
        surface - step.drop,
        sample.z + sample.outZ * step.offset,
      );
      flows.push(sample.distance, step.flowY);
      kinds.push(0);
    }
  }
  const ringSize = profile.length;
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
  const mesh = new THREE.Mesh(track(geometry), createFlowWaterMaterial({ mist: true }));
  mesh.name = 'boundary-river-mist';
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
