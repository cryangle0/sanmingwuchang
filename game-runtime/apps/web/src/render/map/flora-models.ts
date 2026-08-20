import type { MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { appendAssetVersion, webAssetDirectoryUrl, webAssetUrl } from '../../runtime/asset-url';
import { applyWindSway } from '../shading/wind';
import { WORLD_SCALE_PROFILE } from '../world-scale-profile';
import {
  type FloraTreeOccluderPart,
  type FloraTreeOccluderTarget,
  floraTreeOccluderTarget,
} from './flora-occlusion';
import { type RegionId, regionAt } from './map-regions';

const MODEL_DIR = 'models/foliage/';
const TREE_TARGET_HEIGHTS = WORLD_SCALE_PROFILE.flora.treeTargetHeights;
const ROCK_TARGET_HEIGHT = WORLD_SCALE_PROFILE.flora.rockTargetHeight;
const BUSH_TARGET_HEIGHT = WORLD_SCALE_PROFILE.flora.bushTargetHeight;
const FERN_TARGET_HEIGHT = WORLD_SCALE_PROFILE.flora.fernTargetHeight;
const MUSHROOM_TARGET_HEIGHT = WORLD_SCALE_PROFILE.flora.mushroomTargetHeight;
const ASIA_BUSH_TARGET_HEIGHT = WORLD_SCALE_PROFILE.flora.asiaBushTargetHeight;
const REED_TARGET_HEIGHT = WORLD_SCALE_PROFILE.flora.reedTargetHeight;
const SMALL_PLANT_1_TARGET_HEIGHT = WORLD_SCALE_PROFILE.flora.smallPlant1TargetHeight;
const SMALL_PLANT_2_TARGET_HEIGHT = WORLD_SCALE_PROFILE.flora.smallPlant2TargetHeight;
const BURDOCK_TARGET_HEIGHT = WORLD_SCALE_PROFILE.flora.burdockTargetHeight;
const MODEL_LOAD_CONCURRENCY = 3;
const LEAF_ALPHA_TEST = 0.38;
const BALANCED_MODEL_CHUNK_SIZE = 112;
const REDUCED_MODEL_CHUNK_SIZE = 224;
const MODEL_VISIBILITY_UPDATE_INTERVAL_FRAMES = 3;
const TREE_CULL_DISTANCE = 130;
const ROCK_CULL_DISTANCE = 115;
const DRESSING_CULL_DISTANCE = 95;
const REDUCED_TREE_CULL_DISTANCE = 104;
const REDUCED_ROCK_CULL_DISTANCE = 88;
const REDUCED_DRESSING_CULL_DISTANCE = 68;
const MODEL_BOUNDS_PADDING = 6;

type TreeModelKind =
  | 'pine'
  | 'oak'
  | 'twisted'
  | 'dead'
  | 'asia'
  | 'maple'
  | 'cypress'
  | 'beech'
  | 'willow';
export type DressingModelKind =
  | 'bush'
  | 'fern'
  | 'mushroom'
  | 'asiaBush'
  | 'reed'
  | 'smallPlant1'
  | 'smallPlant2'
  | 'burdock';
type ModelKind = TreeModelKind | 'rock' | DressingModelKind;
export type GraphicsTier = 'balanced' | 'reduced';

const MODEL_PATHS: Readonly<Record<ModelKind, readonly string[]>> = {
  pine: ['pine_4.glb', 'pine_5.glb', 'cypress-poly.glb'],
  oak: ['oak_3.glb', 'oak_5.glb', 'beech-poly.glb'],
  twisted: ['willow-poly.glb', 'twisted_1.glb'],
  dead: ['dead-cypress-poly.glb', 'dead-beech-poly.glb', 'dead_3.glb'],
  asia: ['asia-tree.glb'],
  maple: ['red-maple.glb'],
  cypress: ['cypress-poly.glb'],
  beech: ['beech-poly.glb'],
  willow: ['willow-poly.glb'],
  rock: ['rock_1.glb', 'rock_2.glb', 'rock_3.glb'],
  bush: ['bush.glb'],
  fern: ['fern.glb'],
  mushroom: ['mushroom.glb'],
  asiaBush: ['asia-bush.glb'],
  reed: ['reed-big.glb'],
  smallPlant1: ['small-plant-1.glb'],
  smallPlant2: ['small-plant-2.glb'],
  burdock: ['burdock-poly.glb'],
};

const REDUCED_MODEL_PATHS: Readonly<Record<ModelKind, readonly string[]>> = {
  pine: ['cypress-poly.glb'],
  oak: ['beech-poly.glb'],
  twisted: ['willow-poly.glb'],
  dead: ['dead-cypress-poly.glb', 'dead-beech-poly.glb'],
  asia: ['asia-tree.glb'],
  maple: ['red-maple.glb'],
  cypress: ['cypress-poly.glb'],
  beech: ['beech-poly.glb'],
  willow: ['willow-poly.glb'],
  rock: ['rock_1.glb'],
  bush: [],
  fern: [],
  mushroom: [],
  asiaBush: [],
  reed: [],
  smallPlant1: [],
  smallPlant2: [],
  burdock: ['burdock-poly.glb'],
};

export interface FloraModelTreePlacement {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly size: number;
  readonly yaw: number;
  readonly dead: boolean;
  readonly regionId: RegionId;
}

export interface FloraModelDressingPlacement {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly yaw: number;
  readonly kind: DressingModelKind;
  readonly regionId: RegionId;
}

export interface FloraModelLayerDiagnostics {
  readonly status: 'disabled' | 'loading' | 'ready' | 'failed' | 'disposed';
  readonly loadedAssets: readonly string[];
  readonly failedAssets: readonly string[];
  readonly treeInstances: number;
  readonly visibleTreeInstances: number;
  readonly rockInstances: number;
  readonly visibleRockInstances: number;
  readonly dressingInstances: number;
  readonly visibleDressingInstances: number;
  readonly instancedBatches: number;
  readonly visibleInstancedBatches: number;
  readonly triangles: number;
  readonly drawCalls: number;
  readonly visible: boolean;
}

export interface FloraModelLayer {
  readonly group: THREE.Group;
  readonly ready: Promise<readonly FloraTreeOccluderTarget[]>;
  setGraphicsTier(tier: GraphicsTier): void;
  update(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void;
  diagnostics(): FloraModelLayerDiagnostics;
  dispose(): void;
}

interface ModelPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly isLeaf: boolean;
  readonly triangles: number;
}

interface ModelTemplate {
  readonly path: string;
  readonly parts: readonly ModelPart[];
  readonly minY: number;
  readonly maxY: number;
  readonly height: number;
}

interface ModelBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly trianglesPerInstance: number;
  readonly chunk: ModelChunk;
}

type ModelChunkKind = 'tree' | 'rock' | 'dressing';

interface ModelChunk {
  readonly key: string;
  readonly kind: ModelChunkKind;
  readonly group: THREE.Group;
  readonly chunkX: number;
  readonly chunkZ: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  instanceCount: number;
}

interface BuildResult {
  readonly treeTargets: readonly FloraTreeOccluderTarget[];
  readonly treeInstances: number;
  readonly rockInstances: number;
  readonly dressingInstances: number;
}

const white = new THREE.Color(0xffffff);
const tint = new THREE.Color();
const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const scale = new THREE.Vector3();
const position = new THREE.Vector3();

function chunkSizeForTier(tier: GraphicsTier): number {
  return tier === 'reduced' ? REDUCED_MODEL_CHUNK_SIZE : BALANCED_MODEL_CHUNK_SIZE;
}

function chunkCoordinate(value: number, chunkSize: number): number {
  return Math.floor(value / chunkSize);
}

function chunkKey(chunkX: number, chunkZ: number): string {
  return `${chunkX}:${chunkZ}`;
}

function createModelChunk(
  parent: THREE.Group,
  kind: ModelChunkKind,
  chunkX: number,
  chunkZ: number,
): ModelChunk {
  const group = new THREE.Group();
  group.name = `flora-model-${kind}-chunk-${chunkX}-${chunkZ}`;
  group.visible = false;
  parent.add(group);
  return {
    key: chunkKey(chunkX, chunkZ),
    kind,
    group,
    chunkX,
    chunkZ,
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    instanceCount: 0,
  };
}

function includeChunkPoint(chunk: ModelChunk, x: number, z: number): void {
  chunk.minX = Math.min(chunk.minX, x);
  chunk.maxX = Math.max(chunk.maxX, x);
  chunk.minZ = Math.min(chunk.minZ, z);
  chunk.maxZ = Math.max(chunk.maxZ, z);
}

function partitionModelChunks<T>(
  parent: THREE.Group,
  kind: ModelChunkKind,
  items: readonly T[],
  coordinates: (item: T) => { readonly x: number; readonly z: number },
  chunkSize: number,
): Map<string, { readonly chunk: ModelChunk; readonly items: T[] }> {
  const chunks = new Map<string, { readonly chunk: ModelChunk; readonly items: T[] }>();
  for (const item of items) {
    const point = coordinates(item);
    const chunkX = chunkCoordinate(point.x, chunkSize);
    const chunkZ = chunkCoordinate(point.z, chunkSize);
    const key = chunkKey(chunkX, chunkZ);
    let entry = chunks.get(key);
    if (!entry) {
      entry = {
        chunk: createModelChunk(parent, kind, chunkX, chunkZ),
        items: [],
      };
      chunks.set(key, entry);
    }
    entry.items.push(item);
    includeChunkPoint(entry.chunk, point.x, point.z);
  }
  return chunks;
}

function activeModelChunks(
  chunks: Iterable<{ readonly chunk: ModelChunk }>,
): readonly ModelChunk[] {
  const active: ModelChunk[] = [];
  for (const { chunk } of chunks) {
    if (chunk.instanceCount > 0) {
      active.push(chunk);
    } else {
      chunk.group.removeFromParent();
    }
  }
  return active;
}

function squaredDistanceToChunk(reference: THREE.Vector3, chunk: ModelChunk): number {
  const minimumX = chunk.minX - MODEL_BOUNDS_PADDING;
  const maximumX = chunk.maxX + MODEL_BOUNDS_PADDING;
  const minimumZ = chunk.minZ - MODEL_BOUNDS_PADDING;
  const maximumZ = chunk.maxZ + MODEL_BOUNDS_PADDING;
  const dx =
    reference.x < minimumX
      ? minimumX - reference.x
      : reference.x > maximumX
        ? reference.x - maximumX
        : 0;
  const dz =
    reference.z < minimumZ
      ? minimumZ - reference.z
      : reference.z > maximumZ
        ? reference.z - maximumZ
        : 0;
  return dx * dx + dz * dz;
}

function hashAt(x: number, z: number, salt: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43_758.5453123;
  return value - Math.floor(value);
}

function normalizedModelUrl(fileName: string): string {
  return appendAssetVersion(webAssetUrl(`${MODEL_DIR}${fileName}`));
}

function copyAttribute(
  source: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  const values = new Float32Array(source.count * source.itemSize);
  for (let index = 0; index < source.count; index += 1) {
    for (let component = 0; component < source.itemSize; component += 1) {
      values[index * source.itemSize + component] = source.getComponent(index, component);
    }
  }
  return new THREE.BufferAttribute(values, source.itemSize, false);
}

function bakeGeometry(
  source: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const attributeName of ['position', 'normal', 'uv', 'uv1', 'color']) {
    const attribute = source.getAttribute(attributeName);
    if (attribute) {
      geometry.setAttribute(attributeName, copyAttribute(attribute));
    }
  }
  if (source.index) {
    geometry.setIndex(source.index.clone());
  }
  for (const group of source.groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  geometry.applyMatrix4(worldMatrix);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function isLowpolyFoliagePath(path: string): boolean {
  return /(?:^|\/)(?:asia-tree|asia-bush|reed-big|small-plant-\d+)\.glb$/i.test(path);
}

function isPolyNatureFoliagePath(path: string): boolean {
  return /(?:^|\/)(?:beech|burdock|cypress|dead-beech|dead-cypress|willow)-poly\.glb$/i.test(path);
}

function isLeafMaterial(material: THREE.Material, path: string): boolean {
  return (
    /leaves|flowers|foliage|fern|grass|reed|frond|plant/i.test(material.name) ||
    isLowpolyFoliagePath(path)
  );
}

function applyLeafLighting(
  material: THREE.MeshStandardMaterial,
  profile: 'tree' | 'bush' | 'fern' | 'maple' | 'lowpoly' | 'polyNature',
): void {
  if ((profile === 'tree' || profile === 'bush') && material.map) {
    material.emissiveMap = material.map;
  }
  if (profile === 'tree') {
    material.emissive.setRGB(0.24, 0.275, 0.205);
    material.emissiveIntensity = 1.05;
    material.color.multiplyScalar(1.12);
  } else if (profile === 'bush') {
    // Bush cards are much darker than the tree canopy texture. Keep the map
    // for shape variation, then add a small shader floor so shadows do not
    // collapse the entire shrub to a black silhouette.
    material.emissiveMap = material.map;
    material.emissiveIntensity = 0.65;
    material.emissive.setRGB(0.08, 0.1, 0.05);
    material.color.multiplyScalar(0.92);
  } else if (profile === 'maple') {
    material.emissiveMap = material.map;
    material.emissive.setRGB(0.12, 0.035, 0.018);
    material.emissiveIntensity = 0.42;
    material.color.multiplyScalar(1.04);
  } else if (profile === 'lowpoly') {
    material.emissiveMap = material.map;
    material.emissive.setRGB(0.035, 0.055, 0.022);
    material.emissiveIntensity = material.map ? 0.12 : 0.08;
    material.color.multiplyScalar(1.04);
  } else if (profile === 'polyNature') {
    material.emissiveMap = material.map;
    material.emissive.setRGB(0.045, 0.065, 0.025);
    material.emissiveIntensity = material.map ? 0.28 : 0.08;
    material.color.multiplyScalar(0.96);
  } else {
    material.emissiveMap = null;
    material.emissive.setRGB(0.012, 0.018, 0.009);
    material.emissiveIntensity = 0.22;
    material.color.multiplyScalar(0.68);
  }

  const previousCompile = material.onBeforeCompile;
  const previousProgramKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      [
        '#include <beginnormal_vertex>',
        'vec3 jwgbCanopyRadius = vec3(position.x, position.y * 0.75 + 0.55, position.z);',
        'vec3 jwgbCanopyDirection = normalize(jwgbCanopyRadius);',
        `objectNormal = normalize(mix(objectNormal, jwgbCanopyDirection, ${
          profile === 'tree'
            ? '0.72'
            : profile === 'bush'
              ? '0.62'
              : profile === 'lowpoly'
                ? '0.26'
                : profile === 'polyNature'
                  ? '0.46'
                  : '0.42'
        }));`,
      ].join('\n'),
    );
    if (profile === 'bush') {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'totalEmissiveRadiance += vec3(0.035, 0.05, 0.024);',
        ].join('\n'),
      );
    }
  };
  material.customProgramCacheKey = () => `jwgb-leaf-lighting-${profile}|${previousProgramKey}`;
}

function prepareMaterial(
  source: THREE.Material,
  leaf: boolean,
  path: string,
  hasVertexColors: boolean,
): THREE.Material {
  const material = source.clone() as THREE.MeshStandardMaterial;
  const lowpolyFoliage = isLowpolyFoliagePath(path);
  const polyNatureFoliage = isPolyNatureFoliagePath(path);
  material.vertexColors = Boolean(material.vertexColors && hasVertexColors);
  material.side = leaf || lowpolyFoliage ? THREE.DoubleSide : THREE.FrontSide;
  if (leaf) {
    material.alphaTest = Math.max(material.alphaTest, LEAF_ALPHA_TEST);
    material.transparent = false;
    material.depthWrite = true;
    applyWindSway(material, lowpolyFoliage ? 0.018 : 0.035);
    const profile = /(?:^|\/)red-maple\.glb$/i.test(path)
      ? 'maple'
      : polyNatureFoliage
        ? 'polyNature'
        : /(?:^|\/)(?:asia-)?bush\.glb$/i.test(path)
          ? 'bush'
          : /(?:^|\/)(?:fern|reed-big|small-plant-\d+)\.glb$/i.test(path)
            ? lowpolyFoliage
              ? 'lowpoly'
              : 'fern'
            : lowpolyFoliage
              ? 'lowpoly'
              : 'tree';
    applyLeafLighting(material, profile);
  } else {
    material.roughness = Math.max(material.roughness, 0.82);
    material.metalness = Math.min(material.metalness, 0.08);
    if (lowpolyFoliage) {
      material.emissive.setRGB(0.025, 0.04, 0.016);
      material.emissiveIntensity = material.map ? 0.08 : 0.05;
    }
  }
  material.needsUpdate = true;
  return material;
}

function extractParts(path: string, gltf: { readonly scene: THREE.Group }): ModelTemplate {
  gltf.scene.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const baked = bakeGeometry(object.geometry, object.matrixWorld);
    const groups =
      baked.groups.length > 0
        ? baked.groups
        : [
            {
              start: 0,
              count: baked.index?.count ?? baked.getAttribute('position')?.count ?? 0,
              materialIndex: 0,
            },
          ];
    for (const group of groups) {
      if (group.count <= 0) {
        continue;
      }
      const geometry = baked.clone();
      geometry.clearGroups();
      geometry.setDrawRange(group.start, group.count);
      const sourceMaterial = sourceMaterials[group.materialIndex ?? 0] ?? sourceMaterials[0];
      if (!sourceMaterial) {
        geometry.dispose();
        continue;
      }
      const leaf = isLeafMaterial(sourceMaterial, path);
      parts.push({
        geometry,
        material: prepareMaterial(
          sourceMaterial,
          leaf,
          path,
          Boolean(geometry.getAttribute('color')),
        ),
        isLeaf: leaf,
        triangles: Math.floor(group.count / 3),
      });
    }
    baked.dispose();
  });
  if (parts.length === 0) {
    throw new Error(`foliage model has no renderable meshes: ${path}`);
  }
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    const bounds = part.geometry.boundingBox;
    if (!bounds) {
      continue;
    }
    minY = Math.min(minY, bounds.min.y);
    maxY = Math.max(maxY, bounds.max.y);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY - minY <= 0.001) {
    throw new Error(`foliage model has invalid bounds: ${path}`);
  }
  return {
    path,
    parts,
    minY,
    maxY,
    height: maxY - minY,
  };
}

function softTint(hex: number, soften: number, x: number, z: number, salt: number): THREE.Color {
  tint.setHex(hex).lerp(white, soften);
  tint.offsetHSL(
    (hashAt(x, z, salt) - 0.5) * 0.035,
    (hashAt(x, z, salt + 1) - 0.5) * 0.08,
    (hashAt(x, z, salt + 2) - 0.5) * 0.07,
  );
  return tint.clone();
}

function treeKindFor(placement: FloraModelTreePlacement): TreeModelKind {
  if (placement.dead) {
    return 'dead';
  }
  const variation = hashAt(placement.x, placement.z, 17);
  if (placement.regionId === 'longji') {
    return variation < 0.18
      ? 'asia'
      : variation < 0.42
        ? 'cypress'
        : variation < 0.68
          ? 'pine'
          : variation < 0.84
            ? 'beech'
            : 'oak';
  }
  if (placement.regionId === 'baizu') {
    return variation < 0.14
      ? 'asia'
      : variation < 0.34
        ? 'willow'
        : variation < 0.56
          ? 'beech'
          : variation < 0.8
            ? 'oak'
            : 'pine';
  }
  if (placement.regionId === 'jinshui') {
    return variation < 0.12
      ? 'maple'
      : variation < 0.36
        ? 'willow'
        : variation < 0.62
          ? 'twisted'
          : variation < 0.82
            ? 'beech'
            : 'oak';
  }
  if (placement.regionId === 'mihun') {
    return variation < 0.3
      ? 'willow'
      : variation < 0.54
        ? 'twisted'
        : variation < 0.76
          ? 'cypress'
          : 'pine';
  }
  if (placement.regionId === 'zhusi' && variation < 0.06) {
    return 'maple';
  }
  return variation < 0.18
    ? 'cypress'
    : variation < 0.42
      ? 'pine'
      : variation < 0.68
        ? 'beech'
        : 'oak';
}

function modelPathFor(kind: ModelKind, x: number, z: number, tier: GraphicsTier): string {
  const paths = (tier === 'reduced' ? REDUCED_MODEL_PATHS : MODEL_PATHS)[kind];
  const index = Math.min(paths.length - 1, Math.floor(hashAt(x, z, 23) * paths.length));
  return paths[index] as string;
}

function composeModelMatrix(
  template: ModelTemplate,
  x: number,
  z: number,
  yaw: number,
  targetHeight: number,
  variationScale: number,
  tiltX = 0,
  tiltZ = 0,
): THREE.Matrix4 {
  const modelScale = (targetHeight / template.height) * variationScale;
  euler.set(tiltX, yaw, tiltZ);
  quaternion.setFromEuler(euler);
  scale.set(modelScale, modelScale, modelScale);
  position.set(x, -template.minY * modelScale, z);
  matrix.compose(position, quaternion, scale);
  return matrix.clone();
}

function materialTintForTree(
  placement: FloraModelTreePlacement,
  kind: TreeModelKind,
  leaf: boolean,
): THREE.Color {
  const region = regionAt(placement.x, placement.z);
  if (kind === 'asia') {
    // AsiaTree1 uses a packed atlas texture for trunk and canopy in one mesh.
    // Its source atlas runs yellow, so multiply it by a deeper foliage green
    // instead of whitening the regional tint.
    return softTint(0x405d3b, 0.08, placement.x, placement.z, 29);
  }
  if (kind === 'maple') {
    return softTint(
      leaf ? region.scatter : region.groundAlt,
      leaf ? 0.88 : 0.8,
      placement.x,
      placement.z,
      leaf ? 31 : 37,
    );
  }
  return softTint(
    leaf ? region.scatter : region.groundAlt,
    leaf ? 0.66 : 0.72,
    placement.x,
    placement.z,
    leaf ? 31 : 37,
  );
}

function materialTintForRock(point: MapPointMm): THREE.Color {
  const region = regionAt(point.x / 1_000, point.z / 1_000);
  return softTint(region.groundAlt, 0.58, point.x, point.z, 41);
}

function materialTintForDressing(
  placement: FloraModelDressingPlacement,
  leaf: boolean,
  kind: DressingModelKind = placement.kind,
): THREE.Color {
  const region = regionAt(placement.x, placement.z);
  if (kind === 'asiaBush' || kind === 'smallPlant1' || kind === 'smallPlant2') {
    // The packed atlas is strongly yellow-green. A restrained foliage tint
    // keeps its internal variation while matching the darker map vegetation.
    const base = kind === 'asiaBush' ? 0x38563a : kind === 'smallPlant1' ? 0x52663f : 0x465d3a;
    return softTint(base, 0.1, placement.x, placement.z, 45);
  }
  if (kind === 'reed') {
    return softTint(region.scatter, 0.42, placement.x, placement.z, 46);
  }
  if (kind === 'burdock') {
    return softTint(
      leaf ? 0x48663c : region.groundAlt,
      leaf ? 0.12 : 0.5,
      placement.x,
      placement.z,
      48,
    );
  }
  if (!leaf) {
    return softTint(region.groundAlt, 0.58, placement.x, placement.z, 47);
  }
  return softTint(region.scatter, kind === 'fern' ? 0.26 : 0.52, placement.x, placement.z, 53);
}

function createLoader(renderer: THREE.WebGLRenderer): {
  readonly loader: GLTFLoader;
  readonly transcoder: KTX2Loader;
} {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(appendAssetVersion);
  const transcoder = new KTX2Loader(manager);
  transcoder.setTranscoderPath(webAssetDirectoryUrl('basis/'));
  transcoder.detectSupport(renderer);
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setKTX2Loader(transcoder);
  return { loader, transcoder };
}

async function loadTemplates(
  loader: GLTFLoader,
  paths: readonly string[],
  failedAssets: Set<string>,
): Promise<Map<string, ModelTemplate>> {
  const templates = new Map<string, ModelTemplate>();
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const fileName = paths[index];
      if (!fileName) {
        return;
      }
      const path = `${MODEL_DIR}${fileName}`;
      try {
        const gltf = await loader.loadAsync(normalizedModelUrl(fileName));
        templates.set(fileName, extractParts(path, gltf));
        failedAssets.delete(path);
      } catch (error) {
        failedAssets.add(path);
        console.warn(`JWGB foliage model failed to load: ${path}`, error);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MODEL_LOAD_CONCURRENCY, paths.length) }, () => worker()),
  );
  return templates;
}

function uniqueModelPaths(tier: GraphicsTier): {
  readonly core: readonly string[];
  readonly dressing: readonly string[];
} {
  const paths = tier === 'reduced' ? REDUCED_MODEL_PATHS : MODEL_PATHS;
  const core = [
    ...paths.pine,
    ...paths.oak,
    ...paths.twisted,
    ...paths.dead,
    ...paths.asia,
    ...paths.maple,
    ...paths.cypress,
    ...paths.beech,
    ...paths.willow,
    ...paths.rock,
  ];
  const dressing = [
    ...paths.bush,
    ...paths.fern,
    ...paths.mushroom,
    ...paths.asiaBush,
    ...paths.reed,
    ...paths.smallPlant1,
    ...paths.smallPlant2,
    ...paths.burdock,
  ];
  return {
    core: [...new Set(core)],
    dressing: [...new Set(dressing)],
  };
}

export function floraModelAssetPaths(tier: GraphicsTier): {
  readonly core: readonly string[];
  readonly dressing: readonly string[];
} {
  return uniqueModelPaths(tier);
}

function addTreeBatches(
  parent: THREE.Group,
  templates: ReadonlyMap<string, ModelTemplate>,
  placements: readonly FloraModelTreePlacement[],
  tier: GraphicsTier,
): {
  readonly targets: readonly FloraTreeOccluderTarget[];
  readonly batches: readonly ModelBatch[];
  readonly chunks: readonly ModelChunk[];
  readonly count: number;
} {
  const spatialChunks = partitionModelChunks(
    parent,
    'tree',
    placements,
    (placement) => placement,
    chunkSizeForTier(tier),
  );
  const targetsById = new Map<
    string,
    { readonly placement: FloraModelTreePlacement; readonly parts: FloraTreeOccluderPart[] }
  >();
  const batches: ModelBatch[] = [];
  for (const { chunk, items } of spatialChunks.values()) {
    const byPath = new Map<string, FloraModelTreePlacement[]>();
    for (const placement of items) {
      const path = modelPathFor(treeKindFor(placement), placement.x, placement.z, tier);
      const list = byPath.get(path);
      if (list) {
        list.push(placement);
      } else {
        byPath.set(path, [placement]);
      }
    }
    for (const [fileName, list] of byPath) {
      const template = templates.get(fileName);
      if (!template) {
        continue;
      }
      const kind: TreeModelKind =
        fileName.startsWith('dead_') || fileName.startsWith('dead-')
          ? 'dead'
          : fileName.startsWith('cypress-poly')
            ? 'cypress'
            : fileName.startsWith('beech-poly')
              ? 'beech'
              : fileName.startsWith('willow-poly')
                ? 'willow'
                : fileName.startsWith('twisted_')
                  ? 'twisted'
                  : fileName.startsWith('oak_')
                    ? 'oak'
                    : fileName.startsWith('asia-tree')
                      ? 'asia'
                      : fileName.startsWith('red-maple')
                        ? 'maple'
                        : 'pine';
      chunk.instanceCount += list.length;
      const partRefs = list.map((placement) => {
        const entry = {
          placement,
          parts: [] as FloraTreeOccluderPart[],
        };
        targetsById.set(placement.id, entry);
        return entry;
      });
      for (const [partIndex, part] of template.parts.entries()) {
        const instanced = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        instanced.name =
          `flora-model-${kind}-${fileName.replace('.glb', '')}-` +
          `${chunk.chunkX}-${chunk.chunkZ}-${partIndex}`;
        const lightweightFoliage =
          kind === 'asia' ||
          kind === 'maple' ||
          kind === 'cypress' ||
          kind === 'beech' ||
          kind === 'willow';
        instanced.castShadow = !lightweightFoliage && (part.isLeaf || kind === 'dead');
        instanced.receiveShadow = !lightweightFoliage;
        instanced.frustumCulled = false;
        for (const [index, placement] of list.entries()) {
          const variationScale =
            (kind === 'dead' ? 0.86 : 0.84) + Math.min(1.35, placement.size) * 0.16;
          const modelMatrix = composeModelMatrix(
            template,
            placement.x,
            placement.z,
            placement.yaw,
            TREE_TARGET_HEIGHTS[kind],
            variationScale,
            kind === 'dead' ? (hashAt(placement.x, placement.z, 61) - 0.5) * 0.035 : 0,
            kind === 'dead' ? (hashAt(placement.x, placement.z, 62) - 0.5) * 0.035 : 0,
          );
          instanced.setMatrixAt(index, modelMatrix);
          const instanceColour = materialTintForTree(placement, kind, part.isLeaf);
          instanced.setColorAt(index, instanceColour);
          partRefs[index]?.parts.push({
            id: part.isLeaf ? 'canopy' : 'trunk',
            mesh: instanced,
            instanceIndex: index,
            matrix: modelMatrix,
            colour: instanceColour.clone(),
          });
        }
        instanced.instanceMatrix.needsUpdate = true;
        if (instanced.instanceColor) {
          instanced.instanceColor.needsUpdate = true;
        }
        chunk.group.add(instanced);
        batches.push({
          mesh: instanced,
          geometry: part.geometry,
          material: part.material,
          trianglesPerInstance: part.triangles,
          chunk,
        });
      }
    }
  }

  const targets: FloraTreeOccluderTarget[] = [];
  for (const placement of placements) {
    const entry = targetsById.get(placement.id);
    if (!entry || entry.parts.length === 0) {
      continue;
    }
    targets.push(floraTreeOccluderTarget(placement.id, entry.parts));
  }
  return {
    targets,
    batches,
    chunks: activeModelChunks(spatialChunks.values()),
    count: targets.length,
  };
}

function addRockBatches(
  parent: THREE.Group,
  templates: ReadonlyMap<string, ModelTemplate>,
  points: readonly MapPointMm[],
  tier: GraphicsTier,
): {
  readonly batches: readonly ModelBatch[];
  readonly chunks: readonly ModelChunk[];
  readonly count: number;
} {
  const spatialChunks = partitionModelChunks(
    parent,
    'rock',
    points,
    (point) => ({
      x: point.x / 1_000,
      z: point.z / 1_000,
    }),
    chunkSizeForTier(tier),
  );
  const batches: ModelBatch[] = [];
  let count = 0;
  for (const { chunk, items } of spatialChunks.values()) {
    const byPath = new Map<string, MapPointMm[]>();
    for (const point of items) {
      const path = modelPathFor('rock', point.x, point.z, tier);
      const list = byPath.get(path);
      if (list) {
        list.push(point);
      } else {
        byPath.set(path, [point]);
      }
    }
    for (const [fileName, list] of byPath) {
      const template = templates.get(fileName);
      if (!template) {
        continue;
      }
      chunk.instanceCount += list.length;
      count += list.length;
      for (const [partIndex, part] of template.parts.entries()) {
        const instanced = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        instanced.name =
          `flora-model-rock-${fileName.replace('.glb', '')}-` +
          `${chunk.chunkX}-${chunk.chunkZ}-${partIndex}`;
        instanced.castShadow = false;
        instanced.receiveShadow = true;
        instanced.frustumCulled = false;
        for (const [index, point] of list.entries()) {
          const variationScale = 0.72 + hashAt(point.x, point.z, 67) * 0.68;
          const modelMatrix = composeModelMatrix(
            template,
            point.x / 1_000,
            point.z / 1_000,
            hashAt(point.x, point.z, 68) * Math.PI * 2,
            ROCK_TARGET_HEIGHT,
            variationScale,
            (hashAt(point.x, point.z, 69) - 0.5) * 0.22,
            (hashAt(point.x, point.z, 70) - 0.5) * 0.22,
          );
          instanced.setMatrixAt(index, modelMatrix);
          instanced.setColorAt(index, materialTintForRock(point));
        }
        instanced.instanceMatrix.needsUpdate = true;
        if (instanced.instanceColor) {
          instanced.instanceColor.needsUpdate = true;
        }
        chunk.group.add(instanced);
        batches.push({
          mesh: instanced,
          geometry: part.geometry,
          material: part.material,
          trianglesPerInstance: part.triangles,
          chunk,
        });
      }
    }
  }
  return {
    batches,
    chunks: activeModelChunks(spatialChunks.values()),
    count,
  };
}

function addDressingBatches(
  parent: THREE.Group,
  templates: ReadonlyMap<string, ModelTemplate>,
  placements: readonly FloraModelDressingPlacement[],
  tier: GraphicsTier,
): {
  readonly batches: readonly ModelBatch[];
  readonly chunks: readonly ModelChunk[];
  readonly count: number;
} {
  const spatialChunks = partitionModelChunks(
    parent,
    'dressing',
    placements,
    (placement) => placement,
    chunkSizeForTier(tier),
  );
  const batches: ModelBatch[] = [];
  const allowedPaths = new Set(uniqueModelPaths(tier).dressing);
  let count = 0;
  for (const { chunk, items } of spatialChunks.values()) {
    const byKind = new Map<DressingModelKind, FloraModelDressingPlacement[]>();
    for (const placement of items) {
      const kind = tier === 'reduced' ? 'burdock' : placement.kind;
      const list = byKind.get(kind);
      if (list) {
        list.push(placement);
      } else {
        byKind.set(kind, [placement]);
      }
    }
    for (const [kind, list] of byKind) {
      const fileName =
        kind === 'asiaBush'
          ? 'asia-bush.glb'
          : kind === 'reed'
            ? 'reed-big.glb'
            : kind === 'smallPlant1'
              ? 'small-plant-1.glb'
              : kind === 'smallPlant2'
                ? 'small-plant-2.glb'
                : kind === 'burdock'
                  ? 'burdock-poly.glb'
                  : `${kind}.glb`;
      if (!allowedPaths.has(fileName)) {
        continue;
      }
      const template = templates.get(fileName);
      if (!template) {
        continue;
      }
      chunk.instanceCount += list.length;
      count += list.length;
      for (const [partIndex, part] of template.parts.entries()) {
        const instanced = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        instanced.name = `flora-model-${kind}-${chunk.chunkX}-${chunk.chunkZ}-${partIndex}`;
        instanced.castShadow = false;
        instanced.receiveShadow = !['asiaBush', 'reed', 'smallPlant1', 'smallPlant2'].includes(
          kind,
        );
        instanced.frustumCulled = false;
        for (const [index, placement] of list.entries()) {
          const targetHeight =
            kind === 'bush'
              ? BUSH_TARGET_HEIGHT
              : kind === 'fern'
                ? FERN_TARGET_HEIGHT
                : kind === 'mushroom'
                  ? MUSHROOM_TARGET_HEIGHT
                  : kind === 'asiaBush'
                    ? ASIA_BUSH_TARGET_HEIGHT
                    : kind === 'reed'
                      ? REED_TARGET_HEIGHT
                      : kind === 'smallPlant1'
                        ? SMALL_PLANT_1_TARGET_HEIGHT
                        : kind === 'smallPlant2'
                          ? SMALL_PLANT_2_TARGET_HEIGHT
                          : BURDOCK_TARGET_HEIGHT;
          const variationScale =
            tier === 'reduced'
              ? 0.68 + hashAt(placement.x, placement.z, 73) * 0.4
              : placement.scale * (0.9 + hashAt(placement.x, placement.z, 73) * 0.2);
          const modelMatrix = composeModelMatrix(
            template,
            placement.x,
            placement.z,
            placement.yaw,
            targetHeight,
            variationScale,
          );
          instanced.setMatrixAt(index, modelMatrix);
          instanced.setColorAt(index, materialTintForDressing(placement, part.isLeaf, kind));
        }
        instanced.instanceMatrix.needsUpdate = true;
        if (instanced.instanceColor) {
          instanced.instanceColor.needsUpdate = true;
        }
        chunk.group.add(instanced);
        batches.push({
          mesh: instanced,
          geometry: part.geometry,
          material: part.material,
          trianglesPerInstance: part.triangles,
          chunk,
        });
      }
    }
  }
  return {
    batches,
    chunks: activeModelChunks(spatialChunks.values()),
    count,
  };
}

function disposeTemplates(templates: ReadonlyMap<string, ModelTemplate>): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const template of templates.values()) {
    for (const part of template.parts) {
      geometries.add(part.geometry);
      materials.add(part.material);
      for (const value of Object.values(part.material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) {
          textures.add(value);
        }
      }
    }
  }
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

function disposeBatchInstances(batches: readonly ModelBatch[]): void {
  for (const batch of batches) {
    batch.mesh.dispose();
  }
}

export function buildFloraModelLayer(
  parent: THREE.Group,
  options: {
    readonly renderer: THREE.WebGLRenderer | null;
    readonly graphicsTier: GraphicsTier;
    readonly trees: readonly FloraModelTreePlacement[];
    readonly rocks: readonly MapPointMm[];
    readonly dressing: readonly FloraModelDressingPlacement[];
    readonly onTreeTargetsChanged?: (targets: readonly FloraTreeOccluderTarget[]) => void;
  },
): FloraModelLayer {
  const group = new THREE.Group();
  group.name = 'flora-models';
  group.visible = false;
  parent.add(group);

  let treeGroup = new THREE.Group();
  treeGroup.name = 'flora-model-trees';
  let rockGroup = new THREE.Group();
  rockGroup.name = 'flora-model-rocks';
  let dressingGroup = new THREE.Group();
  dressingGroup.name = 'flora-model-dressing';
  group.add(treeGroup, rockGroup, dressingGroup);

  let tier = options.graphicsTier;
  let builtTier: GraphicsTier | null = null;
  let status: FloraModelLayerDiagnostics['status'] = options.renderer ? 'loading' : 'disabled';
  const failedAssets = new Set<string>();
  const coreTemplates = new Map<string, ModelTemplate>();
  const dressingTemplates = new Map<string, ModelTemplate>();
  let batches: ModelBatch[] = [];
  let chunks: ModelChunk[] = [];
  let transcoder: KTX2Loader | null = null;
  let loader: GLTFLoader | null = null;
  let disposed = false;
  let requestedBuild = 0;
  let buildQueue = Promise.resolve();
  let frameCounter = MODEL_VISIBILITY_UPDATE_INTERVAL_FRAMES - 1;
  let visibilityReference: THREE.Vector3 | null = null;
  let visibleTreeInstances = 0;
  let visibleRockInstances = 0;
  let visibleDressingInstances = 0;
  let buildResult: BuildResult = {
    treeTargets: [],
    treeInstances: 0,
    rockInstances: 0,
    dressingInstances: 0,
  };

  let resolveReady: (targets: readonly FloraTreeOccluderTarget[]) => void = () => {};
  let readySettled = false;
  const ready = new Promise<readonly FloraTreeOccluderTarget[]>((resolve) => {
    resolveReady = resolve;
  });
  const settleReady = (targets: readonly FloraTreeOccluderTarget[]): void => {
    if (readySettled) {
      return;
    }
    readySettled = true;
    resolveReady(targets);
  };

  const updateVisibility = (cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void => {
    const reference = focusPosition.lengthSq() > 0 ? focusPosition : cameraPosition;
    const visibilityTier = builtTier ?? tier;
    visibilityReference ??= new THREE.Vector3();
    visibilityReference.copy(reference);
    visibleTreeInstances = 0;
    visibleRockInstances = 0;
    visibleDressingInstances = 0;
    for (const chunk of chunks) {
      const cullDistance =
        chunk.kind === 'tree'
          ? visibilityTier === 'reduced'
            ? REDUCED_TREE_CULL_DISTANCE
            : TREE_CULL_DISTANCE
          : chunk.kind === 'rock'
            ? visibilityTier === 'reduced'
              ? REDUCED_ROCK_CULL_DISTANCE
              : ROCK_CULL_DISTANCE
            : visibilityTier === 'reduced'
              ? REDUCED_DRESSING_CULL_DISTANCE
              : DRESSING_CULL_DISTANCE;
      const visible =
        group.visible && squaredDistanceToChunk(reference, chunk) <= cullDistance * cullDistance;
      chunk.group.visible = visible;
      if (!visible) {
        continue;
      }
      if (chunk.kind === 'tree') {
        visibleTreeInstances += chunk.instanceCount;
      } else if (chunk.kind === 'rock') {
        visibleRockInstances += chunk.instanceCount;
      } else {
        visibleDressingInstances += chunk.instanceCount;
      }
    }
    treeGroup.visible = visibleTreeInstances > 0;
    rockGroup.visible = visibleRockInstances > 0;
    dressingGroup.visible = visibleDressingInstances > 0;
  };

  const ensureTemplates = async (
    target: Map<string, ModelTemplate>,
    paths: readonly string[],
  ): Promise<boolean> => {
    if (!loader || disposed) {
      return false;
    }
    const missing = paths.filter((path) => !target.has(path));
    if (missing.length > 0) {
      const loaded = await loadTemplates(loader, missing, failedAssets);
      if (disposed) {
        disposeTemplates(loaded);
        return false;
      }
      for (const [path, template] of loaded) {
        target.set(path, template);
      }
    }
    return paths.every((path) => target.has(path));
  };

  const pruneTemplates = (
    templates: Map<string, ModelTemplate>,
    retainedPaths: ReadonlySet<string>,
  ): void => {
    const discarded = new Map<string, ModelTemplate>();
    for (const [path, template] of templates) {
      if (!retainedPaths.has(path)) {
        discarded.set(path, template);
        templates.delete(path);
      }
    }
    disposeTemplates(discarded);
  };

  const rebuild = async (buildId: number): Promise<void> => {
    if (!loader || disposed || buildId !== requestedBuild) {
      return;
    }
    const nextTier = tier;
    const paths = uniqueModelPaths(nextTier);
    const coreReady = await ensureTemplates(coreTemplates, paths.core);
    if (disposed || buildId !== requestedBuild) {
      return;
    }
    const dressingReady = await ensureTemplates(dressingTemplates, paths.dressing);
    if (disposed || buildId !== requestedBuild) {
      return;
    }
    if (!coreReady || !dressingReady) {
      status = 'failed';
      settleReady([]);
      return;
    }

    const nextTreeGroup = new THREE.Group();
    nextTreeGroup.name = 'flora-model-trees';
    const nextRockGroup = new THREE.Group();
    nextRockGroup.name = 'flora-model-rocks';
    const nextDressingGroup = new THREE.Group();
    nextDressingGroup.name = 'flora-model-dressing';
    const treeResult = addTreeBatches(nextTreeGroup, coreTemplates, options.trees, nextTier);
    const rockResult = addRockBatches(nextRockGroup, coreTemplates, options.rocks, nextTier);
    const dressingResult = addDressingBatches(
      nextDressingGroup,
      dressingTemplates,
      options.dressing,
      nextTier,
    );
    const nextBatches = [...treeResult.batches, ...rockResult.batches, ...dressingResult.batches];
    if (options.trees.length > 0 && treeResult.count < options.trees.length) {
      for (const chunk of [...treeResult.chunks, ...rockResult.chunks, ...dressingResult.chunks]) {
        chunk.group.removeFromParent();
      }
      status = 'failed';
      settleReady([]);
      return;
    }

    const previousBatches = batches;
    treeGroup.removeFromParent();
    rockGroup.removeFromParent();
    dressingGroup.removeFromParent();
    treeGroup = nextTreeGroup;
    rockGroup = nextRockGroup;
    dressingGroup = nextDressingGroup;
    group.add(treeGroup, rockGroup, dressingGroup);
    batches = nextBatches;
    chunks = [...treeResult.chunks, ...rockResult.chunks, ...dressingResult.chunks];
    buildResult = {
      treeTargets: treeResult.targets,
      treeInstances: treeResult.count,
      rockInstances: rockResult.count,
      dressingInstances: dressingResult.count,
    };
    builtTier = nextTier;
    pruneTemplates(coreTemplates, new Set(paths.core));
    pruneTemplates(dressingTemplates, new Set(paths.dressing));
    for (const failedPath of failedAssets) {
      const fileName = failedPath.slice(MODEL_DIR.length);
      if (!paths.core.includes(fileName) && !paths.dressing.includes(fileName)) {
        failedAssets.delete(failedPath);
      }
    }
    group.visible = true;
    const reference = visibilityReference ?? new THREE.Vector3();
    updateVisibility(reference, reference);
    status = 'ready';
    options.onTreeTargetsChanged?.(treeResult.targets);
    disposeBatchInstances(previousBatches);
    settleReady(treeResult.targets);
  };

  const requestRebuild = (): void => {
    if (!loader || disposed) {
      return;
    }
    const buildId = ++requestedBuild;
    buildQueue = buildQueue
      .then(() => rebuild(buildId))
      .catch((error) => {
        if (disposed || buildId !== requestedBuild) {
          return;
        }
        status = 'failed';
        failedAssets.add(`loader: ${String(error)}`);
        settleReady([]);
        console.warn(
          'JWGB foliage model layer unavailable; procedural fallback remains active',
          error,
        );
      });
  };

  if (options.renderer) {
    const created = createLoader(options.renderer);
    loader = created.loader;
    transcoder = created.transcoder;
    requestRebuild();
  } else {
    settleReady([]);
  }

  return {
    group,
    ready,
    setGraphicsTier(nextTier): void {
      if (tier === nextTier && builtTier === nextTier) {
        updateVisibility(
          visibilityReference ?? new THREE.Vector3(),
          visibilityReference ?? new THREE.Vector3(),
        );
        return;
      }
      tier = nextTier;
      requestRebuild();
    },
    update(cameraPosition, focusPosition): void {
      if (disposed || status !== 'ready') {
        visibilityReference ??= new THREE.Vector3();
        visibilityReference.copy(focusPosition.lengthSq() > 0 ? focusPosition : cameraPosition);
        return;
      }
      frameCounter = (frameCounter + 1) % MODEL_VISIBILITY_UPDATE_INTERVAL_FRAMES;
      if (frameCounter === 0) {
        updateVisibility(cameraPosition, focusPosition);
      }
    },
    diagnostics(): FloraModelLayerDiagnostics {
      const visibleBatches = batches.filter(
        (batch) =>
          group.visible && batch.chunk.group.visible && batch.mesh.visible && batch.mesh.count > 0,
      );
      return {
        status,
        loadedAssets: [...coreTemplates.values(), ...dressingTemplates.values()]
          .map((template) => template.path)
          .sort(),
        failedAssets: [...failedAssets].sort(),
        treeInstances: buildResult.treeInstances,
        visibleTreeInstances,
        rockInstances: buildResult.rockInstances,
        visibleRockInstances,
        dressingInstances: buildResult.dressingInstances,
        visibleDressingInstances,
        instancedBatches: batches.length,
        visibleInstancedBatches: visibleBatches.length,
        triangles: visibleBatches.reduce(
          (sum, batch) => sum + batch.trianglesPerInstance * batch.mesh.count,
          0,
        ),
        drawCalls: visibleBatches.length,
        visible: group.visible,
      };
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      requestedBuild += 1;
      status = 'disposed';
      group.removeFromParent();
      settleReady([]);
      disposeBatchInstances(batches);
      disposeTemplates(coreTemplates);
      disposeTemplates(dressingTemplates);
      coreTemplates.clear();
      dressingTemplates.clear();
      batches = [];
      chunks = [];
      try {
        transcoder?.dispose();
      } catch {
        // Best-effort decoder cleanup.
      }
      transcoder = null;
    },
  };
}
