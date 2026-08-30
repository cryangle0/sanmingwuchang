import { MAP_BOUNDARY, MAP_GEOMETRY_HASH, type MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { appendAssetVersion, webAssetUrl } from '../../runtime/asset-url';
import { applyWindSway } from '../shading/wind';
import { type RegionId, regionAt, regionStyles } from './map-regions';
import { createRandomStream, dressingSurfaceMeters, isOpenGround } from './map-sampling';
import { waterSurfaceAt } from './water';

const MM = 1_000;
const ASSET_DIR = 'models/global-scenes/';
const LOAD_CONCURRENCY = 3;
const VISIBILITY_UPDATE_INTERVAL_FRAMES = 3;
const CHUNK_SIZE = 112;
const BALANCED_NEAR_CULL_DISTANCE = 150;
const REDUCED_NEAR_CULL_DISTANCE = 108;
const BACKDROP_CULL_DISTANCE = 430;
const NEAR_CLEARANCE_METERS = 6.2;
const BACKDROP_RING_RADIUS_METERS = 72;
const SEED_SALT = 0x59ef8d31;

export type GlobalSceneGraphicsTier = 'balanced' | 'reduced';
export type GlobalSceneSourceId = 'overgrown' | 'forest-road-night' | 'forest-mountains';
export type GlobalSceneRole = 'grove' | 'tree' | 'foliage' | 'backdrop';

export interface GlobalSceneAssetCatalogEntry {
  readonly id: string;
  readonly fileName: string;
  readonly sourceId: GlobalSceneSourceId;
  readonly role: GlobalSceneRole;
  readonly targetHeight: number;
}

export const GLOBAL_SCENE_ASSET_CATALOG: readonly GlobalSceneAssetCatalogEntry[] = [
  {
    id: 'overgrown-grove',
    fileName: 'overgrown-grove.glb',
    sourceId: 'overgrown',
    role: 'grove',
    targetHeight: 12,
  },
  {
    id: 'overgrown-card-a',
    fileName: 'overgrown-card-a.glb',
    sourceId: 'overgrown',
    role: 'foliage',
    targetHeight: 7.5,
  },
  {
    id: 'overgrown-card-b',
    fileName: 'overgrown-card-b.glb',
    sourceId: 'overgrown',
    role: 'foliage',
    targetHeight: 10,
  },
  {
    id: 'forest-road-tree-a',
    fileName: 'forest-road-tree-a.glb',
    sourceId: 'forest-road-night',
    role: 'tree',
    targetHeight: 9.4,
  },
  {
    id: 'forest-road-tree-b',
    fileName: 'forest-road-tree-b.glb',
    sourceId: 'forest-road-night',
    role: 'tree',
    targetHeight: 7.2,
  },
  {
    id: 'forest-road-understory',
    fileName: 'forest-road-understory.glb',
    sourceId: 'forest-road-night',
    role: 'foliage',
    targetHeight: 2.2,
  },
  {
    id: 'forest-mountains-card-a',
    fileName: 'forest-mountains-card-a.glb',
    sourceId: 'forest-mountains',
    role: 'tree',
    targetHeight: 8.4,
  },
  {
    id: 'forest-mountains-card-b',
    fileName: 'forest-mountains-card-b.glb',
    sourceId: 'forest-mountains',
    role: 'tree',
    targetHeight: 7.4,
  },
  {
    id: 'forest-mountains-card-c',
    fileName: 'forest-mountains-card-c.glb',
    sourceId: 'forest-mountains',
    role: 'tree',
    targetHeight: 10,
  },
  {
    id: 'forest-mountains-ridge-a',
    fileName: 'forest-mountains-ridge-a.glb',
    sourceId: 'forest-mountains',
    role: 'backdrop',
    targetHeight: 36,
  },
  {
    id: 'forest-mountains-ridge-b',
    fileName: 'forest-mountains-ridge-b.glb',
    sourceId: 'forest-mountains',
    role: 'backdrop',
    targetHeight: 42,
  },
] as const;

const CATALOG_BY_ID = new Map(GLOBAL_SCENE_ASSET_CATALOG.map((entry) => [entry.id, entry]));

export interface GlobalScenePlacement {
  readonly id: string;
  readonly assetId: string;
  readonly sourceId: GlobalSceneSourceId;
  readonly role: GlobalSceneRole;
  readonly regionId: RegionId | 'perimeter';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly reduced: boolean;
}

export interface GlobalSceneLayerDiagnostics {
  readonly status: 'disabled' | 'loading' | 'ready' | 'failed' | 'disposed';
  readonly loadedAssets: readonly string[];
  readonly failedAssets: readonly string[];
  readonly placements: number;
  readonly visiblePlacements: number;
  readonly placementsBySource: Readonly<Record<GlobalSceneSourceId, number>>;
  readonly visiblePlacementsBySource: Readonly<Record<GlobalSceneSourceId, number>>;
  readonly instancedBatches: number;
  readonly visibleInstancedBatches: number;
  readonly triangles: number;
  readonly drawCalls: number;
  readonly visible: boolean;
}

export interface GlobalSceneLayer {
  readonly group: THREE.Group;
  setGraphicsTier(tier: GlobalSceneGraphicsTier): void;
  update(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void;
  diagnostics(): GlobalSceneLayerDiagnostics;
  dispose(): void;
}

interface TemplatePart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly triangles: number;
}

interface Template {
  readonly entry: GlobalSceneAssetCatalogEntry;
  readonly path: string;
  readonly parts: readonly TemplatePart[];
}

interface PlacementChunk {
  readonly key: string;
  readonly group: THREE.Group;
  readonly role: 'near' | 'backdrop';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  placements: number;
  readonly placementsBySource: Record<GlobalSceneSourceId, number>;
}

interface SceneBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly chunk: PlacementChunk;
  readonly sourceId: GlobalSceneSourceId;
  readonly trianglesPerInstance: number;
  readonly instanceCount: number;
}

const tempMatrix = new THREE.Matrix4();
const tempEuler = new THREE.Euler();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempPosition = new THREE.Vector3();

function assetUrl(entry: GlobalSceneAssetCatalogEntry): string {
  return appendAssetVersion(webAssetUrl(`${ASSET_DIR}${entry.fileName}`));
}

function emptySourceCounts(): Record<GlobalSceneSourceId, number> {
  return {
    overgrown: 0,
    'forest-road-night': 0,
    'forest-mountains': 0,
  };
}

function seedFromHash(): number {
  return Number.parseInt(MAP_GEOMETRY_HASH.slice(0, 8), 16) >>> 0 || 1;
}

function validNearPoint(point: MapPointMm): boolean {
  const x = point.x / MM;
  const z = point.z / MM;
  return isOpenGround(point, { roadVergeMm: 5_500 }) && waterSurfaceAt(x, z) === null;
}

function pointNearRegionAnchor(
  regionId: RegionId,
  nextRandom: () => number,
  accepted: readonly GlobalScenePlacement[],
): { readonly x: number; readonly z: number } | null {
  const region = regionStyles().find((entry) => entry.id === regionId);
  if (!region) {
    return null;
  }
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const angle = nextRandom() * Math.PI * 2;
    const radius =
      regionId === 'santing' ? 82 + nextRandom() * 24 : 24 + Math.sqrt(nextRandom()) * 66;
    const x = region.anchor.x + Math.cos(angle) * radius;
    const z = region.anchor.z + Math.sin(angle) * radius;
    const point = { x: Math.round(x * MM), z: Math.round(z * MM) };
    if (!validNearPoint(point) || regionAt(x, z).id !== regionId) {
      continue;
    }
    const tooClose = accepted.some((placement) => {
      if (placement.role === 'backdrop') {
        return false;
      }
      const dx = placement.x - x;
      const dz = placement.z - z;
      return dx * dx + dz * dz < NEAR_CLEARANCE_METERS * NEAR_CLEARANCE_METERS;
    });
    if (!tooClose) {
      return { x, z };
    }
  }
  return null;
}

function assetIdForSource(sourceId: GlobalSceneSourceId, index: number, variation: number): string {
  if (sourceId === 'overgrown') {
    return index % 5 === 0
      ? 'overgrown-grove'
      : variation < 0.55
        ? 'overgrown-card-a'
        : 'overgrown-card-b';
  }
  if (sourceId === 'forest-road-night') {
    return index % 4 === 0
      ? 'forest-road-understory'
      : variation < 0.58
        ? 'forest-road-tree-a'
        : 'forest-road-tree-b';
  }
  return variation < 0.36
    ? 'forest-mountains-card-a'
    : variation < 0.72
      ? 'forest-mountains-card-b'
      : 'forest-mountains-card-c';
}

function sourceScale(sourceId: GlobalSceneSourceId, assetId: string, variation: number): number {
  if (assetId === 'overgrown-grove') {
    return 0.72 + variation * 0.24;
  }
  if (sourceId === 'forest-road-night') {
    return 0.78 + variation * 0.42;
  }
  if (sourceId === 'forest-mountains') {
    return 0.7 + variation * 0.34;
  }
  return 0.66 + variation * 0.32;
}

export function createGlobalScenePlacementPlan(
  seed = seedFromHash(),
): readonly GlobalScenePlacement[] {
  const nextRandom = createRandomStream(seed ^ SEED_SALT);
  const placements: GlobalScenePlacement[] = [];
  const regionIds = regionStyles().map((region) => region.id);
  const sources: readonly GlobalSceneSourceId[] = [
    'overgrown',
    'forest-road-night',
    'forest-mountains',
  ];
  const perSourcePerRegion = 3;

  for (const regionId of regionIds) {
    for (const sourceId of sources) {
      for (let index = 0; index < perSourcePerRegion; index += 1) {
        const point = pointNearRegionAnchor(regionId, nextRandom, placements);
        if (!point) {
          continue;
        }
        const variation = nextRandom();
        const assetId = assetIdForSource(sourceId, index, variation);
        const catalog = CATALOG_BY_ID.get(assetId);
        if (!catalog) {
          continue;
        }
        placements.push({
          id: `global-${regionId}-${sourceId}-${index}`,
          assetId,
          sourceId,
          role: catalog.role,
          regionId,
          x: point.x,
          y: dressingSurfaceMeters({
            x: Math.round(point.x * MM),
            z: Math.round(point.z * MM),
          }),
          z: point.z,
          yaw: nextRandom() * Math.PI * 2,
          scale: sourceScale(sourceId, assetId, nextRandom()),
          reduced: index === 0,
        });
      }
    }
  }

  const boundaryBounds = MAP_BOUNDARY.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x / MM),
      maxX: Math.max(bounds.maxX, point.x / MM),
      minZ: Math.min(bounds.minZ, point.z / MM),
      maxZ: Math.max(bounds.maxZ, point.z / MM),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  );
  const centreX = (boundaryBounds.minX + boundaryBounds.maxX) / 2;
  const centreZ = (boundaryBounds.minZ + boundaryBounds.maxZ) / 2;
  const halfX = (boundaryBounds.maxX - boundaryBounds.minX) / 2 + BACKDROP_RING_RADIUS_METERS;
  const halfZ = (boundaryBounds.maxZ - boundaryBounds.minZ) / 2 + BACKDROP_RING_RADIUS_METERS;
  const backdropCount = 16;
  for (let index = 0; index < backdropCount; index += 1) {
    const angle = (index / backdropCount) * Math.PI * 2;
    const directionX = Math.cos(angle);
    const directionZ = Math.sin(angle);
    const edgeScale = 1 / Math.max(Math.abs(directionX), Math.abs(directionZ), 0.001);
    const x = centreX + directionX * halfX * edgeScale;
    const z = centreZ + directionZ * halfZ * edgeScale;
    const assetId = index % 3 === 0 ? 'forest-mountains-ridge-b' : 'forest-mountains-ridge-a';
    placements.push({
      id: `global-perimeter-forest-mountains-${index}`,
      assetId,
      sourceId: 'forest-mountains',
      role: 'backdrop',
      regionId: 'perimeter',
      x,
      y:
        dressingSurfaceMeters({
          x: Math.round(
            THREE.MathUtils.clamp(x, boundaryBounds.minX + 2, boundaryBounds.maxX - 2) * MM,
          ),
          z: Math.round(
            THREE.MathUtils.clamp(z, boundaryBounds.minZ + 2, boundaryBounds.maxZ - 2) * MM,
          ),
        }) - 5.5,
      z,
      yaw: Math.atan2(-directionX, -directionZ),
      scale: 0.9 + nextRandom() * 0.28,
      reduced: index % 2 === 0,
    });
  }

  return placements;
}

export function placementsForGlobalSceneTier(
  placements: readonly GlobalScenePlacement[],
  tier: GlobalSceneGraphicsTier,
): readonly GlobalScenePlacement[] {
  return tier === 'balanced' ? placements : placements.filter((placement) => placement.reduced);
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

function bakeGeometry(source: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
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
  geometry.applyMatrix4(matrix);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function prepareMaterial(
  source: THREE.Material,
  entry: GlobalSceneAssetCatalogEntry,
): THREE.Material {
  const material = source.clone();
  material.name = `${entry.id}-${source.name || 'material'}`;
  const foliage = entry.role !== 'backdrop' && Boolean((material as THREE.MeshBasicMaterial).map);
  if (foliage) {
    material.transparent = false;
    material.alphaTest = Math.max(material.alphaTest, 0.34);
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.roughness = Math.max(material.roughness, 0.88);
      material.metalness = Math.min(material.metalness, 0.04);
      material.emissiveMap = material.map;
      material.emissive.setRGB(0.018, 0.028, 0.012);
      material.emissiveIntensity = 0.16;
      material.color.multiplyScalar(entry.sourceId === 'forest-road-night' ? 0.92 : 0.86);
      applyWindSway(material, entry.role === 'foliage' ? 0.018 : 0.028);
    }
  } else {
    material.transparent = false;
    material.alphaTest = 0;
    material.depthWrite = true;
    material.side = THREE.FrontSide;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.roughness = Math.max(material.roughness, 0.96);
      material.metalness = Math.min(material.metalness, 0.02);
      material.color.multiplyScalar(0.68);
    }
  }
  material.needsUpdate = true;
  return material;
}

function extractTemplate(entry: GlobalSceneAssetCatalogEntry, scene: THREE.Group): Template {
  scene.updateMatrixWorld(true);
  const parts: TemplatePart[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const groups =
      object.geometry.groups.length > 0
        ? object.geometry.groups
        : [
            {
              start: 0,
              count:
                object.geometry.index?.count ??
                object.geometry.getAttribute('position')?.count ??
                0,
              materialIndex: 0,
            },
          ];
    const baked = bakeGeometry(object.geometry, object.matrixWorld);
    for (const group of groups) {
      const sourceMaterial = sourceMaterials[group.materialIndex ?? 0] ?? sourceMaterials[0];
      if (!sourceMaterial || group.count <= 0) {
        continue;
      }
      const geometry = baked.clone();
      geometry.clearGroups();
      geometry.setDrawRange(group.start, group.count);
      parts.push({
        geometry,
        material: prepareMaterial(sourceMaterial, entry),
        triangles: Math.floor(group.count / 3),
      });
    }
    baked.dispose();
  });
  if (parts.length === 0) {
    throw new Error(`global scene asset ${entry.id} has no renderable meshes`);
  }
  return { entry, path: assetUrl(entry), parts };
}

function createLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

async function loadTemplates(
  entries: readonly GlobalSceneAssetCatalogEntry[],
  failedAssets: Set<string>,
): Promise<Map<string, Template>> {
  const templates = new Map<string, Template>();
  const loader = createLoader();
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const entry = entries[nextIndex];
      nextIndex += 1;
      if (!entry) {
        return;
      }
      try {
        const gltf = await loader.loadAsync(assetUrl(entry));
        templates.set(entry.id, extractTemplate(entry, gltf.scene));
      } catch (error) {
        failedAssets.add(assetUrl(entry));
        console.warn(`JWGB global scene asset failed to load: ${entry.id}`, error);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(LOAD_CONCURRENCY, entries.length) }, () => worker()),
  );
  return templates;
}

function disposeTemplates(templates: ReadonlyMap<string, Template>): void {
  const textures = new Set<THREE.Texture>();
  for (const template of templates.values()) {
    for (const part of template.parts) {
      part.geometry.dispose();
      for (const value of Object.values(part.material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) {
          textures.add(value);
        }
      }
      part.material.dispose();
    }
  }
  for (const texture of textures) {
    texture.dispose();
  }
}

function disposeBatches(batches: readonly SceneBatch[]): void {
  for (const batch of batches) {
    batch.mesh.dispose();
  }
}

function chunkKey(placement: GlobalScenePlacement): string {
  if (placement.role === 'backdrop') {
    return `backdrop:${Math.floor(placement.x / 220)}:${Math.floor(placement.z / 220)}`;
  }
  return `near:${Math.floor(placement.x / CHUNK_SIZE)}:${Math.floor(placement.z / CHUNK_SIZE)}`;
}

function createChunk(parent: THREE.Group, placement: GlobalScenePlacement): PlacementChunk {
  const group = new THREE.Group();
  group.name = `global-scene-chunk-${chunkKey(placement).replaceAll(':', '-')}`;
  group.visible = false;
  parent.add(group);
  return {
    key: chunkKey(placement),
    group,
    role: placement.role === 'backdrop' ? 'backdrop' : 'near',
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    placements: 0,
    placementsBySource: emptySourceCounts(),
  };
}

function makePlacementMatrix(placement: GlobalScenePlacement): THREE.Matrix4 {
  tempEuler.set(0, placement.yaw, 0);
  tempQuaternion.setFromEuler(tempEuler);
  tempScale.setScalar(placement.scale);
  tempPosition.set(placement.x, placement.y, placement.z);
  tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
  return tempMatrix.clone();
}

function squaredDistanceToChunk(reference: THREE.Vector3, chunk: PlacementChunk): number {
  const padding = chunk.role === 'backdrop' ? 30 : 8;
  const minX = chunk.minX - padding;
  const maxX = chunk.maxX + padding;
  const minZ = chunk.minZ - padding;
  const maxZ = chunk.maxZ + padding;
  const dx = reference.x < minX ? minX - reference.x : reference.x > maxX ? reference.x - maxX : 0;
  const dz = reference.z < minZ ? minZ - reference.z : reference.z > maxZ ? reference.z - maxZ : 0;
  return dx * dx + dz * dz;
}

export function buildGlobalSceneLayer(
  parent: THREE.Group,
  options: {
    readonly renderer: THREE.WebGLRenderer | null;
    readonly graphicsTier: GlobalSceneGraphicsTier;
    readonly seed?: number;
  },
): GlobalSceneLayer {
  const group = new THREE.Group();
  group.name = 'map-global-scenes';
  group.visible = false;
  parent.add(group);

  let tier = options.graphicsTier;
  let builtTier: GlobalSceneGraphicsTier | null = null;
  let status: GlobalSceneLayerDiagnostics['status'] = options.renderer ? 'loading' : 'disabled';
  let disposed = false;
  let requestedBuild = 0;
  let frameCounter = VISIBILITY_UPDATE_INTERVAL_FRAMES - 1;
  let visibilityReference: THREE.Vector3 | null = null;
  let batches: SceneBatch[] = [];
  let chunks: PlacementChunk[] = [];
  let selectedPlacements: readonly GlobalScenePlacement[] = [];
  let visiblePlacements = 0;
  let visiblePlacementsBySource = emptySourceCounts();
  const failedAssets = new Set<string>();
  const templates = new Map<string, Template>();
  const placements = createGlobalScenePlacementPlan(options.seed ?? seedFromHash());
  let buildQueue = Promise.resolve();

  const updateVisibility = (cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void => {
    const reference = focusPosition.lengthSq() > 0 ? focusPosition : cameraPosition;
    visibilityReference ??= new THREE.Vector3();
    visibilityReference.copy(reference);
    visiblePlacements = 0;
    visiblePlacementsBySource = emptySourceCounts();
    for (const chunk of chunks) {
      const distance =
        chunk.role === 'backdrop'
          ? BACKDROP_CULL_DISTANCE
          : builtTier === 'reduced'
            ? REDUCED_NEAR_CULL_DISTANCE
            : BALANCED_NEAR_CULL_DISTANCE;
      const visible =
        group.visible && squaredDistanceToChunk(reference, chunk) <= distance * distance;
      chunk.group.visible = visible;
      if (!visible) {
        continue;
      }
      visiblePlacements += chunk.placements;
      for (const sourceId of Object.keys(chunk.placementsBySource) as GlobalSceneSourceId[]) {
        visiblePlacementsBySource[sourceId] += chunk.placementsBySource[sourceId];
      }
    }
  };

  const rebuild = async (buildId: number): Promise<void> => {
    if (!options.renderer || disposed || buildId !== requestedBuild) {
      return;
    }
    const nextPlacements = placementsForGlobalSceneTier(placements, tier);
    const requestedAssetIds = new Set(nextPlacements.map((placement) => placement.assetId));
    const missingEntries = GLOBAL_SCENE_ASSET_CATALOG.filter(
      (entry) => requestedAssetIds.has(entry.id) && !templates.has(entry.id),
    );
    if (missingEntries.length > 0) {
      const loaded = await loadTemplates(missingEntries, failedAssets);
      if (disposed || buildId !== requestedBuild) {
        disposeTemplates(loaded);
        return;
      }
      for (const [id, template] of loaded) {
        templates.set(id, template);
      }
    }
    if (disposed || buildId !== requestedBuild) {
      return;
    }

    const nextGroup = new THREE.Group();
    nextGroup.name = 'map-global-scenes-content';
    const chunkMap = new Map<string, PlacementChunk>();
    const byChunkAsset = new Map<
      string,
      { readonly chunk: PlacementChunk; readonly placements: GlobalScenePlacement[] }
    >();
    for (const placement of nextPlacements) {
      let chunk = chunkMap.get(chunkKey(placement));
      if (!chunk) {
        chunk = createChunk(nextGroup, placement);
        chunkMap.set(chunk.key, chunk);
      }
      chunk.minX = Math.min(chunk.minX, placement.x);
      chunk.maxX = Math.max(chunk.maxX, placement.x);
      chunk.minZ = Math.min(chunk.minZ, placement.z);
      chunk.maxZ = Math.max(chunk.maxZ, placement.z);
      chunk.placements += 1;
      chunk.placementsBySource[placement.sourceId] += 1;
      const key = `${chunk.key}|${placement.assetId}`;
      const entry = byChunkAsset.get(key);
      if (entry) {
        entry.placements.push(placement);
      } else {
        byChunkAsset.set(key, { chunk, placements: [placement] });
      }
    }

    const nextBatches: SceneBatch[] = [];
    for (const { chunk, placements: assetPlacements } of byChunkAsset.values()) {
      const assetId = assetPlacements[0]?.assetId;
      if (!assetId) {
        continue;
      }
      const template = templates.get(assetId);
      if (!template) {
        continue;
      }
      const matrices = assetPlacements.map(makePlacementMatrix);
      for (const [partIndex, part] of template.parts.entries()) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
        mesh.name = `global-scene-${assetId}-${chunk.key.replaceAll(':', '-')}-${partIndex}`;
        mesh.castShadow = false;
        mesh.receiveShadow = template.entry.role !== 'foliage';
        mesh.frustumCulled = true;
        for (const [index, matrix] of matrices.entries()) {
          mesh.setMatrixAt(index, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        chunk.group.add(mesh);
        nextBatches.push({
          mesh,
          chunk,
          sourceId: template.entry.sourceId,
          trianglesPerInstance: part.triangles,
          instanceCount: matrices.length,
        });
      }
    }

    const previousContent = group.getObjectByName('map-global-scenes-content');
    previousContent?.removeFromParent();
    disposeBatches(batches);
    group.add(nextGroup);
    batches = nextBatches;
    chunks = [...chunkMap.values()];
    selectedPlacements = nextPlacements.filter((placement) => templates.has(placement.assetId));
    builtTier = tier;
    group.visible = batches.length > 0;
    const reference = visibilityReference ?? new THREE.Vector3();
    updateVisibility(reference, reference);
    status = batches.length > 0 ? 'ready' : 'failed';
  };

  const requestRebuild = (): void => {
    if (!options.renderer || disposed) {
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
        console.warn(
          'JWGB global scene layer unavailable; the existing procedural map remains active',
          error,
        );
      });
  };

  if (options.renderer) {
    requestRebuild();
  }

  return {
    group,
    setGraphicsTier(nextTier): void {
      if (tier === nextTier && builtTier === nextTier) {
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
      frameCounter = (frameCounter + 1) % VISIBILITY_UPDATE_INTERVAL_FRAMES;
      if (frameCounter === 0) {
        updateVisibility(cameraPosition, focusPosition);
      }
    },
    diagnostics(): GlobalSceneLayerDiagnostics {
      const placementsBySource = emptySourceCounts();
      for (const placement of selectedPlacements) {
        placementsBySource[placement.sourceId] += 1;
      }
      const visibleBatches = batches.filter(
        (batch) => group.visible && batch.chunk.group.visible && batch.mesh.visible,
      );
      return {
        status,
        loadedAssets: [...templates.values()].map((template) => template.path).sort(),
        failedAssets: [...failedAssets].sort(),
        placements: selectedPlacements.length,
        visiblePlacements,
        placementsBySource,
        visiblePlacementsBySource: { ...visiblePlacementsBySource },
        instancedBatches: batches.length,
        visibleInstancedBatches: visibleBatches.length,
        triangles: visibleBatches.reduce(
          (sum, batch) => sum + batch.trianglesPerInstance * batch.instanceCount,
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
      status = 'disposed';
      group.removeFromParent();
      disposeBatches(batches);
      disposeTemplates(templates);
      batches = [];
      chunks = [];
      selectedPlacements = [];
      group.clear();
    },
  };
}
