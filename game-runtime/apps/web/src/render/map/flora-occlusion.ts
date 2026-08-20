import * as THREE from 'three';
import { occluderSegmentHitsBox } from './map-occlusion';

export interface FloraTreeOccluderPart {
  readonly id: 'trunk' | 'canopy' | 'shadow';
  readonly mesh: THREE.InstancedMesh;
  readonly instanceIndex: number;
  readonly matrix: THREE.Matrix4;
  readonly colour: THREE.Color | null;
}

export interface FloraTreeOccluderTarget {
  readonly id: string;
  readonly parts: readonly FloraTreeOccluderPart[];
  readonly x: number;
  readonly z: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly topY: number;
}

export interface FloraOcclusionDiagnostics {
  readonly active: boolean;
  readonly treeOpacity: number;
  readonly treeIntersections: number;
  readonly treeCount: number;
  readonly activeTreeCount: number;
  readonly fadingTreeCount: number;
  readonly activeTreeIds: readonly string[];
}

const OCCLUSION_CHECK_INTERVAL_FRAMES = 3;
const OCCLUDED_TREE_OPACITY = 0.3;
const FADE_OUT_FACTOR = 0.22;
const FADE_IN_FACTOR = 0.16;
const OPACITY_EPSILON = 0.006;
const BOUNDS_PADDING = 0.12;

interface SourcePartState {
  readonly source: FloraTreeOccluderPart;
  readonly hiddenMatrix: THREE.Matrix4;
  ghost: THREE.InstancedMesh | null;
}

interface TreeOccluderState {
  readonly target: FloraTreeOccluderTarget;
  readonly parts: readonly SourcePartState[];
  occluded: boolean;
  sourceHidden: boolean;
  alpha: number;
}

export function floraTreeOccluderTarget(
  id: string,
  parts: readonly FloraTreeOccluderPart[],
): FloraTreeOccluderTarget {
  if (parts.length === 0) {
    throw new Error(`flora occlusion: ${id} has no geometry`);
  }

  const bounds = new THREE.Box3().makeEmpty();
  for (const part of parts) {
    if (part.instanceIndex < 0 || part.instanceIndex >= part.mesh.count) {
      throw new Error(`flora occlusion: ${id}/${part.id} has an invalid instance index`);
    }
    const geometry = part.mesh.geometry;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) {
      throw new Error(`flora occlusion: ${id}/${part.id} has invalid bounds`);
    }
    part.mesh.updateMatrix();
    const combinedMatrix = new THREE.Matrix4().multiplyMatrices(part.mesh.matrix, part.matrix);
    bounds.union(geometry.boundingBox.clone().applyMatrix4(combinedMatrix));
  }

  if (bounds.isEmpty()) {
    throw new Error(`flora occlusion: ${id} has invalid bounds`);
  }
  return {
    id,
    parts,
    x: (bounds.min.x + bounds.max.x) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
    halfWidth: Math.max(BOUNDS_PADDING, (bounds.max.x - bounds.min.x) / 2 + BOUNDS_PADDING),
    halfDepth: Math.max(BOUNDS_PADDING, (bounds.max.z - bounds.min.z) / 2 + BOUNDS_PADDING),
    topY: bounds.max.y + BOUNDS_PADDING,
  };
}

export class FloraOcclusionController {
  private readonly states: TreeOccluderState[];
  private readonly changedMeshes = new Set<THREE.InstancedMesh>();
  private frameCounter = OCCLUSION_CHECK_INTERVAL_FRAMES - 1;
  private enabled = true;

  constructor(targets: readonly FloraTreeOccluderTarget[]) {
    const seenIds = new Set<string>();
    this.states = targets.map((target) => {
      if (seenIds.has(target.id)) {
        throw new Error(`flora occlusion: duplicate tree id ${target.id}`);
      }
      seenIds.add(target.id);
      return {
        target,
        parts: target.parts.map((source) => ({
          source,
          hiddenMatrix: collapsedInstanceMatrix(source.matrix),
          ghost: null,
        })),
        occluded: false,
        sourceHidden: false,
        alpha: 1,
      };
    });
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    this.frameCounter = OCCLUSION_CHECK_INTERVAL_FRAMES - 1;
    if (enabled) {
      return;
    }
    for (const state of this.states) {
      state.occluded = false;
      state.alpha = 1;
      if (state.sourceHidden) {
        this.restoreSource(state);
      }
    }
    this.flushMatrixUpdates();
  }

  update(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void {
    if (!this.enabled) {
      return;
    }
    this.frameCounter = (this.frameCounter + 1) % OCCLUSION_CHECK_INTERVAL_FRAMES;
    if (this.frameCounter === 0) {
      this.detectOcclusion(cameraPosition, focusPosition);
    }

    this.changedMeshes.clear();
    for (const state of this.states) {
      if (state.occluded) {
        this.hideSource(state);
        state.alpha = THREE.MathUtils.lerp(state.alpha, OCCLUDED_TREE_OPACITY, FADE_OUT_FACTOR);
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
    this.flushMatrixUpdates();
  }

  diagnostics(): FloraOcclusionDiagnostics {
    const active = this.states.filter((state) => state.occluded);
    const fading = this.states.filter((state) => state.sourceHidden && !state.occluded);
    const visibleGhosts = this.states.filter((state) => state.sourceHidden);
    return {
      active: active.length > 0,
      treeOpacity:
        visibleGhosts.length > 0 ? Math.min(...visibleGhosts.map((state) => state.alpha)) : 1,
      treeIntersections: active.length,
      treeCount: this.states.length,
      activeTreeCount: active.length,
      fadingTreeCount: fading.length,
      activeTreeIds: active.map((state) => state.target.id).sort(),
    };
  }

  dispose(): void {
    this.changedMeshes.clear();
    for (const state of this.states) {
      state.occluded = false;
      if (state.sourceHidden) {
        this.restoreSource(state);
      }
      for (const part of state.parts) {
        if (!part.ghost) {
          continue;
        }
        part.ghost.removeFromParent();
        const materials = Array.isArray(part.ghost.material)
          ? part.ghost.material
          : [part.ghost.material];
        for (const material of materials) {
          material.dispose();
        }
        part.ghost.dispose();
        part.ghost = null;
      }
    }
    this.flushMatrixUpdates();
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

  private hideSource(state: TreeOccluderState): void {
    if (!state.sourceHidden) {
      for (const part of state.parts) {
        const ghost = this.ensureGhost(state, part);
        ghost.visible = true;
        part.source.mesh.setMatrixAt(part.source.instanceIndex, part.hiddenMatrix);
        this.changedMeshes.add(part.source.mesh);
      }
      state.sourceHidden = true;
      return;
    }
    for (const part of state.parts) {
      this.ensureGhost(state, part).visible = true;
    }
  }

  private restoreSource(state: TreeOccluderState): void {
    for (const part of state.parts) {
      part.source.mesh.setMatrixAt(part.source.instanceIndex, part.source.matrix);
      this.changedMeshes.add(part.source.mesh);
      if (part.ghost) {
        part.ghost.visible = false;
      }
    }
    state.sourceHidden = false;
  }

  private ensureGhost(state: TreeOccluderState, part: SourcePartState): THREE.InstancedMesh {
    if (part.ghost) {
      return part.ghost;
    }
    const sourceMaterials = Array.isArray(part.source.mesh.material)
      ? part.source.mesh.material
      : [part.source.mesh.material];
    const ghostMaterials = sourceMaterials.map((sourceMaterial) => {
      const material = sourceMaterial.clone();
      material.name = `flora-occlusion-ghost-${state.target.id}-${part.source.id}`;
      material.transparent = true;
      material.depthWrite = false;
      material.onBeforeCompile = sourceMaterial.onBeforeCompile;
      material.customProgramCacheKey = sourceMaterial.customProgramCacheKey;
      material.needsUpdate = true;
      return material;
    });
    const material = Array.isArray(part.source.mesh.material)
      ? ghostMaterials
      : (ghostMaterials[0] as THREE.Material);
    const ghost = new THREE.InstancedMesh(part.source.mesh.geometry, material, 1);
    ghost.name = `flora-occlusion-ghost-${state.target.id}-${part.source.id}`;
    ghost.setMatrixAt(0, part.source.matrix);
    ghost.instanceMatrix.needsUpdate = true;
    if (part.source.colour) {
      ghost.setColorAt(0, part.source.colour);
      if (ghost.instanceColor) {
        ghost.instanceColor.needsUpdate = true;
      }
    }
    ghost.castShadow = false;
    ghost.receiveShadow = false;
    ghost.frustumCulled = false;
    ghost.renderOrder = part.source.mesh.renderOrder + 1;
    ghost.visible = false;
    part.source.mesh.add(ghost);
    part.ghost = ghost;
    return ghost;
  }

  private applyGhostAlpha(state: TreeOccluderState): void {
    for (const part of state.parts) {
      const ghost = this.ensureGhost(state, part);
      const sourceMaterials = Array.isArray(part.source.mesh.material)
        ? part.source.mesh.material
        : [part.source.mesh.material];
      const ghostMaterials = Array.isArray(ghost.material) ? ghost.material : [ghost.material];
      ghostMaterials.forEach((material, index) => {
        const sourceMaterial = sourceMaterials[index] ?? sourceMaterials[0];
        material.opacity = (sourceMaterial?.opacity ?? 1) * state.alpha;
        material.alphaTest = (sourceMaterial?.alphaTest ?? 0) * state.alpha;
      });
    }
  }

  private flushMatrixUpdates(): void {
    for (const mesh of this.changedMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.changedMeshes.clear();
  }
}

function collapsedInstanceMatrix(source: THREE.Matrix4): THREE.Matrix4 {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  source.decompose(position, rotation, scale);
  scale.setScalar(0);
  return new THREE.Matrix4().compose(position, rotation, scale);
}
