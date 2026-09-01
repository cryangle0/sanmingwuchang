import { MAP_BOUNDARY, type MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { appendAssetVersion, webAssetUrl } from '../../runtime/asset-url';
import { applyWindSway, setWindCameraPosition, windTimeUniform } from '../shading/wind';
import { AUTUMN_STORM } from './autumn-storm';
import type { FloraModelLayerDiagnostics } from './flora-models';
import {
  FloraOcclusionController,
  type FloraOcclusionDiagnostics,
  type FloraTreeOccluderPart,
  type FloraTreeOccluderTarget,
  floraTreeOccluderTarget,
} from './flora-occlusion';
import { regionAt } from './map-regions';
import {
  createRandomStream,
  dressingSurfaceMeters,
  isOpenGround,
  sampleGroundLattice,
  sampleOpenGround,
} from './map-sampling';
import { waterSurfaceAt } from './water';

const MM = 1_000;
const SOURCE = 'grassworks' as const;
const TREE_ASSET_PATH = 'models/grassworks/grassworks-trees.glb';
const GRASS_ATLAS_PATH = 'models/grassworks/grass-atlas5.png';
const TREE_VARIANTS = 9;
const TREE_COUNT = 1_800;
const TREE_SEED_SALT = 0x9e3779b9;
const GRASS_SEED_SALT = 0x4f1bbcdc;
export interface GrassworksForestGrove {
  readonly id: string;
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly treeCount: number;
}

export const GRASSWORKS_FOREST_GROVES: readonly GrassworksForestGrove[] = [
  { id: 'northwest-forest', centerX: -300, centerZ: 150, radiusX: 52, radiusZ: 38, treeCount: 220 },
  { id: 'north-forest', centerX: -65, centerZ: 205, radiusX: 52, radiusZ: 38, treeCount: 210 },
  { id: 'east-forest', centerX: 260, centerZ: 235, radiusX: 54, radiusZ: 38, treeCount: 200 },
  { id: 'west-forest', centerX: -300, centerZ: -115, radiusX: 50, radiusZ: 38, treeCount: 220 },
  {
    id: 'southwest-forest',
    centerX: -190,
    centerZ: -210,
    radiusX: 52,
    radiusZ: 38,
    treeCount: 230,
  },
  { id: 'south-forest', centerX: 70, centerZ: -225, radiusX: 52, radiusZ: 36, treeCount: 220 },
  { id: 'southeast-forest', centerX: 280, centerZ: -80, radiusX: 50, radiusZ: 38, treeCount: 210 },
] as const;

const FOREST_TREE_COUNT = GRASSWORKS_FOREST_GROVES.reduce(
  (sum, grove) => sum + grove.treeCount,
  0,
);
const FOREST_ROAD_VERGE_MM = 2_500;
const FOREST_MIN_DISTANCE_METERS = 2.55;
const GRASS_SPACING_METERS = 1.25;
const GRASS_JITTER = 0.55;
const GRASS_ROAD_VERGE_MM = -1;
const GRASS_WIDTH_MIN = 1.36;
const GRASS_WIDTH_MAX = 1.92;
const GRASS_HEIGHT_MIN = 0.92;
const GRASS_HEIGHT_MAX = 1.58;
const GRASS_ATLAS_SIZE = 1_000;
// Texture.flipY maps UV y=0 to the source image's lower half. Rects are inset
// from each 500px cell so pngtree corner marks stay out of the sampled tuft.
const GRASS_ATLAS_RECTS = [
  { x: 72, y: 8, width: 356, height: 484 },
  { x: 572, y: 8, width: 356, height: 484 },
  { x: 72, y: 508, width: 356, height: 484 },
  { x: 572, y: 508, width: 356, height: 484 },
] as const;
const GRASS_LOGICAL_TILE_SIZE = 25;
const GRASS_RENDER_BATCH_SIZE = GRASS_LOGICAL_TILE_SIZE * 2;
const TREE_CHUNK_SIZE = 56;
const GRASS_VISIBILITY_UPDATE_INTERVAL = 3;
const TREE_VISIBILITY_UPDATE_INTERVAL = 3;
const INFLUENCE_UPDATE_INTERVAL = 2;
const INFLUENCE_RESOLUTION = 256;
const INFLUENCE_RADIUS_METERS = 5.8;
const INFLUENCE_RECOVERY_PER_UPDATE = 7;
const BALANCED_GRASS_DISTANCE = 180;
const REDUCED_GRASS_DISTANCE = 108;
const BALANCED_TREE_HIGH_DISTANCE = 150;
const BALANCED_TREE_LOW_DISTANCE = 260;
const REDUCED_TREE_LOW_DISTANCE = 208;
const TREE_HIGH_HYSTERESIS = 12;
const TREE_LOW_HYSTERESIS = 16;
const REDUCED_TREE_DENSITY = 0.66;
const TREE_TARGET_HEIGHT_MIN = 7.2;
const TREE_TARGET_HEIGHT_MAX = 10.4;
const GRASS_VERTICES_PER_DETAIL = 6;
const GRASS_TRIANGLES_PER_DETAIL = 2;

export type GrassworksGraphicsTier = 'balanced' | 'reduced';
export type GrassworksGrassLod = 'high' | 'medium' | 'low' | 'veryLow';

interface GrassworksGrassLodDefinition {
  readonly id: GrassworksGrassLod;
  readonly detail: number;
  readonly density: number;
  readonly distanceRatio: number;
}

const GRASS_LODS: readonly GrassworksGrassLodDefinition[] = [
  { id: 'high', detail: 5, density: 4, distanceRatio: 0.3 },
  { id: 'medium', detail: 2, density: 3, distanceRatio: 0.7 },
  { id: 'low', detail: 1, density: 2, distanceRatio: 0.9 },
  { id: 'veryLow', detail: 1, density: 1, distanceRatio: 0.9 },
] as const;
const GRASS_MAX_DENSITY = Math.max(...GRASS_LODS.map((definition) => definition.density));

/**
 * Literal source settings plus the WebGL compatibility choices used here.
 *
 * The source demo is Three.js r185 WebGPU/TSL. This project remains on the
 * existing r165 WebGL renderer, so the same tile/LOD/atlas/influence design is
 * implemented with InstancedBufferGeometry and onBeforeCompile.
 */
export const GRASSWORKS_SOURCE_PROFILE = {
  renderer: 'three.js r185 WebGPU/TSL adapted to three.js r165 WebGL',
  tileSizeMeters: GRASS_LOGICAL_TILE_SIZE,
  renderBatchSizeMeters: GRASS_RENDER_BATCH_SIZE,
  maxDistanceMeters: 150,
  atlasColumns: 2,
  atlasRows: 2,
  influenceResolution: 256,
  sourceLods: [
    { id: 'high', detail: 5, density: 4, distanceRatio: 0.3 },
    { id: 'medium', detail: 2, density: 3, distanceRatio: 0.7 },
    { id: 'low', detail: 1, density: 2, distanceRatio: 0.9 },
    { id: 'veryLow', detail: 1, density: 1, distanceRatio: 0.9 },
  ],
  runtimeSpacingMeters: GRASS_SPACING_METERS,
  runtimeMaxDistanceMeters: BALANCED_GRASS_DISTANCE,
  runtimeReducedMaxDistanceMeters: REDUCED_GRASS_DISTANCE,
  runtimeJitter: GRASS_JITTER,
  runtimeRoadVergeMm: GRASS_ROAD_VERGE_MM,
  runtimeClumpWidthMeters: {
    min: GRASS_WIDTH_MIN,
    max: GRASS_WIDTH_MAX,
  },
  runtimeTreeCount: TREE_COUNT,
  runtimeTreePlacement: 'whole-map clustered woodland',
  runtimeForestTreeCount: FOREST_TREE_COUNT,
  runtimeForestGroves: GRASSWORKS_FOREST_GROVES.length,
  runtimeTreeHighDistanceMeters: BALANCED_TREE_HIGH_DISTANCE,
  runtimeTreeLowDistanceMeters: BALANCED_TREE_LOW_DISTANCE,
  runtimeReducedTreeLowDistanceMeters: REDUCED_TREE_LOW_DISTANCE,
  runtimeTreeHighHysteresisMeters: TREE_HIGH_HYSTERESIS,
  runtimeTreeLowHysteresisMeters: TREE_LOW_HYSTERESIS,
  runtimeLods: GRASS_LODS,
  leafSprites: {
    highAlphaTest: 0.5,
    lowAlphaTest: 0.35,
    highEmissiveIntensity: AUTUMN_STORM.leafEmissiveHigh,
    lowEmissiveIntensity: AUTUMN_STORM.leafEmissiveLow,
    highWind: AUTUMN_STORM.windLeafHigh,
    lowWind: AUTUMN_STORM.windLeafLow,
  },
} as const;

export const GRASSWORKS_VEGETATION_ASSET_PATHS = [TREE_ASSET_PATH, GRASS_ATLAS_PATH] as const;

export interface GrassworksVegetationDiagnostics extends FloraModelLayerDiagnostics {
  readonly source: typeof SOURCE;
  readonly tileSizeMeters: number;
  readonly renderBatchSizeMeters: number;
  readonly maxGrassDistanceMeters: number;
  readonly influenceResolution: number;
  readonly grassInstances: number;
  readonly visibleGrassInstances: number;
  readonly visibleGrassInstancesByLod: Readonly<Record<GrassworksGrassLod, number>>;
  readonly highTreeInstances: number;
  readonly lowTreeInstances: number;
  readonly visibleHighTreeInstances: number;
  readonly visibleLowTreeInstances: number;
  readonly grassChunks: number;
  readonly grassTiles: number;
  readonly grassRenderBatches: number;
  readonly visibleGrassChunks: number;
  readonly treeChunks: number;
  readonly visibleTreeChunks: number;
  readonly legacyFloraInstances: 0;
  readonly legacyScatterInstances: 0;
  readonly legacyGlobalSceneVegetationInstances: 0;
}

export interface GrassworksVegetationLayer {
  readonly group: THREE.Group;
  setGraphicsTier(tier: GrassworksGraphicsTier): void;
  update(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void;
  diagnostics(): GrassworksVegetationDiagnostics;
  occlusionDiagnostics(): FloraOcclusionDiagnostics;
  dispose(): void;
}

interface GrassPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly width: number;
  readonly height: number;
  readonly phase: number;
  readonly atlasRect: (typeof GRASS_ATLAS_RECTS)[number];
  readonly colour: THREE.Color;
  readonly order: number;
}

interface GrassChunk {
  readonly key: string;
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  readonly fullCount: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  lod: GrassworksGrassLod | 'hidden';
  visibleCount: number;
  detail: number;
}

interface GrassBuild {
  readonly chunks: readonly GrassChunk[];
  readonly logicalTileCount: number;
}

interface TreePlacement {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly height: number;
  readonly variant: number;
  readonly order: number;
}

interface TreeTemplatePart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly isLeaf: boolean;
  readonly triangles: number;
}

interface TreeTemplate {
  readonly variant: number;
  readonly lod: 'high' | 'low';
  readonly parts: readonly TreeTemplatePart[];
}

interface TreeBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly trianglesPerInstance: number;
  readonly instances: number;
  readonly lod: 'high' | 'low';
  readonly chunk: TreeChunk;
}

interface TreeChunk {
  readonly key: string;
  readonly group: THREE.Group;
  readonly high: THREE.Group;
  readonly low: THREE.Group;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly instances: number;
  lod: 'hidden' | 'high' | 'low';
}

interface TreeBuild {
  readonly root: THREE.Group;
  readonly chunks: readonly TreeChunk[];
  readonly batches: readonly TreeBatch[];
  readonly targets: readonly FloraTreeOccluderTarget[];
  readonly instances: number;
}

interface GrassInfluenceMap {
  readonly texture: THREE.DataTexture;
  update(focusPosition: THREE.Vector3): void;
  dispose(): void;
}

const MAP_BOUNDS = MAP_BOUNDARY.reduce(
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

const GRASS_BOUNDS_UNIFORM = {
  value: new THREE.Vector4(
    MAP_BOUNDS.minX,
    MAP_BOUNDS.minZ,
    1 / Math.max(1, MAP_BOUNDS.maxX - MAP_BOUNDS.minX),
    1 / Math.max(1, MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ),
  ),
};
const tempMatrix = new THREE.Matrix4();
const tempEuler = new THREE.Euler();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const grassTintTarget = new THREE.Color(0x756f3e);

function assetUrl(path: string): string {
  return appendAssetVersion(webAssetUrl(path));
}

function emptyGrassLodCounts(): Record<GrassworksGrassLod, number> {
  return {
    high: 0,
    medium: 0,
    low: 0,
    veryLow: 0,
  };
}

function hashAt(x: number, z: number, salt: number): number {
  let value = (Math.round(x * MM) ^ Math.imul(Math.round(z * MM), 0x45d9f3b) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function isWaterPoint(point: MapPointMm): boolean {
  return waterSurfaceAt(point.x / MM, point.z / MM) !== null;
}

export function sampleGrassworksGrassPoints(seed: number): readonly MapPointMm[] {
  return sampleGroundLattice(GRASS_SPACING_METERS, createRandomStream(seed ^ GRASS_SEED_SALT), {
    roadVergeMm: GRASS_ROAD_VERGE_MM,
    jitter: GRASS_JITTER,
    reject: isWaterPoint,
  });
}

export function sampleGrassworksTreePoints(seed: number): readonly MapPointMm[] {
  const nextRandom = createRandomStream(seed ^ TREE_SEED_SALT);
  const forest = sampleForestGroves(nextRandom);
  const sparse = sampleClusteredOpenGround(
    TREE_COUNT - forest.length,
    72,
    nextRandom,
    5_000,
    2_800,
    2,
    10,
    2,
    6,
    3.2,
    forest,
  );
  return [...forest, ...sparse];
}

function sampleForestGroves(nextRandom: () => number): MapPointMm[] {
  const points: MapPointMm[] = [];
  for (const grove of GRASSWORKS_FOREST_GROVES) {
    let added = 0;
    for (
      let attempt = 0;
      attempt < grove.treeCount * 180 && added < grove.treeCount;
      attempt += 1
    ) {
      const angle = nextRandom() * Math.PI * 2;
      const radius = Math.sqrt(nextRandom());
      const candidate: MapPointMm = {
        x: Math.round((grove.centerX + Math.cos(angle) * radius * grove.radiusX) * MM),
        z: Math.round((grove.centerZ + Math.sin(angle) * radius * grove.radiusZ) * MM),
      };
      if (
        !isOpenGround(candidate, { roadVergeMm: FOREST_ROAD_VERGE_MM }) ||
        isWaterPoint(candidate) ||
        !farEnoughFrom(points, candidate, FOREST_MIN_DISTANCE_METERS)
      ) {
        continue;
      }
      points.push(candidate);
      added += 1;
    }
  }
  return points;
}

function sampleClusteredOpenGround(
  count: number,
  anchorCount: number,
  nextRandom: () => number,
  anchorRoadVergeMm: number,
  pointRoadVergeMm: number,
  minRadiusMeters: number,
  maxRadiusMeters: number,
  minClusterCount: number,
  maxClusterCount: number,
  minDistanceMeters: number,
  occupied: readonly MapPointMm[] = [],
): MapPointMm[] {
  const anchors = sampleOpenGround(anchorCount, anchorCount * 18, nextRandom, {
    roadVergeMm: anchorRoadVergeMm,
  }).filter((point) => !isWaterPoint(point));
  const points: MapPointMm[] = [];
  for (const anchor of anchors) {
    const clusterCount =
      minClusterCount + Math.floor(nextRandom() * (maxClusterCount - minClusterCount + 1));
    let added = 0;
    for (
      let attempt = 0;
      attempt < clusterCount * 10 && added < clusterCount && points.length < count;
      attempt += 1
    ) {
      const angle = nextRandom() * Math.PI * 2;
      const radius =
        minRadiusMeters + Math.sqrt(nextRandom()) * (maxRadiusMeters - minRadiusMeters);
      const candidate: MapPointMm = {
        x: Math.round(anchor.x + Math.cos(angle) * radius * MM),
        z: Math.round(anchor.z + Math.sin(angle) * radius * MM),
      };
      if (
        !isOpenGround(candidate, { roadVergeMm: pointRoadVergeMm }) ||
        isWaterPoint(candidate) ||
        !farEnoughFrom(occupied, candidate, minDistanceMeters) ||
        !farEnoughFrom(points, candidate, minDistanceMeters)
      ) {
        continue;
      }
      points.push(candidate);
      added += 1;
    }
    if (points.length >= count) {
      return points;
    }
  }

  for (const point of sampleOpenGround(
    (count - points.length) * 6,
    Math.max((count - points.length) * 60, 6_000),
    nextRandom,
    { roadVergeMm: pointRoadVergeMm },
  )) {
    if (points.length >= count) {
      break;
    }
    if (
      isWaterPoint(point) ||
      !farEnoughFrom(occupied, point, minDistanceMeters) ||
      !farEnoughFrom(points, point, minDistanceMeters)
    ) {
      continue;
    }
    points.push(point);
  }
  return points;
}

function farEnoughFrom(
  points: readonly MapPointMm[],
  candidate: MapPointMm,
  minDistanceMeters: number,
): boolean {
  const minimumDistanceSquared = (minDistanceMeters * MM) ** 2;
  return points.every((point) => {
    const dx = candidate.x - point.x;
    const dz = candidate.z - point.z;
    return dx * dx + dz * dz >= minimumDistanceSquared;
  });
}

function createGrassInfluenceMap(): GrassInfluenceMap {
  const data = new Uint8Array(INFLUENCE_RESOLUTION * INFLUENCE_RESOLUTION * 4);
  const activePixels: number[] = [];
  const activeFlags = new Uint8Array(INFLUENCE_RESOLUTION * INFLUENCE_RESOLUTION);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 128;
    data[index + 1] = 128;
    data[index + 2] = 0;
    data[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(
    data,
    INFLUENCE_RESOLUTION,
    INFLUENCE_RESOLUTION,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'grassworks-influence-map';
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;

  let frame = INFLUENCE_UPDATE_INTERVAL - 1;
  let previousFocus: THREE.Vector3 | null = null;

  const paint = (focus: THREE.Vector3): void => {
    const width = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
    const height = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
    const centreX = Math.round(
      ((focus.x - MAP_BOUNDS.minX) / Math.max(1, width)) * (INFLUENCE_RESOLUTION - 1),
    );
    const centreY = Math.round(
      ((focus.z - MAP_BOUNDS.minZ) / Math.max(1, height)) * (INFLUENCE_RESOLUTION - 1),
    );
    const radiusX = Math.max(
      2,
      Math.ceil((INFLUENCE_RADIUS_METERS / Math.max(1, width)) * INFLUENCE_RESOLUTION),
    );
    const radiusY = Math.max(
      2,
      Math.ceil((INFLUENCE_RADIUS_METERS / Math.max(1, height)) * INFLUENCE_RESOLUTION),
    );
    const movementX = previousFocus ? focus.x - previousFocus.x : 0;
    const movementZ = previousFocus ? focus.z - previousFocus.z : 0;
    const movementLength = Math.hypot(movementX, movementZ);

    for (let y = centreY - radiusY; y <= centreY + radiusY; y += 1) {
      if (y < 0 || y >= INFLUENCE_RESOLUTION) {
        continue;
      }
      for (let x = centreX - radiusX; x <= centreX + radiusX; x += 1) {
        if (x < 0 || x >= INFLUENCE_RESOLUTION) {
          continue;
        }
        const normalizedX = (x - centreX) / radiusX;
        const normalizedY = (y - centreY) / radiusY;
        const distance = Math.hypot(normalizedX, normalizedY);
        if (distance > 1) {
          continue;
        }
        const directionLength = Math.hypot(normalizedX, normalizedY);
        const directionX =
          directionLength > 0.08
            ? normalizedX / directionLength
            : movementLength > 0.001
              ? movementX / movementLength
              : 1;
        const directionZ =
          directionLength > 0.08
            ? normalizedY / directionLength
            : movementLength > 0.001
              ? movementZ / movementLength
              : 0;
        const pressure = Math.round((1 - distance) ** 1.4 * 255);
        const index = (y * INFLUENCE_RESOLUTION + x) * 4;
        if (pressure < (data[index + 2] ?? 0)) {
          continue;
        }
        const pixelIndex = y * INFLUENCE_RESOLUTION + x;
        if (activeFlags[pixelIndex] === 0) {
          activeFlags[pixelIndex] = 1;
          activePixels.push(pixelIndex);
        }
        data[index] = Math.round((directionX * 0.5 + 0.5) * 255);
        data[index + 1] = Math.round((directionZ * 0.5 + 0.5) * 255);
        data[index + 2] = pressure;
      }
    }
    previousFocus ??= new THREE.Vector3();
    previousFocus.copy(focus);
  };

  return {
    texture,
    update(focusPosition): void {
      frame = (frame + 1) % INFLUENCE_UPDATE_INTERVAL;
      if (frame !== 0) {
        return;
      }
      let changed = false;
      for (let activeIndex = activePixels.length - 1; activeIndex >= 0; activeIndex -= 1) {
        const pixelIndex = activePixels[activeIndex] as number;
        const pressureIndex = pixelIndex * 4 + 2;
        const pressure = data[pressureIndex] ?? 0;
        if (pressure === 0) {
          activeFlags[pixelIndex] = 0;
          activePixels.splice(activeIndex, 1);
          continue;
        }
        const nextPressure = Math.max(0, pressure - INFLUENCE_RECOVERY_PER_UPDATE);
        data[pressureIndex] = nextPressure;
        if (nextPressure === 0) {
          activeFlags[pixelIndex] = 0;
          activePixels.splice(activeIndex, 1);
        }
        changed = true;
      }
      if (focusPosition.lengthSq() > 0) {
        paint(focusPosition);
        changed = true;
      }
      if (changed) {
        texture.needsUpdate = true;
      }
    },
    dispose(): void {
      texture.dispose();
      previousFocus = null;
    },
  };
}

function createGrassGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const detail = GRASS_LODS[0]?.detail ?? 5;
  for (let plane = 0; plane < detail; plane += 1) {
    const angle = (plane / detail) * Math.PI;
    const sideX = Math.cos(angle);
    const sideZ = Math.sin(angle);
    const normalX = -Math.sin(angle);
    const normalZ = Math.cos(angle);
    const lean = (plane % 2 === 0 ? 1 : -1) * 0.055;
    const bottomLeft = [-sideX * 0.5, 0, -sideZ * 0.5] as const;
    const bottomRight = [sideX * 0.5, 0, sideZ * 0.5] as const;
    const topRight = [sideX * 0.48 + normalX * lean, 1, sideZ * 0.48 + normalZ * lean] as const;
    const topLeft = [-sideX * 0.48 + normalX * lean, 1, -sideZ * 0.48 + normalZ * lean] as const;
    positions.push(
      ...bottomLeft,
      ...bottomRight,
      ...topRight,
      ...bottomLeft,
      ...topRight,
      ...topLeft,
    );
    uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    for (let vertex = 0; vertex < GRASS_VERTICES_PER_DETAIL; vertex += 1) {
      normals.push(normalX * 0.46, 0.78, normalZ * 0.46);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function configureGrassAtlas(texture: THREE.Texture, renderer: THREE.WebGLRenderer): void {
  texture.name = 'grassworks-grass-atlas';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
}

function createGrassMaterial(
  atlas: THREE.Texture,
  influence: THREE.Texture,
  focusUniform: { value: THREE.Vector3 },
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: atlas,
    roughness: 0.96,
    metalness: 0,
    emissive: 0x080604,
    emissiveIntensity: 0.02,
    alphaTest: 0.22,
    side: THREE.DoubleSide,
  });
  material.alphaToCoverage = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassworksTime = windTimeUniform();
    shader.uniforms.uGrassworksFocus = focusUniform;
    shader.uniforms.uGrassworksInfluence = { value: influence };
    shader.uniforms.uGrassworksBounds = GRASS_BOUNDS_UNIFORM;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'attribute vec3 grassworksOffset;',
          'attribute vec4 grassworksParams;',
          'attribute vec3 grassworksTint;',
          'attribute vec4 grassworksAtlasRect;',
          'uniform float uGrassworksTime;',
          'uniform vec3 uGrassworksFocus;',
          'uniform sampler2D uGrassworksInfluence;',
          'uniform vec4 uGrassworksBounds;',
          'varying vec3 vGrassworksTint;',
        ].join('\n'),
      )
      .replace(
        '#include <uv_vertex>',
        [
          '#include <uv_vertex>',
          '#ifdef USE_MAP',
          'vMapUv = grassworksAtlasRect.xy + vMapUv * grassworksAtlasRect.zw;',
          '#endif',
        ].join('\n'),
      )
      .replace(
        '#include <beginnormal_vertex>',
        [
          '#include <beginnormal_vertex>',
          'float grassworksNormalCos = cos(grassworksParams.x);',
          'float grassworksNormalSin = sin(grassworksParams.x);',
          'objectNormal.xz = mat2(grassworksNormalCos, -grassworksNormalSin, grassworksNormalSin, grassworksNormalCos) * objectNormal.xz;',
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'float grassworksYaw = grassworksParams.x;',
          'float grassworksWidth = grassworksParams.y;',
          'float grassworksHeight = grassworksParams.z;',
          'float grassworksPhase = grassworksParams.w;',
          'float grassworksWeight = smoothstep(0.04, 0.96, transformed.y);',
          'float grassworksCos = cos(grassworksYaw);',
          'float grassworksSin = sin(grassworksYaw);',
          'transformed.xz *= grassworksWidth;',
          'transformed.y *= grassworksHeight;',
          'transformed.xz = mat2(grassworksCos, -grassworksSin, grassworksSin, grassworksCos) * transformed.xz;',
          'vec2 grassworksWindSample = grassworksOffset.xz + transformed.xz * 0.35;',
          'float grassworksWindPhase = uGrassworksTime * 3.0 + grassworksPhase * 0.08;',
          'float grassworksBroad = sin(grassworksWindSample.x * 0.18 + grassworksWindSample.y * 0.14 + grassworksWindPhase);',
          'float grassworksCross = cos(grassworksWindSample.x * 0.08 + grassworksWindSample.y * 0.22 + grassworksWindPhase * 0.72);',
          'float grassworksDetail = sin(grassworksWindSample.x * 0.55 + grassworksWindSample.y * 0.42 + grassworksWindPhase * 0.35);',
          'float grassworksMicro = sin(grassworksWindSample.x * 0.50 - grassworksWindSample.y * 0.31 + grassworksWindPhase * 0.50);',
          'vec2 grassworksWindDirection = normalize(vec2(0.93, 0.36));',
          'vec2 grassworksWindSide = vec2(-grassworksWindDirection.y, grassworksWindDirection.x);',
          'float grassworksGust = 0.70 + grassworksBroad * 0.20 + grassworksDetail * 0.10;',
          'float grassworksCrossAmount = grassworksCross * 0.06 + grassworksMicro * 0.035;',
          'vec2 grassworksWind = grassworksWindDirection * grassworksGust + grassworksWindSide * grassworksCrossAmount;',
          'vec2 grassworksWorld = grassworksOffset.xz + transformed.xz;',
          'vec2 grassworksAway = grassworksWorld - uGrassworksFocus.xz;',
          'float grassworksFocusDistance = length(grassworksAway);',
          'vec2 grassworksImmediateDirection = grassworksFocusDistance > 0.001 ? grassworksAway / grassworksFocusDistance : vec2(1.0, 0.0);',
          'float grassworksImmediate = pow(1.0 - smoothstep(0.55, 3.1, grassworksFocusDistance), 1.7);',
          'vec2 grassworksInfluenceUv = (grassworksWorld - uGrassworksBounds.xy) * uGrassworksBounds.zw;',
          'float grassworksInfluenceInside = step(0.0, grassworksInfluenceUv.x) * step(grassworksInfluenceUv.x, 1.0) * step(0.0, grassworksInfluenceUv.y) * step(grassworksInfluenceUv.y, 1.0);',
          'vec3 grassworksInfluence = texture2D(uGrassworksInfluence, clamp(grassworksInfluenceUv, vec2(0.0), vec2(1.0))).rgb;',
          'vec2 grassworksPersistentDirection = grassworksInfluence.rg * 2.0 - 1.0;',
          'float grassworksPersistent = grassworksInfluence.b * grassworksInfluenceInside;',
          'vec2 grassworksCombinedDirection = grassworksImmediateDirection * grassworksImmediate + grassworksPersistentDirection * grassworksPersistent;',
          'float grassworksCombinedLength = length(grassworksCombinedDirection);',
          'vec2 grassworksPushDirection = grassworksCombinedLength > 0.001 ? grassworksCombinedDirection / grassworksCombinedLength : vec2(1.0, 0.0);',
          'float grassworksInteraction = max(grassworksImmediate, grassworksPersistent);',
          'transformed.xz += grassworksWind * grassworksWeight * 0.12;',
          'transformed.xz += grassworksPushDirection * grassworksInteraction * grassworksWeight * 0.82;',
          'transformed.y *= 1.0 - grassworksInteraction * grassworksWeight * 0.34;',
          'transformed += grassworksOffset;',
          'vGrassworksTint = grassworksTint;',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassworksTint;')
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'diffuseColor.rgb *= vGrassworksTint;',
          'diffuseColor.rgb = mix(diffuseColor.rgb, sqrt(max(diffuseColor.rgb, vec3(0.0))), 0.035);',
        ].join('\n'),
      )
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          'normal.y = abs(normal.y);',
          'normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), 0.24));',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'jwgb-grassworks-grass-atlas-influence-v7-storm';
  return material;
}

function chunkCoordinate(value: number, size: number): number {
  return Math.floor(value / size);
}

function squaredDistanceToBounds(
  reference: THREE.Vector3,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  padding: number,
): number {
  const dx =
    reference.x < minX - padding
      ? minX - padding - reference.x
      : reference.x > maxX + padding
        ? reference.x - maxX - padding
        : 0;
  const dz =
    reference.z < minZ - padding
      ? minZ - padding - reference.z
      : reference.z > maxZ + padding
        ? reference.z - maxZ - padding
        : 0;
  return dx * dx + dz * dz;
}

function buildGrassChunks(
  parent: THREE.Group,
  seed: number,
  material: THREE.MeshStandardMaterial,
): GrassBuild {
  const pointsByLogicalTile = new Map<string, GrassPoint[]>();
  for (const point of sampleGrassworksGrassPoints(seed)) {
    const x = point.x / MM;
    const z = point.z / MM;
    const key =
      `${chunkCoordinate(x, GRASS_LOGICAL_TILE_SIZE)}:` +
      `${chunkCoordinate(z, GRASS_LOGICAL_TILE_SIZE)}`;
    const region = regionAt(x, z);
    const colour = new THREE.Color(0x9b8a54)
      .lerp(new THREE.Color(region.scatter), 0.18)
      .lerp(grassTintTarget, 0.42)
      .multiplyScalar(1.02 + hashAt(x, z, 7) * 0.08);
    const atlasIndex = Math.min(3, Math.floor(hashAt(x, z, 29) * 4));
    const atlasRect = GRASS_ATLAS_RECTS[atlasIndex] ?? GRASS_ATLAS_RECTS[0];
    const grassPoint: GrassPoint = {
      x,
      y: dressingSurfaceMeters(point) + 0.014,
      z,
      yaw: hashAt(x, z, 11) * Math.PI * 2,
      width: GRASS_WIDTH_MIN + hashAt(x, z, 13) * (GRASS_WIDTH_MAX - GRASS_WIDTH_MIN),
      height: GRASS_HEIGHT_MIN + hashAt(x, z, 17) * (GRASS_HEIGHT_MAX - GRASS_HEIGHT_MIN),
      phase: hashAt(x, z, 19) * Math.PI * 2,
      atlasRect,
      colour,
      order: hashAt(x, z, 23),
    };
    const list = pointsByLogicalTile.get(key);
    if (list) {
      list.push(grassPoint);
    } else {
      pointsByLogicalTile.set(key, [grassPoint]);
    }
  }

  const pointsByRenderBatch = new Map<string, GrassPoint[]>();
  for (const [tileKey, tilePoints] of pointsByLogicalTile) {
    const [tileXValue, tileZValue] = tileKey.split(':');
    const tileX = Number(tileXValue);
    const tileZ = Number(tileZValue);
    const key = `${Math.floor(tileX / 2)}:${Math.floor(tileZ / 2)}`;
    const batch = pointsByRenderBatch.get(key);
    if (batch) {
      batch.push(...tilePoints);
    } else {
      pointsByRenderBatch.set(key, [...tilePoints]);
    }
  }

  const baseGeometry = createGrassGeometry();
  const chunks: GrassChunk[] = [];
  for (const [key, points] of pointsByRenderBatch) {
    points.sort((left, right) => left.order - right.order);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', baseGeometry.getAttribute('position'));
    geometry.setAttribute('normal', baseGeometry.getAttribute('normal'));
    geometry.setAttribute('uv', baseGeometry.getAttribute('uv'));
    const offsets = new Float32Array(points.length * 3);
    const params = new Float32Array(points.length * 4);
    const tints = new Float32Array(points.length * 3);
    const atlasRects = new Float32Array(points.length * 4);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    points.forEach((point, index) => {
      offsets.set([point.x, point.y, point.z], index * 3);
      params.set([point.yaw, point.width, point.height, point.phase], index * 4);
      tints.set(point.colour.toArray(), index * 3);
      atlasRects.set(
        [
          point.atlasRect.x / GRASS_ATLAS_SIZE,
          point.atlasRect.y / GRASS_ATLAS_SIZE,
          point.atlasRect.width / GRASS_ATLAS_SIZE,
          point.atlasRect.height / GRASS_ATLAS_SIZE,
        ],
        index * 4,
      );
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y + point.height);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    });
    geometry.setAttribute('grassworksOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute('grassworksParams', new THREE.InstancedBufferAttribute(params, 4));
    geometry.setAttribute('grassworksTint', new THREE.InstancedBufferAttribute(tints, 3));
    geometry.setAttribute('grassworksAtlasRect', new THREE.InstancedBufferAttribute(atlasRects, 4));
    geometry.instanceCount = points.length;
    geometry.setDrawRange(0, (GRASS_LODS[0]?.detail ?? 5) * GRASS_VERTICES_PER_DETAIL);
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(minX - 1.4, minY, minZ - 1.4),
      new THREE.Vector3(maxX + 1.4, maxY + 0.5, maxZ + 1.4),
    );
    geometry.boundingSphere = new THREE.Sphere();
    geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `grassworks-grass-batch-${key.replace(':', '-')}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.visible = false;
    parent.add(mesh);
    chunks.push({
      key,
      mesh,
      fullCount: points.length,
      minX,
      maxX,
      minZ,
      maxZ,
      lod: 'hidden',
      visibleCount: 0,
      detail: 0,
    });
  }
  baseGeometry.dispose();
  return {
    chunks,
    logicalTileCount: pointsByLogicalTile.size,
  };
}

function grassLodForDistance(
  distanceSquared: number,
  tier: GrassworksGraphicsTier,
): GrassworksGrassLodDefinition | null {
  const maxDistance = tier === 'balanced' ? BALANCED_GRASS_DISTANCE : REDUCED_GRASS_DISTANCE;
  const distance = Math.sqrt(distanceSquared);
  if (distance > maxDistance) {
    return null;
  }
  const ratio = distance / maxDistance;
  return (
    GRASS_LODS.find((definition) => ratio <= definition.distanceRatio) ??
    GRASS_LODS[GRASS_LODS.length - 1] ??
    null
  );
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

function prepareTreeMaterial(
  source: THREE.Material,
  lod: 'high' | 'low',
  isLeaf: boolean,
): THREE.Material {
  const material = source.clone();
  material.name = `grassworks-${lod}-${source.name || 'material'}`;
  if (isLeaf) {
    material.transparent = false;
    material.alphaTest =
      lod === 'low'
        ? GRASSWORKS_SOURCE_PROFILE.leafSprites.lowAlphaTest
        : GRASSWORKS_SOURCE_PROFILE.leafSprites.highAlphaTest;
    material.alphaToCoverage = true;
    // Source foliage is alpha-masked and writes depth. This keeps near trees
    // from being overwritten by farther instances in the same billboard draw.
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
  } else {
    material.side = THREE.FrontSide;
  }
  applyWindSway(
    material,
    isLeaf
      ? lod === 'high'
        ? GRASSWORKS_SOURCE_PROFILE.leafSprites.highWind
        : GRASSWORKS_SOURCE_PROFILE.leafSprites.lowWind
      : AUTUMN_STORM.windTrunk,
    { billboard: lod === 'low' },
  );
  if (material instanceof THREE.MeshStandardMaterial) {
    material.roughness = Math.max(material.roughness, isLeaf ? 0.72 : 0.88);
    material.metalness = Math.min(material.metalness, 0.03);
    if (!isLeaf) {
      material.color.multiplyScalar(lod === 'low' ? 0.62 : 0.72);
    }
    if (isLeaf) {
      // Autumn colour is supplied per instance below. Applying the same tint
      // here as well squared the colour and made the canopy nearly black.
      material.emissiveMap = material.map;
      material.emissive.setRGB(
        AUTUMN_STORM.leafEmissive.r,
        AUTUMN_STORM.leafEmissive.g,
        AUTUMN_STORM.leafEmissive.b,
      );
      material.emissiveIntensity =
        lod === 'high'
          ? GRASSWORKS_SOURCE_PROFILE.leafSprites.highEmissiveIntensity
          : GRASSWORKS_SOURCE_PROFILE.leafSprites.lowEmissiveIntensity;
    }
  }
  material.needsUpdate = true;
  return material;
}

function extractTreeTemplates(scene: THREE.Group): Map<string, TreeTemplate> {
  scene.updateMatrixWorld(true);
  const templates = new Map<string, TreeTemplate>();
  for (let variant = 1; variant <= TREE_VARIANTS; variant += 1) {
    for (const lod of ['high', 'low'] as const) {
      const root = scene.getObjectByName(`grassworks-tree-${variant}-${lod}`);
      if (!root) {
        throw new Error(`Grassworks tree template ${variant}/${lod} is missing`);
      }
      const parts: TreeTemplatePart[] = [];
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) {
          return;
        }
        const sourceMaterials = Array.isArray(object.material)
          ? object.material
          : [object.material];
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
          const sourceMaterial = sourceMaterials[group.materialIndex ?? 0] ?? sourceMaterials[0];
          if (!sourceMaterial || group.count <= 0) {
            continue;
          }
          const geometry = baked.clone();
          geometry.clearGroups();
          geometry.setDrawRange(group.start, group.count);
          const isLeaf =
            lod === 'low' ||
            sourceMaterial.transparent ||
            sourceMaterial.alphaTest > 0 ||
            /leaf|leaves|billboard/i.test(`${object.name} ${sourceMaterial.name}`);
          parts.push({
            geometry,
            material: prepareTreeMaterial(sourceMaterial, lod, isLeaf),
            isLeaf,
            triangles: Math.floor(group.count / 3),
          });
        }
        baked.dispose();
      });
      if (parts.length === 0) {
        throw new Error(`Grassworks tree template ${variant}/${lod} has no renderable meshes`);
      }
      templates.set(`${variant}:${lod}`, { variant, lod, parts });
    }
  }
  return templates;
}

function treeVariantForChunk(x: number, z: number): number {
  const chunkX = chunkCoordinate(x, TREE_CHUNK_SIZE);
  const chunkZ = chunkCoordinate(z, TREE_CHUNK_SIZE);
  return (
    1 +
    Math.min(
      TREE_VARIANTS - 1,
      Math.floor(hashAt(chunkX * TREE_CHUNK_SIZE, chunkZ * TREE_CHUNK_SIZE, 37) * TREE_VARIANTS),
    )
  );
}

function createTreePlacements(
  seed: number,
  tier: GrassworksGraphicsTier,
): readonly TreePlacement[] {
  return sampleGrassworksTreePoints(seed)
    .map((point, index): TreePlacement => {
      const x = point.x / MM;
      const z = point.z / MM;
      const scaleNoise = hashAt(x, z, 31);
      return {
        id: `grassworks-tree-${index.toString().padStart(4, '0')}`,
        x,
        z,
        yaw: hashAt(x, z, 29) * Math.PI * 2,
        height:
          TREE_TARGET_HEIGHT_MIN + scaleNoise * (TREE_TARGET_HEIGHT_MAX - TREE_TARGET_HEIGHT_MIN),
        variant: treeVariantForChunk(x, z),
        order: hashAt(x, z, 41),
      };
    })
    .filter((placement) => tier === 'balanced' || placement.order < REDUCED_TREE_DENSITY);
}

function composeTreeMatrix(placement: TreePlacement): THREE.Matrix4 {
  tempEuler.set(0, placement.yaw, 0);
  tempQuaternion.setFromEuler(tempEuler);
  tempScale.setScalar(placement.height);
  tempPosition.set(
    placement.x,
    dressingSurfaceMeters({
      x: Math.round(placement.x * MM),
      z: Math.round(placement.z * MM),
    }),
    placement.z,
  );
  tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
  return tempMatrix.clone();
}

function buildTreeContent(
  templates: ReadonlyMap<string, TreeTemplate>,
  seed: number,
  tier: GrassworksGraphicsTier,
): TreeBuild {
  const root = new THREE.Group();
  root.name = 'grassworks-tree-content';
  const placements = createTreePlacements(seed, tier);
  const placementsByChunk = new Map<string, TreePlacement[]>();
  for (const placement of placements) {
    const key =
      `${chunkCoordinate(placement.x, TREE_CHUNK_SIZE)}:` +
      `${chunkCoordinate(placement.z, TREE_CHUNK_SIZE)}`;
    const list = placementsByChunk.get(key);
    if (list) {
      list.push(placement);
    } else {
      placementsByChunk.set(key, [placement]);
    }
  }

  const chunks: TreeChunk[] = [];
  const batches: TreeBatch[] = [];
  const targetParts = new Map<string, FloraTreeOccluderPart[]>();
  let instances = 0;
  for (const [key, chunkPlacements] of placementsByChunk) {
    const chunkGroup = new THREE.Group();
    chunkGroup.name = `grassworks-tree-chunk-${key.replace(':', '-')}`;
    chunkGroup.visible = false;
    const high = new THREE.Group();
    high.name = 'grassworks-tree-high';
    high.visible = false;
    const low = new THREE.Group();
    low.name = 'grassworks-tree-low';
    low.visible = false;
    chunkGroup.add(high, low);
    root.add(chunkGroup);
    const minX = Math.min(...chunkPlacements.map((placement) => placement.x));
    const maxX = Math.max(...chunkPlacements.map((placement) => placement.x));
    const minZ = Math.min(...chunkPlacements.map((placement) => placement.z));
    const maxZ = Math.max(...chunkPlacements.map((placement) => placement.z));
    const chunk: TreeChunk = {
      key,
      group: chunkGroup,
      high,
      low,
      minX,
      maxX,
      minZ,
      maxZ,
      instances: chunkPlacements.length,
      lod: 'hidden',
    };
    chunks.push(chunk);
    instances += chunkPlacements.length;

    const variant = chunkPlacements[0]?.variant;
    if (!variant || chunkPlacements.some((placement) => placement.variant !== variant)) {
      throw new Error(`Grassworks tree chunk ${key} contains mixed variants`);
    }
    const matrices = chunkPlacements.map(composeTreeMatrix);
    for (const placement of chunkPlacements) {
      targetParts.set(placement.id, []);
    }
    for (const lod of ['high', 'low'] as const) {
      const template = templates.get(`${variant}:${lod}`);
      if (!template) {
        continue;
      }
      const parent = lod === 'high' ? high : low;
      for (const [partIndex, part] of template.parts.entries()) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, chunkPlacements.length);
        mesh.name = `grassworks-tree-${lod}-v${variant}-${key.replace(':', '-')}-${partIndex}`;
        mesh.castShadow = false;
        mesh.receiveShadow = lod === 'high';
        mesh.frustumCulled = true;
        chunkPlacements.forEach((placement, index) => {
          const matrix = matrices[index] as THREE.Matrix4;
          mesh.setMatrixAt(index, matrix);
          const region = regionAt(placement.x, placement.z);
          const colour = part.isLeaf
            ? new THREE.Color(AUTUMN_STORM.canopyTint).lerp(
                new THREE.Color(0x9a4e18),
                hashAt(placement.x, placement.z, 41) * 0.42,
              )
            : new THREE.Color(region.groundAlt).lerp(new THREE.Color(0x2a2218), 0.38);
          mesh.setColorAt(index, colour);
          targetParts.get(placement.id)?.push({
            id: part.isLeaf ? 'canopy' : 'trunk',
            mesh,
            instanceIndex: index,
            matrix,
            colour,
          });
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true;
        }
        mesh.computeBoundingSphere();
        parent.add(mesh);
        batches.push({
          mesh,
          trianglesPerInstance: part.triangles,
          instances: chunkPlacements.length,
          lod,
          chunk,
        });
      }
    }
  }

  const targets: FloraTreeOccluderTarget[] = [];
  for (const placement of placements) {
    const parts = targetParts.get(placement.id);
    if (parts && parts.length > 0) {
      targets.push(floraTreeOccluderTarget(placement.id, parts));
    }
  }
  return { root, chunks, batches, targets, instances };
}

function disposeTreeTemplates(templates: ReadonlyMap<string, TreeTemplate>): void {
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

function disposeTreeBuild(build: TreeBuild | null): void {
  if (!build) {
    return;
  }
  for (const batch of build.batches) {
    batch.mesh.dispose();
  }
  build.root.removeFromParent();
  build.root.clear();
}

function emptyOcclusionDiagnostics(): FloraOcclusionDiagnostics {
  return {
    active: false,
    treeOpacity: 1,
    treeIntersections: 0,
    treeCount: 0,
    activeTreeCount: 0,
    fadingTreeCount: 0,
    activeTreeIds: [],
  };
}

export function buildGrassworksVegetationLayer(
  parent: THREE.Group,
  options: {
    readonly renderer: THREE.WebGLRenderer | null;
    readonly graphicsTier: GrassworksGraphicsTier;
    readonly seed: number;
  },
): GrassworksVegetationLayer {
  const group = new THREE.Group();
  group.name = 'map-grassworks-vegetation';
  group.visible = false;
  parent.add(group);

  let tier = options.graphicsTier;
  let status: GrassworksVegetationDiagnostics['status'] = options.renderer ? 'loading' : 'disabled';
  let disposed = false;
  let grassFrame = GRASS_VISIBILITY_UPDATE_INTERVAL - 1;
  let treeFrame = TREE_VISIBILITY_UPDATE_INTERVAL - 1;
  let grassChunks: readonly GrassChunk[] = [];
  let grassLogicalTileCount = 0;
  let treeBuild: TreeBuild | null = null;
  let templates = new Map<string, TreeTemplate>();
  let occlusion = new FloraOcclusionController([]);
  let grassMaterial: THREE.MeshStandardMaterial | null = null;
  let grassAtlas: THREE.Texture | null = null;
  let grassReady = false;
  let treeReady = false;
  let grassSettled = !options.renderer;
  let treeSettled = !options.renderer;
  let visibleGrassInstances = 0;
  let visibleGrassChunks = 0;
  let visibleGrassInstancesByLod = emptyGrassLodCounts();
  let visibleTreeInstances = 0;
  let visibleHighTreeInstances = 0;
  let visibleLowTreeInstances = 0;
  let visibleTreeChunks = 0;
  const visibilityReference = new THREE.Vector3();
  const grassFocusUniform = { value: new THREE.Vector3(1_000_000, 0, 1_000_000) };
  const influence = createGrassInfluenceMap();
  const failedAssets = new Set<string>();
  const loadedAssets = new Set<string>();

  const refreshStatus = (): void => {
    if (disposed || !options.renderer) {
      return;
    }
    group.visible = grassReady || treeReady;
    if (!grassSettled || !treeSettled) {
      status = 'loading';
      return;
    }
    status = failedAssets.size === 0 && grassReady && treeReady ? 'ready' : 'failed';
  };

  const updateGrassVisibility = (reference: THREE.Vector3): void => {
    visibleGrassInstances = 0;
    visibleGrassChunks = 0;
    visibleGrassInstancesByLod = emptyGrassLodCounts();
    for (const chunk of grassChunks) {
      const distanceSquared = squaredDistanceToBounds(
        reference,
        chunk.minX,
        chunk.maxX,
        chunk.minZ,
        chunk.maxZ,
        3,
      );
      const lod = grassReady ? grassLodForDistance(distanceSquared, tier) : null;
      if (!group.visible || !lod) {
        chunk.mesh.visible = false;
        chunk.mesh.geometry.instanceCount = 0;
        chunk.lod = 'hidden';
        chunk.visibleCount = 0;
        chunk.detail = 0;
        continue;
      }
      const visibleCount = Math.max(
        1,
        Math.ceil((chunk.fullCount * lod.density) / GRASS_MAX_DENSITY),
      );
      chunk.mesh.visible = true;
      chunk.mesh.geometry.instanceCount = visibleCount;
      chunk.mesh.geometry.setDrawRange(0, lod.detail * GRASS_VERTICES_PER_DETAIL);
      chunk.lod = lod.id;
      chunk.visibleCount = visibleCount;
      chunk.detail = lod.detail;
      visibleGrassChunks += 1;
      visibleGrassInstances += visibleCount;
      visibleGrassInstancesByLod[lod.id] += visibleCount;
    }
  };

  const updateTreeVisibility = (reference: THREE.Vector3): void => {
    visibleTreeInstances = 0;
    visibleHighTreeInstances = 0;
    visibleLowTreeInstances = 0;
    visibleTreeChunks = 0;
    if (!treeBuild) {
      return;
    }
    for (const chunk of treeBuild.chunks) {
      const distanceSquared = squaredDistanceToBounds(
        reference,
        chunk.minX,
        chunk.maxX,
        chunk.minZ,
        chunk.maxZ,
        8,
      );
      const lowDistance =
        tier === 'balanced' ? BALANCED_TREE_LOW_DISTANCE : REDUCED_TREE_LOW_DISTANCE;
      const distance = Math.sqrt(distanceSquared);
      const highEnterDistance = Math.max(0, BALANCED_TREE_HIGH_DISTANCE - TREE_HIGH_HYSTERESIS);
      const highExitDistance = BALANCED_TREE_HIGH_DISTANCE + TREE_HIGH_HYSTERESIS;
      const lowEnterDistance = Math.max(0, lowDistance - TREE_LOW_HYSTERESIS);
      const lowExitDistance = lowDistance + TREE_LOW_HYSTERESIS;
      let lod: TreeChunk['lod'];
      if (tier === 'balanced' && chunk.lod === 'high') {
        lod =
          distance <= highExitDistance ? 'high' : distance <= lowExitDistance ? 'low' : 'hidden';
      } else if (chunk.lod === 'low') {
        lod =
          tier === 'balanced' && distance <= highEnterDistance
            ? 'high'
            : distance <= lowExitDistance
              ? 'low'
              : 'hidden';
      } else {
        lod =
          tier === 'balanced' && distance <= highEnterDistance
            ? 'high'
            : distance <= lowEnterDistance
              ? 'low'
              : 'hidden';
      }
      chunk.lod = lod;
      const visible = group.visible && lod !== 'hidden';
      chunk.group.visible = visible;
      chunk.high.visible = visible && lod === 'high';
      chunk.low.visible = visible && lod === 'low';
      if (!chunk.group.visible) {
        continue;
      }
      visibleTreeChunks += 1;
      visibleTreeInstances += chunk.instances;
      if (lod === 'high') {
        visibleHighTreeInstances += chunk.instances;
      } else {
        visibleLowTreeInstances += chunk.instances;
      }
    }
  };

  const rebuildTrees = (): void => {
    if (templates.size === 0 || disposed) {
      return;
    }
    occlusion.dispose();
    disposeTreeBuild(treeBuild);
    treeBuild = buildTreeContent(templates, options.seed, tier);
    group.add(treeBuild.root);
    occlusion = new FloraOcclusionController(treeBuild.targets);
    occlusion.setEnabled(tier === 'balanced');
    treeReady = true;
    updateGrassVisibility(visibilityReference);
    updateTreeVisibility(visibilityReference);
    refreshStatus();
  };

  if (options.renderer) {
    const renderer = options.renderer;
    const textureLoader = new THREE.TextureLoader();
    void textureLoader
      .loadAsync(assetUrl(GRASS_ATLAS_PATH))
      .then((texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        configureGrassAtlas(texture, renderer);
        grassAtlas = texture;
        grassMaterial = createGrassMaterial(texture, influence.texture, grassFocusUniform);
        const grassBuild = buildGrassChunks(group, options.seed, grassMaterial);
        grassChunks = grassBuild.chunks;
        grassLogicalTileCount = grassBuild.logicalTileCount;
        grassReady = grassChunks.length > 0;
        loadedAssets.add(GRASS_ATLAS_PATH);
        updateGrassVisibility(visibilityReference);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        failedAssets.add(GRASS_ATLAS_PATH);
        console.warn('JWGB Grassworks grass atlas failed to load', error);
      })
      .finally(() => {
        if (disposed) {
          return;
        }
        grassSettled = true;
        refreshStatus();
      });

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    void loader
      .loadAsync(assetUrl(TREE_ASSET_PATH))
      .then((gltf) => {
        if (disposed) {
          return;
        }
        templates = extractTreeTemplates(gltf.scene);
        loadedAssets.add(TREE_ASSET_PATH);
        rebuildTrees();
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        failedAssets.add(TREE_ASSET_PATH);
        console.warn('JWGB Grassworks tree asset failed to load', error);
      })
      .finally(() => {
        if (disposed) {
          return;
        }
        treeSettled = true;
        refreshStatus();
      });
  }

  return {
    group,
    setGraphicsTier(nextTier): void {
      if (tier === nextTier) {
        return;
      }
      tier = nextTier;
      rebuildTrees();
      updateGrassVisibility(visibilityReference);
      updateTreeVisibility(visibilityReference);
    },
    update(cameraPosition, focusPosition): void {
      if (disposed) {
        return;
      }
      setWindCameraPosition(cameraPosition);
      visibilityReference.copy(cameraPosition);
      grassFocusUniform.value.copy(focusPosition);
      influence.update(focusPosition);
      grassFrame = (grassFrame + 1) % GRASS_VISIBILITY_UPDATE_INTERVAL;
      treeFrame = (treeFrame + 1) % TREE_VISIBILITY_UPDATE_INTERVAL;
      if (grassFrame === 0) {
        updateGrassVisibility(visibilityReference);
      }
      if (treeFrame === 0) {
        updateTreeVisibility(visibilityReference);
      }
      occlusion.update(cameraPosition, focusPosition);
    },
    diagnostics(): GrassworksVegetationDiagnostics {
      const visibleGrassBatches = grassChunks.filter((chunk) => chunk.mesh.visible);
      const visibleTreeBatches =
        treeBuild?.batches.filter(
          (batch) =>
            batch.mesh.visible &&
            batch.chunk.group.visible &&
            (batch.lod === 'high' ? batch.chunk.high.visible : batch.chunk.low.visible),
        ) ?? [];
      const grassInstances = grassChunks.reduce((sum, chunk) => sum + chunk.fullCount, 0);
      const treeInstances = treeBuild?.instances ?? 0;
      return {
        source: SOURCE,
        status,
        loadedAssets: [...loadedAssets].sort(),
        failedAssets: [...failedAssets].sort(),
        treeInstances,
        visibleTreeInstances,
        rockInstances: 0,
        visibleRockInstances: 0,
        dressingInstances: 0,
        visibleDressingInstances: 0,
        instancedBatches: grassChunks.length + (treeBuild?.batches.length ?? 0),
        visibleInstancedBatches: visibleGrassBatches.length + visibleTreeBatches.length,
        triangles:
          visibleGrassBatches.reduce(
            (sum, chunk) => sum + GRASS_TRIANGLES_PER_DETAIL * chunk.detail * chunk.visibleCount,
            0,
          ) +
          visibleTreeBatches.reduce(
            (sum, batch) => sum + batch.trianglesPerInstance * batch.instances,
            0,
          ),
        drawCalls: visibleGrassBatches.length + visibleTreeBatches.length,
        visible: group.visible,
        tileSizeMeters: GRASS_LOGICAL_TILE_SIZE,
        renderBatchSizeMeters: GRASS_RENDER_BATCH_SIZE,
        maxGrassDistanceMeters:
          tier === 'balanced' ? BALANCED_GRASS_DISTANCE : REDUCED_GRASS_DISTANCE,
        influenceResolution: INFLUENCE_RESOLUTION,
        grassInstances,
        visibleGrassInstances,
        visibleGrassInstancesByLod: { ...visibleGrassInstancesByLod },
        highTreeInstances: treeInstances,
        lowTreeInstances: treeInstances,
        visibleHighTreeInstances,
        visibleLowTreeInstances,
        grassChunks: grassChunks.length,
        grassTiles: grassLogicalTileCount,
        grassRenderBatches: grassChunks.length,
        visibleGrassChunks,
        treeChunks: treeBuild?.chunks.length ?? 0,
        visibleTreeChunks,
        legacyFloraInstances: 0,
        legacyScatterInstances: 0,
        legacyGlobalSceneVegetationInstances: 0,
      };
    },
    occlusionDiagnostics(): FloraOcclusionDiagnostics {
      return disposed ? emptyOcclusionDiagnostics() : occlusion.diagnostics();
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      status = 'disposed';
      occlusion.dispose();
      disposeTreeBuild(treeBuild);
      treeBuild = null;
      disposeTreeTemplates(templates);
      templates.clear();
      for (const chunk of grassChunks) {
        chunk.mesh.geometry.dispose();
      }
      grassMaterial?.dispose();
      grassAtlas?.dispose();
      influence.dispose();
      grassChunks = [];
      grassLogicalTileCount = 0;
      group.removeFromParent();
      group.clear();
    },
  };
}
