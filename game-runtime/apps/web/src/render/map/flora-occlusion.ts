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
/**
 * A crown between the lens and the player thins to this; it stays a tree.
 * Walking past a wood used to dissolve every crown around the hero to a few
 * percent, which read as the forest vanishing rather than the fight showing.
 */
const OCCLUDED_TREE_OPACITY = 0.38;
/**
 * Exponential fade rates per second. The fade used to lerp by a fixed factor
 * per frame, so on a slow device (or a 2 fps headless capture) a crown took
 * many seconds to clear while a 120 Hz screen snapped it away; time-based
 * rates make both reach the same opacity after the same wall-clock time.
 */
const FADE_OUT_PER_SECOND = 12;
const FADE_IN_PER_SECOND = 8;
const MAX_FADE_STEP_SECONDS = 0.25;
const OPACITY_EPSILON = 0.006;
const BOUNDS_PADDING = 0.12;
/** Plan distance from the camera within which a tall tree fades out of the frame. */
const NEAR_CAMERA_FADE_METERS = 6;
/**
 * Slope of the chase view, rise over plan distance (tan of the ~32° standard
 * pitch). A crown beside the lens crowds the frame when its top reaches above
 * the view line at its own plan distance from the camera. The old rule asked
 * for a top within 4 m of the lens height, but the camera sits ~21 m up and
 * looks down through 12–20 m crowns whose tops are 5–10 m below it: those
 * filled the frame and never faded.
 */
const NEAR_CAMERA_VIEW_SLOPE = 0.62;
/**
 * Plan margin added to a crown's box for the blocker test. The line from the
 * camera to the player is one ray; the frame around the player is ~8 m wide
 * at that distance, so crowns beside the ray still hide the fight.
 */
const BLOCKER_FRAME_MARGIN_METERS = 3;
/**
 * The fight is not a point. Besides the ray to the player, rays to the ground
 * this far around them are tested too, so the canopy over the whole melee
 * clears rather than a single keyhole onto the hero.
 */
const BLOCKER_FOCUS_RADIUS_METERS = 5;
/**
 * Canopy dome around the player. From the 32° chase pitch every crown within
 * this plan radius of the hero whose top stands above their head hangs over
 * the fight, whether or not it crosses the ray to the lens; in a dense grove
 * that is most of the frame. They fade like blockers and share the same
 * opacity budget, so the dome opens without the wood turning into a bald patch.
 */
const CANOPY_DOME_RADIUS_METERS = 4;
const CANOPY_DOME_ABOVE_FOCUS_METERS = 3;
const BLOCKER_FOCUS_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7, 0.7],
  [0.7, -0.7],
  [-0.7, 0.7],
  [-0.7, -0.7],
];
/**
 * A crown beside the lens is not a landmark the player needs to keep reading,
 * so unlike a blocker between camera and player it fades almost all the way
 * out; layered leaves at 30 % still add up to a wall.
 */
const NEAR_CAMERA_TREE_OPACITY = 0.1;
/**
 * Summed opacity the stacked blockers between camera and player may reach.
 * Two crowns keep the full 30 %; ten share 6 % each, which still veils the
 * player by about half instead of hiding them behind a solid canopy.
 */
const STACKED_BLOCKER_OPACITY_BUDGET = 0.6;
/**
 * Floor for a shared blocker's opacity. Under the canopy dome sixty crowns can
 * fade at once; splitting the budget sixty ways erased the wood to bare poles
 * from the tactical lens. A few percent each still lets the fight through
 * (crowns only stack three or four deep on any pixel) while the grove keeps
 * reading as a grove.
 */
const STACKED_BLOCKER_OPACITY_FLOOR = 0.2;

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
  /** The lens is inside or beside this crown, so its branches go with the leaves. */
  crowdsCamera: boolean;
  sourceHidden: boolean;
  /** Whether the trunk part is currently collapsed along with the crown. */
  trunkHidden: boolean;
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
  private lastUpdateMs = Number.NaN;
  private readonly now: () => number;

  constructor(
    targets: readonly FloraTreeOccluderTarget[],
    now: () => number = () => performance.now(),
  ) {
    this.now = now;
    const seenIds = new Set<string>();
    this.states = targets.map((target) => {
      if (seenIds.has(target.id)) {
        throw new Error(`flora occlusion: duplicate tree id ${target.id}`);
      }
      seenIds.add(target.id);
      return {
        target,
        // Trunks are stable world geometry and must not flicker as a player
        // approaches: a mid-field blocker fades only its crown and shadow.
        // The one exception is a crown the lens itself is inside or beside,
        // where the branch mesh crossing the frame goes with the leaves.
        parts: target.parts.map((source) => ({
          source,
          hiddenMatrix: collapsedInstanceMatrix(source.matrix),
          ghost: null,
        })),
        occluded: false,
        occludedOpacity: OCCLUDED_TREE_OPACITY,
        crowdsCamera: false,
        sourceHidden: false,
        trunkHidden: false,
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
    const nowMs = this.now();
    const elapsedSeconds = Number.isFinite(this.lastUpdateMs)
      ? Math.min(MAX_FADE_STEP_SECONDS, Math.max(0, (nowMs - this.lastUpdateMs) / 1000))
      : MAX_FADE_STEP_SECONDS;
    this.lastUpdateMs = nowMs;
    const fadeOut = 1 - Math.exp(-FADE_OUT_PER_SECOND * elapsedSeconds);
    const fadeIn = 1 - Math.exp(-FADE_IN_PER_SECOND * elapsedSeconds);

    this.changedMeshes.clear();
    for (const state of this.states) {
      if (state.occluded) {
        this.hideSource(state);
        state.alpha = THREE.MathUtils.lerp(state.alpha, state.occludedOpacity, fadeOut);
        this.applyGhostAlpha(state);
        continue;
      }
      if (!state.sourceHidden) {
        state.alpha = 1;
        continue;
      }
      state.alpha = THREE.MathUtils.lerp(state.alpha, 1, fadeIn);
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
      const span = reach + radius + BLOCKER_FOCUS_RADIUS_METERS + BLOCKER_FRAME_MARGIN_METERS;
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
        (cameraPlanDistanceSquared <= nearCameraSpan * nearCameraSpan &&
          target.topY >=
            cameraPosition.y - Math.sqrt(cameraPlanDistanceSquared) * NEAR_CAMERA_VIEW_SLOPE);
      state.occludedOpacity = crowdsCamera ? NEAR_CAMERA_TREE_OPACITY : OCCLUDED_TREE_OPACITY;
      state.crowdsCamera = crowdsCamera;
      const domeReach = CANOPY_DOME_RADIUS_METERS + radius;
      const underDome =
        target.topY >= focusPosition.y + CANOPY_DOME_ABOVE_FOCUS_METERS &&
        dx * dx + dz * dz <= domeReach * domeReach;
      state.occluded =
        crowdsCamera ||
        underDome ||
        (dx * dx + dz * dz <= span * span &&
          BLOCKER_FOCUS_OFFSETS.some(([ox, oz]) =>
            occluderSegmentHitsBox(
              target.x,
              target.z,
              target.halfWidth + BLOCKER_FRAME_MARGIN_METERS,
              target.halfDepth + BLOCKER_FRAME_MARGIN_METERS,
              target.topY,
              focusPosition.x + ox * BLOCKER_FOCUS_RADIUS_METERS,
              focusPosition.y,
              focusPosition.z + oz * BLOCKER_FOCUS_RADIUS_METERS,
              cameraPosition.x,
              cameraPosition.y,
              cameraPosition.z,
            ),
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
      const shared = Math.max(
        STACKED_BLOCKER_OPACITY_FLOOR,
        Math.min(OCCLUDED_TREE_OPACITY, STACKED_BLOCKER_OPACITY_BUDGET / blockers),
      );
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
        if (part.source.id === 'trunk' && !state.crowdsCamera) {
          continue;
        }
        this.hidePart(state, part);
      }
      state.sourceHidden = true;
      state.trunkHidden = state.crowdsCamera;
      return;
    }
    if (state.trunkHidden !== state.crowdsCamera) {
      for (const part of state.parts) {
        if (part.source.id !== 'trunk') {
          continue;
        }
        if (state.crowdsCamera) {
          this.hidePart(state, part);
        } else {
          this.restorePart(part);
        }
      }
      state.trunkHidden = state.crowdsCamera;
    }
    for (const part of state.parts) {
      if (part.source.id === 'trunk' && !state.trunkHidden) {
        continue;
      }
      this.ensureGhost(state, part).visible = true;
    }
  }

  private hidePart(state: TreeOccluderState, part: SourcePartState): void {
    const ghost = this.ensureGhost(state, part);
    ghost.visible = true;
    part.source.mesh.setMatrixAt(part.source.instanceIndex, part.hiddenMatrix);
    this.changedMeshes.add(part.source.mesh);
  }

  private restorePart(part: SourcePartState): void {
    part.source.mesh.setMatrixAt(part.source.instanceIndex, part.source.matrix);
    this.changedMeshes.add(part.source.mesh);
    if (part.ghost) {
      part.ghost.visible = false;
    }
  }

  private restoreSource(state: TreeOccluderState): void {
    for (const part of state.parts) {
      this.restorePart(part);
    }
    state.sourceHidden = false;
    state.trunkHidden = false;
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
      // The source leaf material uses alpha-to-coverage for its cutout edges.
      // On a multisampled canvas that turns alpha into a sample count instead
      // of a blend factor, so a ghost at 4 % opacity was still drawn as a
      // solid crown and the wood never opened up. Ghosts blend normally.
      material.alphaToCoverage = false;
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
      if (part.source.id === 'trunk' && !state.trunkHidden) {
        continue;
      }
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
