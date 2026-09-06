import { MAP_BOUNDARY, type MapPointMm, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';

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
 * The boundary river spills over a waterfall just outside the rim, so the
 * apron starts past the foot of the fall and the floor sits at the bottom of
 * that drop. Ridges are rooted on this floor and read as distant massifs
 * behind the falls.
 */
const APRON_INNER_OFFSET = 14;
const BEYOND_FLOOR = -56;

export function buildBeyond(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  _seed: number,
): void {
  // No ridge silhouettes: the rim is a river going over a fall into fog, and
  // the player asked for the edge to read as water, not mountains.
  buildApron(group, materials, track);
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
    const inner = [
      toOuterPoint(a, centroid, APRON_INNER_OFFSET),
      toOuterPoint(b, centroid, APRON_INNER_OFFSET),
    ];
    const outer = [toOuterPoint(a, centroid, APRON_DEPTH), toOuterPoint(b, centroid, APRON_DEPTH)];
    const [ia, ib] = inner as [{ x: number; z: number }, { x: number; z: number }];
    const [oa, ob] = outer as [{ x: number; z: number }, { x: number; z: number }];
    const innerYa = terrainHeightMeters(a.x / MM, a.z / MM) - 46;
    const innerYb = terrainHeightMeters(b.x / MM, b.z / MM) - 46;
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
