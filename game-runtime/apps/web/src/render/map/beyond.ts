import type * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';
import { buildOcean } from './ocean';

/**
 * The world beyond the boundary river.
 *
 * The playfield ends at the 21-point boundary polygon; without treatment the
 * camera sees raw fog colour past the falls and the world reads as a floating
 * slab. Earlier passes filled that with an ink-dark apron and, before that,
 * with ridge silhouettes; both read as a painted floor. The rim is a river
 * going over a fall, so what lies below is a sea: see `ocean.ts`.
 */
export function buildBeyond(
  group: THREE.Group,
  _materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  _seed: number,
): void {
  buildOcean(group, track);
}
