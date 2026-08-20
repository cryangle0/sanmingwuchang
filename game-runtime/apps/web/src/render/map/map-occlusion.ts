import * as THREE from 'three';
import { type GeometryBag, mergeMixedParts } from './dressing/prop-kit';

export interface MapOcclusionDiagnostics {
  readonly active: boolean;
  readonly roofOpacity: number;
  readonly roofIntersections: number;
  readonly roofMeshCount: number;
  readonly treeOpacity: number;
  readonly treeIntersections: number;
  readonly treeCount: number;
  readonly activeTreeCount: number;
  readonly fadingTreeCount: number;
  readonly activeTreeIds: readonly string[];
  readonly occluderCount: number;
  readonly activeOccluderCount: number;
  readonly fadingOccluderCount: number;
  readonly activeOccluderIds: readonly string[];
}

export interface MapRoofOccluderSource {
  readonly id: string;
  readonly geometries: GeometryBag;
}

export interface MapRoofOccluderTarget {
  readonly id: string;
  readonly geometry: THREE.BufferGeometry;
  readonly startVertex: number;
  readonly vertexCount: number;
  readonly x: number;
  readonly z: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly topY: number;
}

export interface MapRoofOcclusionBatch {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.Material;
  readonly originalPositions: Float32Array;
  readonly targets: readonly MapRoofOccluderTarget[];
}

const OCCLUSION_CHECK_INTERVAL_FRAMES = 3;
const OCCLUDED_ROOF_OPACITY = 0.18;
const FADE_IN_FACTOR = 0.18;
const OPACITY_EPSILON = 0.006;
const BOUNDS_PADDING = 0.18;
const HIDDEN_GEOMETRY_Y = -10_000;

interface OccluderState {
  readonly batch: MapRoofOcclusionBatch;
  readonly target: MapRoofOccluderTarget;
  occluded: boolean;
  sourceHidden: boolean;
  alpha: number;
  ghost: THREE.Mesh | null;
}

export function roofOccluderSource(id: string, geometries: GeometryBag): MapRoofOccluderSource {
  if (geometries.length === 0) {
    throw new Error(`map occlusion: ${id} has no roof geometry`);
  }
  return { id, geometries };
}

/**
 * Keeps every authored roof in one opaque base mesh while retaining one
 * geometry per structure for the temporary ghost shown during occlusion.
 * The base range is collapsed only while its matching ghost is visible, so
 * unrelated roofs never inherit the fade.
 */
export function buildRoofOcclusionBatch(
  parent: THREE.Group,
  name: string,
  unoccludedGeometries: GeometryBag,
  sources: readonly MapRoofOccluderSource[],
  material: THREE.Material,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): MapRoofOcclusionBatch | null {
  if (unoccludedGeometries.length === 0 && sources.length === 0) {
    return null;
  }

  const masterParts: THREE.BufferGeometry[] = [];
  const targetDrafts: Array<
    Omit<MapRoofOccluderTarget, 'startVertex' | 'vertexCount'> & {
      readonly masterPart: THREE.BufferGeometry;
    }
  > = [];

  let vertexCursor = 0;
  if (unoccludedGeometries.length > 0) {
    const regular = mergeMixedParts(unoccludedGeometries, `${name}-unoccluded`);
    const masterPart = cloneAsNonIndexed(regular);
    vertexCursor = masterPart.getAttribute('position').count;
    masterParts.push(masterPart);
    regular.dispose();
  }

  const seenIds = new Set<string>();
  for (const source of sources) {
    if (seenIds.has(source.id)) {
      throw new Error(`map occlusion: duplicate roof id ${source.id}`);
    }
    seenIds.add(source.id);
    const geometry = mergeMixedParts(source.geometries, `${name}-${source.id}`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const bounds = geometry.boundingBox;
    if (!bounds || bounds.isEmpty()) {
      throw new Error(`map occlusion: ${source.id} has invalid bounds`);
    }
    const masterPart = cloneAsNonIndexed(geometry);
    masterParts.push(masterPart);
    targetDrafts.push({
      id: source.id,
      geometry,
      masterPart,
      x: (bounds.min.x + bounds.max.x) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
      halfWidth: Math.max(BOUNDS_PADDING, (bounds.max.x - bounds.min.x) / 2 + BOUNDS_PADDING),
      halfDepth: Math.max(BOUNDS_PADDING, (bounds.max.z - bounds.min.z) / 2 + BOUNDS_PADDING),
      topY: bounds.max.y + BOUNDS_PADDING,
    });
  }

  const targets: MapRoofOccluderTarget[] = [];
  for (const draft of targetDrafts) {
    const vertexCount = draft.masterPart.getAttribute('position').count;
    targets.push({
      id: draft.id,
      geometry: draft.geometry,
      startVertex: vertexCursor,
      vertexCount,
      x: draft.x,
      z: draft.z,
      halfWidth: draft.halfWidth,
      halfDepth: draft.halfDepth,
      topY: draft.topY,
    });
    vertexCursor += vertexCount;
  }

  const merged = track(mergeMixedParts(masterParts, name));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  const position = merged.getAttribute('position');
  if (!(position.array instanceof Float32Array)) {
    throw new Error(`map occlusion: ${name} positions are not Float32Array`);
  }
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);

  return {
    mesh,
    material,
    originalPositions: new Float32Array(position.array),
    targets,
  };
}

export class MapOcclusionController {
  private readonly states: OccluderState[];
  private readonly changedBatches = new Set<MapRoofOcclusionBatch>();
  private frameCounter = OCCLUSION_CHECK_INTERVAL_FRAMES - 1;

  constructor(private readonly batches: readonly MapRoofOcclusionBatch[]) {
    this.states = batches.flatMap((batch) =>
      batch.targets.map((target) => ({
        batch,
        target,
        occluded: false,
        sourceHidden: false,
        alpha: 1,
        ghost: null,
      })),
    );
  }

  update(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void {
    this.frameCounter = (this.frameCounter + 1) % OCCLUSION_CHECK_INTERVAL_FRAMES;
    if (this.frameCounter === 0) {
      this.detectOcclusion(cameraPosition, focusPosition);
    }

    this.changedBatches.clear();
    for (const state of this.states) {
      if (state.occluded) {
        this.hideSource(state);
        state.alpha = OCCLUDED_ROOF_OPACITY;
        this.applyGhostAlpha(state);
        continue;
      }
      if (!state.sourceHidden) {
        state.alpha = 1;
        continue;
      }
      state.alpha = THREE.MathUtils.lerp(state.alpha, 1, FADE_IN_FACTOR);
      if (1 - state.alpha <= OPACITY_EPSILON) {
        state.alpha = 1;
        this.restoreSource(state);
      } else {
        this.applyGhostAlpha(state);
      }
    }
    this.flushPositionUpdates();
  }

  diagnostics(): MapOcclusionDiagnostics {
    const active = this.states.filter((state) => state.occluded);
    const fading = this.states.filter((state) => state.sourceHidden && !state.occluded);
    const visibleGhosts = this.states.filter((state) => state.sourceHidden);
    return {
      active: active.length > 0,
      roofOpacity:
        visibleGhosts.length > 0 ? Math.min(...visibleGhosts.map((state) => state.alpha)) : 1,
      roofIntersections: active.length,
      roofMeshCount: this.batches.length,
      treeOpacity: 1,
      treeIntersections: 0,
      treeCount: 0,
      activeTreeCount: 0,
      fadingTreeCount: 0,
      activeTreeIds: [],
      occluderCount: this.states.length,
      activeOccluderCount: active.length,
      fadingOccluderCount: fading.length,
      activeOccluderIds: active.map((state) => state.target.id).sort(),
    };
  }

  dispose(): void {
    this.changedBatches.clear();
    for (const state of this.states) {
      state.occluded = false;
      if (state.sourceHidden) {
        this.restoreSource(state);
      }
      if (state.ghost) {
        state.ghost.removeFromParent();
        const materials = Array.isArray(state.ghost.material)
          ? state.ghost.material
          : [state.ghost.material];
        for (const material of materials) {
          material.dispose();
        }
        state.ghost = null;
      }
    }
    this.flushPositionUpdates();
    for (const batch of this.batches) {
      disposeRoofOcclusionBatchTargets(batch);
    }
  }

  private detectOcclusion(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void {
    const reach = Math.hypot(
      cameraPosition.x - focusPosition.x,
      cameraPosition.z - focusPosition.z,
    );
    for (const state of this.states) {
      const { target } = state;
      const dx = target.x - focusPosition.x;
      const dz = target.z - focusPosition.z;
      const radius = Math.hypot(target.halfWidth, target.halfDepth);
      const span = reach + radius;
      state.occluded =
        dx * dx + dz * dz <= span * span &&
        occluderSegmentHitsBox(
          target.x,
          target.z,
          target.halfWidth,
          target.halfDepth,
          target.topY,
          focusPosition.x,
          focusPosition.y,
          focusPosition.z,
          cameraPosition.x,
          cameraPosition.y,
          cameraPosition.z,
        );
    }
  }

  private hideSource(state: OccluderState): void {
    if (!state.sourceHidden) {
      const position = state.batch.mesh.geometry.getAttribute('position');
      const endVertex = state.target.startVertex + state.target.vertexCount;
      for (let vertex = state.target.startVertex; vertex < endVertex; vertex += 1) {
        position.setXYZ(vertex, state.target.x, HIDDEN_GEOMETRY_Y, state.target.z);
      }
      state.sourceHidden = true;
      this.changedBatches.add(state.batch);
    }
    const ghost = this.ensureGhost(state);
    ghost.visible = true;
  }

  private restoreSource(state: OccluderState): void {
    const position = state.batch.mesh.geometry.getAttribute('position');
    const sourceStart = state.target.startVertex * 3;
    const sourceEnd = sourceStart + state.target.vertexCount * 3;
    const targetArray = position.array as Float32Array;
    targetArray.set(state.batch.originalPositions.subarray(sourceStart, sourceEnd), sourceStart);
    state.sourceHidden = false;
    if (state.ghost) {
      state.ghost.visible = false;
    }
    this.changedBatches.add(state.batch);
  }

  private ensureGhost(state: OccluderState): THREE.Mesh {
    if (state.ghost) {
      return state.ghost;
    }
    const material = state.batch.material.clone();
    material.name = `occlusion-ghost-${state.target.id}`;
    material.transparent = true;
    material.depthWrite = false;
    material.opacity = state.batch.material.opacity;
    material.needsUpdate = true;
    const ghost = new THREE.Mesh(state.target.geometry, material);
    ghost.name = `occlusion-ghost-${state.target.id}`;
    ghost.castShadow = false;
    ghost.receiveShadow = true;
    state.batch.mesh.parent?.add(ghost);
    state.ghost = ghost;
    return ghost;
  }

  private applyGhostAlpha(state: OccluderState): void {
    const ghost = this.ensureGhost(state);
    const materials = Array.isArray(ghost.material) ? ghost.material : [ghost.material];
    for (const material of materials) {
      material.opacity = state.batch.material.opacity * state.alpha;
    }
  }

  private flushPositionUpdates(): void {
    for (const batch of this.changedBatches) {
      batch.mesh.geometry.getAttribute('position').needsUpdate = true;
    }
    this.changedBatches.clear();
  }
}

export function disposeRoofOcclusionBatchTargets(batch: MapRoofOcclusionBatch): void {
  for (const target of batch.targets) {
    target.geometry.dispose();
  }
}

export function occluderSegmentHitsBox(
  boxX: number,
  boxZ: number,
  halfWidth: number,
  halfDepth: number,
  topY: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
): boolean {
  const eyeInside = Math.abs(eyeX - boxX) < halfWidth && Math.abs(eyeZ - boxZ) < halfDepth;
  const cameraInside = Math.abs(cameraX - boxX) < halfWidth && Math.abs(cameraZ - boxZ) < halfDepth;
  if ((eyeY < topY && eyeInside) || (cameraY < topY && cameraInside)) {
    return true;
  }

  const dx = cameraX - eyeX;
  const dz = cameraZ - eyeZ;
  const localEyeX = eyeX - boxX;
  const localEyeZ = eyeZ - boxZ;
  let minimumT = Number.NEGATIVE_INFINITY;
  let maximumT = Number.POSITIVE_INFINITY;

  if (Math.abs(dx) < 1e-9) {
    if (localEyeX < -halfWidth || localEyeX > halfWidth) {
      return false;
    }
  } else {
    let first = (-halfWidth - localEyeX) / dx;
    let second = (halfWidth - localEyeX) / dx;
    if (first > second) {
      [first, second] = [second, first];
    }
    minimumT = Math.max(minimumT, first);
    maximumT = Math.min(maximumT, second);
  }

  if (Math.abs(dz) < 1e-9) {
    if (localEyeZ < -halfDepth || localEyeZ > halfDepth) {
      return false;
    }
  } else {
    let first = (-halfDepth - localEyeZ) / dz;
    let second = (halfDepth - localEyeZ) / dz;
    if (first > second) {
      [first, second] = [second, first];
    }
    minimumT = Math.max(minimumT, first);
    maximumT = Math.min(maximumT, second);
  }

  if (maximumT < minimumT || maximumT < 0 || minimumT < 0 || minimumT > 1) {
    return false;
  }
  return eyeY + (cameraY - eyeY) * minimumT < topY;
}

function cloneAsNonIndexed(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const clone = geometry.clone();
  if (clone.index === null) {
    return clone;
  }
  const expanded = clone.toNonIndexed();
  clone.dispose();
  return expanded;
}
