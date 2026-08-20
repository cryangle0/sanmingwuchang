import { MAP_BOUNDARY, type MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';
import { createRandomStream } from './map-sampling';

/**
 * The world beyond the boundary cliffs.
 *
 * The playfield ends at the 21-point boundary polygon; without treatment the
 * camera sees raw fog colour past the cliff edge and the world reads as a
 * floating slab. Two cheap layers fix that: an ink-dark apron ring hugging
 * the boundary so there is always ground under the horizon, and two rings of
 * jagged low-poly ridge silhouettes that step down into the fog like an ink
 * painting's distant mountains. Three draw calls, all static.
 */

const MM = 1_000;

/** How far the apron extends past the boundary, metres. */
const APRON_DEPTH = 320;

export function buildBeyond(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  seed: number,
): void {
  buildApron(group, materials, track);
  const nextRandom = createRandomStream(seed ^ 0x51f0b3d1);
  buildRidges(group, materials, track, nextRandom);
}

/**
 * A flat ring from every boundary edge outward: inner vertices sit exactly on
 * the boundary polygon (slightly below the floor to avoid z-fighting with the
 * cliff bases), outer vertices push radially away from the polygon centroid.
 */
function buildApron(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): void {
  const centroid = boundaryCentroidMeters();
  const positions: number[] = [];
  const push = (x: number, z: number): void => {
    positions.push(x, -0.12, z);
  };
  for (let index = 0; index < MAP_BOUNDARY.length; index += 1) {
    const a = MAP_BOUNDARY[index] as MapPointMm;
    const b = MAP_BOUNDARY[(index + 1) % MAP_BOUNDARY.length] as MapPointMm;
    const inner = [toOuterPoint(a, centroid, 0), toOuterPoint(b, centroid, 0)];
    const outer = [toOuterPoint(a, centroid, APRON_DEPTH), toOuterPoint(b, centroid, APRON_DEPTH)];
    const [ia, ib] = inner as [{ x: number; z: number }, { x: number; z: number }];
    const [oa, ob] = outer as [{ x: number; z: number }, { x: number; z: number }];
    // Boundary rings are sim-CCW, so inner→outer quads wound this way face +Y.
    push(ia.x, ia.z);
    push(ob.x, ob.z);
    push(oa.x, oa.z);
    push(ia.x, ia.z);
    push(ib.x, ib.z);
    push(ob.x, ob.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(track(geometry), materials.beyondApron);
  mesh.receiveShadow = false;
  group.add(mesh);
}

/**
 * Two rings of irregular pyramid silhouettes outside the boundary. The near
 * ring is taller and denser; the far ring is lower, darker and offset half a
 * step so gaps in the first ring show a second ridge line, not the void.
 */
function buildRidges(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  nextRandom: () => number,
): void {
  const centroid = boundaryCentroidMeters();
  const perimeter = boundaryPerimeterPoints(11);

  const rings: readonly {
    readonly material: THREE.Material;
    readonly offset: number;
    readonly spacing: number;
    readonly minHeight: number;
    readonly maxHeight: number;
    readonly phase: number;
  }[] = [
    // The orthographic camera only ever sees ~45 m past the boundary, so the
    // ridges hug the cliffs: a dense low band right outside, then a taller
    // sparser band behind it.
    {
      material: materials.beyondRidgeNear,
      offset: 5,
      spacing: 1,
      minHeight: 4,
      maxHeight: 9,
      phase: 0,
    },
    {
      material: materials.beyondRidgeFar,
      offset: 16,
      spacing: 2,
      minHeight: 8,
      maxHeight: 16,
      phase: 1,
    },
  ];

  const cone = track(new THREE.ConeGeometry(1, 1, 5, 1));
  // Base at y=0 so vertical scale is the ridge height directly.
  cone.translate(0, 0.5, 0);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();

  for (const ring of rings) {
    const slots: { x: number; z: number }[] = [];
    for (let index = ring.phase; index < perimeter.length; index += ring.spacing) {
      slots.push(perimeter[index] as { x: number; z: number });
    }
    const instanced = new THREE.InstancedMesh(cone, ring.material, slots.length);
    const tint = new THREE.Color();
    slots.forEach((slot, index) => {
      const jitter = ring.offset + nextRandom() * 14;
      const outward = outwardOf(slot, centroid);
      const height = ring.minHeight + nextRandom() * (ring.maxHeight - ring.minHeight);
      const radius = height * (0.9 + nextRandom() * 0.8);
      euler.set(0, nextRandom() * Math.PI * 2, 0);
      quaternion.setFromEuler(euler);
      scale.set(radius, height, radius * (0.7 + nextRandom() * 0.6));
      position.set(
        slot.x + outward.x * jitter,
        // Sunk slightly so ragged cone bases never hover over the apron.
        -2,
        slot.z + outward.z * jitter,
      );
      matrix.compose(position, quaternion, scale);
      instanced.setMatrixAt(index, matrix);
      // Brightness jitter breaks the ridge line into individual peaks.
      tint.setScalar(0.82 + nextRandom() * 0.36);
      instanced.setColorAt(index, tint);
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) {
      instanced.instanceColor.needsUpdate = true;
    }
    group.add(instanced);
  }
}

/** Points spaced roughly `stepMeters` apart along the whole boundary. */
function boundaryPerimeterPoints(stepMeters: number): readonly { x: number; z: number }[] {
  const points: { x: number; z: number }[] = [];
  for (let index = 0; index < MAP_BOUNDARY.length; index += 1) {
    const a = MAP_BOUNDARY[index] as MapPointMm;
    const b = MAP_BOUNDARY[(index + 1) % MAP_BOUNDARY.length] as MapPointMm;
    const ax = a.x / MM;
    const az = a.z / MM;
    const bx = b.x / MM;
    const bz = b.z / MM;
    const stepCount = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / stepMeters));
    for (let step = 0; step < stepCount; step += 1) {
      const t = step / stepCount;
      points.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t });
    }
  }
  return points;
}

function toOuterPoint(
  point: MapPointMm,
  centroid: { x: number; z: number },
  pushMeters: number,
): { x: number; z: number } {
  const x = point.x / MM;
  const z = point.z / MM;
  if (pushMeters === 0) {
    return { x, z };
  }
  const outward = outwardOf({ x, z }, centroid);
  return { x: x + outward.x * pushMeters, z: z + outward.z * pushMeters };
}

function outwardOf(
  point: { x: number; z: number },
  centroid: { x: number; z: number },
): { x: number; z: number } {
  const dx = point.x - centroid.x;
  const dz = point.z - centroid.z;
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
