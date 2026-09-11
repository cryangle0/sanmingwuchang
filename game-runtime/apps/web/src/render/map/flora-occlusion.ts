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
/** Plan distance from the camera within which a tall tree fades out of the frame. */
const NEAR_CAMERA_FADE_METERS = 16;
/** A tree this far below the lens is a bush in the foreground, not a curtain. */
const NEAR_CAMERA_FADE_DROP_METERS = 4;
/**
 * A crown beside the lens is not a landmark the player needs to keep reading,
 * so unlike a blocker between camera and player it fades almost all the way
 * out; layered leaves at 30 % still add up to a wall.
 */
const NEAR_CAMERA_TREE_OPACITY = 0.04;
/**
 * Summed opacity the stacked blockers between camera and player may reach.
 * Two crowns keep the full 30 %; ten share 6 % each, which still veils the
 * player by about half instead of hiding them behind a solid canopy.
 */
const STACKED_BLOCKER_OPACITY_BUDGET = 0.6;

interface SourcePartState {
  readonly source: FloraTreeOccluderPart;
  readonly hiddenMatrix: THREE.Matrix4;
  ghost: THREE.InstancedMesh | null;
}

interface TreeOccluderState {
  readonly target: FloraTreeOccluderTarget;
  readonly parts: readonly SourcePartState[];
  occluded: boolean;
  /** Opacity the ghost settles at while occluded; blockers stay readable, camera crowders vanish. */
  occludedOpacity: number;
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
        // Trunks are stable world geometry and must never change opacity as a
        // player approaches. Only crowns and ground shadows participate in
        // camera occlusion so the character remains visible in dense woods.
        parts: target.parts
          .filter((source) => source.id !== 'trunk')
          .map((source) => ({
            source,
            hiddenMatrix: collapsedInstanceMatrix(source.matrix),
            ghost: null,
          })),
        occluded: false,
        occludedOpacity: OCCLUDED_TREE_OPACITY,
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
        state.alpha = THREE.MathUtils.lerp(state.alpha, state.occludedOpacity, FADE_OUT_FACTOR);
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
      // A crown right beside the camera fills the edge of the frame even when
      // it never crosses the line to the player. Trees stand taller than the
      // chase camera, so a tree next to the lens — or one the lens is inside —
      // is a curtain of leaves; it fades harder than a mid-field blocker.
      const cameraDx = target.x - cameraPosition.x;
      const cameraDz = target.z - cameraPosition.z;
      const cameraPlanDistanceSquared = cameraDx * cameraDx + cameraDz * cameraDz;
      const nearCameraSpan = radius + NEAR_CAMERA_FADE_METERS;
      const insideCrown =
        cameraPosition.y <= target.topY &&
        Math.abs(cameraDx) <= target.halfWidth &&
        Math.abs(cameraDz) <= target.halfDepth;
      const crowdsCamera =
        insideCrown ||
        (target.topY >= cameraPosition.y - NEAR_CAMERA_FADE_DROP_METERS &&
          cameraPlanDistanceSquared <= nearCameraSpan * nearCameraSpan);
      state.occludedOpacity = crowdsCamera ? NEAR_CAMERA_TREE_OPACITY : OCCLUDED_TREE_OPACITY;
      state.occluded =
        crowdsCamera ||
        (dx * dx + dz * dz <= span * span &&
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
          ));
    }

    // Inside a grove the line to the player crosses a dozen crowns at once.
    // Fifteen ghosts at 30 % stack to an opaque roof, so the blockers share a
    // fixed opacity budget: the deeper the stack, the fainter each crown.
    let blockers = 0;
    for (const state of this.states) {
      if (state.occluded && state.occludedOpacity === OCCLUDED_TREE_OPACITY) {
        blockers += 1;
      }
    }
    if (blockers > 0) {
      const shared = Math.min(OCCLUDED_TREE_OPACITY, STACKED_BLOCKER_OPACITY_BUDGET / blockers);
      for (const state of this.states) {
        if (state.occluded && state.occludedOpacity === OCCLUDED_TREE_OPACITY) {
          state.occludedOpacity = shared;
        }
      }
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
