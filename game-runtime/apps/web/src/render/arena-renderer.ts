import { getActiveDefinition, type MapPointMm } from '@jwgb/content';
import type { EntityId } from '@jwgb/core';
import type {
  AfterimageSnapshot,
  AirdropSnapshot,
  LootSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  SimEvent,
  StaticSolidRect,
  SummonSnapshot,
  WindWallSnapshot,
  WorldSnapshot,
} from '@jwgb/sim';
import * as THREE from 'three';
import { modelAssetBaseUrl } from '../runtime/asset-url';
import type { WebCameraViewMode, WebGraphicsPreference } from '../runtime/web-settings';
import {
  cameraOffsetFromOrbit,
  cameraOrbitFromOffset,
  dragCameraPan,
  hasCameraDragStarted,
  moveCameraPan,
  normalizeCameraYaw,
  normalizeWheelDelta,
  orthographicMetersPerPixel,
  rotateCameraOrbit,
  stepCameraZoomScale,
  tiltCameraPitch,
  zoomCameraScale,
} from './camera-controls';
import { type CameraFollowState, updateCameraFollowState } from './camera-follow';
import { CombatEffectsLayer, effectColorForElement } from './combat-effects';
import { activePresentationRange, type CombatRangePreviewMode } from './combat-range-preview';
import { createMapAtmosphere, type MapAtmosphere } from './map/atmosphere';
import type { GlobalSceneLayerDiagnostics } from './map/global-scene-layer';
import { standingSurfaceMeters } from './map/ground';
import type { MapAssetLayerDiagnostics } from './map/map-asset-layer';
import { buildMapEnvironment, type MapEnvironment } from './map/map-environment';
import type { MapOcclusionDiagnostics } from './map/map-occlusion';
import {
  type CharacterAnimationState,
  type CharacterModelDiagnostics,
  type CharacterModelInstance,
  CharacterModelLibrary,
} from './models/character-model-library';
import { collectModelAnimationEventTriggers } from './models/model-animation-events';
import { heroModelDefinition, monsterModelDefinition } from './models/web-model-catalog';
import {
  characterAnimationIntervalSeconds,
  shouldCastCharacterShadow,
  shouldReduceGraphicsLoad,
} from './render-performance-policy';
import { tickWind } from './shading/wind';
import {
  createSpawnMarkerVisual,
  hasMovedFromSpawn,
  type SpawnMarkerVisual,
  updateSpawnMarkerVisual,
} from './spawn-marker';
import { WORLD_SCALE_PROFILE } from './world-scale-profile';

interface PlayerVisual {
  readonly heroId: string;
  readonly group: THREE.Group;
  readonly bodyMaterial: THREE.MeshStandardMaterial;
  readonly model: CharacterModelInstance | null;
  spawnMarker: SpawnMarkerVisual | null;
  readonly spawnPositionX: number;
  readonly spawnPositionZ: number;
  readonly healthGroup: THREE.Group;
  readonly healthBar: THREE.Mesh;
  readonly healthMaterial: THREE.MeshBasicMaterial;
  readonly shieldShell: THREE.Mesh;
  readonly iceCoffinShell: THREE.Mesh;
  readonly whirlwindRing: THREE.Mesh;
  spawnMarkerDismissed: boolean;
  previousAttackCooldownTicks: number;
  previousAttackIntent: boolean;
  previousActiveCooldownTicks: number;
  previousWhirlwindTicks: number;
}

interface WindWallVisual {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
}

interface ProjectileVisual {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
}

interface MonsterVisual {
  readonly modelId: string | null;
  readonly group: THREE.Group;
  readonly bodyMaterial: THREE.MeshStandardMaterial;
  readonly model: CharacterModelInstance | null;
  readonly healthGroup: THREE.Group;
  readonly healthBar: THREE.Mesh;
  readonly healthMaterial: THREE.MeshBasicMaterial;
  previousAttackCooldownTicks: number;
  previousPositionX: number;
  previousPositionZ: number;
}

interface LootVisual {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
}

interface SummonVisual {
  readonly group: THREE.Group;
  readonly bodyMaterial: THREE.MeshStandardMaterial;
  readonly healthGroup: THREE.Group;
  readonly healthBar: THREE.Mesh;
  readonly healthMaterial: THREE.MeshBasicMaterial;
}

interface AfterimageVisual {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
}

interface StaticSolidVisual {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
}

interface AirdropVisual {
  readonly group: THREE.Group;
  readonly warningBeam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly warningRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly crate: THREE.Group;
}

export interface RenderPixelDiagnostics {
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
  readonly sampledPixels: number;
  readonly nonBlackPixels: number;
  readonly minimumChannel: number;
  readonly maximumChannel: number;
}

export interface RenderPerformanceDiagnostics {
  readonly sampledFrames: number;
  readonly averageFps: number;
  readonly averageFrameMs: number;
  readonly p95FrameMs: number;
  readonly maximumFrameMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly lines: number;
  readonly points: number;
  readonly geometries: number;
  readonly textures: number;
  readonly pixelRatio: number;
  readonly graphicsTier: 'balanced' | 'reduced';
  readonly graphicsPreference: WebGraphicsPreference;
  readonly gpuRenderer: string;
  readonly shadowsEnabled: boolean;
}

export interface RenderSceneContributorDiagnostics {
  readonly name: string;
  readonly meshes: number;
  readonly visibleMeshes: number;
  readonly triangles: number;
  readonly drawCalls: number;
}

export interface RenderEntityDiagnostics {
  readonly playerVisuals: number;
  readonly visiblePlayerVisuals: number;
  readonly monsterVisuals: number;
  readonly visibleMonsterVisuals: number;
  readonly lootVisuals: number;
  readonly airdropVisuals: number;
}

export interface RenderModelEntityDiagnostics {
  readonly entityId: EntityId;
  readonly modelId: string | null;
  readonly loaded: boolean;
  readonly loadRequested: boolean;
  readonly visible: boolean;
  readonly visualScale: number;
  readonly instanceUuid: string | null;
  readonly animationState: CharacterAnimationState | null;
  readonly meshNames: readonly string[];
  readonly fallbackRenderableMeshes: number;
}

export interface RenderModelDiagnostics extends CharacterModelDiagnostics {
  readonly visibleInstances: number;
  readonly visibleLoadedInstances: number;
  readonly visiblePendingInstances: number;
  readonly visibleRenderableFallbackInstances: number;
  readonly sceneSprites: number;
  readonly playerModels: readonly RenderModelEntityDiagnostics[];
  readonly monsterModels: readonly RenderModelEntityDiagnostics[];
}

export type CameraViewMode = WebCameraViewMode;

export interface CameraViewState {
  readonly mode: CameraViewMode;
  readonly label: string;
}

export interface RenderCameraDiagnostics extends CameraViewState {
  readonly zoom: number;
  readonly targetZoom: number;
  readonly presetZoom: number;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly desiredTarget: readonly [number, number, number];
  readonly localTarget: readonly [number, number, number];
  readonly offset: readonly [number, number, number];
  readonly targetOffset: readonly [number, number, number];
  readonly presetOffset: readonly [number, number, number];
  readonly yawDegrees: number;
  readonly pitchDegrees: number;
  readonly zoomScale: number;
  readonly panOffset: readonly [number, number];
  readonly controlsCustomized: boolean;
  readonly navigationWaypointVisible: boolean;
  readonly navigationWaypointPosition: readonly [number, number, number];
}

export interface CombatRangePreviewDiagnostics {
  readonly mode: CombatRangePreviewMode;
  readonly attackRangeMm: number;
  readonly activeRangeMm: number | null;
  readonly attackVisible: boolean;
  readonly activeVisible: boolean;
}

const HERO_COLORS: Readonly<Record<string, number>> = {
  H001: 0xb94d43,
  H009: 0xd2a844,
  H018: 0x3d735c,
};
const MAX_PERFORMANCE_FRAME_SAMPLES = 240;
const BALANCED_ENTITY_VISUAL_CULL_DISTANCE_SQUARED = 55_000 ** 2;
const REDUCED_ENTITY_VISUAL_CULL_DISTANCE_SQUARED = 45_000 ** 2;
const BALANCED_PLAYER_STATUS_DISTANCE_SQUARED = 38_000 ** 2;
const BALANCED_MONSTER_STATUS_DISTANCE_SQUARED = 34_000 ** 2;
const REDUCED_PLAYER_STATUS_DISTANCE_SQUARED = 30_000 ** 2;
const REDUCED_MONSTER_STATUS_DISTANCE_SQUARED = 26_000 ** 2;
const REDUCED_PIXEL_RATIO_CAP = 0.85;
const AUTO_BALANCED_PIXEL_RATIO_CAP = 1.25;
const QUALITY_PIXEL_RATIO_CAP = 1.5;
const ADAPTIVE_GRAPHICS_READINESS_CHECK_INTERVAL_FRAMES = 15;
const ADAPTIVE_GRAPHICS_SETTLE_SECONDS = 2;
// CharacterModelLibrary normalizes every imported model to its catalog height.
// The player presentation multiplier is intentional: it improves in-world
// readability without changing simulation collision or movement scale.
const PLAYER_MODEL_VISUAL_SCALE = WORLD_SCALE_PROFILE.character.playerModelScale;
const MONSTER_MODEL_VISUAL_SCALE = WORLD_SCALE_PROFILE.character.monsterModelScale;
const CAMERA_VIEW_ORDER: readonly CameraViewMode[] = ['standard', 'close', 'tactical'];
const CAMERA_VIEWS: Readonly<
  Record<
    CameraViewMode,
    {
      readonly label: string;
      readonly offset: readonly [number, number, number];
      readonly zoom: number;
    }
  >
> = {
  // Only the direction of these offsets matters now: under a perspective
  // camera the distance is solved from how much world has to fit on screen,
  // not authored per preset. The pitches are 32 / 26 / 48 degrees — lower than
  // the 39 degrees the orthographic rig used, because relief is only legible
  // when you can see the side of a hill rather than its plan.
  standard: { label: '标准视角', offset: [12, 10.6, 12], zoom: 1.12 },
  close: { label: '近景视角', offset: [12.7, 8.77, 12.7], zoom: 1.38 },
  tactical: { label: '战术视角', offset: [9.46, 14.86, 9.46], zoom: 0.84 },
};
/**
 * Narrow field of view.
 *
 * Perspective is what buys depth, a horizon and aerial perspective, none of
 * which an orthographic projection can produce at any amount of relief. A
 * narrow angle keeps the price down: at 30 degrees the size difference
 * between a character at the near edge of the view and one at the far edge
 * stays small enough that the 30-player readability the orthographic rig was
 * chosen for survives.
 */
const CAMERA_FOV_DEGREES = 30;
/** Portrait sees very little ahead at a shallow pitch, so it looks down more. */
const PORTRAIT_MIN_PITCH_DEGREES = 38;
const DEFAULT_CAMERA_ORBIT = cameraOrbitFromOffset(CAMERA_VIEWS.standard.offset);

function worldMeters(millimeters: number): number {
  return millimeters / 1_000;
}

export class ArenaRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly playerVisuals = new Map<EntityId, PlayerVisual>();
  private readonly windWallVisuals = new Map<EntityId, WindWallVisual>();
  private readonly projectileVisuals = new Map<EntityId, ProjectileVisual>();
  private readonly monsterVisuals = new Map<EntityId, MonsterVisual>();
  private readonly lootVisuals = new Map<EntityId, LootVisual>();
  private readonly summonVisuals = new Map<EntityId, SummonVisual>();
  private readonly afterimageVisuals = new Map<EntityId, AfterimageVisual>();
  private readonly staticSolidVisuals = new Map<string, StaticSolidVisual>();
  private readonly airdropVisuals = new Map<string, AirdropVisual>();
  private readonly modelLibrary = new CharacterModelLibrary(modelAssetBaseUrl());
  private readonly canvas: HTMLCanvasElement;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3(...CAMERA_VIEWS.standard.offset);
  private readonly cameraFollowState: CameraFollowState = {
    focus: this.cameraTarget,
    offset: this.cameraOffset,
    zoom: CAMERA_VIEWS.standard.zoom,
  };
  private readonly cameraDesiredTarget = new THREE.Vector3();
  private readonly cameraLocalTarget = new THREE.Vector3();
  private readonly cameraDesiredOffset = new THREE.Vector3(...CAMERA_VIEWS.standard.offset);
  private readonly cameraPanOffset = new THREE.Vector3();
  private readonly occlusionFocus = new THREE.Vector3();
  private readonly billboardParentQuaternion = new THREE.Quaternion();
  private readonly aimPointer = new THREE.Vector2();
  private readonly aimRaycaster = new THREE.Raycaster();
  private readonly aimHit = new THREE.Vector3();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly navigationWaypoint: THREE.Group;
  private readonly attackRangeRing: THREE.LineLoop<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial | THREE.LineDashedMaterial
  >;
  private readonly activeRangeRing: THREE.LineLoop<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial | THREE.LineDashedMaterial
  >;
  private readonly stormGroup: THREE.Group;
  private readonly stormRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly stormWall: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly combatEffects: CombatEffectsLayer;
  private readonly renderFrameIntervalsMs: number[] = [];
  private readonly adaptiveFrameIntervalsMs: number[] = [];
  private graphicsTier: 'balanced' | 'reduced';
  private readonly detectedGraphicsTier: 'balanced' | 'reduced';
  private graphicsPreference: WebGraphicsPreference;
  private readonly gpuRenderer: string;
  private previousRenderSeconds: number | null = null;
  private adaptiveReadinessCheckFrames = 0;
  private adaptiveResourcesReady = false;
  private adaptiveReadySinceSeconds: number | null = null;
  private adaptiveSamplingStarted = false;
  private previousCameraSeconds: number | null = null;
  private localEntityId: EntityId | null = null;
  private cameraSnapRequested = true;
  private cameraViewMode: CameraViewMode = 'standard';
  private cameraOrbitYaw = DEFAULT_CAMERA_ORBIT.yaw;
  private cameraOrbitPitch = DEFAULT_CAMERA_ORBIT.pitch;
  /** Metres of world that must fit across the viewport's height at zoom 1. */
  private viewportVerticalSize = 24;
  private minCameraPitch = 0;
  private cameraZoomScale = 1;
  private environmentKind: 'none' | 'legacy' | 'map' = 'none';
  private mapEnvironment: MapEnvironment | null = null;
  private mapAtmosphere: MapAtmosphere | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private hemisphere: THREE.HemisphereLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  private previousAtmosphereSeconds: number | null = null;
  private combatRangePreviewMode: CombatRangePreviewMode = 'none';
  private attackRangeMm = 0;
  private activeRangeMm: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    shell: HTMLElement,
    graphicsPreference: WebGraphicsPreference = 'auto',
  ) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    const graphics = this.detectGraphicsTier();
    this.detectedGraphicsTier = graphics.tier;
    this.graphicsPreference = graphicsPreference;
    this.graphicsTier = this.resolveGraphicsTier(graphicsPreference);
    this.gpuRenderer = graphics.renderer;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap()));
    this.renderer.shadowMap.enabled = this.graphicsTier === 'balanced';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Placeholder sky until the map environment installs its own gradient.
    // Keeping it in the same 浅青 family as the map sky means the first frames
    // of a match no longer flash a dark ink background before the world lands.
    this.scene.background = new THREE.Color(0x7798b3);
    this.scene.fog = new THREE.FogExp2(0x91adbd, 0.0022);

    // Far plane reaches the ridge line beyond the boundary cliffs; the
    // orthographic rig only ever needed 180 m.
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, 0.1, 600);
    this.camera.position.set(...CAMERA_VIEWS.standard.offset);
    this.camera.lookAt(0, 0, 0);

    this.createLighting();
    this.navigationWaypoint = this.createNavigationWaypoint();
    this.attackRangeRing = this.createCombatRangeRing(0xe3aa57, false);
    this.activeRangeRing = this.createCombatRangeRing(0x70d2c2, true);
    const storm = this.createStormVisuals();
    this.stormGroup = storm.group;
    this.stormRing = storm.ring;
    this.stormWall = storm.wall;
    this.combatEffects = new CombatEffectsLayer(this.scene, this.graphicsTier);
    this.resize();

    window.addEventListener('resize', this.resize);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      shell.classList.add('is-context-lost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      shell.classList.remove('is-context-lost');
    });
  }

  setLocalEntity(entityId: EntityId | null): void {
    if (this.localEntityId !== entityId) {
      this.cameraSnapRequested = true;
      this.previousCameraSeconds = null;
    }
    this.localEntityId = entityId;
  }

  snapCameraToLocalEntity(): void {
    this.cameraSnapRequested = true;
    this.previousCameraSeconds = null;
  }

  resetCameraControls(): CameraViewState {
    this.resetCameraControlState(true);
    return this.getCameraViewState();
  }

  focusCameraOnLocalEntity(): void {
    this.cameraPanOffset.set(0, 0, 0);
    this.snapCameraToLocalEntity();
  }

  getGraphicsPreference(): WebGraphicsPreference {
    return this.graphicsPreference;
  }

  setGraphicsPreference(preference: WebGraphicsPreference): void {
    this.graphicsPreference = preference;
    this.resetAdaptiveQualitySampling();
    this.applyGraphicsTier(this.resolveGraphicsTier(preference));
  }

  private footingMeters(xMm: number, zMm: number): number {
    return this.mapEnvironment ? standingSurfaceMeters(worldMeters(xMm), worldMeters(zMm)) : 0;
  }

  private isWithinEntityVisualDistance(
    position: { readonly x: number; readonly z: number },
    localPosition: { readonly x: number; readonly z: number } | null,
  ): boolean {
    if (!localPosition) {
      return true;
    }
    const dx = position.x - localPosition.x;
    const dz = position.z - localPosition.z;
    return (
      dx * dx + dz * dz <=
      (this.graphicsTier === 'reduced'
        ? REDUCED_ENTITY_VISUAL_CULL_DISTANCE_SQUARED
        : BALANCED_ENTITY_VISUAL_CULL_DISTANCE_SQUARED)
    );
  }

  setNavigationWaypoint(point: MapPointMm | null): void {
    if (!point) {
      this.navigationWaypoint.visible = false;
      return;
    }
    this.navigationWaypoint.position.set(
      worldMeters(point.x),
      this.footingMeters(point.x, point.z) + 0.04,
      worldMeters(point.z),
    );
    this.navigationWaypoint.visible = true;
  }

  setCombatRangePreview(mode: CombatRangePreviewMode): void {
    this.combatRangePreviewMode = mode;
    if (mode === 'none') {
      this.attackRangeRing.visible = false;
      this.activeRangeRing.visible = false;
    }
  }

  getCombatRangePreviewDiagnostics(): CombatRangePreviewDiagnostics {
    return {
      mode: this.combatRangePreviewMode,
      attackRangeMm: this.attackRangeMm,
      activeRangeMm: this.activeRangeMm,
      attackVisible: this.attackRangeRing.visible,
      activeVisible: this.activeRangeRing.visible,
    };
  }

  getCameraViewState(): CameraViewState {
    const view = CAMERA_VIEWS[this.cameraViewMode];
    return { mode: this.cameraViewMode, label: view.label };
  }

  getCameraYaw(): number {
    return this.cameraOrbitYaw;
  }

  cycleCameraView(direction = 1): CameraViewState {
    const currentIndex = CAMERA_VIEW_ORDER.indexOf(this.cameraViewMode);
    const step = direction < 0 ? -1 : 1;
    const nextIndex = (currentIndex + step + CAMERA_VIEW_ORDER.length) % CAMERA_VIEW_ORDER.length;
    return this.setCameraView(CAMERA_VIEW_ORDER[nextIndex] ?? 'standard');
  }

  setCameraView(mode: CameraViewMode, resetControls = false): CameraViewState {
    const modeChanged = this.cameraViewMode !== mode;
    this.cameraViewMode = mode;
    if (modeChanged || resetControls) {
      this.resetCameraControlState(false);
    }
    return this.getCameraViewState();
  }

  rotateCameraByPixels(deltaX: number, deltaY: number): void {
    const orbit = rotateCameraOrbit(this.cameraOrbitYaw, this.cameraOrbitPitch, deltaX, deltaY);
    this.cameraOrbitYaw = orbit.yaw;
    this.cameraOrbitPitch = orbit.pitch;
  }

  rotateCameraByStep(direction: number): void {
    this.rotateCameraByPixels(-Math.sign(direction) * 30, 0);
  }

  tiltCameraByWheel(deltaY: number, deltaMode: number): void {
    const wheelDelta = normalizeWheelDelta(deltaY, deltaMode, this.canvas.clientHeight);
    this.cameraOrbitPitch = tiltCameraPitch(this.cameraOrbitPitch, wheelDelta);
  }

  zoomCameraByWheel(deltaY: number, deltaMode: number): void {
    const wheelDelta = normalizeWheelDelta(deltaY, deltaMode, this.canvas.clientHeight);
    this.cameraZoomScale = zoomCameraScale(this.cameraZoomScale, wheelDelta);
  }

  stepCameraZoom(direction: number): void {
    this.cameraZoomScale = stepCameraZoomScale(this.cameraZoomScale, direction);
  }

  panCameraByPixels(deltaX: number, deltaY: number): void {
    const metersPerPixel = orthographicMetersPerPixel(
      this.viewportVerticalSize,
      this.cameraFollowState.zoom,
      this.canvas.clientHeight,
    );
    const pan = dragCameraPan(
      { x: this.cameraPanOffset.x, z: this.cameraPanOffset.z },
      deltaX,
      deltaY,
      this.cameraOrbitYaw,
      metersPerPixel,
    );
    this.cameraPanOffset.set(pan.x, 0, pan.z);
  }

  panCameraByScreenDirection(screenX: number, screenY: number): void {
    const visibleVerticalSpan = this.visibleVerticalSpan();
    const pan = moveCameraPan(
      { x: this.cameraPanOffset.x, z: this.cameraPanOffset.z },
      screenX,
      screenY,
      this.cameraOrbitYaw,
      visibleVerticalSpan * 0.075,
    );
    this.cameraPanOffset.set(pan.x, 0, pan.z);
  }

  hasCameraDragStarted(
    startX: number,
    startY: number,
    currentX: number,
    currentY: number,
  ): boolean {
    return hasCameraDragStarted(startX, startY, currentX, currentY);
  }

  getGroundAimDirection(clientX: number, clientY: number): { x: number; z: number } | null {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }
    this.aimPointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.aimRaycaster.setFromCamera(this.aimPointer, this.camera);
    this.groundPlane.set(
      new THREE.Vector3(0, 1, 0),
      -this.footingMeters(
        Math.round(this.cameraLocalTarget.x * 1_000),
        Math.round(this.cameraLocalTarget.z * 1_000),
      ),
    );
    if (!this.aimRaycaster.ray.intersectPlane(this.groundPlane, this.aimHit)) {
      return null;
    }
    const x = this.aimHit.x - this.cameraLocalTarget.x;
    const z = this.aimHit.z - this.cameraLocalTarget.z;
    const length = Math.hypot(x, z);
    return length > 0.001 ? { x: x / length, z: z / length } : null;
  }

  getCameraDiagnostics(): RenderCameraDiagnostics {
    const view = CAMERA_VIEWS[this.cameraViewMode];
    const presetOrbit = cameraOrbitFromOffset(view.offset);
    const targetZoom = view.zoom * this.cameraZoomScale;
    return {
      ...this.getCameraViewState(),
      zoom: this.cameraFollowState.zoom,
      targetZoom,
      presetZoom: view.zoom,
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z],
      desiredTarget: [
        this.cameraDesiredTarget.x,
        this.cameraDesiredTarget.y,
        this.cameraDesiredTarget.z,
      ],
      localTarget: [this.cameraLocalTarget.x, this.cameraLocalTarget.y, this.cameraLocalTarget.z],
      offset: [this.cameraOffset.x, this.cameraOffset.y, this.cameraOffset.z],
      targetOffset: [
        this.cameraDesiredOffset.x,
        this.cameraDesiredOffset.y,
        this.cameraDesiredOffset.z,
      ],
      presetOffset: view.offset,
      yawDegrees: THREE.MathUtils.radToDeg(this.cameraOrbitYaw),
      pitchDegrees: THREE.MathUtils.radToDeg(this.cameraOrbitPitch),
      zoomScale: this.cameraZoomScale,
      panOffset: [this.cameraPanOffset.x, this.cameraPanOffset.z],
      controlsCustomized:
        Math.abs(normalizeCameraYaw(this.cameraOrbitYaw - presetOrbit.yaw)) > 0.0001 ||
        Math.abs(this.cameraOrbitPitch - presetOrbit.pitch) > 0.0001 ||
        Math.abs(this.cameraZoomScale - 1) > 0.0001 ||
        this.cameraPanOffset.lengthSq() > 0.0001,
      navigationWaypointVisible: this.navigationWaypoint.visible,
      navigationWaypointPosition: [
        this.navigationWaypoint.position.x,
        this.navigationWaypoint.position.y,
        this.navigationWaypoint.position.z,
      ],
    };
  }

  /** Metres of world currently spanning the viewport's height. */
  private visibleVerticalSpan(): number {
    return this.viewportVerticalSize / Math.max(0.001, this.cameraFollowState.zoom);
  }

  private cameraDistanceFor(zoom: number): number {
    const span = this.viewportVerticalSize / Math.max(0.001, zoom);
    return span / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV_DEGREES) / 2));
  }

  private resetCameraControlState(snap: boolean): void {
    const orbit = cameraOrbitFromOffset(CAMERA_VIEWS[this.cameraViewMode].offset);
    this.cameraOrbitYaw = orbit.yaw;
    this.cameraOrbitPitch = orbit.pitch;
    this.cameraZoomScale = 1;
    this.cameraPanOffset.set(0, 0, 0);
    if (snap) {
      this.snapCameraToLocalEntity();
    }
  }

  render(snapshot: WorldSnapshot, elapsedSeconds: number, events: readonly SimEvent[] = []): void {
    this.recordRenderFrame(elapsedSeconds);
    const animationTriggers = collectModelAnimationEventTriggers(events);
    if (this.environmentKind === 'none') {
      if (snapshot.mapGeometryHash !== null) {
        this.mapEnvironment = buildMapEnvironment(this.renderer, this.graphicsTier);
        this.scene.add(this.mapEnvironment.group);
        this.mapEnvironment.setGraphicsTier(this.graphicsTier);
        if (!this.sun || !this.hemisphere || !this.fillLight) {
          throw new Error('map atmosphere needs lighting');
        }
        this.mapAtmosphere = createMapAtmosphere(this.scene, {
          sun: this.sun,
          hemisphere: this.hemisphere,
          fill: this.fillLight,
          graphicsReduced: this.graphicsTier === 'reduced',
        });
        this.environmentKind = 'map';
      } else {
        this.createArena();
        this.environmentKind = 'legacy';
      }
    }

    if (this.environmentKind === 'map') {
      for (const [solidId, visual] of this.staticSolidVisuals) {
        this.scene.remove(visual.mesh);
        visual.mesh.geometry.dispose();
        visual.material.dispose();
        this.staticSolidVisuals.delete(solidId);
      }
    } else {
      const currentStaticSolidIds = new Set(snapshot.staticSolids.map((solid) => solid.solidId));
      for (const [solidId, visual] of this.staticSolidVisuals) {
        if (!currentStaticSolidIds.has(solidId)) {
          this.scene.remove(visual.mesh);
          visual.mesh.geometry.dispose();
          visual.material.dispose();
          this.staticSolidVisuals.delete(solidId);
        }
      }
      for (const solid of snapshot.staticSolids) {
        if (!this.staticSolidVisuals.has(solid.solidId)) {
          this.createStaticSolidVisual(solid);
        }
      }
    }

    const visibleAirdrops = snapshot.airdrops.filter(
      (airdrop) => airdrop.phase === 'warning' || airdrop.phase === 'available',
    );
    const visibleAirdropIds = new Set(visibleAirdrops.map((airdrop) => airdrop.id));
    for (const [airdropId, visual] of this.airdropVisuals) {
      if (!visibleAirdropIds.has(airdropId)) {
        this.disposeAirdropVisual(visual);
        this.airdropVisuals.delete(airdropId);
      }
    }
    for (const airdrop of visibleAirdrops) {
      const visual = this.airdropVisuals.get(airdrop.id) ?? this.createAirdropVisual(airdrop);
      this.updateAirdropVisual(visual, airdrop, elapsedSeconds);
    }

    const localPlayer = snapshot.players.find((player) => player.entityId === this.localEntityId);
    this.updateStormVisual(snapshot, localPlayer?.position ?? null, elapsedSeconds);
    if (localPlayer?.taibaiTargetHeroId) {
      const targetDefinition = heroModelDefinition(localPlayer.taibaiTargetHeroId);
      if (targetDefinition) {
        this.modelLibrary.preload(targetDefinition, true);
      }
    }
    const currentIds = new Set(snapshot.players.map((player) => player.entityId));
    for (const [entityId, visual] of this.playerVisuals) {
      if (!currentIds.has(entityId)) {
        this.disposePlayerVisual(visual);
        this.playerVisuals.delete(entityId);
      }
    }

    for (const player of snapshot.players) {
      let visual = this.playerVisuals.get(player.entityId);
      if (visual && visual.heroId !== player.heroId) {
        this.disposePlayerVisual(visual);
        this.playerVisuals.delete(player.entityId);
        visual = undefined;
      }
      visual ??= this.createPlayerVisual(player);
      this.updatePlayerVisual(
        visual,
        player,
        elapsedSeconds,
        localPlayer?.position ?? null,
        animationTriggers.playerAttacks.has(player.entityId),
        animationTriggers.playerSpells.has(player.entityId),
      );
    }

    const currentWallIds = new Set(snapshot.windWalls.map((wall) => wall.entityId));
    for (const [entityId, visual] of this.windWallVisuals) {
      if (!currentWallIds.has(entityId)) {
        this.scene.remove(visual.mesh);
        visual.mesh.geometry.dispose();
        visual.material.dispose();
        this.windWallVisuals.delete(entityId);
      }
    }
    for (const wall of snapshot.windWalls) {
      const visual = this.windWallVisuals.get(wall.entityId) ?? this.createWindWallVisual(wall);
      this.updateWindWallVisual(visual, wall, elapsedSeconds, localPlayer?.position ?? null);
    }

    const currentProjectileIds = new Set(
      snapshot.projectiles.map((projectile) => projectile.entityId),
    );
    for (const [entityId, visual] of this.projectileVisuals) {
      if (!currentProjectileIds.has(entityId)) {
        this.scene.remove(visual.mesh);
        visual.mesh.geometry.dispose();
        visual.material.dispose();
        this.projectileVisuals.delete(entityId);
      }
    }
    for (const projectile of snapshot.projectiles) {
      const visual =
        this.projectileVisuals.get(projectile.entityId) ?? this.createProjectileVisual(projectile);
      this.updateProjectileVisual(
        visual,
        projectile,
        elapsedSeconds,
        localPlayer?.position ?? null,
      );
    }

    const currentMonsterIds = new Set(snapshot.monsters.map((monster) => monster.entityId));
    for (const [entityId, visual] of this.monsterVisuals) {
      if (!currentMonsterIds.has(entityId)) {
        this.disposeMonsterVisual(visual);
        this.monsterVisuals.delete(entityId);
      }
    }
    for (const monster of snapshot.monsters) {
      const definition = monsterModelDefinition(
        monster.kind,
        monster.entityId,
        monster.element,
        snapshot.rootSeed,
      );
      let visual = this.monsterVisuals.get(monster.entityId);
      if (visual && visual.modelId !== (definition?.id ?? null)) {
        this.disposeMonsterVisual(visual);
        this.monsterVisuals.delete(monster.entityId);
        visual = undefined;
      }
      visual ??= this.createMonsterVisual(monster, definition);
      this.updateMonsterVisual(
        visual,
        monster,
        elapsedSeconds,
        localPlayer?.position ?? null,
        animationTriggers.monsterSpells.has(monster.entityId),
      );
    }

    const currentLootIds = new Set(snapshot.lootDrops.map((drop) => drop.entityId));
    for (const [entityId, visual] of this.lootVisuals) {
      if (!currentLootIds.has(entityId)) {
        this.scene.remove(visual.mesh);
        visual.mesh.geometry.dispose();
        visual.material.dispose();
        this.lootVisuals.delete(entityId);
      }
    }
    for (const drop of snapshot.lootDrops) {
      const visual = this.lootVisuals.get(drop.entityId) ?? this.createLootVisual(drop);
      this.updateLootVisual(visual, drop, elapsedSeconds, localPlayer?.position ?? null);
    }

    const currentSummonIds = new Set(snapshot.summons.map((summon) => summon.entityId));
    for (const [entityId, visual] of this.summonVisuals) {
      if (!currentSummonIds.has(entityId)) {
        this.scene.remove(visual.group);
        visual.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
          }
        });
        visual.bodyMaterial.dispose();
        visual.healthMaterial.dispose();
        this.summonVisuals.delete(entityId);
      }
    }
    for (const summon of snapshot.summons) {
      const visual = this.summonVisuals.get(summon.entityId) ?? this.createSummonVisual(summon);
      this.updateSummonVisual(visual, summon, elapsedSeconds, localPlayer?.position ?? null);
    }

    const currentAfterimageIds = new Set(
      snapshot.afterimages.map((afterimage) => afterimage.entityId),
    );
    for (const [entityId, visual] of this.afterimageVisuals) {
      if (!currentAfterimageIds.has(entityId)) {
        this.scene.remove(visual.mesh);
        visual.mesh.geometry.dispose();
        visual.material.dispose();
        this.afterimageVisuals.delete(entityId);
      }
    }
    for (const afterimage of snapshot.afterimages) {
      const visual =
        this.afterimageVisuals.get(afterimage.entityId) ?? this.createAfterimageVisual(afterimage);
      this.updateAfterimageVisual(
        visual,
        afterimage,
        elapsedSeconds,
        localPlayer?.position ?? null,
      );
    }
    this.combatEffects.update(snapshot, events, elapsedSeconds, localPlayer?.position ?? null);

    const local = localPlayer;
    if (local) {
      this.updateCombatRangePreview(local);
      this.cameraLocalTarget.set(
        worldMeters(local.position.x),
        this.footingMeters(local.position.x, local.position.z) + 1.15,
        worldMeters(local.position.z),
      );
      this.cameraDesiredTarget.copy(this.cameraLocalTarget).add(this.cameraPanOffset);
      const cameraView = CAMERA_VIEWS[this.cameraViewMode];
      const desiredZoom = cameraView.zoom * this.cameraZoomScale;
      // Solve the pull-back that makes the requested span fill the frame, so
      // every zoom, pan and viewport rule written for the orthographic rig
      // keeps its meaning: zoom still means "how much world fits on screen".
      const targetOffset = cameraOffsetFromOrbit(
        this.cameraDistanceFor(desiredZoom),
        this.cameraOrbitYaw,
        Math.max(this.minCameraPitch, this.cameraOrbitPitch),
      );
      this.cameraDesiredOffset.set(...targetOffset);
      const cameraDeltaSeconds =
        this.previousCameraSeconds === null
          ? 0
          : Math.max(0, elapsedSeconds - this.previousCameraSeconds);
      this.previousCameraSeconds = elapsedSeconds;
      updateCameraFollowState(
        this.cameraFollowState,
        this.cameraDesiredTarget,
        this.cameraDesiredOffset,
        desiredZoom,
        cameraDeltaSeconds,
        this.cameraSnapRequested,
      );
      this.cameraSnapRequested = false;
      this.camera.position.copy(this.cameraTarget).add(this.cameraOffset);
      this.camera.lookAt(this.cameraTarget);
      this.mapAtmosphere?.update(
        this.cameraTarget.x,
        this.cameraTarget.z,
        this.cameraLocalTarget,
        this.previousAtmosphereSeconds === null
          ? 0
          : Math.max(0, Math.min(0.05, elapsedSeconds - this.previousAtmosphereSeconds)),
      );
      this.previousAtmosphereSeconds = elapsedSeconds;
      this.occlusionFocus.set(
        this.cameraLocalTarget.x,
        this.cameraLocalTarget.y,
        this.cameraLocalTarget.z,
      );
      this.mapEnvironment?.updateOcclusion(this.camera.position, this.occlusionFocus);
      if (this.sun) {
        // Keep the shadow frustum centered on the local player on the big map.
        this.sun.position.set(this.cameraTarget.x - 22, 34, this.cameraTarget.z + 18);
        this.sun.target.position.copy(this.cameraTarget);
      }
    } else {
      this.attackRangeRing.visible = false;
      this.activeRangeRing.visible = false;
    }

    for (const visual of this.playerVisuals.values()) {
      if (
        visual.group.parent === this.scene &&
        visual.group.visible &&
        visual.healthGroup.visible
      ) {
        this.faceCamera(visual.healthGroup);
      }
    }
    for (const visual of this.monsterVisuals.values()) {
      if (
        visual.group.parent === this.scene &&
        visual.group.visible &&
        visual.healthGroup.visible
      ) {
        this.faceCamera(visual.healthGroup);
      }
    }
    for (const visual of this.summonVisuals.values()) {
      if (visual.group.visible && visual.healthGroup.visible) {
        this.faceCamera(visual.healthGroup);
      }
    }

    tickWind(elapsedSeconds);
    this.renderer.render(this.scene, this.camera);
    this.maybeReduceGraphicsLoad(elapsedSeconds);
  }

  private faceCamera(object: THREE.Object3D): void {
    const parent = object.parent;
    if (!parent) {
      object.quaternion.copy(this.camera.quaternion);
      return;
    }
    parent.getWorldQuaternion(this.billboardParentQuaternion);
    object.quaternion
      .copy(this.billboardParentQuaternion)
      .invert()
      .multiply(this.camera.quaternion);
  }

  getPixelDiagnostics(): RenderPixelDiagnostics {
    const gl = this.renderer.getContext();
    const sampleWidth = 96;
    const sampleHeight = 96;
    const target = new THREE.WebGLRenderTarget(sampleWidth, sampleHeight, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(target, 0, 0, sampleWidth, sampleHeight, pixels);
    this.renderer.setRenderTarget(previousTarget);
    target.dispose();

    let nonBlackPixels = 0;
    let minimumChannel = 255;
    let maximumChannel = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      minimumChannel = Math.min(minimumChannel, red, green, blue);
      maximumChannel = Math.max(maximumChannel, red, green, blue);
      if (red !== 0 || green !== 0 || blue !== 0) {
        nonBlackPixels += 1;
      }
    }

    return {
      drawingBufferWidth: gl.drawingBufferWidth,
      drawingBufferHeight: gl.drawingBufferHeight,
      sampledPixels: sampleWidth * sampleHeight,
      nonBlackPixels,
      minimumChannel,
      maximumChannel,
    };
  }

  getModelDiagnostics(): RenderModelDiagnostics {
    const playerModels = [...this.playerVisuals.entries()]
      .map(([entityId, visual]) => ({
        entityId,
        modelId: visual.model ? visual.heroId : null,
        loaded: visual.model?.isLoaded ?? false,
        loadRequested: visual.model?.isLoadRequested ?? false,
        visible: visual.group.parent === this.scene && visual.group.visible,
        visualScale: visual.model?.root.scale.x ?? 1,
        instanceUuid: visual.model?.root.uuid ?? null,
        animationState: visual.model?.animationState ?? null,
        meshNames: visual.model?.loadedMeshNames ?? [],
        fallbackRenderableMeshes: visual.model?.fallbackRenderableMeshCount ?? 0,
      }))
      .sort((left, right) => Number(left.entityId) - Number(right.entityId));
    const monsterModels = [...this.monsterVisuals.entries()]
      .map(([entityId, visual]) => ({
        entityId,
        modelId: visual.modelId,
        loaded: visual.model?.isLoaded ?? false,
        loadRequested: visual.model?.isLoadRequested ?? false,
        visible: visual.group.parent === this.scene && visual.group.visible,
        visualScale: visual.model?.root.scale.x ?? 1,
        instanceUuid: visual.model?.root.uuid ?? null,
        animationState: visual.model?.animationState ?? null,
        meshNames: visual.model?.loadedMeshNames ?? [],
        fallbackRenderableMeshes: visual.model?.fallbackRenderableMeshCount ?? 0,
      }))
      .sort((left, right) => Number(left.entityId) - Number(right.entityId));
    const visibleModels = [
      ...[...this.playerVisuals.values()]
        .filter((visual) => visual.group.parent === this.scene && visual.group.visible)
        .map((visual) => visual.model),
      ...[...this.monsterVisuals.values()]
        .filter((visual) => visual.group.parent === this.scene && visual.group.visible)
        .map((visual) => visual.model),
    ].filter((model): model is CharacterModelInstance => model !== null);
    const visibleLoadedInstances = visibleModels.filter((model) => model.isLoaded).length;
    const visibleRenderableFallbackInstances = visibleModels.filter(
      (model) => model.fallbackRenderableMeshCount > 0,
    ).length;
    let sceneSprites = 0;
    this.scene.traverse((child) => {
      if (child instanceof THREE.Sprite) {
        sceneSprites += 1;
      }
    });
    return {
      ...this.modelLibrary.diagnostics(),
      visibleInstances: visibleModels.length,
      visibleLoadedInstances,
      visiblePendingInstances: visibleModels.length - visibleLoadedInstances,
      visibleRenderableFallbackInstances,
      sceneSprites,
      playerModels,
      monsterModels,
    };
  }

  getEntityDiagnostics(): RenderEntityDiagnostics {
    return {
      playerVisuals: this.playerVisuals.size,
      visiblePlayerVisuals: [...this.playerVisuals.values()].filter(
        (visual) => visual.group.visible && visual.group.parent === this.scene,
      ).length,
      monsterVisuals: this.monsterVisuals.size,
      visibleMonsterVisuals: [...this.monsterVisuals.values()].filter(
        (visual) => visual.group.visible && visual.group.parent === this.scene,
      ).length,
      lootVisuals: this.lootVisuals.size,
      airdropVisuals: [...this.airdropVisuals.values()].filter((visual) => visual.group.visible)
        .length,
    };
  }

  getCombatEffectDiagnostics(): ReturnType<CombatEffectsLayer['getDiagnostics']> {
    return this.combatEffects.getDiagnostics();
  }

  getOcclusionDiagnostics(): MapOcclusionDiagnostics {
    return (
      this.mapEnvironment?.getOcclusionDiagnostics() ?? {
        active: false,
        roofOpacity: 1,
        roofIntersections: 0,
        roofMeshCount: 0,
        treeOpacity: 1,
        treeIntersections: 0,
        treeCount: 0,
        activeTreeCount: 0,
        fadingTreeCount: 0,
        activeTreeIds: [],
        occluderCount: 0,
        activeOccluderCount: 0,
        fadingOccluderCount: 0,
        activeOccluderIds: [],
      }
    );
  }

  getFloraModelDiagnostics(): ReturnType<MapEnvironment['getFloraModelDiagnostics']> {
    return (
      this.mapEnvironment?.getFloraModelDiagnostics() ?? {
        source: 'grassworks',
        status: 'disabled',
        loadedAssets: [],
        failedAssets: [],
        treeInstances: 0,
        visibleTreeInstances: 0,
        rockInstances: 0,
        visibleRockInstances: 0,
        dressingInstances: 0,
        visibleDressingInstances: 0,
        instancedBatches: 0,
        visibleInstancedBatches: 0,
        triangles: 0,
        drawCalls: 0,
        visible: false,
        tileSizeMeters: 25,
        renderBatchSizeMeters: 50,
        maxGrassDistanceMeters: 150,
        influenceResolution: 256,
        grassInstances: 0,
        visibleGrassInstances: 0,
        visibleGrassInstancesByLod: {
          high: 0,
          medium: 0,
          low: 0,
          veryLow: 0,
        },
        highTreeInstances: 0,
        lowTreeInstances: 0,
        visibleHighTreeInstances: 0,
        visibleLowTreeInstances: 0,
        grassChunks: 0,
        grassTiles: 0,
        grassRenderBatches: 0,
        visibleGrassChunks: 0,
        treeChunks: 0,
        visibleTreeChunks: 0,
        legacyFloraInstances: 0,
        legacyScatterInstances: 0,
        legacyGlobalSceneVegetationInstances: 0,
      }
    );
  }

  getMapAssetDiagnostics(): MapAssetLayerDiagnostics {
    return (
      this.mapEnvironment?.getMapAssetDiagnostics() ?? {
        status: 'disabled',
        loadedAssets: [],
        failedAssets: [],
        landmarks: [],
        landmarkInstances: 0,
        visibleLandmarkInstances: 0,
        rockInstances: 0,
        visibleRockInstances: 0,
        instancedBatches: 0,
        triangles: 0,
        drawCalls: 0,
        visible: false,
      }
    );
  }

  getGlobalSceneDiagnostics(): GlobalSceneLayerDiagnostics {
    return (
      this.mapEnvironment?.getGlobalSceneDiagnostics() ?? {
        status: 'disabled',
        loadedAssets: [],
        failedAssets: [],
        placements: 0,
        visiblePlacements: 0,
        placementsBySource: {
          overgrown: 0,
          'forest-road-night': 0,
          'forest-mountains': 0,
        },
        visiblePlacementsBySource: {
          overgrown: 0,
          'forest-road-night': 0,
          'forest-mountains': 0,
        },
        instancedBatches: 0,
        visibleInstancedBatches: 0,
        triangles: 0,
        drawCalls: 0,
        visible: false,
      }
    );
  }

  getPerformanceDiagnostics(): RenderPerformanceDiagnostics {
    const samples = [...this.renderFrameIntervalsMs].sort((left, right) => left - right);
    const total = samples.reduce((sum, value) => sum + value, 0);
    const averageFrameMs = samples.length > 0 ? total / samples.length : 0;
    const p95Index = Math.min(samples.length - 1, Math.floor(samples.length * 0.95));
    return {
      sampledFrames: samples.length,
      averageFps: averageFrameMs > 0 ? 1_000 / averageFrameMs : 0,
      averageFrameMs,
      p95FrameMs: samples[p95Index] ?? 0,
      maximumFrameMs: samples.at(-1) ?? 0,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      lines: this.renderer.info.render.lines,
      points: this.renderer.info.render.points,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
      graphicsTier: this.graphicsTier,
      graphicsPreference: this.graphicsPreference,
      gpuRenderer: this.gpuRenderer,
      shadowsEnabled: this.renderer.shadowMap.enabled,
    };
  }

  getSceneContributorDiagnostics(): readonly RenderSceneContributorDiagnostics[] {
    const contributors = new Map<
      string,
      { meshes: number; visibleMeshes: number; triangles: number; drawCalls: number }
    >();
    const isVisibleInScene = (object: THREE.Object3D): boolean => {
      for (let current: THREE.Object3D | null = object; current; current = current.parent) {
        if (!current.visible) {
          return false;
        }
        if (current === this.scene) {
          return true;
        }
      }
      return false;
    };
    const contributorName = (object: THREE.Object3D): string => {
      const environmentGroup = this.mapEnvironment?.group;
      if (environmentGroup) {
        let current: THREE.Object3D | null = object;
        while (
          current?.parent &&
          current.parent !== environmentGroup &&
          current.parent !== this.scene
        ) {
          current = current.parent;
        }
        if (current?.parent === environmentGroup) {
          return current.name || current.type;
        }
      }
      let current: THREE.Object3D | null = object;
      while (current?.parent && current.parent !== this.scene) {
        current = current.parent;
      }
      return current?.name || current?.type || 'scene';
    };
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      const name = contributorName(object);
      const current = contributors.get(name) ?? {
        meshes: 0,
        visibleMeshes: 0,
        triangles: 0,
        drawCalls: 0,
      };
      current.meshes += 1;
      const visible = isVisibleInScene(object);
      if (visible) {
        current.visibleMeshes += 1;
      }
      const position = object.geometry.getAttribute('position');
      const index = object.geometry.getIndex();
      const triangles = index
        ? Math.floor(index.count / 3)
        : position
          ? Math.floor(position.count / 3)
          : 0;
      const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
      current.triangles += triangles * instances;
      current.drawCalls += visible ? 1 : 0;
      contributors.set(name, current);
    });
    return [...contributors.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((left, right) => right.triangles - left.triangles);
  }

  resetPerformanceDiagnostics(): void {
    this.renderFrameIntervalsMs.length = 0;
    this.previousRenderSeconds = null;
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    for (const visual of this.windWallVisuals.values()) {
      visual.mesh.geometry.dispose();
      visual.material.dispose();
    }
    for (const visual of this.projectileVisuals.values()) {
      visual.mesh.geometry.dispose();
      visual.material.dispose();
    }
    for (const visual of this.monsterVisuals.values()) {
      this.disposeMonsterVisual(visual);
    }
    for (const visual of this.lootVisuals.values()) {
      visual.mesh.geometry.dispose();
      visual.material.dispose();
    }
    for (const visual of this.summonVisuals.values()) {
      visual.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      });
      visual.bodyMaterial.dispose();
      visual.healthMaterial.dispose();
    }
    for (const visual of this.playerVisuals.values()) {
      this.disposePlayerVisual(visual);
    }
    for (const visual of this.afterimageVisuals.values()) {
      visual.mesh.geometry.dispose();
      visual.material.dispose();
    }
    for (const visual of this.staticSolidVisuals.values()) {
      visual.mesh.geometry.dispose();
      visual.material.dispose();
    }
    for (const visual of this.airdropVisuals.values()) {
      this.disposeAirdropVisual(visual);
    }
    this.mapEnvironment?.dispose();
    this.mapAtmosphere?.dispose();
    this.navigationWaypoint.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.dispose();
      }
    });
    this.attackRangeRing.geometry.dispose();
    this.attackRangeRing.material.dispose();
    this.activeRangeRing.geometry.dispose();
    this.activeRangeRing.material.dispose();
    this.stormRing.geometry.dispose();
    this.stormRing.material.dispose();
    this.stormWall.geometry.dispose();
    this.stormWall.material.dispose();
    this.combatEffects.dispose();
    this.modelLibrary.dispose();
    this.renderer.dispose();
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const aspect = width / height;
    this.viewportVerticalSize = aspect < 0.8 ? 34 : aspect < 1.2 ? 29 : 24;
    this.minCameraPitch = aspect < 0.8 ? THREE.MathUtils.degToRad(PORTRAIT_MIN_PITCH_DEGREES) : 0;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private createLighting(): void {
    // Section 7 of the scene prompt: warm gold key from the upper side, cool
    // 青 sky bounce as ambient, and a cool counter-light so nothing falls into
    // black. The sky half of the hemisphere carries the cool, which is what
    // keeps overcast districts from reading as grey.
    const hemisphere = new THREE.HemisphereLight(0xcfe1f2, 0x5b5748, 1.7);
    this.scene.add(hemisphere);
    this.hemisphere = hemisphere;

    const sun = new THREE.DirectionalLight(0xffe8bc, 2.2);
    sun.position.set(-22, 34, 18);
    sun.castShadow = this.graphicsTier === 'balanced';
    sun.shadow.mapSize.set(1_024, 1_024);
    // Widened with the pitch drop: at 26-32 degrees the camera sees roughly
    // half again as far down-range as it did at 39, and shadows that stopped
    // at 38 m ended in a visible line across open ground.
    sun.shadow.camera.left = -58;
    sun.shadow.camera.right = 58;
    sun.shadow.camera.top = 58;
    sun.shadow.camera.bottom = -58;
    sun.shadow.normalBias = 0.08;
    sun.shadow.radius = 3;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    // Cool counter-light from the opposite quadrant lifts the faces the sun
    // misses, so tall walls read as stone instead of dropping to black.
    const fill = new THREE.DirectionalLight(0x9db8c4, 0.6);
    fill.position.set(24, 16, -20);
    this.scene.add(fill);
    this.fillLight = fill;
  }

  private createNavigationWaypoint(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'navigation-waypoint';
    group.visible = false;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.58, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf4d35c,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    group.add(ring);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.44, 7, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xf4d35c,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.y = 3.5;
    group.add(beam);

    const pointer = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.48, 0),
      new THREE.MeshBasicMaterial({
        color: 0xffe786,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
      }),
    );
    pointer.position.y = 5.3;
    pointer.rotation.z = Math.PI / 4;
    group.add(pointer);

    this.scene.add(group);
    return group;
  }

  private createCombatRangeRing(
    color: number,
    dashed: boolean,
  ): THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial | THREE.LineDashedMaterial> {
    const points: THREE.Vector3[] = [];
    for (let segment = 0; segment < 160; segment += 1) {
      const angle = (segment / 160) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
    }
    const material = dashed
      ? new THREE.LineDashedMaterial({
          color,
          dashSize: 0.22,
          gapSize: 0.14,
          transparent: true,
          opacity: 0.86,
          depthTest: false,
          depthWrite: false,
        })
      : new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.72,
          depthTest: false,
          depthWrite: false,
        });
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
    if (dashed) {
      ring.computeLineDistances();
    }
    ring.name = dashed ? 'active-range-preview' : 'attack-range-preview';
    ring.position.y = dashed ? 0.19 : 0.17;
    ring.renderOrder = dashed ? 61 : 60;
    ring.visible = false;
    ring.frustumCulled = false;
    this.scene.add(ring);
    return ring;
  }

  private createStormVisuals(): {
    readonly group: THREE.Group;
    readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    readonly wall: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  } {
    const group = new THREE.Group();
    group.name = 'storm-zone';
    group.visible = false;
    group.frustumCulled = false;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.986, 1.012, 192),
      new THREE.MeshBasicMaterial({
        color: 0xb48cff,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    ring.renderOrder = 8;
    ring.frustumCulled = false;
    group.add(ring);

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 96, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x7a5cd8,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    wall.position.y = 9;
    wall.scale.y = 18;
    wall.renderOrder = 7;
    wall.frustumCulled = false;
    group.add(wall);

    this.scene.add(group);
    return { group, ring, wall };
  }

  private updateStormVisual(
    snapshot: WorldSnapshot,
    localPosition: PlayerSnapshot['position'] | null,
    elapsedSeconds: number,
  ): void {
    const storm = snapshot.stormZone;
    const apocalypse = storm.apocalypseStarted || storm.radiusMm <= 0;
    this.stormGroup.visible = !apocalypse;
    if (apocalypse) {
      return;
    }
    const radiusMeters = Math.max(4, worldMeters(storm.radiusMm));
    this.stormGroup.position.set(worldMeters(storm.center.x), 0, worldMeters(storm.center.z));
    this.stormRing.scale.setScalar(radiusMeters);
    this.stormWall.scale.set(radiusMeters, 18, radiusMeters);
    let outside = false;
    if (localPosition) {
      const dx = localPosition.x - storm.center.x;
      const dz = localPosition.z - storm.center.z;
      outside = dx * dx + dz * dz > storm.radiusMm * storm.radiusMm;
    }
    const pulse = 0.82 + Math.sin(elapsedSeconds * 2.4) * 0.12;
    this.stormRing.material.color.setHex(outside ? 0xff6b63 : 0xb48cff);
    this.stormRing.material.opacity = outside ? 0.98 : pulse;
    this.stormWall.material.color.setHex(outside ? 0xc45b6a : 0x7a5cd8);
    this.stormWall.material.opacity = outside ? 0.38 : 0.2;
  }

  private updateCombatRangePreview(player: PlayerSnapshot): void {
    const active = activePresentationRange(getActiveDefinition(player.activeAbilityId));
    this.attackRangeMm = player.attackRangeMm;
    this.activeRangeMm = active?.rangeMm ?? null;
    const canPresent = player.lifeState !== 'eliminated' && player.lifeState !== 'soul-flight';
    const showAttack =
      canPresent &&
      (this.combatRangePreviewMode === 'attack' || this.combatRangePreviewMode === 'both');
    const showActive =
      canPresent &&
      active !== null &&
      (this.combatRangePreviewMode === 'active' || this.combatRangePreviewMode === 'both');
    this.attackRangeRing.visible = showAttack;
    this.activeRangeRing.visible = showActive;
    const surface = this.footingMeters(player.position.x, player.position.z);
    this.attackRangeRing.position.set(
      worldMeters(player.position.x),
      surface + 0.17,
      worldMeters(player.position.z),
    );
    this.activeRangeRing.position.set(
      worldMeters(player.position.x),
      surface + 0.19,
      worldMeters(player.position.z),
    );
    if (showAttack) {
      this.attackRangeRing.scale.setScalar(worldMeters(player.attackRangeMm));
    }
    if (showActive && active) {
      this.activeRangeRing.scale.setScalar(worldMeters(active.rangeMm));
    }
  }

  private createArena(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(125, 128),
      new THREE.MeshStandardMaterial({
        color: 0x364239,
        roughness: 0.94,
        metalness: 0.02,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(250, 50, 0x7b8878, 0x4d5a4e);
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.2;
    grid.position.y = 0.035;
    this.scene.add(grid);

    const innerCourt = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 14, 0.35, 48),
      new THREE.MeshStandardMaterial({
        color: 0x4b4f43,
        roughness: 0.86,
        metalness: 0.06,
      }),
    );
    innerCourt.position.y = 0.16;
    innerCourt.receiveShadow = true;
    this.scene.add(innerCourt);

    const crossPathMaterial = new THREE.MeshStandardMaterial({
      color: 0x555b4e,
      roughness: 0.92,
    });
    for (const rotation of [0, Math.PI / 2]) {
      const path = new THREE.Mesh(new THREE.BoxGeometry(74, 0.08, 5.5), crossPathMaterial);
      path.position.y = 0.06;
      path.rotation.y = rotation;
      path.receiveShadow = true;
      this.scene.add(path);
    }

    for (const radius of [14, 28, 48, 80, 118]) {
      const points: THREE.Vector3[] = [];
      for (let segment = 0; segment <= 128; segment += 1) {
        const angle = (segment / 128) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * radius, 0.025, Math.sin(angle) * radius));
      }
      const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: radius === 14 ? 0xb79447 : 0x667063,
          transparent: true,
          opacity: radius === 14 ? 0.72 : 0.24,
        }),
      );
      this.scene.add(ring);
    }

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x596052,
      roughness: 0.9,
    });
    const wallSpecs = [
      [-10, 1.1, -7, 9, 2.2, 1.4, 0.2],
      [8, 1.1, 8, 12, 2.2, 1.4, -0.42],
      [19, 1.1, -11, 8, 2.2, 1.4, 0.9],
      [-21, 1.1, 13, 10, 2.2, 1.4, -0.76],
      [4, 1.1, -22, 7, 2.2, 1.4, 0.1],
      [-29, 1.1, -15, 9, 2.2, 1.4, 0.48],
    ] as const;
    for (const [x, y, z, width, height, depth, rotation] of wallSpecs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMaterial);
      wall.position.set(x, y, z);
      wall.rotation.y = rotation;
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
    }

    const pillarGeometry = new THREE.CylinderGeometry(0.45, 0.58, 3.2, 8);
    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0x765a37,
      roughness: 0.82,
    });
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      pillar.position.set(Math.cos(angle) * 16.5, 1.6, Math.sin(angle) * 16.5);
      pillar.castShadow = true;
      this.scene.add(pillar);
    }

    const lanternColors = [0xd89b45, 0xb95843, 0xd89b45, 0x71a57d];
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
      const light = new THREE.PointLight(lanternColors[index] ?? 0xd89b45, 18, 18, 2);
      light.position.set(Math.cos(angle) * 13, 3.2, Math.sin(angle) * 13);
      this.scene.add(light);
    }
  }

  private createPlayerVisual(player: PlayerSnapshot): PlayerVisual {
    const group = new THREE.Group();
    const color = HERO_COLORS[player.heroId] ?? 0xc8b887;
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.12,
      emissive: 0x000000,
    });
    const placeholder = new THREE.Group();
    placeholder.name = `model-loading-${player.heroId}`;
    const definition = heroModelDefinition(player.heroId);
    const model = definition ? this.modelLibrary.createInstance(definition, placeholder) : null;
    if (model) {
      model.root.scale.setScalar(PLAYER_MODEL_VISUAL_SCALE);
      group.add(model.root);
    } else {
      group.add(placeholder);
    }

    const spawnMarker =
      player.entityId === this.localEntityId ? this.createPlayerSpawnMarker() : null;
    if (spawnMarker) {
      group.add(spawnMarker.group);
    }

    const healthGroup = new THREE.Group();
    healthGroup.position.set(
      0,
      (definition?.height ?? 2.2) * PLAYER_MODEL_VISUAL_SCALE +
        WORLD_SCALE_PROFILE.character.playerHealthBar.offset,
      0,
    );
    const healthBackground = new THREE.Mesh(
      new THREE.PlaneGeometry(
        WORLD_SCALE_PROFILE.character.playerHealthBar.backgroundWidth,
        WORLD_SCALE_PROFILE.character.playerHealthBar.backgroundHeight,
      ),
      new THREE.MeshBasicMaterial({ color: 0x171b18, transparent: true, opacity: 0.9 }),
    );
    const healthMaterial = new THREE.MeshBasicMaterial({ color: 0xcf4e45 });
    const healthBar = new THREE.Mesh(
      new THREE.PlaneGeometry(
        WORLD_SCALE_PROFILE.character.playerHealthBar.width,
        WORLD_SCALE_PROFILE.character.playerHealthBar.height,
      ),
      healthMaterial,
    );
    healthBar.position.z = 0.01;
    healthGroup.add(healthBackground, healthBar);
    group.add(healthGroup);

    const shieldShell = new THREE.Mesh(
      new THREE.SphereGeometry(WORLD_SCALE_PROFILE.character.playerShield.radius, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0x76d9e8,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        wireframe: true,
      }),
    );
    shieldShell.position.y = WORLD_SCALE_PROFILE.character.playerShield.y;
    shieldShell.visible = false;
    group.add(shieldShell);

    const iceCoffinShell = new THREE.Mesh(
      new THREE.CapsuleGeometry(
        WORLD_SCALE_PROFILE.character.playerIceCoffin.radius,
        WORLD_SCALE_PROFILE.character.playerIceCoffin.length,
        8,
        16,
      ),
      new THREE.MeshStandardMaterial({
        color: 0xa6e8f5,
        emissive: 0x174f61,
        emissiveIntensity: 0.82,
        roughness: 0.18,
        metalness: 0.04,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    );
    iceCoffinShell.position.y = WORLD_SCALE_PROFILE.character.playerIceCoffin.y;
    iceCoffinShell.visible = false;
    group.add(iceCoffinShell);

    const whirlwindRing = new THREE.Mesh(
      new THREE.TorusGeometry(8, 0.16, 8, 72),
      new THREE.MeshBasicMaterial({
        color: 0xe5a94f,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      }),
    );
    whirlwindRing.rotation.x = Math.PI / 2;
    whirlwindRing.position.y = 0.2;
    whirlwindRing.visible = false;
    group.add(whirlwindRing);

    this.scene.add(group);
    const visual = {
      heroId: player.heroId,
      group,
      bodyMaterial,
      model,
      spawnMarker,
      spawnPositionX: player.position.x,
      spawnPositionZ: player.position.z,
      healthGroup,
      healthBar,
      healthMaterial,
      shieldShell,
      iceCoffinShell,
      whirlwindRing,
      spawnMarkerDismissed: false,
      previousAttackCooldownTicks: player.attackCooldownTicks,
      previousAttackIntent: player.intent.attack,
      previousActiveCooldownTicks: player.activeCooldownTicks,
      previousWhirlwindTicks: player.whirlwindTicks,
    };
    this.playerVisuals.set(player.entityId, visual);
    return visual;
  }

  private updatePlayerVisual(
    visual: PlayerVisual,
    player: PlayerSnapshot,
    elapsedSeconds: number,
    localPosition: PlayerSnapshot['position'] | null,
    attackTriggered: boolean,
    spellTriggered: boolean,
  ): void {
    const isSoul = player.lifeState === 'soul-flight';
    const isAlive = player.lifeState !== 'eliminated';
    const distanceSquared = localPosition
      ? (player.position.x - localPosition.x) ** 2 + (player.position.z - localPosition.z) ** 2
      : 0;
    const isLocal = player.entityId === this.localEntityId;
    if (
      !visual.spawnMarkerDismissed &&
      hasMovedFromSpawn(
        visual.spawnPositionX,
        visual.spawnPositionZ,
        player.position.x,
        player.position.z,
      )
    ) {
      visual.spawnMarkerDismissed = true;
    }
    const visible =
      isAlive &&
      (isLocal ||
        !localPosition ||
        distanceSquared <=
          (this.graphicsTier === 'reduced'
            ? REDUCED_ENTITY_VISUAL_CULL_DISTANCE_SQUARED
            : BALANCED_ENTITY_VISUAL_CULL_DISTANCE_SQUARED));
    if (visible) {
      if (visual.group.parent !== this.scene) {
        this.scene.add(visual.group);
      }
      visual.group.visible = true;
    } else {
      visual.group.visible = false;
      if (visual.group.parent === this.scene) {
        this.scene.remove(visual.group);
      }
    }
    if (!visible) {
      visual.previousAttackCooldownTicks = player.attackCooldownTicks;
      visual.previousAttackIntent = player.intent.attack;
      visual.previousActiveCooldownTicks = player.activeCooldownTicks;
      visual.previousWhirlwindTicks = player.whirlwindTicks;
      return;
    }
    const surface = this.footingMeters(player.position.x, player.position.z);
    visual.group.position.set(
      worldMeters(player.position.x),
      isSoul ? surface + 2.4 + Math.sin(elapsedSeconds * 4) * 0.24 : surface,
      worldMeters(player.position.z),
    );
    visual.group.rotation.y = Math.atan2(player.facing.x, player.facing.z);
    visual.model?.setShadows(
      shouldCastCharacterShadow(this.graphicsTier, distanceSquared, isLocal),
      this.graphicsTier === 'balanced',
    );
    visual.model?.ensureLoaded(isLocal);
    const showSpawnMarker = isLocal && !visual.spawnMarkerDismissed && !isSoul;
    if (showSpawnMarker && !visual.spawnMarker) {
      visual.spawnMarker = this.createPlayerSpawnMarker();
      visual.group.add(visual.spawnMarker.group);
    }
    if (visual.spawnMarker) {
      visual.spawnMarker.group.visible = showSpawnMarker;
    }
    if (showSpawnMarker && visual.spawnMarker) {
      updateSpawnMarkerVisual(visual.spawnMarker, elapsedSeconds);
    }
    visual.healthGroup.visible =
      isLocal ||
      distanceSquared <=
        (this.graphicsTier === 'reduced'
          ? REDUCED_PLAYER_STATUS_DISTANCE_SQUARED
          : BALANCED_PLAYER_STATUS_DISTANCE_SQUARED);

    const healthRatio = player.maxHp > 0 ? player.hp / player.maxHp : 0;
    visual.healthBar.scale.x = Math.max(0.001, healthRatio);
    visual.healthBar.position.x =
      -((1 - healthRatio) * WORLD_SCALE_PROFILE.character.playerHealthBar.width) / 2;
    visual.healthMaterial.color.setHex(healthRatio > 0.35 ? 0xcf4e45 : 0xe18c3d);
    visual.bodyMaterial.transparent = isSoul;
    visual.bodyMaterial.opacity = isSoul ? 0.42 : 1;
    visual.shieldShell.visible = player.totalShield > 0 && !isSoul;
    visual.shieldShell.rotation.y = elapsedSeconds * 1.8;
    visual.iceCoffinShell.visible = player.iceCoffinTicks > 0 && !isSoul;
    visual.iceCoffinShell.rotation.y = elapsedSeconds * 0.7;
    const icePulse = 1 + Math.sin(elapsedSeconds * 5) * 0.018;
    visual.iceCoffinShell.scale.setScalar(icePulse);
    visual.whirlwindRing.visible = player.whirlwindTicks > 0 && !isSoul;
    visual.whirlwindRing.rotation.z = elapsedSeconds * 5.5;
    visual.bodyMaterial.emissive.setHex(
      player.iceCoffinTicks > 0
        ? 0x216d82
        : player.invulnerableTicks > 0
          ? 0x155b67
          : player.b20ReviveBuffTicks > 0
            ? 0x1f5b32
            : player.whirlwindTicks > 0
              ? 0x6e2e0d
              : player.activeBuffTicks > 0 && Math.sin(elapsedSeconds * 12) > 0
                ? 0x5d4210
                : 0x000000,
    );
    visual.model?.setEffects(
      isSoul ? 0.42 : 1,
      player.iceCoffinTicks > 0
        ? 0x216d82
        : player.invulnerableTicks > 0
          ? 0x155b67
          : player.b20ReviveBuffTicks > 0
            ? 0x1f5b32
            : player.whirlwindTicks > 0
              ? 0x6e2e0d
              : 0x000000,
    );
    const moving = !isSoul && (player.intent.movement.x !== 0 || player.intent.movement.z !== 0);
    const attackIntentStarted = player.intent.attack && !visual.previousAttackIntent;
    const trigger =
      spellTriggered ||
      player.activeCooldownTicks > visual.previousActiveCooldownTicks ||
      (player.whirlwindTicks > 0 && visual.previousWhirlwindTicks <= 0)
        ? 'Spell'
        : attackTriggered ||
            attackIntentStarted ||
            player.attackCooldownTicks > visual.previousAttackCooldownTicks
          ? 'Attack'
          : null;
    visual.model?.update(
      elapsedSeconds,
      moving ? 'Move' : 'Idle',
      trigger,
      characterAnimationIntervalSeconds(this.graphicsTier, distanceSquared, isLocal),
    );
    visual.previousAttackCooldownTicks = player.attackCooldownTicks;
    visual.previousAttackIntent = player.intent.attack;
    visual.previousActiveCooldownTicks = player.activeCooldownTicks;
    visual.previousWhirlwindTicks = player.whirlwindTicks;
  }

  private createPlayerSpawnMarker(): SpawnMarkerVisual {
    return createSpawnMarkerVisual(
      WORLD_SCALE_PROFILE.character.playerSelectionRing.innerRadius,
      WORLD_SCALE_PROFILE.character.playerSelectionRing.outerRadius,
      WORLD_SCALE_PROFILE.character.playerSelectionRing.elevation,
    );
  }

  private createStaticSolidVisual(solid: StaticSolidRect): StaticSolidVisual {
    const material = new THREE.MeshStandardMaterial({
      color: solid.solidId.includes('thin') ? 0x6c8b83 : 0x6b7480,
      roughness: 0.82,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        worldMeters(solid.maximumX - solid.minimumX),
        2.2,
        worldMeters(solid.maximumZ - solid.minimumZ),
      ),
      material,
    );
    mesh.position.set(
      worldMeters((solid.minimumX + solid.maximumX) / 2),
      1.1,
      worldMeters((solid.minimumZ + solid.maximumZ) / 2),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const visual = { mesh, material };
    this.staticSolidVisuals.set(solid.solidId, visual);
    return visual;
  }

  private createAirdropVisual(airdrop: AirdropSnapshot): AirdropVisual {
    const group = new THREE.Group();
    const warningBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.65, 9, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xf0c75e,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    warningBeam.position.y = 4.5;
    group.add(warningBeam);

    const warningRing = new THREE.Mesh(
      new THREE.RingGeometry(2.05, 2.42, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf0c75e,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    warningRing.position.y = 0.055;
    warningRing.rotation.x = -Math.PI / 2;
    group.add(warningRing);

    const crate = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({
      color: 0x3f5846,
      roughness: 0.72,
      metalness: 0.08,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0xd0a84d,
      emissive: 0x4c3510,
      emissiveIntensity: 0.35,
      roughness: 0.38,
      metalness: 0.62,
    });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, 1.35), wood);
    base.position.y = 0.62;
    base.castShadow = true;
    base.receiveShadow = true;
    crate.add(base);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.3, 1.47), wood);
    lid.position.y = 1.28;
    lid.castShadow = true;
    crate.add(lid);
    for (const x of [-0.62, 0.62]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.42, 1.52), metal);
      strap.position.set(x, 0.73, 0);
      strap.castShadow = true;
      crate.add(strap);
    }
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.14), metal);
    latch.position.set(0, 0.86, 0.75);
    crate.add(latch);
    group.add(crate);

    this.scene.add(group);
    const visual = { group, warningBeam, warningRing, crate };
    this.airdropVisuals.set(airdrop.id, visual);
    return visual;
  }

  private updateAirdropVisual(
    visual: AirdropVisual,
    airdrop: AirdropSnapshot,
    elapsedSeconds: number,
  ): void {
    if (!airdrop.position) {
      visual.group.visible = false;
      return;
    }
    visual.group.visible = true;
    visual.group.position.set(
      worldMeters(airdrop.position.x),
      this.footingMeters(airdrop.position.x, airdrop.position.z),
      worldMeters(airdrop.position.z),
    );
    const pulse = 1 + Math.sin(elapsedSeconds * 4.5 + airdrop.sequence) * 0.08;
    visual.warningRing.scale.setScalar(pulse);
    visual.warningRing.rotation.z = elapsedSeconds * 0.45;
    visual.warningBeam.material.opacity =
      airdrop.phase === 'warning' ? 0.18 + Math.sin(elapsedSeconds * 5) * 0.05 : 0.09;
    visual.warningRing.material.opacity = airdrop.phase === 'warning' ? 0.82 : 0.52;
    visual.crate.visible = airdrop.phase === 'available';
    visual.crate.position.y =
      airdrop.phase === 'available' ? 0.04 + Math.sin(elapsedSeconds * 2.8) * 0.04 : 0;
  }

  private disposeAirdropVisual(visual: AirdropVisual): void {
    this.scene.remove(visual.group);
    visual.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.dispose();
      }
    });
  }

  private createMonsterVisual(
    monster: MonsterSnapshot,
    definition = monsterModelDefinition(monster.kind, monster.entityId, monster.element),
  ): MonsterVisual {
    const group = new THREE.Group();
    const color =
      monster.kind === 'core-boss'
        ? 0x8b3c55
        : monster.kind === 'dragon-king'
          ? 0x7d55a1
          : monster.kind === 'pig'
            ? 0xc78367
            : monster.kind.startsWith('elite')
              ? 0x8f7650
              : monster.kind === 'flying'
                ? 0x5d87a8
                : 0x66755e;
    const radius = Math.max(0.38, worldMeters(monster.collisionRadiusMm));
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.78,
      metalness: monster.kind.startsWith('elite') || monster.kind === 'core-boss' ? 0.24 : 0.04,
    });
    const placeholder = new THREE.Group();
    placeholder.name = `model-loading-${definition?.id ?? monster.kind}`;
    const model = definition ? this.modelLibrary.createInstance(definition, placeholder) : null;
    if (model) {
      model.root.scale.setScalar(MONSTER_MODEL_VISUAL_SCALE);
      group.add(model.root);
    } else {
      group.add(placeholder);
    }

    const healthGroup = new THREE.Group();
    healthGroup.position.set(
      0,
      Math.max(
        radius * 2.45 + 0.55,
        (definition?.height ?? radius * 2) * MONSTER_MODEL_VISUAL_SCALE +
          WORLD_SCALE_PROFILE.character.monsterHealthBar.offset,
      ),
      0,
    );
    const healthBackground = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(1.1, radius * 2.3), 0.12),
      new THREE.MeshBasicMaterial({ color: 0x171b18, transparent: true, opacity: 0.88 }),
    );
    const healthMaterial = new THREE.MeshBasicMaterial({ color: 0xb7c85c });
    const healthBar = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(1.02, radius * 2.15), 0.07),
      healthMaterial,
    );
    healthBar.position.z = 0.01;
    healthGroup.add(healthBackground, healthBar);
    group.add(healthGroup);

    this.scene.add(group);
    const visual = {
      modelId: definition?.id ?? null,
      group,
      bodyMaterial,
      model,
      healthGroup,
      healthBar,
      healthMaterial,
      previousAttackCooldownTicks: monster.attackCooldownTicks,
      previousPositionX: monster.position.x,
      previousPositionZ: monster.position.z,
    };
    this.monsterVisuals.set(monster.entityId, visual);
    return visual;
  }

  private disposePlayerVisual(visual: PlayerVisual): void {
    this.scene.remove(visual.group);
    visual.model?.dispose();
    visual.bodyMaterial.dispose();
    visual.healthMaterial.dispose();
    visual.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (material !== visual.bodyMaterial && material !== visual.healthMaterial) {
            material.dispose();
          }
        }
      }
    });
  }

  private disposeMonsterVisual(visual: MonsterVisual): void {
    this.scene.remove(visual.group);
    visual.model?.dispose();
    visual.bodyMaterial.dispose();
    visual.healthMaterial.dispose();
    visual.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (material !== visual.bodyMaterial && material !== visual.healthMaterial) {
            material.dispose();
          }
        }
      }
    });
  }

  private updateMonsterVisual(
    visual: MonsterVisual,
    monster: MonsterSnapshot,
    elapsedSeconds: number,
    localPosition: PlayerSnapshot['position'] | null,
    spellTriggered: boolean,
  ): void {
    const radius = Math.max(0.38, worldMeters(monster.collisionRadiusMm));
    const distanceSquared = localPosition
      ? (monster.position.x - localPosition.x) ** 2 + (monster.position.z - localPosition.z) ** 2
      : 0;
    const visible =
      !localPosition ||
      distanceSquared <=
        (this.graphicsTier === 'reduced'
          ? REDUCED_ENTITY_VISUAL_CULL_DISTANCE_SQUARED
          : BALANCED_ENTITY_VISUAL_CULL_DISTANCE_SQUARED);
    if (visible) {
      if (visual.group.parent !== this.scene) {
        this.scene.add(visual.group);
      }
      visual.group.visible = true;
    } else {
      visual.group.visible = false;
      if (visual.group.parent === this.scene) {
        this.scene.remove(visual.group);
      }
    }
    if (!visible) {
      visual.previousAttackCooldownTicks = monster.attackCooldownTicks;
      visual.previousPositionX = monster.position.x;
      visual.previousPositionZ = monster.position.z;
      return;
    }
    const surface = this.footingMeters(monster.position.x, monster.position.z);
    visual.group.position.set(
      worldMeters(monster.position.x),
      monster.kind === 'flying'
        ? surface + 1.4 + Math.sin(elapsedSeconds * 3.6 + Number(monster.entityId)) * 0.24
        : surface,
      worldMeters(monster.position.z),
    );
    visual.group.rotation.y = Math.atan2(monster.facing.x, monster.facing.z);
    visual.model?.setShadows(
      shouldCastCharacterShadow(this.graphicsTier, distanceSquared, false),
      this.graphicsTier === 'balanced',
    );
    visual.model?.ensureLoaded();
    visual.healthGroup.visible =
      distanceSquared <=
      (this.graphicsTier === 'reduced'
        ? REDUCED_MONSTER_STATUS_DISTANCE_SQUARED
        : BALANCED_MONSTER_STATUS_DISTANCE_SQUARED);
    const healthRatio = monster.maxHp > 0 ? monster.hp / monster.maxHp : 0;
    visual.healthBar.scale.x = Math.max(0.001, healthRatio);
    visual.healthBar.position.x = -((1 - healthRatio) * Math.max(1.02, radius * 2.15)) / 2;
    visual.healthMaterial.color.setHex(
      monster.kind === 'core-boss' || monster.kind === 'dragon-king' ? 0xe0a255 : 0xb7c85c,
    );
    visual.bodyMaterial.emissive.setHex(
      monster.invulnerableTicks > 0
        ? 0x31536a
        : monster.targetEntityId !== null
          ? 0x3d2415
          : 0x000000,
    );
    visual.model?.setEffects(
      1,
      monster.invulnerableTicks > 0
        ? 0x31536a
        : monster.targetEntityId !== null
          ? 0x3d2415
          : 0x000000,
    );
    const moved =
      Math.abs(monster.position.x - visual.previousPositionX) > 4 ||
      Math.abs(monster.position.z - visual.previousPositionZ) > 4;
    const trigger = spellTriggered
      ? 'Spell'
      : monster.attackCooldownTicks > visual.previousAttackCooldownTicks
        ? 'Attack'
        : null;
    visual.model?.update(
      elapsedSeconds,
      moved ? 'Move' : 'Idle',
      trigger,
      characterAnimationIntervalSeconds(this.graphicsTier, distanceSquared, false),
    );
    visual.previousAttackCooldownTicks = monster.attackCooldownTicks;
    visual.previousPositionX = monster.position.x;
    visual.previousPositionZ = monster.position.z;
  }

  private recordRenderFrame(elapsedSeconds: number): void {
    if (this.previousRenderSeconds !== null) {
      const intervalMs = (elapsedSeconds - this.previousRenderSeconds) * 1_000;
      if (Number.isFinite(intervalMs) && intervalMs > 0 && intervalMs <= 250) {
        this.renderFrameIntervalsMs.push(intervalMs);
        if (this.renderFrameIntervalsMs.length > MAX_PERFORMANCE_FRAME_SAMPLES) {
          this.renderFrameIntervalsMs.shift();
        }
        if (this.graphicsPreference === 'auto' && this.graphicsTier === 'balanced') {
          this.adaptiveFrameIntervalsMs.push(intervalMs);
          if (this.adaptiveFrameIntervalsMs.length > MAX_PERFORMANCE_FRAME_SAMPLES) {
            this.adaptiveFrameIntervalsMs.shift();
          }
        }
      }
    }
    this.previousRenderSeconds = elapsedSeconds;
  }

  private maybeReduceGraphicsLoad(elapsedSeconds: number): void {
    if (this.graphicsPreference !== 'auto' || this.graphicsTier === 'reduced') {
      return;
    }

    this.adaptiveReadinessCheckFrames += 1;
    if (this.adaptiveReadinessCheckFrames >= ADAPTIVE_GRAPHICS_READINESS_CHECK_INTERVAL_FRAMES) {
      this.adaptiveReadinessCheckFrames = 0;
      const resourcesReady = this.performanceResourcesReady();
      if (resourcesReady !== this.adaptiveResourcesReady) {
        this.adaptiveResourcesReady = resourcesReady;
        this.adaptiveReadySinceSeconds = resourcesReady ? elapsedSeconds : null;
        this.adaptiveSamplingStarted = false;
        this.adaptiveFrameIntervalsMs.length = 0;
      }
    }

    if (!this.adaptiveResourcesReady || this.adaptiveReadySinceSeconds === null) {
      return;
    }
    if (!this.adaptiveSamplingStarted) {
      if (elapsedSeconds - this.adaptiveReadySinceSeconds < ADAPTIVE_GRAPHICS_SETTLE_SECONDS) {
        return;
      }
      this.adaptiveSamplingStarted = true;
      this.adaptiveFrameIntervalsMs.length = 0;
      return;
    }
    if (this.adaptiveFrameIntervalsMs.length < 120) {
      return;
    }

    const shouldReduce = shouldReduceGraphicsLoad(this.adaptiveFrameIntervalsMs);
    this.adaptiveFrameIntervalsMs.length = 0;
    if (!shouldReduce) {
      return;
    }
    this.applyGraphicsTier('reduced');
  }

  private performanceResourcesReady(): boolean {
    if (this.environmentKind === 'none') {
      return false;
    }
    if (this.modelLibrary.diagnostics().pendingTemplateLoads > 0) {
      return false;
    }
    if (!this.mapEnvironment) {
      return true;
    }
    const floraStatus = this.mapEnvironment.getFloraModelDiagnostics().status;
    const mapAssetStatus = this.mapEnvironment.getMapAssetDiagnostics().status;
    const globalSceneStatus = this.mapEnvironment.getGlobalSceneDiagnostics().status;
    return (
      floraStatus !== 'loading' && mapAssetStatus !== 'loading' && globalSceneStatus !== 'loading'
    );
  }

  private resetAdaptiveQualitySampling(): void {
    this.adaptiveFrameIntervalsMs.length = 0;
    this.adaptiveReadinessCheckFrames = ADAPTIVE_GRAPHICS_READINESS_CHECK_INTERVAL_FRAMES - 1;
    this.adaptiveResourcesReady = false;
    this.adaptiveReadySinceSeconds = null;
    this.adaptiveSamplingStarted = false;
  }

  private resolveGraphicsTier(preference: WebGraphicsPreference): 'balanced' | 'reduced' {
    if (preference === 'quality') {
      return 'balanced';
    }
    if (preference === 'performance') {
      return 'reduced';
    }
    return this.detectedGraphicsTier;
  }

  private applyGraphicsTier(tier: 'balanced' | 'reduced'): void {
    this.graphicsTier = tier;
    this.renderer.shadowMap.enabled = tier === 'balanced';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap()));
    if (this.sun) {
      this.sun.castShadow = tier === 'balanced';
    }
    this.mapEnvironment?.setGraphicsTier(tier);
    this.combatEffects.setGraphicsTier(tier);
    this.resize();
  }

  private pixelRatioCap(): number {
    if (this.graphicsTier === 'reduced') {
      return REDUCED_PIXEL_RATIO_CAP;
    }
    return this.graphicsPreference === 'quality'
      ? QUALITY_PIXEL_RATIO_CAP
      : AUTO_BALANCED_PIXEL_RATIO_CAP;
  }

  private detectGraphicsTier(): {
    readonly tier: 'balanced' | 'reduced';
    readonly renderer: string;
  } {
    const gl = this.renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    const deviceMemory = (navigator as Navigator & { readonly deviceMemory?: number }).deviceMemory;
    const hardwareConcurrency = navigator.hardwareConcurrency;
    const softwareRenderer = /swiftshader|llvmpipe|software/i.test(renderer);
    const integratedGpu = /intel|iris|uhd|radeon\(tm\) graphics|vega \d|adreno|mali/i.test(
      renderer,
    );
    const discreteDesktopGpu = /nvidia|geforce|quadro|radeon rx|arc(?:\(tm\))? a\d/i.test(renderer);
    const touchMobile =
      navigator.maxTouchPoints > 0 &&
      window.matchMedia('(pointer: coarse)').matches &&
      Math.min(window.innerWidth, window.innerHeight) <= 900;
    const reduced =
      softwareRenderer ||
      touchMobile ||
      integratedGpu ||
      (!discreteDesktopGpu &&
        ((typeof deviceMemory === 'number' && deviceMemory <= 6) ||
          (typeof hardwareConcurrency === 'number' && hardwareConcurrency <= 4)));
    return {
      tier: reduced ? 'reduced' : 'balanced',
      renderer,
    };
  }

  private createLootVisual(drop: LootSnapshot): LootVisual {
    const material = new THREE.MeshStandardMaterial({
      color: drop.equipmentId
        ? 0xd29d4d
        : drop.bookPassiveId
          ? 0xb78ae0
          : drop.gems > 0
            ? 0x72c4d2
            : 0xc6b267,
      emissive: drop.equipmentId ? 0x4d3211 : 0x000000,
      emissiveIntensity: drop.equipmentId ? 0.45 : 0,
      roughness: 0.42,
      metalness: 0.24,
    });
    const mesh = new THREE.Mesh(
      drop.equipmentId
        ? new THREE.OctahedronGeometry(0.46, 0)
        : new THREE.CylinderGeometry(0.32, 0.32, 0.16, 8),
      material,
    );
    mesh.castShadow = true;
    this.scene.add(mesh);
    const visual = { mesh, material };
    this.lootVisuals.set(drop.entityId, visual);
    return visual;
  }

  private updateLootVisual(
    visual: LootVisual,
    drop: LootSnapshot,
    elapsedSeconds: number,
    localPosition: PlayerSnapshot['position'] | null,
  ): void {
    const visible = this.isWithinEntityVisualDistance(drop.position, localPosition);
    visual.mesh.visible = visible;
    if (!visible) {
      return;
    }
    visual.mesh.castShadow = this.graphicsTier === 'balanced';
    visual.mesh.position.set(
      worldMeters(drop.position.x),
      this.footingMeters(drop.position.x, drop.position.z) +
        0.42 +
        Math.sin(elapsedSeconds * 4 + Number(drop.entityId)) * 0.08,
      worldMeters(drop.position.z),
    );
    visual.mesh.rotation.y = elapsedSeconds * 1.8 + Number(drop.entityId) * 0.17;
  }

  private createSummonVisual(summon: SummonSnapshot): SummonVisual {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color:
        summon.kind === 'wolf-spirit'
          ? 0x8da7ad
          : summon.kind === 'fire-spirit'
            ? 0xe76f36
            : 0x8b897c,
      emissive: summon.kind === 'fire-spirit' ? 0x9a2f0e : 0x000000,
      emissiveIntensity: summon.kind === 'fire-spirit' ? 1.2 : 0,
      roughness: summon.kind === 'stone-statue' ? 0.95 : 0.5,
      metalness: summon.kind === 'stone-statue' ? 0.08 : 0.02,
    });
    const body = new THREE.Mesh(
      summon.kind === 'stone-statue'
        ? new THREE.BoxGeometry(1.25, 2.15, 1.25)
        : summon.kind === 'fire-spirit'
          ? new THREE.SphereGeometry(0.34, 16, 12)
          : new THREE.CapsuleGeometry(0.42, 0.72, 5, 10),
      bodyMaterial,
    );
    body.position.y =
      summon.kind === 'stone-statue' ? 1.08 : summon.kind === 'fire-spirit' ? 0.78 : 0.72;
    body.castShadow = true;
    group.add(body);

    const healthGroup = new THREE.Group();
    healthGroup.position.set(0, summon.kind === 'stone-statue' ? 2.55 : 1.72, 0);
    const healthBackground = new THREE.Mesh(
      new THREE.PlaneGeometry(1.25, 0.11),
      new THREE.MeshBasicMaterial({
        color: 0x171b18,
        transparent: true,
        opacity: 0.88,
      }),
    );
    const healthMaterial = new THREE.MeshBasicMaterial({ color: 0x73b790 });
    const healthBar = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.07), healthMaterial);
    healthBar.position.z = 0.01;
    healthGroup.add(healthBackground, healthBar);
    healthGroup.visible = summon.targetable;
    group.add(healthGroup);

    this.scene.add(group);
    const visual = { group, bodyMaterial, healthGroup, healthBar, healthMaterial };
    this.summonVisuals.set(summon.entityId, visual);
    return visual;
  }

  private updateSummonVisual(
    visual: SummonVisual,
    summon: SummonSnapshot,
    elapsedSeconds: number,
    localPosition: PlayerSnapshot['position'] | null,
  ): void {
    const visible = this.isWithinEntityVisualDistance(summon.position, localPosition);
    visual.group.visible = visible;
    if (!visible) {
      return;
    }
    visual.group.position.set(
      worldMeters(summon.position.x),
      this.footingMeters(summon.position.x, summon.position.z) +
        (summon.kind === 'fire-spirit'
          ? Math.sin(elapsedSeconds * 6 + Number(summon.entityId)) * 0.12
          : 0),
      worldMeters(summon.position.z),
    );
    visual.group.rotation.y =
      summon.kind === 'fire-spirit' ? elapsedSeconds * 3.5 : Number(summon.entityId) * 0.37;
    const healthRatio = summon.maxHp > 0 ? summon.hp / summon.maxHp : 0;
    visual.healthBar.scale.x = Math.max(0.001, healthRatio);
    visual.healthBar.position.x = -((1 - healthRatio) * 1.18) / 2;
    visual.bodyMaterial.emissiveIntensity =
      summon.kind === 'fire-spirit'
        ? 1 + Math.sin(elapsedSeconds * 9 + Number(summon.entityId)) * 0.25
        : 0;
  }

  private createAfterimageVisual(afterimage: AfterimageSnapshot): AfterimageVisual {
    const material = new THREE.MeshBasicMaterial({
      color: afterimage.explosionDamage > 0 ? 0xe0804f : 0x6cb7c2,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.35, 1.05, 36), material);
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    const visual = { mesh, material };
    this.afterimageVisuals.set(afterimage.entityId, visual);
    return visual;
  }

  private updateAfterimageVisual(
    visual: AfterimageVisual,
    afterimage: AfterimageSnapshot,
    elapsedSeconds: number,
    localPosition: PlayerSnapshot['position'] | null,
  ): void {
    const visible = this.isWithinEntityVisualDistance(afterimage.position, localPosition);
    visual.mesh.visible = visible;
    if (!visible) {
      return;
    }
    visual.mesh.position.set(
      worldMeters(afterimage.position.x),
      this.footingMeters(afterimage.position.x, afterimage.position.z) + 0.055,
      worldMeters(afterimage.position.z),
    );
    visual.mesh.rotation.z = elapsedSeconds * 1.8 + Number(afterimage.entityId) * 0.11;
    const pulse = 0.92 + Math.sin(elapsedSeconds * 7 + Number(afterimage.entityId)) * 0.08;
    visual.mesh.scale.setScalar(pulse);
  }

  private createWindWallVisual(wall: WindWallSnapshot): WindWallVisual {
    const material = new THREE.MeshBasicMaterial({
      color: 0x9adce5,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(worldMeters(wall.lengthMm), 3.2, 0.12),
      material,
    );
    this.scene.add(mesh);
    const visual = { mesh, material };
    this.windWallVisuals.set(wall.entityId, visual);
    return visual;
  }

  private updateWindWallVisual(
    visual: WindWallVisual,
    wall: WindWallSnapshot,
    elapsedSeconds: number,
    localPosition: PlayerSnapshot['position'] | null,
  ): void {
    const visible = this.isWithinEntityVisualDistance(wall.center, localPosition);
    visual.mesh.visible = visible;
    if (!visible) {
      return;
    }
    visual.mesh.position.set(
      worldMeters(wall.center.x),
      this.footingMeters(wall.center.x, wall.center.z) + 1.6,
      worldMeters(wall.center.z),
    );
    visual.mesh.rotation.y = Math.atan2(wall.direction.x, wall.direction.z);
    visual.mesh.scale.y = 0.94 + Math.sin(elapsedSeconds * 9 + Number(wall.entityId)) * 0.06;
    visual.material.opacity = Math.min(0.56, 0.2 + wall.remainingTicks / 180);
  }

  private createProjectileVisual(projectile: ProjectileSnapshot): ProjectileVisual {
    const material = new THREE.MeshBasicMaterial({
      color:
        projectile.kind === 'cold-arrow'
          ? 0x9ce7ff
          : effectColorForElement(projectile.sourceElement),
      transparent: true,
      opacity: 0.96,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const radius = Math.max(0.12, worldMeters(projectile.collisionRadiusMm));
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
    this.scene.add(mesh);
    const visual = { mesh, material };
    this.projectileVisuals.set(projectile.entityId, visual);
    return visual;
  }

  private updateProjectileVisual(
    visual: ProjectileVisual,
    projectile: ProjectileSnapshot,
    elapsedSeconds: number,
    localPosition: PlayerSnapshot['position'] | null,
  ): void {
    const visible = this.isWithinEntityVisualDistance(projectile.position, localPosition);
    visual.mesh.visible = visible;
    if (!visible) {
      return;
    }
    visual.mesh.position.set(
      worldMeters(projectile.position.x),
      this.footingMeters(projectile.position.x, projectile.position.z) + 1.15,
      worldMeters(projectile.position.z),
    );
    const pulse = 0.92 + Math.sin(elapsedSeconds * 18 + Number(projectile.entityId)) * 0.08;
    visual.mesh.scale.setScalar(pulse);
  }
}
