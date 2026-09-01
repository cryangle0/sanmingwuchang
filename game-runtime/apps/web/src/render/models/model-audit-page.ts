import * as THREE from 'three';
import {
  type CharacterAnimationState,
  CharacterModelLibrary,
  characterModelRenderableBounds,
} from './character-model-library';
import {
  WEB_HERO_MODELS,
  WEB_MONSTER_MODELS,
  WEB_SHOP_MODELS,
  type WebModelDefinition,
} from './web-model-catalog';

interface VectorRecord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface AnimationBoundsRecord {
  readonly state: CharacterAnimationState;
  readonly sampledFrames: number;
  readonly minimumHeight: number;
  readonly maximumHeight: number;
  readonly minimumGroundOffset: number;
  readonly maximumGroundOffset: number;
  readonly maximumHorizontalCenterOffset: number;
  readonly maximumPresentationPositionDelta: number;
  readonly maximumPresentationScaleDelta: number;
  readonly maximumPresentationRotationDelta: number;
}

export interface WebModelAuditResult {
  readonly id: string;
  readonly sourceName: string;
  readonly kind: string;
  readonly status: 'passed' | 'failed';
  readonly loadMilliseconds: number;
  readonly meshCount: number;
  readonly skinnedMeshCount: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly materialCount: number;
  readonly textureCount: number;
  readonly readyTextureCount: number;
  readonly animationClipCount: number;
  readonly animationTrackCount: number;
  readonly animationBounds: readonly AnimationBoundsRecord[];
  readonly targetHeight: number;
  readonly boundsMinimum: VectorRecord;
  readonly boundsMaximum: VectorRecord;
  readonly boundsSize: VectorRecord;
  readonly changedPixels: number;
  readonly pixelCoverage: number;
  readonly colorBucketCount: number;
  readonly errors: readonly string[];
}

export interface WebModelAuditReport {
  readonly schema: 'jwgb.web-model-render-audit.v1';
  readonly generatedAt: string;
  readonly modelBaseUrl: string;
  readonly renderer: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly WebModelAuditResult[];
}

interface ModelAuditController {
  readonly status: 'running' | 'complete' | 'failed';
  readonly completed: number;
  readonly total: number;
  readonly report: WebModelAuditReport | null;
  readonly error: string | null;
}

declare global {
  interface Window {
    __JWGB_MODEL_AUDIT__?: ModelAuditController;
  }
}

const requestedModelIds = new Set(
  new URLSearchParams(window.location.search)
    .get('ids')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? [],
);
const MODEL_CATALOG = [...WEB_HERO_MODELS, ...WEB_MONSTER_MODELS, ...WEB_SHOP_MODELS];
const ALL_MODELS =
  requestedModelIds.size > 0
    ? MODEL_CATALOG.filter((model) => requestedModelIds.has(model.id))
    : [...WEB_HERO_MODELS, ...WEB_MONSTER_MODELS];
const RENDER_SIZE = 256;
const BACKGROUND = 0x172023;
const TEXTURE_WAIT_MILLISECONDS = 15_000;
const MINIMUM_CHANGED_PIXELS = 320;
const MINIMUM_COLOR_BUCKETS = 8;
const HEIGHT_TOLERANCE = 0.025;
const GROUND_TOLERANCE = 0.025;
const MINIMUM_ANIMATED_HEIGHT_RATIO = 0.55;
const MAXIMUM_ANIMATED_HEIGHT_RATIO = 1.8;
const PRESENTATION_TRANSFORM_TOLERANCE = 0.000_01;
const ANIMATION_STATES: readonly CharacterAnimationState[] = ['Idle', 'Move', 'Attack', 'Spell'];
const ANIMATION_SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75, 0.995] as const;

const statusOutput = requiredElement<HTMLOutputElement>('audit-status');
const grid = requiredElement<HTMLElement>('audit-grid');
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(1);
renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const target = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE, {
  depthBuffer: true,
  stencilBuffer: false,
  colorSpace: THREE.SRGBColorSpace,
});

function requiredElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`missing audit element ${id}`);
  }
  return element as unknown as T;
}

function modelBaseUrl(): string {
  const configured = new URLSearchParams(window.location.search).get('modelBase')?.trim();
  return configured || '/models/';
}

function vectorRecord(vector: THREE.Vector3): VectorRecord {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function finiteVector(vector: THREE.Vector3): boolean {
  return vector.toArray().every(Number.isFinite);
}

function textureReady(texture: THREE.Texture): boolean {
  const image = texture.image as
    | {
        readonly complete?: boolean;
        readonly naturalHeight?: number;
        readonly naturalWidth?: number;
        readonly height?: number;
        readonly width?: number;
      }
    | undefined;
  if (!image) {
    return false;
  }
  const width = image.naturalWidth ?? image.width ?? 0;
  const height = image.naturalHeight ?? image.height ?? 0;
  return image.complete !== false && width > 0 && height > 0;
}

function modelMaterials(root: THREE.Object3D): {
  readonly materials: readonly THREE.Material[];
  readonly textures: readonly THREE.Texture[];
} {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) {
          textures.add(value);
        }
      }
    }
  });
  return { materials: [...materials], textures: [...textures] };
}

async function waitForTextures(textures: readonly THREE.Texture[]): Promise<number> {
  const deadline = performance.now() + TEXTURE_WAIT_MILLISECONDS;
  while (performance.now() < deadline) {
    const ready = textures.filter(textureReady).length;
    if (ready === textures.length) {
      return ready;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }
  return textures.filter(textureReady).length;
}

interface ObjectTransformSnapshot {
  readonly object: THREE.Object3D;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale: THREE.Vector3;
  readonly morphTargetInfluences: readonly number[] | null;
}

function captureObjectTransforms(root: THREE.Object3D): readonly ObjectTransformSnapshot[] {
  const snapshots: ObjectTransformSnapshot[] = [];
  root.traverse((object) => {
    const morphTargetInfluences =
      object instanceof THREE.Mesh && object.morphTargetInfluences
        ? [...object.morphTargetInfluences]
        : null;
    snapshots.push({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
      morphTargetInfluences,
    });
  });
  return snapshots;
}

function restoreObjectTransforms(snapshots: readonly ObjectTransformSnapshot[]): void {
  for (const snapshot of snapshots) {
    snapshot.object.position.copy(snapshot.position);
    snapshot.object.quaternion.copy(snapshot.quaternion);
    snapshot.object.scale.copy(snapshot.scale);
    if (
      snapshot.object instanceof THREE.Mesh &&
      snapshot.object.morphTargetInfluences &&
      snapshot.morphTargetInfluences
    ) {
      snapshot.object.morphTargetInfluences.splice(
        0,
        snapshot.object.morphTargetInfluences.length,
        ...snapshot.morphTargetInfluences,
      );
    }
  }
}

function validateAnimations(
  root: THREE.Group,
  clips: ReadonlyMap<CharacterAnimationState, THREE.AnimationClip>,
  targetHeight: number,
  animationStates: readonly CharacterAnimationState[],
  errors: string[],
): {
  readonly trackCount: number;
  readonly bounds: readonly AnimationBoundsRecord[];
} {
  let trackCount = 0;
  const animationBounds: AnimationBoundsRecord[] = [];
  const mixer = new THREE.AnimationMixer(root);
  const transformSnapshots = captureObjectTransforms(root);
  const presentationPosition = root.position.clone();
  const presentationQuaternion = root.quaternion.clone();
  const presentationScale = root.scale.clone();
  const initialBounds = characterModelRenderableBounds(root);
  const initialCenter = initialBounds.getCenter(new THREE.Vector3());

  for (const state of animationStates) {
    const clip = clips.get(state);
    if (!clip) {
      errors.push(`missing ${state} clip`);
      continue;
    }
    if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
      errors.push(`${state} has invalid duration`);
    }
    if (clip.tracks.length === 0) {
      errors.push(`${state} has no animation tracks`);
    }
    trackCount += clip.tracks.length;
    mixer.stopAllAction();
    restoreObjectTransforms(transformSnapshots);
    root.updateMatrixWorld(true);
    const action = mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopOnce, 1).play();
    action.clampWhenFinished = true;

    let previousSampleTime = 0;
    let minimumHeight = Number.POSITIVE_INFINITY;
    let maximumHeight = Number.NEGATIVE_INFINITY;
    let minimumGroundOffset = Number.POSITIVE_INFINITY;
    let maximumGroundOffset = Number.NEGATIVE_INFINITY;
    let maximumHorizontalCenterOffset = 0;
    let maximumPresentationPositionDelta = 0;
    let maximumPresentationScaleDelta = 0;
    let maximumPresentationRotationDelta = 0;
    let sampledFrames = 0;

    for (const fraction of ANIMATION_SAMPLE_FRACTIONS) {
      const sampleTime = clip.duration * fraction;
      mixer.update(Math.max(0, sampleTime - previousSampleTime));
      previousSampleTime = sampleTime;
      root.updateMatrixWorld(true);
      let finiteMatrices = true;
      root.traverse((child) => {
        finiteMatrices &&= child.matrixWorld.elements.every(Number.isFinite);
      });
      if (!finiteMatrices) {
        errors.push(`${state} produced a non-finite transform at ${fraction.toFixed(3)}`);
        continue;
      }

      const bounds = characterModelRenderableBounds(root);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      if (
        bounds.isEmpty() ||
        !finiteVector(bounds.min) ||
        !finiteVector(bounds.max) ||
        !finiteVector(size)
      ) {
        errors.push(`${state} produced invalid render bounds at ${fraction.toFixed(3)}`);
        continue;
      }

      sampledFrames += 1;
      minimumHeight = Math.min(minimumHeight, size.y);
      maximumHeight = Math.max(maximumHeight, size.y);
      minimumGroundOffset = Math.min(minimumGroundOffset, bounds.min.y);
      maximumGroundOffset = Math.max(maximumGroundOffset, bounds.min.y);
      maximumHorizontalCenterOffset = Math.max(
        maximumHorizontalCenterOffset,
        Math.hypot(center.x - initialCenter.x, center.z - initialCenter.z),
      );
      maximumPresentationPositionDelta = Math.max(
        maximumPresentationPositionDelta,
        root.position.distanceTo(presentationPosition),
      );
      maximumPresentationScaleDelta = Math.max(
        maximumPresentationScaleDelta,
        root.scale.distanceTo(presentationScale),
      );
      maximumPresentationRotationDelta = Math.max(
        maximumPresentationRotationDelta,
        root.quaternion.angleTo(presentationQuaternion),
      );
    }

    const boundsRecord: AnimationBoundsRecord = {
      state,
      sampledFrames,
      minimumHeight,
      maximumHeight,
      minimumGroundOffset,
      maximumGroundOffset,
      maximumHorizontalCenterOffset,
      maximumPresentationPositionDelta,
      maximumPresentationScaleDelta,
      maximumPresentationRotationDelta,
    };
    animationBounds.push(boundsRecord);

    if (sampledFrames !== ANIMATION_SAMPLE_FRACTIONS.length) {
      errors.push(
        `${state} sampled only ${sampledFrames}/${ANIMATION_SAMPLE_FRACTIONS.length} frames`,
      );
    }
    if (minimumHeight < targetHeight * MINIMUM_ANIMATED_HEIGHT_RATIO) {
      errors.push(`${state} collapses to height ${minimumHeight.toFixed(3)}`);
    }
    if (maximumHeight > targetHeight * MAXIMUM_ANIMATED_HEIGHT_RATIO) {
      errors.push(`${state} expands to height ${maximumHeight.toFixed(3)}`);
    }
    const horizontalOffsetLimit = Math.max(0.75, targetHeight * 0.75);
    if (maximumHorizontalCenterOffset > horizontalOffsetLimit) {
      errors.push(
        `${state} moves ${maximumHorizontalCenterOffset.toFixed(3)} from the entity center`,
      );
    }
    const minimumGroundLimit = -Math.max(0.35, targetHeight * 0.25);
    if (minimumGroundOffset < minimumGroundLimit) {
      errors.push(`${state} sinks to ${minimumGroundOffset.toFixed(3)}`);
    }
    if (
      maximumPresentationPositionDelta > PRESENTATION_TRANSFORM_TOLERANCE ||
      maximumPresentationScaleDelta > PRESENTATION_TRANSFORM_TOLERANCE ||
      maximumPresentationRotationDelta > PRESENTATION_TRANSFORM_TOLERANCE
    ) {
      errors.push(`${state} overwrites the normalized presentation transform`);
    }
    action.stop();
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  restoreObjectTransforms(transformSnapshots);
  root.updateMatrixWorld(true);
  return { trackCount, bounds: animationBounds };
}

function frameCamera(camera: THREE.PerspectiveCamera, bounds: THREE.Box3): void {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(0.1, sphere.radius);
  const direction = new THREE.Vector3(1.15, 0.48, 1.8).normalize();
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5))) * 1.18;
  camera.near = Math.max(0.01, distance / 100);
  camera.far = Math.max(100, distance * 10);
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
}

function renderPixels(
  scene: THREE.Scene,
  camera: THREE.Camera,
): {
  readonly pixels: Uint8Array;
  readonly changedPixels: number;
  readonly pixelCoverage: number;
  readonly colorBucketCount: number;
} {
  const baseline = new Uint8Array(RENDER_SIZE * RENDER_SIZE * 4);
  const pixels = new Uint8Array(RENDER_SIZE * RENDER_SIZE * 4);
  const visibleObjects = scene.children.filter((child) => child.userData.modelAuditVisual === true);
  for (const object of visibleObjects) {
    object.visible = false;
  }
  renderer.setRenderTarget(target);
  renderer.setClearColor(BACKGROUND, 1);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(target, 0, 0, RENDER_SIZE, RENDER_SIZE, baseline);
  for (const object of visibleObjects) {
    object.visible = true;
  }
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(target, 0, 0, RENDER_SIZE, RENDER_SIZE, pixels);
  renderer.setRenderTarget(null);

  let changedPixels = 0;
  const colors = new Set<number>();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;
    const baselineRed = baseline[offset] ?? 0;
    const baselineGreen = baseline[offset + 1] ?? 0;
    const baselineBlue = baseline[offset + 2] ?? 0;
    const difference = Math.max(
      Math.abs(red - baselineRed),
      Math.abs(green - baselineGreen),
      Math.abs(blue - baselineBlue),
    );
    if (difference <= 6) {
      continue;
    }
    changedPixels += 1;
    colors.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
  }
  return {
    pixels,
    changedPixels,
    pixelCoverage: changedPixels / (RENDER_SIZE * RENDER_SIZE),
    colorBucketCount: colors.size,
  };
}

function appendResultCard(
  definition: WebModelDefinition,
  result: WebModelAuditResult,
  pixels: Uint8Array,
): void {
  const figure = document.createElement('figure');
  figure.className = 'audit-model';
  figure.dataset.status = result.status;
  const canvas = document.createElement('canvas');
  canvas.width = RENDER_SIZE;
  canvas.height = RENDER_SIZE;
  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(RENDER_SIZE, RENDER_SIZE);
    for (let y = 0; y < RENDER_SIZE; y += 1) {
      const sourceStart = (RENDER_SIZE - y - 1) * RENDER_SIZE * 4;
      const destinationStart = y * RENDER_SIZE * 4;
      image.data.set(pixels.subarray(sourceStart, sourceStart + RENDER_SIZE * 4), destinationStart);
    }
    context.putImageData(image, 0, 0);
  }
  const caption = document.createElement('figcaption');
  const id = document.createElement('strong');
  id.textContent = definition.id;
  const name = document.createElement('span');
  name.textContent = definition.sourceName;
  const metrics = document.createElement('span');
  metrics.textContent =
    result.status === 'passed'
      ? `${result.meshCount} mesh / ${result.triangleCount.toLocaleString()} tri`
      : result.errors.join('; ');
  caption.append(id, name, document.createElement('span'), metrics);
  figure.append(canvas, caption);
  grid.append(figure);
}

async function auditModel(
  definition: WebModelDefinition,
  baseUrl: string,
): Promise<{ readonly result: WebModelAuditResult; readonly pixels: Uint8Array }> {
  const errors: string[] = [];
  const library = new CharacterModelLibrary(baseUrl);
  const startedAt = performance.now();
  let pixels = new Uint8Array(RENDER_SIZE * RENDER_SIZE * 4);
  let meshCount = 0;
  let skinnedMeshCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let materialCount = 0;
  let textureCount = 0;
  let readyTextureCount = 0;
  let animationClipCount = 0;
  let animationTrackCount = 0;
  let animationBounds: readonly AnimationBoundsRecord[] = [];
  let bounds = new THREE.Box3();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  const ambient = new THREE.HemisphereLight(0xf7faf7, 0x304047, 2.15);
  const key = new THREE.DirectionalLight(0xffffff, 3.1);
  key.position.set(4, 7, 5);
  const fill = new THREE.DirectionalLight(0x8fc3d8, 1.2);
  fill.position.set(-5, 3, 1);
  scene.add(ambient, key, fill);
  let visual: THREE.Group | null = null;

  try {
    const template = await library.load(definition);
    visual = template.root;
    visual.userData.modelAuditVisual = true;
    scene.add(visual);
    const materials = modelMaterials(visual);
    materialCount = materials.materials.length;
    textureCount = materials.textures.length;
    readyTextureCount = await waitForTextures(materials.textures);
    visual.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.visible) {
        return;
      }
      meshCount += 1;
      if (child instanceof THREE.SkinnedMesh) {
        skinnedMeshCount += 1;
      }
      const positions = child.geometry.getAttribute('position');
      if (positions) {
        vertexCount += positions.count;
      }
      const indexCount = child.geometry.index?.count ?? positions?.count ?? 0;
      triangleCount += Math.floor(indexCount / 3);
    });
    if (meshCount === 0 || vertexCount === 0 || triangleCount === 0) {
      errors.push('model has no renderable geometry');
    }
    if (materialCount === 0) {
      errors.push('model has no materials');
    }
    if (textureCount === 0) {
      errors.push('model has no referenced textures');
    } else if (readyTextureCount !== textureCount) {
      errors.push(`only ${readyTextureCount}/${textureCount} textures loaded`);
    }
    animationClipCount = template.clips.size;
    const animationAudit = validateAnimations(
      visual,
      template.clips,
      definition.height,
      definition.animationStates ?? ANIMATION_STATES,
      errors,
    );
    animationTrackCount = animationAudit.trackCount;
    animationBounds = animationAudit.bounds;
    bounds = characterModelRenderableBounds(visual);
    const size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || !finiteVector(bounds.min) || !finiteVector(bounds.max)) {
      errors.push('model has invalid render bounds');
    }
    if (Math.abs(size.y - definition.height) > HEIGHT_TOLERANCE) {
      errors.push(`height ${size.y.toFixed(3)} differs from ${definition.height.toFixed(3)}`);
    }
    if (Math.abs(bounds.min.y) > GROUND_TOLERANCE) {
      errors.push(`ground offset is ${bounds.min.y.toFixed(3)}`);
    }
    frameCamera(camera, bounds);
    const rendered = renderPixels(scene, camera);
    pixels = rendered.pixels;
    if (rendered.changedPixels < MINIMUM_CHANGED_PIXELS) {
      errors.push(`only ${rendered.changedPixels} model pixels rendered`);
    }
    if (rendered.colorBucketCount < MINIMUM_COLOR_BUCKETS) {
      errors.push(`only ${rendered.colorBucketCount} visible color buckets`);
    }
    const result: WebModelAuditResult = {
      id: definition.id,
      sourceName: definition.sourceName,
      kind: definition.kind,
      status: errors.length === 0 ? 'passed' : 'failed',
      loadMilliseconds: performance.now() - startedAt,
      meshCount,
      skinnedMeshCount,
      vertexCount,
      triangleCount,
      materialCount,
      textureCount,
      readyTextureCount,
      animationClipCount,
      animationTrackCount,
      animationBounds,
      targetHeight: definition.height,
      boundsMinimum: vectorRecord(bounds.min),
      boundsMaximum: vectorRecord(bounds.max),
      boundsSize: vectorRecord(size),
      changedPixels: rendered.changedPixels,
      pixelCoverage: rendered.pixelCoverage,
      colorBucketCount: rendered.colorBucketCount,
      errors,
    };
    return { result, pixels };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return {
      pixels,
      result: {
        id: definition.id,
        sourceName: definition.sourceName,
        kind: definition.kind,
        status: 'failed',
        loadMilliseconds: performance.now() - startedAt,
        meshCount,
        skinnedMeshCount,
        vertexCount,
        triangleCount,
        materialCount,
        textureCount,
        readyTextureCount,
        animationClipCount,
        animationTrackCount,
        animationBounds,
        targetHeight: definition.height,
        boundsMinimum: vectorRecord(bounds.min),
        boundsMaximum: vectorRecord(bounds.max),
        boundsSize: vectorRecord(bounds.getSize(new THREE.Vector3())),
        changedPixels: 0,
        pixelCoverage: 0,
        colorBucketCount: 0,
        errors,
      },
    };
  } finally {
    if (visual) {
      scene.remove(visual);
    }
    library.dispose();
    renderer.renderLists.dispose();
  }
}

async function runAudit(): Promise<WebModelAuditReport> {
  const baseUrl = modelBaseUrl();
  const results: WebModelAuditResult[] = [];
  for (const [index, definition] of ALL_MODELS.entries()) {
    statusOutput.textContent = `Loading ${index + 1}/${ALL_MODELS.length}: ${definition.id}`;
    const audited = await auditModel(definition, baseUrl);
    results.push(audited.result);
    appendResultCard(definition, audited.result, audited.pixels);
    if (window.__JWGB_MODEL_AUDIT__) {
      Object.assign(window.__JWGB_MODEL_AUDIT__, { completed: index + 1 });
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  const failed = results.filter((result) => result.status === 'failed').length;
  const gl = renderer.getContext();
  const report: WebModelAuditReport = {
    schema: 'jwgb.web-model-render-audit.v1',
    generatedAt: new Date().toISOString(),
    modelBaseUrl: baseUrl,
    renderer:
      gl.getParameter(
        gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER,
      ) ?? 'unknown',
    total: results.length,
    passed: results.length - failed,
    failed,
    results,
  };
  statusOutput.textContent =
    failed === 0
      ? `${report.passed}/${report.total} models passed`
      : `${report.failed}/${report.total} models failed`;
  return report;
}

window.__JWGB_MODEL_AUDIT__ = {
  status: 'running',
  completed: 0,
  total: ALL_MODELS.length,
  report: null,
  error: null,
};

void runAudit()
  .then((report) => {
    if (window.__JWGB_MODEL_AUDIT__) {
      Object.assign(window.__JWGB_MODEL_AUDIT__, {
        status: 'complete',
        report,
      });
    }
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    statusOutput.textContent = `Audit failed: ${message}`;
    if (window.__JWGB_MODEL_AUDIT__) {
      Object.assign(window.__JWGB_MODEL_AUDIT__, {
        status: 'failed',
        error: message,
      });
    }
  });
