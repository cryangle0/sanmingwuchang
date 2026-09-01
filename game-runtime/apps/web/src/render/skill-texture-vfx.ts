import * as THREE from 'three';
import { webAssetUrl } from '../runtime/asset-url';

interface SkillTextureManifestEntry {
  readonly atlasPath: string;
  readonly columns: number;
  readonly rows: number;
  readonly frames: number;
  readonly fps: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly overlaySlot: number;
}

interface SkillTextureManifest {
  readonly schema: string;
  readonly staticOverlay: {
    readonly path: string;
    readonly columns: number;
    readonly rows: number;
    readonly slots: number;
  };
  readonly effects: Readonly<Record<string, SkillTextureManifestEntry>>;
}

interface LoadedSkillTexture {
  readonly entry: SkillTextureManifestEntry;
  readonly texture: THREE.Texture;
  readonly overlayTexture: THREE.Texture;
  readonly overlayColumns: number;
  readonly overlayRows: number;
}

interface SkillTextureState {
  readonly stage: 'cast' | 'impact' | 'status';
  readonly loaded: LoadedSkillTexture;
  readonly layer: THREE.Group;
  readonly mainMaterial: THREE.MeshBasicMaterial;
  readonly overlayMaterial: THREE.MeshBasicMaterial;
}

const manifestUrl = webAssetUrl('vfx/skills/manifest.json');
const manifestPromise: Promise<SkillTextureManifest | null> =
  typeof window === 'undefined'
    ? Promise.resolve(null)
    : fetch(manifestUrl)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`skill texture manifest returned ${response.status}`);
          }
          return (await response.json()) as SkillTextureManifest;
        })
        .catch(() => null);

const loadedTextures = new Map<string, Promise<LoadedSkillTexture | null>>();
const failedKeys = new Set<string>();

function configureTexture(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function textureFrame(
  texture: THREE.Texture,
  frame: number,
  columns: number,
  rows: number,
): void {
  const safeColumns = Math.max(1, columns);
  const safeRows = Math.max(1, rows);
  const safeFrame = Math.max(0, Math.floor(frame));
  const column = safeFrame % safeColumns;
  const row = Math.floor(safeFrame / safeColumns);
  texture.repeat.set(1 / safeColumns, 1 / safeRows);
  texture.offset.set(column / safeColumns, 1 - (row + 1) / safeRows);
}

function loadTexture(url: string): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  return loader.loadAsync(url).then(configureTexture);
}

function loadedTextureFor(key: string): Promise<LoadedSkillTexture | null> {
  const existing = loadedTextures.get(key);
  if (existing) {
    return existing;
  }

  const request = manifestPromise
    .then(async (manifest) => {
      if (!manifest) {
        return null;
      }
      const entry = manifest.effects[key];
      if (!entry) {
        return null;
      }
      const [texture, overlayTexture] = await Promise.all([
        loadTexture(webAssetUrl(entry.atlasPath)),
        loadTexture(webAssetUrl(manifest.staticOverlay.path)),
      ]);
      return {
        entry,
        texture,
        overlayTexture,
        overlayColumns: manifest.staticOverlay.columns,
        overlayRows: manifest.staticOverlay.rows,
      };
    })
    .catch(() => {
      failedKeys.add(key);
      return null;
    });
  loadedTextures.set(key, request);
  return request;
}

function textureMaterial(
  texture: THREE.Texture,
  opacity: number,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    alphaTest: 0.02,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  material.userData.baseOpacity = opacity;
  return material;
}

function addTexturePlanes(
  layer: THREE.Group,
  stage: SkillTextureState['stage'],
  mainMaterial: THREE.MeshBasicMaterial,
  overlayMaterial: THREE.MeshBasicMaterial,
  reduced: boolean,
): void {
  const mainSize = stage === 'impact' ? 3.5 : stage === 'cast' ? 3.2 : 2.8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(mainSize, mainSize), mainMaterial);
  ground.name = 'skill-texture-ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.12;
  ground.renderOrder = 13;
  ground.frustumCulled = false;
  layer.add(ground);

  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(mainSize * 0.94, mainSize * 0.94),
    overlayMaterial,
  );
  overlay.name = 'skill-texture-overlay';
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.y = 0.145;
  overlay.renderOrder = 14;
  overlay.frustumCulled = false;
  layer.add(overlay);

  const billboardOpacity = stage === 'status' ? 0.24 : reduced ? 0.42 : 0.62;
  mainMaterial.userData.billboardOpacity = billboardOpacity;
  overlayMaterial.userData.billboardOpacity = billboardOpacity * 0.55;

  const billboard = new THREE.Mesh(
    new THREE.PlaneGeometry(mainSize, mainSize),
    mainMaterial,
  );
  billboard.name = 'skill-texture-billboard';
  billboard.position.y = stage === 'status' ? 0.85 : 1.12;
  billboard.renderOrder = 12;
  billboard.frustumCulled = false;
  layer.add(billboard);

  if (!reduced) {
    const crossBillboard = new THREE.Mesh(
      new THREE.PlaneGeometry(mainSize * 0.96, mainSize * 0.96),
      overlayMaterial,
    );
    crossBillboard.name = 'skill-texture-cross-overlay';
    crossBillboard.position.y = stage === 'status' ? 0.82 : 1.08;
    crossBillboard.rotation.y = Math.PI / 2;
    crossBillboard.renderOrder = 11;
    crossBillboard.frustumCulled = false;
    layer.add(crossBillboard);
  }
}

function materialBaseOpacity(material: THREE.MeshBasicMaterial): number {
  return typeof material.userData.baseOpacity === 'number'
    ? material.userData.baseOpacity
    : 1;
}

export function attachSkillTextureLayer(
  group: THREE.Group,
  textureKey: string,
  stage: 'cast' | 'impact' | 'status',
  reduced: boolean,
): void {
  if (typeof window === 'undefined' || failedKeys.has(textureKey)) {
    return;
  }

  group.userData.skillTextureKey = textureKey;
  group.userData.skillTextureStage = stage;
  void loadedTextureFor(textureKey).then((loaded) => {
    if (
      !loaded ||
      group.userData.disposeRequested === true ||
      group.userData.skillTextureKey !== textureKey ||
      group.userData.skillTextureStage !== stage
    ) {
      return;
    }

    const layer = new THREE.Group();
    layer.name = `skill-texture-${textureKey.toLowerCase()}-${stage}`;
    layer.renderOrder = 11;
    layer.frustumCulled = false;
    const mainMaterial = textureMaterial(loaded.texture.clone(), stage === 'status' ? 0.42 : 0.78);
    const overlayMaterial = textureMaterial(
      loaded.overlayTexture.clone(),
      stage === 'status' ? 0.18 : 0.38,
    );
    textureFrame(
      mainMaterial.map as THREE.Texture,
      0,
      loaded.entry.columns,
      loaded.entry.rows,
    );
    textureFrame(
      overlayMaterial.map as THREE.Texture,
      loaded.entry.overlaySlot,
      loaded.overlayColumns,
      loaded.overlayRows,
    );
    addTexturePlanes(layer, stage, mainMaterial, overlayMaterial, reduced);
    group.add(layer);

    const state: SkillTextureState = {
      stage,
      loaded,
      layer,
      mainMaterial,
      overlayMaterial,
    };
    group.userData.skillTextureState = state;
    const materials = (group.userData.heroSkillMaterials as readonly THREE.MeshBasicMaterial[]) ?? [];
    group.userData.heroSkillMaterials = [...materials, mainMaterial, overlayMaterial];
  });
}

export function updateSkillTextureLayer(
  group: THREE.Group,
  progress: number,
  elapsedSeconds: number,
): void {
  const state = group.userData.skillTextureState as SkillTextureState | undefined;
  if (!state) {
    return;
  }

  const { entry } = state.loaded;
  const frame =
    state.stage === 'status'
      ? Math.floor(elapsedSeconds * entry.fps) % Math.max(1, entry.frames)
      : Math.min(
          Math.max(0, entry.frames - 1),
          Math.floor(Math.max(0, Math.min(1, progress)) * entry.frames),
        );
  textureFrame(
    state.mainMaterial.map as THREE.Texture,
    frame,
    entry.columns,
    entry.rows,
  );
  state.layer.rotation.y =
    elapsedSeconds * (state.stage === 'impact' ? -0.9 : state.stage === 'cast' ? 0.55 : 0.3);
  state.layer.rotation.z =
    state.stage === 'impact' ? Math.sin(elapsedSeconds * 2.4) * 0.06 : 0;

  const envelopeOpacity =
    state.stage === 'impact'
      ? Math.max(0, 1 - Math.max(0, progress - 0.42) / 0.58)
      : state.stage === 'cast'
        ? 0.9 + Math.sin(elapsedSeconds * 9) * 0.1
        : 0.82 + Math.sin(elapsedSeconds * 4.5) * 0.12;
  state.mainMaterial.opacity = materialBaseOpacity(state.mainMaterial) * envelopeOpacity;
  state.overlayMaterial.opacity =
    materialBaseOpacity(state.overlayMaterial) * (0.78 + Math.sin(elapsedSeconds * 7) * 0.22);
}
