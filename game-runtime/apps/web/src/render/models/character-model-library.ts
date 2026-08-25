import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { appendAssetVersion, webAssetUrl } from '../../runtime/asset-url';
import type { WebModelDefinition } from './web-model-catalog';

export type CharacterAnimationState = 'Idle' | 'Move' | 'Attack' | 'Spell';

export interface CharacterModelDiagnostics {
  readonly templateRequests: number;
  readonly templatesLoaded: number;
  readonly templatesFailed: number;
  readonly pendingTemplateLoads: number;
  readonly instances: number;
  readonly loadRequestedInstances: number;
  readonly loadedInstances: number;
  readonly fallbackInstances: number;
  readonly renderableFallbackInstances: number;
}

export interface LoadedCharacterModelTemplate {
  readonly root: THREE.Group;
  readonly clips: ReadonlyMap<CharacterAnimationState, THREE.AnimationClip>;
}

interface MaterialState {
  readonly material: THREE.Material;
  readonly transparent: boolean;
  readonly opacity: number;
  readonly depthWrite: boolean;
  readonly emissive: THREE.Color | null;
  readonly emissiveIntensity: number | null;
}

const CLIP_RANGES = {
  Idle: { firstFrame: 1, lastFrame: 48, loop: true },
  Move: { firstFrame: 49, lastFrame: 96, loop: true },
  Attack: { firstFrame: 97, lastFrame: 120, loop: false },
  Spell: { firstFrame: 121, lastFrame: 144, loop: false },
} as const;
const CLIP_FPS = 24;
const MODEL_LOAD_CONCURRENCY = 2;
const MODEL_TEXTURE_TIMEOUT_MILLISECONDS = 30_000;

function modelUrl(baseUrl: string, assetPath: string): string {
  const pageUrl = typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
  const absoluteBase = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, pageUrl);
  return new URL(assetPath, absoluteBase).toString();
}

function modelTextureBaseUrl(baseUrl: string, assetPath: string): string {
  return new URL('Textures/', modelUrl(baseUrl, assetPath)).toString();
}

export function characterModelAssetUrl(
  definition: WebModelDefinition,
  modelBaseUrl: string,
): string {
  return definition.assetBase === 'web'
    ? webAssetUrl(definition.assetPath)
    : appendAssetVersion(modelUrl(modelBaseUrl, definition.assetPath));
}

function finiteBox(box: THREE.Box3): boolean {
  return [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite);
}

function objectTextures(root: THREE.Object3D): readonly THREE.Texture[] {
  const textures = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) {
          textures.add(value);
        }
      }
    }
  });
  return [...textures];
}

function textureImageReady(texture: THREE.Texture): boolean {
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

async function waitForObjectTextures(root: THREE.Object3D): Promise<void> {
  const textures = objectTextures(root);
  if (textures.length === 0 || textures.every(textureImageReady)) {
    return;
  }

  const deadline = performance.now() + MODEL_TEXTURE_TIMEOUT_MILLISECONDS;
  while (performance.now() < deadline) {
    if (textures.every(textureImageReady)) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  const ready = textures.filter(textureImageReady).length;
  throw new Error(`only ${ready}/${textures.length} model textures became ready`);
}

function renderableBounds(
  root: THREE.Group,
  include: (child: THREE.Mesh) => boolean,
): THREE.Box3 {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().makeEmpty();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.visible || !include(child)) {
      return;
    }
    if (!child.matrixWorld.elements.every(Number.isFinite)) {
      child.visible = false;
      return;
    }
    let localBounds: THREE.Box3 | null = null;
    if (child instanceof THREE.SkinnedMesh) {
      child.skeleton.update();
      child.computeBoundingBox();
      localBounds = child.boundingBox;
    } else {
      const position = child.geometry.getAttribute('position');
      if (!position) {
        child.visible = false;
        return;
      }
      if (!child.geometry.boundingBox) {
        child.geometry.computeBoundingBox();
      }
      localBounds = child.geometry.boundingBox;
    }
    if (!localBounds || !finiteBox(localBounds)) {
      child.visible = false;
      return;
    }
    bounds.union(localBounds.clone().applyMatrix4(child.matrixWorld));
  });
  return bounds;
}

function renderableMeshBounds(root: THREE.Group): THREE.Box3 {
  return renderableBounds(root, () => true);
}

function skinnedMeshBounds(root: THREE.Group): THREE.Box3 | null {
  const bounds = renderableBounds(root, (child) => child instanceof THREE.SkinnedMesh);
  return bounds.isEmpty() ? null : bounds;
}

export function characterModelRenderableBounds(root: THREE.Group): THREE.Box3 {
  return renderableMeshBounds(root);
}

export function createCharacterPresentationRoot(
  sourceRoot: THREE.Group,
  targetHeight: number,
): THREE.Group {
  const presentationRoot = new THREE.Group();
  presentationRoot.name = `character-presentation-${sourceRoot.name || 'root'}`;
  presentationRoot.userData.characterModelPresentation = true;
  presentationRoot.add(sourceRoot);

  const bounds = renderableMeshBounds(presentationRoot);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0.001 || bounds.isEmpty()) {
    throw new Error(`model has invalid bounds (${size.x}, ${size.y}, ${size.z})`);
  }
  presentationRoot.scale.multiplyScalar(targetHeight / size.y);

  const scaledBounds = renderableMeshBounds(presentationRoot);
  const center = (skinnedMeshBounds(presentationRoot) ?? scaledBounds).getCenter(
    new THREE.Vector3(),
  );
  presentationRoot.position.add(new THREE.Vector3(-center.x, -scaledBounds.min.y, -center.z));
  presentationRoot.updateMatrixWorld(true);
  return presentationRoot;
}

function animationClips(
  root: THREE.Group,
): ReadonlyMap<CharacterAnimationState, THREE.AnimationClip> {
  const clips = new Map<CharacterAnimationState, THREE.AnimationClip>();
  for (const state of Object.keys(CLIP_RANGES) as CharacterAnimationState[]) {
    const named = root.animations.find((clip) => clip.name === state);
    if (named) {
      clips.set(state, named);
    }
  }
  if (clips.size === 4) {
    return clips;
  }

  const source = root.animations.reduce<THREE.AnimationClip | null>(
    (longest, clip) => (!longest || clip.duration > longest.duration ? clip : longest),
    null,
  );
  if (!source) {
    return clips;
  }
  for (const state of Object.keys(CLIP_RANGES) as CharacterAnimationState[]) {
    const range = CLIP_RANGES[state];
    clips.set(
      state,
      THREE.AnimationUtils.subclip(source, state, range.firstFrame, range.lastFrame + 1, CLIP_FPS),
    );
  }
  return clips;
}

function disposeObjectMaterials(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of childMaterials) {
      materials.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) {
          textures.add(value);
        }
      }
    }
  });
  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
  }
}

function cloneTemplate(
  root: THREE.Group,
  castShadow: boolean,
  receiveShadow: boolean,
): {
  readonly root: THREE.Group;
  readonly materials: readonly MaterialState[];
} {
  const clone = cloneSkeleton(root) as THREE.Group;
  const materialStates: MaterialState[] = [];
  clone.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    child.castShadow = castShadow;
    child.receiveShadow = receiveShadow;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const clonedMaterials = sourceMaterials.map((material) => {
      const cloned = material.clone();
      const emissive =
        'emissive' in cloned && cloned.emissive instanceof THREE.Color
          ? cloned.emissive.clone()
          : null;
      const emissiveIntensity =
        'emissiveIntensity' in cloned && typeof cloned.emissiveIntensity === 'number'
          ? cloned.emissiveIntensity
          : null;
      materialStates.push({
        material: cloned,
        transparent: cloned.transparent,
        opacity: cloned.opacity,
        depthWrite: cloned.depthWrite,
        emissive,
        emissiveIntensity,
      });
      return cloned;
    });
    child.material = Array.isArray(child.material)
      ? clonedMaterials
      : (clonedMaterials[0] as THREE.Material);
  });
  return { root: clone, materials: materialStates };
}

export class CharacterModelInstance {
  readonly root = new THREE.Group();
  private readonly placeholder: THREE.Group;
  private readonly library: CharacterModelLibrary;
  private readonly definition: WebModelDefinition;
  private loadedRoot: THREE.Group | null = null;
  private materials: readonly MaterialState[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<CharacterAnimationState, THREE.AnimationAction>();
  private currentAction: THREE.AnimationAction | null = null;
  private currentState: CharacterAnimationState | null = null;
  private desiredLocomotion: CharacterAnimationState = 'Idle';
  private pendingTrigger: 'Attack' | 'Spell' | null = null;
  private overrideUntilSeconds = 0;
  private previousElapsedSeconds: number | null = null;
  private animationAccumulatorSeconds = 0;
  private effectOpacity = 1;
  private effectEmissiveHex = 0;
  private appliedEffectOpacity = Number.NaN;
  private appliedEffectEmissiveHex = -1;
  private readonly effectEmissive = new THREE.Color();
  private castShadow = true;
  private receiveShadow = true;
  private loadStarted = false;
  private disposed = false;

  constructor(
    library: CharacterModelLibrary,
    definition: WebModelDefinition,
    placeholder: THREE.Group,
  ) {
    this.library = library;
    this.definition = definition;
    this.placeholder = placeholder;
    this.root.name = `model-instance-${definition.id}`;
    this.root.add(placeholder);
  }

  get isLoaded(): boolean {
    return this.loadedRoot !== null;
  }

  get isFallback(): boolean {
    return this.loadedRoot === null;
  }

  get isLoadRequested(): boolean {
    return this.loadStarted;
  }

  get animationState(): CharacterAnimationState | null {
    return this.currentState;
  }

  get loadedMeshNames(): readonly string[] {
    if (!this.loadedRoot) {
      return [];
    }
    const names: string[] = [];
    this.loadedRoot.traverse((child) => {
      if (child instanceof THREE.Mesh && child.visible) {
        names.push(child.name || 'unnamed-mesh');
      }
    });
    return names.sort();
  }

  get fallbackRenderableMeshCount(): number {
    if (this.loadedRoot) {
      return 0;
    }
    let count = 0;
    this.placeholder.traverse((child) => {
      if (child instanceof THREE.Mesh && child.visible) {
        count += 1;
      }
    });
    return count;
  }

  ensureLoaded(priority = false): void {
    if (this.loadStarted || this.disposed) {
      return;
    }
    this.loadStarted = true;
    void this.library
      .load(this.definition, priority)
      .then((template) => {
        if (this.disposed) {
          return;
        }
        const instance = cloneTemplate(template.root, this.castShadow, this.receiveShadow);
        this.loadedRoot = instance.root;
        this.materials = instance.materials;
        this.appliedEffectOpacity = Number.NaN;
        this.appliedEffectEmissiveHex = -1;
        this.root.remove(this.placeholder);
        disposeObjectMaterials(this.placeholder);
        this.root.add(instance.root);
        this.mixer = new THREE.AnimationMixer(instance.root);
        this.animationAccumulatorSeconds = 0;
        this.actions = new Map(
          [...template.clips.entries()].map(([state, clip]) => {
            const action = this.mixer?.clipAction(clip);
            if (!action) {
              throw new Error(`animation mixer did not create ${state}`);
            }
            if (state === 'Idle' || state === 'Move') {
              action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
            } else {
              action.setLoop(THREE.LoopOnce, 1);
              action.clampWhenFinished = true;
            }
            return [state, action] as const;
          }),
        );
        this.applyEffects();
        this.play(this.desiredLocomotion, true);
      })
      .catch((error: unknown) => {
        console.warn(`JWGB model ${this.definition.id} failed to load`, error);
      });
  }

  update(
    elapsedSeconds: number,
    locomotion: 'Idle' | 'Move',
    trigger: 'Attack' | 'Spell' | null,
    animationIntervalSeconds = 0,
  ): void {
    this.desiredLocomotion = locomotion;
    const previous = this.previousElapsedSeconds ?? elapsedSeconds;
    const delta = Math.max(0, Math.min(0.25, elapsedSeconds - previous));
    this.previousElapsedSeconds = elapsedSeconds;
    this.animationAccumulatorSeconds += delta;

    if (trigger) {
      if (trigger === 'Spell' || this.pendingTrigger === null) {
        this.pendingTrigger = trigger;
      }
    }
    if (this.pendingTrigger && this.mixer) {
      const pendingTrigger = this.pendingTrigger;
      this.pendingTrigger = null;
      const action = this.actions.get(pendingTrigger);
      if (action) {
        this.play(pendingTrigger, true);
        this.overrideUntilSeconds = elapsedSeconds + Math.max(0.1, action.getClip().duration);
      }
    } else if (elapsedSeconds >= this.overrideUntilSeconds && this.currentState !== locomotion) {
      this.play(locomotion, false);
    }
    if (
      this.mixer &&
      (trigger !== null ||
        animationIntervalSeconds <= 0 ||
        this.animationAccumulatorSeconds >= animationIntervalSeconds)
    ) {
      this.mixer.update(this.animationAccumulatorSeconds);
      this.animationAccumulatorSeconds = 0;
    }
  }

  setShadows(castShadow: boolean, receiveShadow: boolean): void {
    if (this.castShadow === castShadow && this.receiveShadow === receiveShadow) {
      return;
    }
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.loadedRoot?.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = castShadow;
        child.receiveShadow = receiveShadow;
      }
    });
  }

  setEffects(opacity: number, emissiveHex: number): void {
    this.effectOpacity = opacity;
    this.effectEmissiveHex = emissiveHex;
    this.applyEffects();
  }

  private applyEffects(): void {
    if (
      this.appliedEffectOpacity === this.effectOpacity &&
      this.appliedEffectEmissiveHex === this.effectEmissiveHex
    ) {
      return;
    }
    this.effectEmissive.setHex(this.effectEmissiveHex);
    for (const state of this.materials) {
      const effectiveOpacity = state.opacity * this.effectOpacity;
      state.material.opacity = effectiveOpacity;
      state.material.transparent = state.transparent || effectiveOpacity < 0.999;
      state.material.depthWrite = effectiveOpacity < 0.999 ? false : state.depthWrite;
      if ('emissive' in state.material && state.material.emissive instanceof THREE.Color) {
        state.material.emissive.copy(state.emissive ?? this.effectEmissive.setHex(0));
        if (this.effectEmissiveHex !== 0) {
          this.effectEmissive.setHex(this.effectEmissiveHex);
          state.material.emissive.add(this.effectEmissive);
        }
      }
      if (
        state.emissiveIntensity !== null &&
        'emissiveIntensity' in state.material &&
        typeof state.material.emissiveIntensity === 'number'
      ) {
        state.material.emissiveIntensity =
          state.emissiveIntensity + (this.effectEmissiveHex === 0 ? 0 : 0.65);
      }
    }
    this.appliedEffectOpacity = this.effectOpacity;
    this.appliedEffectEmissiveHex = this.effectEmissiveHex;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.pendingTrigger = null;
    this.mixer?.stopAllAction();
    if (this.loadedRoot) {
      this.root.remove(this.loadedRoot);
      for (const state of this.materials) {
        state.material.dispose();
      }
    } else {
      this.root.remove(this.placeholder);
      disposeObjectMaterials(this.placeholder);
    }
    this.library.release(this);
  }

  private play(state: CharacterAnimationState, force: boolean): void {
    const action = this.actions.get(state);
    if (!action || (!force && this.currentState === state)) {
      return;
    }
    if (force && this.currentAction === action) {
      action.stopFading();
      action.reset().setEffectiveWeight(1).play();
      this.currentState = state;
      return;
    }
    this.currentAction?.fadeOut(0.12);
    action.reset().fadeIn(0.12).play();
    this.currentAction = action;
    this.currentState = state;
  }
}

export class CharacterModelLibrary {
  private readonly manager: THREE.LoadingManager;
  private readonly templates = new Map<string, Promise<LoadedCharacterModelTemplate>>();
  private readonly loadedIds = new Set<string>();
  private readonly failedIds = new Set<string>();
  private readonly instances = new Set<CharacterModelInstance>();
  private readonly loadQueue: Array<{
    readonly modelId: string;
    readonly load: () => Promise<void>;
  }> = [];
  private activeLoads = 0;

  constructor(private readonly baseUrl: string) {
    this.manager = new THREE.LoadingManager();
    this.manager.setURLModifier(appendAssetVersion);
  }

  createInstance(definition: WebModelDefinition, placeholder: THREE.Group): CharacterModelInstance {
    const instance = new CharacterModelInstance(this, definition, placeholder);
    this.instances.add(instance);
    return instance;
  }

  preload(definition: WebModelDefinition, priority = false): void {
    void this.load(definition, priority).catch((error: unknown) => {
      console.warn(`JWGB model ${definition.id} failed to preload`, error);
    });
  }

  load(definition: WebModelDefinition, priority = false): Promise<LoadedCharacterModelTemplate> {
    const existing = this.templates.get(definition.id);
    if (existing) {
      if (priority) {
        this.promoteQueuedLoad(definition.id);
      }
      return existing;
    }
    const promise = new Promise<LoadedCharacterModelTemplate>((resolve, reject) => {
      const queuedLoad = {
        modelId: definition.id,
        load: () =>
          new Promise<void>((complete) => {
            const onSourceRoot = (sourceRoot: THREE.Group): void => {
              void (async () => {
                try {
                  await waitForObjectTextures(sourceRoot);
                  const clips = animationClips(sourceRoot);
                  const root = createCharacterPresentationRoot(sourceRoot, definition.height);
                  root.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                      child.castShadow = true;
                      child.receiveShadow = true;
                    }
                  });
                  this.loadedIds.add(definition.id);
                  resolve({ root, clips });
                } catch (error) {
                  this.failedIds.add(definition.id);
                  reject(error);
                } finally {
                  complete();
                }
              })();
            };
            const onError = (error: unknown): void => {
              this.failedIds.add(definition.id);
              reject(error);
              complete();
            };
            const url = characterModelAssetUrl(definition, this.baseUrl);
            if (definition.format === 'glb') {
              const loader = new GLTFLoader(this.manager);
              loader.setCrossOrigin('anonymous');
              loader.setMeshoptDecoder(MeshoptDecoder);
              loader.load(
                url,
                (gltf) => {
                  gltf.scene.animations = gltf.animations;
                  onSourceRoot(gltf.scene);
                },
                undefined,
                onError,
              );
              return;
            }

            const loader = new FBXLoader(this.manager);
            loader.setCrossOrigin('anonymous');
            loader.setResourcePath(modelTextureBaseUrl(this.baseUrl, definition.assetPath));
            loader.load(url, onSourceRoot, undefined, onError);
          }),
      };
      if (priority) {
        this.loadQueue.unshift(queuedLoad);
      } else {
        this.loadQueue.push(queuedLoad);
      }
      this.pumpLoadQueue();
    });
    this.templates.set(definition.id, promise);
    return promise;
  }

  release(instance: CharacterModelInstance): void {
    this.instances.delete(instance);
  }

  diagnostics(): CharacterModelDiagnostics {
    const loadedInstances = [...this.instances].filter((instance) => instance.isLoaded).length;
    const loadRequestedInstances = [...this.instances].filter(
      (instance) => instance.isLoadRequested,
    ).length;
    const renderableFallbackInstances = [...this.instances].filter(
      (instance) => instance.fallbackRenderableMeshCount > 0,
    ).length;
    return {
      templateRequests: this.templates.size,
      templatesLoaded: this.loadedIds.size,
      templatesFailed: this.failedIds.size,
      pendingTemplateLoads: Math.max(
        0,
        this.templates.size - this.loadedIds.size - this.failedIds.size,
      ),
      instances: this.instances.size,
      loadRequestedInstances,
      loadedInstances,
      fallbackInstances: this.instances.size - loadedInstances,
      renderableFallbackInstances,
    };
  }

  dispose(): void {
    for (const instance of [...this.instances]) {
      instance.dispose();
    }
    for (const template of this.templates.values()) {
      void template.then(({ root }) => disposeObjectMaterials(root)).catch(() => {});
    }
    this.templates.clear();
    this.loadedIds.clear();
    this.failedIds.clear();
    this.loadQueue.length = 0;
  }

  private pumpLoadQueue(): void {
    while (this.activeLoads < MODEL_LOAD_CONCURRENCY) {
      const queuedLoad = this.loadQueue.shift();
      if (!queuedLoad) {
        return;
      }
      this.activeLoads += 1;
      void queuedLoad.load().finally(() => {
        this.activeLoads -= 1;
        this.pumpLoadQueue();
      });
    }
  }

  private promoteQueuedLoad(modelId: string): void {
    const index = this.loadQueue.findIndex((queued) => queued.modelId === modelId);
    if (index <= 0) {
      return;
    }
    const [queued] = this.loadQueue.splice(index, 1);
    if (queued) {
      this.loadQueue.unshift(queued);
    }
  }
}
