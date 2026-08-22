import { MAP_BOUNDARY, type MapPointMm, terrainHeightMeters } from '@jwgb/content';
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
const APRON_DEPTH = 760;
/**
 * Ground level beyond the rim. The boundary wall rises 34-49 m, so everything
 * out here is hidden below the crest except the ridge tops; the apron only
 * has to stop the void showing through a cleft.
 */
const BEYOND_FLOOR = -6;

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
  const push = (x: number, z: number, y: number): void => {
    positions.push(x, y, z);
  };
  for (let index = 0; index < MAP_BOUNDARY.length; index += 1) {
    const a = MAP_BOUNDARY[index] as MapPointMm;
    const b = MAP_BOUNDARY[(index + 1) % MAP_BOUNDARY.length] as MapPointMm;
    const inner = [toOuterPoint(a, centroid, 0), toOuterPoint(b, centroid, 0)];
    const outer = [toOuterPoint(a, centroid, APRON_DEPTH), toOuterPoint(b, centroid, APRON_DEPTH)];
    const [ia, ib] = inner as [{ x: number; z: number }, { x: number; z: number }];
    const [oa, ob] = outer as [{ x: number; z: number }, { x: number; z: number }];
    const innerYa = terrainHeightMeters(ia.x, ia.z) - 0.08;
    const innerYb = terrainHeightMeters(ib.x, ib.z) - 0.08;
    push(ia.x, ia.z, innerYa);
    push(ob.x, ob.z, BEYOND_FLOOR);
    push(oa.x, oa.z, BEYOND_FLOOR);
    push(ia.x, ia.z, innerYa);
    push(ib.x, ib.z, innerYb);
    push(ob.x, ob.z, BEYOND_FLOOR);
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
    readonly spread: number;
    readonly spacing: number;
    readonly minHeight: number;
    readonly maxHeight: number;
    readonly minRadius: number;
    readonly maxRadius: number;
    readonly phase: number;
  }[] = [
    // Both bands have to out-top a 34-49 m wall to be seen at all, so they
    // stand well back and read as distant massifs above the crest.
    //
    // Radius is authored, not derived from height. Scaling it with height —
    // which was safe while peaks were 4-16 m — turned 120 m peaks into cones
    // 300 m across that swallowed the entire playfield and trapped the camera
    // inside their walls.
    {
      material: materials.beyondRidgeNear,
      offset: 300,
      spread: 90,
      spacing: 3,
      minHeight: 70,
      maxHeight: 120,
      minRadius: 55,
      maxRadius: 95,
      phase: 0,
    },
    {
      material: materials.beyondRidgeFar,
      offset: 520,
      spread: 140,
      spacing: 5,
      minHeight: 110,
      maxHeight: 185,
      minRadius: 90,
      maxRadius: 150,
      phase: 2,
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
      const jitter = ring.offset + nextRandom() * ring.spread;
      const outward = outwardOf(slot, centroid);
      const height = ring.minHeight + nextRandom() * (ring.maxHeight - ring.minHeight);
      const radius = ring.minRadius + nextRandom() * (ring.maxRadius - ring.minRadius);
      euler.set(0, nextRandom() * Math.PI * 2, 0);
      quaternion.setFromEuler(euler);
      scale.set(radius, height, radius * (0.7 + nextRandom() * 0.6));
      position.set(
        slot.x + outward.x * jitter,
        // Rooted on the outer ground; only the upper parts clear the wall.
        BEYOND_FLOOR,
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
