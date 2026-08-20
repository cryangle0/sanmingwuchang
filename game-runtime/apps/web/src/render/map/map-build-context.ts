/**
 * The contract every map builder shares.
 *
 * Builders never own disposal: they register geometries and meshes through the
 * context, and the environment coordinator tears everything down in one pass.
 * That keeps each builder a pure "read compiled geometry, emit meshes" module
 * and makes it impossible to leak a geometry by forgetting a dispose branch.
 */

import type * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';

export interface MapBuildContext {
  /** Root the builder must attach its output to. */
  readonly group: THREE.Group;
  readonly materials: MapMaterialLibrary;
  /**
   * Deterministic seed derived from the compiled map geometry hash. Builders
   * must derive their own sub-seeds from it rather than using Math.random, so
   * two clients on the same map build identical dressing.
   */
  readonly seed: number;
  /** Registers a geometry for disposal and returns it unchanged. */
  track<T extends THREE.BufferGeometry>(geometry: T): T;
  /** Builds, tracks and parents a mesh in one call. */
  addMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    options?: { readonly castShadow?: boolean; readonly receiveShadow?: boolean },
  ): THREE.Mesh;
}

/**
 * A builder that needs per-frame work returns one of these. Builders with no
 * animation return void.
 */
export interface MapDynamicLayer {
  /** Called once per rendered frame with the elapsed seconds since boot. */
  update(elapsedSeconds: number, matchTick: number): void;
}
