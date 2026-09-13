import type { MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { appendAssetVersion, webAssetUrl } from '../../runtime/asset-url';
import {
  applyWindSway,
  setWindCameraPosition,
  windGustUniform,
  windTimeUniform,
} from '../shading/wind';
import {
  type AutumnGroundDressingLayer,
  buildAutumnGroundDressing,
} from './autumn-ground-dressing';
import { AUTUMN_STORM } from './autumn-storm';
import type { FloraModelLayerDiagnostics } from './flora-models';
import {
  FloraOcclusionController,
  type FloraOcclusionDiagnostics,
  type FloraTreeOccluderPart,
  type FloraTreeOccluderTarget,
  floraTreeOccluderTarget,
} from './flora-occlusion';
import { mapBuildingClearanceZones } from './map-asset-layer';

/** Woods thin out into the shore apron over the last ~44 m of playfield. */
const RIM_VEGETATION_THINNING_MM = 44_000;

import { type RegionId, regionAt } from './map-regions';
import {
  createRandomStream,
  dressingSurfaceMeters,
  isInsideBoundWall,
  isInsideVaultWall,
  isOpenGround,
  sampleGroundLattice,
  sampleOpenGround,
} from './map-sampling';
import { isInSpawnPond } from './spawn-ponds';
import { exposeTreeTrunk } from './tree-canopy';
import { buildUnderstoryLayer, type UnderstoryLayer } from './understory';
import { waterSurfaceAt } from './water';

const MM = 1_000;
const SOURCE = 'grassworks' as const;
const TREE_ASSET_PATH = 'models/grassworks/grassworks-trees.glb';
const GRASS_ATLAS_PATH = 'models/grassworks/grass-atlas5.png';
const TREE_VARIANTS = 9;
const TREE_COUNT = 3_800;
const TREE_SEED_SALT = 0x9e3779b9;
const GRASS_SEED_SALT = 0x4f1bbcdc;
/**
 * Woodland on the BOUND massifs and the walkable VAULT hills. A lattice over
 * the wall footprints rather than the open-ground cluster sampler, because a
 * range should read as continuously wooded from foot to crest, not as a few
 * copses on bare rock.
 */
const MASSIF_TREE_SPACING_METERS = 2.6;
const MASSIF_TREE_JITTER = 0.9;
const MASSIF_TREE_KEEP = 0.96;
const MASSIF_TREE_SEED_SALT = 0x2f6b1d93;
const HILL_TREE_SPACING_METERS = 3.6;
const HILL_TREE_JITTER = 0.88;
const HILL_TREE_KEEP = 0.92;
const HILL_TREE_SEED_SALT = 0x5a1c4e27;
export interface GrassworksForestGrove {
  readonly id: string;
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly treeCount: number;
}

// Thirteen woods. The original groves grew another quarter, two new copses
// close the remaining meadow gaps, and crowns may now stand 4.0 m apart.
export const GRASSWORKS_FOREST_GROVES: readonly GrassworksForestGrove[] = [
  { id: 'northwest-forest', centerX: -300, centerZ: 150, radiusX: 70, radiusZ: 52, treeCount: 320 },
  { id: 'north-forest', centerX: -55, centerZ: 295, radiusX: 68, radiusZ: 46, treeCount: 300 },
  { id: 'east-forest', centerX: 140, centerZ: 285, radiusX: 72, radiusZ: 50, treeCount: 310 },
  { id: 'west-forest', centerX: -300, centerZ: -115, radiusX: 68, radiusZ: 52, treeCount: 320 },
  {
    id: 'southwest-forest',
    centerX: -190,
    centerZ: -210,
    radiusX: 70,
    radiusZ: 52,
    treeCount: 330,
  },
  { id: 'south-forest', centerX: 70, centerZ: -225, radiusX: 70, radiusZ: 50, treeCount: 320 },
  { id: 'southeast-forest', centerX: 170, centerZ: -200, radiusX: 64, radiusZ: 52, treeCount: 300 },
  { id: 'northeast-hollow', centerX: 45, centerZ: 250, radiusX: 54, radiusZ: 44, treeCount: 200 },
  { id: 'west-ridge', centerX: -195, centerZ: -30, radiusX: 52, radiusZ: 42, treeCount: 190 },
  { id: 'south-hollow', centerX: -75, centerZ: -255, radiusX: 50, radiusZ: 40, treeCount: 175 },
  { id: 'east-shore', centerX: 372, centerZ: 108, radiusX: 40, radiusZ: 46, treeCount: 110 },
  { id: 'mid-west-copse', centerX: -120, centerZ: 80, radiusX: 42, radiusZ: 36, treeCount: 140 },
  { id: 'mid-east-copse', centerX: 220, centerZ: 20, radiusX: 40, radiusZ: 36, treeCount: 130 },
] as const;

const FOREST_TREE_COUNT = GRASSWORKS_FOREST_GROVES.reduce((sum, grove) => sum + grove.treeCount, 0);
const FOREST_ROAD_VERGE_MM = 2_500;
const FOREST_MIN_DISTANCE_METERS = 4.0;
const GRASS_SPACING_METERS = 1.25;
const GRASS_JITTER = 0.55;
const GRASS_ROAD_VERGE_MM = -1;
const GRASS_WIDTH_MIN = 1.48;
const GRASS_WIDTH_MAX = 2.08;
const GRASS_HEIGHT_MIN = 1.05;
const GRASS_HEIGHT_MAX = 1.78;
// The runtime atlas is repacked by tools/models/import-grassworks-vegetation.mjs:
// the two whole demo clumps, each in its own 512 px slot with a transparent
// margin, bottom-anchored so the cut stems sit on the ground line. Rects are in
// pixel units with y measured from the bottom (Texture.flipY), and must match
// manifest.runtime.grassAtlasRects — sampling any other rectangle slices blades
// at the rect border and puts straight cut edges on the grass cards.
const GRASS_ATLAS_WIDTH = 1_024;
const GRASS_ATLAS_HEIGHT = 512;
const GRASS_ATLAS_RECTS = [
  { x: 0, y: 0, width: 512, height: 444 },
  { x: 512, y: 0, width: 512, height: 325 },
] as const;
const GRASS_LOGICAL_TILE_SIZE = 25;
const GRASS_RENDER_BATCH_SIZE = GRASS_LOGICAL_TILE_SIZE * 2;
const TREE_CHUNK_SIZE = 32;
const GRASS_VISIBILITY_UPDATE_INTERVAL = 3;
const TREE_VISIBILITY_UPDATE_INTERVAL = 3;
const BALANCED_GRASS_DISTANCE = 180;
const REDUCED_GRASS_DISTANCE = 108;
/**
 * High-detail crowns only near the camera. The source trees run 7k–20k
 * triangles each, so every 20 m of high-LOD reach costs millions of triangles
 * in a closed wood; past ~64 m the photographic billboards read the same from
 * the chase camera.
 */
const BALANCED_TREE_HIGH_DISTANCE = 26;
const BALANCED_TREE_LOW_DISTANCE = 260;
const REDUCED_TREE_LOW_DISTANCE = 208;
const TREE_HIGH_HYSTERESIS = 5;
const TREE_LOW_HYSTERESIS = 16;
const REDUCED_TREE_DENSITY = 0.7;
/**
 * Heroes render at 2.2–2.5 m × 1.5, so a 3.5 m figure stands in this grass.
 * Trees at 11–15 m were only three to four heroes tall and still read as
 * orchard stock. These crowns sit five to six heroes high — a real canopy
 * over a chibi figure. Near-camera occlusion hides any tree that would put
 * the 30° chase lens inside the leaves.
 */
const TREE_TARGET_HEIGHT_MIN = 12.5;
const TREE_TARGET_HEIGHT_MAX = 24;
/** Trees on a slope sink by up to this much so the uphill roots stay buried. */
const TREE_SLOPE_SINK_MAX_METERS = 1.6;
/** Billboard cards are flat and wide; bury their base so the downhill corner never hangs. */
const TREE_BILLBOARD_BURY_FRACTION = 0.035;
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
 * existing r165 WebGL renderer, so the tile/LOD/atlas design is implemented
 * with InstancedBufferGeometry and onBeforeCompile. Character influence is
 * disabled so grass remains stable while the player moves.
 */
export const GRASSWORKS_SOURCE_PROFILE = {
  renderer: 'three.js r185 WebGPU/TSL adapted to three.js r165 WebGL',
  tileSizeMeters: GRASS_LOGICAL_TILE_SIZE,
  renderBatchSizeMeters: GRASS_RENDER_BATCH_SIZE,
  maxDistanceMeters: 150,
  atlasColumns: 2,
  atlasRows: 2,
  runtimeAtlas: {
    width: GRASS_ATLAS_WIDTH,
    height: GRASS_ATLAS_HEIGHT,
    rects: GRASS_ATLAS_RECTS,
  },
  influenceResolution: 0,
  sourceLods: GRASS_LODS,
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
  runtimeTreeHeightMeters: {
    min: TREE_TARGET_HEIGHT_MIN,
    max: TREE_TARGET_HEIGHT_MAX,
  },
  runtimeMassifTreeSpacingMeters: MASSIF_TREE_SPACING_METERS,
  runtimeHillTreeSpacingMeters: HILL_TREE_SPACING_METERS,
  runtimeMassifVegetation: 'grass lattice plus tree lattices on BOUND massifs and VAULT hills',
  runtimeUnderstory: 'bush, asia-bush and fern GLBs clustered under every placed tree',
  // One canopy palette per district plus an upland set; see CANOPY_PALETTES.
  runtimeCanopyPalettes: 7,
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
  readonly autumnFlowerInstances: number;
  readonly autumnLeafLitterInstances: number;
  readonly understoryInstances: number;
  readonly visibleUnderstoryInstances: number;
  readonly understoryStatus: UnderstoryLayer extends { diagnostics(): infer D }
    ? D extends { readonly status: infer S }
      ? S
      : never
    : never;
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
  /** Standing on a BOUND massif or VAULT hill. */
  readonly upland: boolean;
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

const tempMatrix = new THREE.Matrix4();
const tempEuler = new THREE.Euler();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const grassTintTarget = new THREE.Color(0x687a3d);
const FOREST_FLOOR = new THREE.Color(0x3f5a2c);
const MASSIF_GRASS = new THREE.Color(0x5a9440);

/**
 * Canopy colour per district. The whole forest used to share one amber tint,
 * which is why every wood read as the same orange smear. Each district now
 * draws from a small palette: cool and jade greens in the wet north and east,
 * deep forest green in 迷魂田 and 百足城, gold and ember where the map is warm.
 * Uplands (massifs and hills) run darker, conifer-like, so a range reads as a
 * range from across the map.
 */
const CANOPY_PALETTES: Readonly<Record<RegionId, readonly number[]>> = {
  duanjin: [0x6f8f3c, 0xa8973a, 0xc98a32, 0x5e7a34, 0xb8602c],
  zhusi: [0x4d7a4a, 0x5f8a58, 0x7d9a4c, 0x8fa85a, 0xa3853a],
  longji: [0x3f7d5a, 0x4f8f68, 0x6a9c5e, 0x8fa64a, 0xb7903c],
  baizu: [0x466f2f, 0x5c8a3a, 0x77994a, 0x9a9a3e, 0xc0782c],
  jinshui: [0xb56f2a, 0xd08a38, 0xc9a13a, 0x8a7a34, 0xa04a26],
  mihun: [0x35652f, 0x467a3c, 0x5a8c42, 0x6d9548, 0x9c8a3a],
  santing: [0xa39a3c, 0xc9a13a, 0xd08a38, 0x7e8f3e, 0xb65a2a],
};
const UPLAND_CANOPY: readonly number[] = [0x2f5a30, 0x3a6a38, 0x4a7a3c, 0x5f7f3a, 0x6d8a3e];

function canopyTintAt(x: number, z: number, upland: boolean): THREE.Color {
  const palette = upland ? UPLAND_CANOPY : CANOPY_PALETTES[regionAt(x, z).id];
  const pick = palette[Math.min(palette.length - 1, Math.floor(hashAt(x, z, 43) * palette.length))];
  return new THREE.Color(pick ?? 0x5c8a3a).multiplyScalar(0.9 + hashAt(x, z, 41) * 0.2);
}

/** Crown radius a tree shades the ground under, from its height. */
function crownRadiusMeters(height: number): number {
  return height * 0.28;
}

/**
 * How much canopy stands over each grass clump, so the forest floor darkens
 * and cools under the trees instead of glowing the same as the open meadow.
 */
class CanopyShadeField {
  private static readonly CELL = 8;
  private readonly buckets = new Map<number, number[]>();

  constructor(private readonly trees: readonly TreePlacement[]) {
    trees.forEach((tree, index) => {
      const radius = crownRadiusMeters(tree.height);
      const minX = Math.floor((tree.x - radius) / CanopyShadeField.CELL);
      const maxX = Math.floor((tree.x + radius) / CanopyShadeField.CELL);
      const minZ = Math.floor((tree.z - radius) / CanopyShadeField.CELL);
      const maxZ = Math.floor((tree.z + radius) / CanopyShadeField.CELL);
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
          const key = (cellX + 0x8000) * 0x10000 + (cellZ + 0x8000);
          const bucket = this.buckets.get(key);
          if (bucket) {
            bucket.push(index);
          } else {
            this.buckets.set(key, [index]);
          }
        }
      }
    });
  }

  /** 0 in the open, rising to 1 directly under a trunk. */
  coverageAt(x: number, z: number): number {
    const key =
      (Math.floor(x / CanopyShadeField.CELL) + 0x8000) * 0x10000 +
      (Math.floor(z / CanopyShadeField.CELL) + 0x8000);
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return 0;
    }
    let best = 0;
    for (const index of bucket) {
      const tree = this.trees[index] as TreePlacement;
      const radius = crownRadiusMeters(tree.height);
      const distance = Math.hypot(x - tree.x, z - tree.z);
      if (distance < radius) {
        best = Math.max(best, (1 - distance / radius) ** 0.7);
      }
    }
    return best;
  }
}

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
  return waterSurfaceAt(point.x / MM, point.z / MM) !== null || isInSpawnPond(point);
}

/** Grass runs onto the river bank shelf this far past the boundary polygon. */
const GRASS_RIM_OVERHANG_MM = 4_000;

export function sampleGrassworksGrassPoints(seed: number): readonly MapPointMm[] {
  return sampleGroundLattice(GRASS_SPACING_METERS, createRandomStream(seed ^ GRASS_SEED_SALT), {
    roadVergeMm: GRASS_ROAD_VERGE_MM,
    rimOverhangMm: GRASS_RIM_OVERHANG_MM,
    landmarkClearanceScale: 0.5,
    exclusionZones: mapBuildingClearanceZones(),
    jitter: GRASS_JITTER,
    // The massifs are rock in the sim only; on screen they are wooded hills,
    // so the same grass lattice climbs them and stands on their surface.
    includeBoundMassifs: true,
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
  const occupied = [...forest, ...sparse];
  const massif = sampleMassifTreePoints(seed);
  const occupiedIndex = new SeparationIndex(HILL_TREE_SPACING_METERS * 0.7);
  for (const point of occupied) {
    occupiedIndex.add(point);
  }
  const hill = sampleHillTreePoints(seed).filter((point) => occupiedIndex.farEnough(point));
  return [...occupied, ...massif, ...hill];
}

/** Trees over every BOUND massif footprint; nothing else is accepted here. */
export function sampleMassifTreePoints(seed: number): readonly MapPointMm[] {
  return sampleGroundLattice(
    MASSIF_TREE_SPACING_METERS,
    createRandomStream(seed ^ MASSIF_TREE_SEED_SALT),
    {
      roadVergeMm: -1,
      landmarkClearanceScale: 0,
      exclusionZones: mapBuildingClearanceZones(),
      jitter: MASSIF_TREE_JITTER,
      includeBoundMassifs: true,
      reject: (point) =>
        !isInsideBoundWall(point) ||
        isWaterPoint(point) ||
        hashAt(point.x / MM, point.z / MM, 53) >= MASSIF_TREE_KEEP,
    },
  );
}

/** Trees over every walkable VAULT hill, so raised terrain is wooded like the massifs. */
export function sampleHillTreePoints(seed: number): readonly MapPointMm[] {
  return sampleGroundLattice(
    HILL_TREE_SPACING_METERS,
    createRandomStream(seed ^ HILL_TREE_SEED_SALT),
    {
      roadVergeMm: 800,
      landmarkClearanceScale: 0.35,
      exclusionZones: mapBuildingClearanceZones(),
      jitter: HILL_TREE_JITTER,
      reject: (point) =>
        !isInsideVaultWall(point) ||
        isInsideBoundWall(point) ||
        isWaterPoint(point) ||
        hashAt(point.x / MM, point.z / MM, 59) >= HILL_TREE_KEEP,
    },
  );
}

function sampleForestGroves(nextRandom: () => number): MapPointMm[] {
  const points: MapPointMm[] = [];
  const index = new SeparationIndex(FOREST_MIN_DISTANCE_METERS);
  for (const grove of GRASSWORKS_FOREST_GROVES) {
    let added = 0;
    for (
      let attempt = 0;
      attempt < grove.treeCount * 100 && added < grove.treeCount;
      attempt += 1
    ) {
      const angle = nextRandom() * Math.PI * 2;
      const radius = Math.sqrt(nextRandom());
      const candidate: MapPointMm = {
        x: Math.round((grove.centerX + Math.cos(angle) * radius * grove.radiusX) * MM),
        z: Math.round((grove.centerZ + Math.sin(angle) * radius * grove.radiusZ) * MM),
      };
      if (
        !isOpenGround(candidate, {
          roadVergeMm: FOREST_ROAD_VERGE_MM,
          exclusionZones: mapBuildingClearanceZones(),
          rimThinningMm: RIM_VEGETATION_THINNING_MM,
        }) ||
        isWaterPoint(candidate) ||
        !index.farEnough(candidate)
      ) {
        continue;
      }
      points.push(candidate);
      index.add(candidate);
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
    exclusionZones: mapBuildingClearanceZones(),
    roadVergeMm: anchorRoadVergeMm,
  }).filter((point) => !isWaterPoint(point));
  const points: MapPointMm[] = [];
  const occupiedIndex = new SeparationIndex(minDistanceMeters);
  for (const point of occupied) {
    occupiedIndex.add(point);
  }
  const pointsIndex = new SeparationIndex(minDistanceMeters);
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
        !isOpenGround(candidate, {
          roadVergeMm: pointRoadVergeMm,
          exclusionZones: mapBuildingClearanceZones(),
          rimThinningMm: RIM_VEGETATION_THINNING_MM,
        }) ||
        isWaterPoint(candidate) ||
        !occupiedIndex.farEnough(candidate) ||
        !pointsIndex.farEnough(candidate)
      ) {
        continue;
      }
      points.push(candidate);
      pointsIndex.add(candidate);
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
    { roadVergeMm: pointRoadVergeMm, exclusionZones: mapBuildingClearanceZones() },
  )) {
    if (points.length >= count) {
      break;
    }
    if (isWaterPoint(point) || !occupiedIndex.farEnough(point) || !pointsIndex.farEnough(point)) {
      continue;
    }
    points.push(point);
    pointsIndex.add(point);
  }
  return points;
}

class SeparationIndex {
  private readonly cellMm: number;
  private readonly minimumDistanceSquared: number;
  private readonly cells = new Map<string, MapPointMm[]>();

  constructor(minDistanceMeters: number) {
    this.cellMm = Math.max(1, Math.round(minDistanceMeters * MM));
    this.minimumDistanceSquared = (minDistanceMeters * MM) ** 2;
  }

  add(point: MapPointMm): void {
    const key = this.cellKey(point.x, point.z);
    const cell = this.cells.get(key);
    if (cell) {
      cell.push(point);
      return;
    }
    this.cells.set(key, [point]);
  }

  farEnough(candidate: MapPointMm): boolean {
    const cellX = Math.floor(candidate.x / this.cellMm);
    const cellZ = Math.floor(candidate.z / this.cellMm);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cell = this.cells.get(`${cellX + dx}:${cellZ + dz}`);
        if (!cell) {
          continue;
        }
        for (const point of cell) {
          const offsetX = candidate.x - point.x;
          const offsetZ = candidate.z - point.z;
          if (offsetX * offsetX + offsetZ * offsetZ < this.minimumDistanceSquared) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / this.cellMm)}:${Math.floor(z / this.cellMm)}`;
  }
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
  // The source PNG has black RGB in fully transparent texels. Mip generation
  // blends that RGB into the alpha edge, producing black grass-shaped noise
  // at distance even when the fragment is later alpha-tested.
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
}

function createGrassMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: atlas,
    roughness: 0.96,
    metalness: 0,
    emissive: 0x080604,
    emissiveIntensity: 0.02,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  material.alphaToCoverage = false;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTimeUniform();
    shader.uniforms.uWindGust = windGustUniform();
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uWindTime;',
          'uniform float uWindGust;',
          'attribute vec3 grassworksOffset;',
          'attribute vec4 grassworksParams;',
          'attribute vec3 grassworksTint;',
          'attribute vec4 grassworksAtlasRect;',
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
          'float grassworksCos = cos(grassworksYaw);',
          'float grassworksSin = sin(grassworksYaw);',
          'transformed.xz *= grassworksWidth;',
          'transformed.y *= grassworksHeight;',
          'transformed.xz = mat2(grassworksCos, -grassworksSin, grassworksSin, grassworksCos) * transformed.xz;',
          'transformed += grassworksOffset;',
          // Storm wind on the blades: the tip bends downwind with a broad
          // gust field plus a fine flutter, weighted by height so roots stay put.
          'float gwTip = clamp(transformed.y - grassworksOffset.y, 0.0, 4.0) / max(grassworksHeight, 0.001);',
          'float gwPhase = uWindTime * 4.8;',
          'float gwBroad = sin(grassworksOffset.x * 0.18 + grassworksOffset.z * 0.14 + gwPhase);',
          'float gwFlutter = sin(grassworksOffset.x * 1.7 - grassworksOffset.z * 1.3 + gwPhase * 2.3 + grassworksParams.w * 6.283);',
          'vec2 gwDir = normalize(vec2(0.93, 0.36));',
          'float gwGust = (0.55 + gwBroad * 0.45 + gwFlutter * 0.2) * uWindGust;',
          'transformed.xz += gwDir * gwGust * gwTip * gwTip * grassworksHeight * 0.55;',
          'transformed.y -= gwGust * gwTip * gwTip * grassworksHeight * 0.08;',
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
  material.customProgramCacheKey = () => 'jwgb-grassworks-grass-atlas-wind-v10';
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
  material: THREE.MeshStandardMaterial,
  points: readonly MapPointMm[],
  shadeAt: (x: number, z: number) => number = () => 0,
): GrassBuild {
  const pointsByLogicalTile = new Map<string, GrassPoint[]>();
  for (const point of points) {
    const x = point.x / MM;
    const z = point.z / MM;
    const key =
      `${chunkCoordinate(x, GRASS_LOGICAL_TILE_SIZE)}:` +
      `${chunkCoordinate(z, GRASS_LOGICAL_TILE_SIZE)}`;
    const region = regionAt(x, z);
    const onMassif = isInsideBoundWall(point);
    const colour = autumnGrassColour(x, z, region.scatter, onMassif);
    const shade = shadeAt(x, z);
    if (shade > 0) {
      // Forest floor: darker and cooler under the crowns, with the deepest
      // shade right at the trunks where the clumps thin as well.
      colour.multiplyScalar(1 - shade * 0.38).lerp(FOREST_FLOOR, shade * 0.35);
    }
    const atlasIndex = Math.min(
      GRASS_ATLAS_RECTS.length - 1,
      Math.floor(hashAt(x, z, 29) * GRASS_ATLAS_RECTS.length),
    );
    const atlasRect = GRASS_ATLAS_RECTS[atlasIndex] ?? GRASS_ATLAS_RECTS[0];
    const heightScale = onMassif ? 1.55 : 1 - shade * 0.18;
    const grassPoint: GrassPoint = {
      x,
      y: dressingSurfaceMeters(point) + 0.014,
      z,
      yaw: hashAt(x, z, 11) * Math.PI * 2,
      width: GRASS_WIDTH_MIN + hashAt(x, z, 13) * (GRASS_WIDTH_MAX - GRASS_WIDTH_MIN),
      height:
        (GRASS_HEIGHT_MIN + hashAt(x, z, 17) * (GRASS_HEIGHT_MAX - GRASS_HEIGHT_MIN)) * heightScale,
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
          point.atlasRect.x / GRASS_ATLAS_WIDTH,
          point.atlasRect.y / GRASS_ATLAS_HEIGHT,
          point.atlasRect.width / GRASS_ATLAS_WIDTH,
          point.atlasRect.height / GRASS_ATLAS_HEIGHT,
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

/**
 * Meadow colour: mostly living greens with gold and russet clumps threaded
 * through, rather than the even straw the whole map used to wear. Massif grass
 * pulls toward a deeper upland green so the ranges read as overgrown.
 */
function autumnGrassColour(
  x: number,
  z: number,
  regionScatter: number,
  onMassif: boolean,
): THREE.Color {
  const season = hashAt(x, z, 0x64aa3d11);
  const palette =
    season < 0.4
      ? 0x4f7a34
      : season < 0.64
        ? 0x62893a
        : season < 0.8
          ? 0x7f9640
          : season < 0.92
            ? 0xa08a36
            : 0x8b6a30;
  const colour = new THREE.Color(regionScatter)
    .lerp(new THREE.Color(palette), 0.72)
    .lerp(grassTintTarget, 0.14)
    .multiplyScalar(0.96 + hashAt(x, z, 0xf0b1cd33) * 0.1);
  if (onMassif) {
    colour.lerp(MASSIF_GRASS, 0.55);
  }
  return colour;
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
  if (!geometry.getAttribute('color')) {
    bakeCanopyOcclusion(geometry);
  }
  return geometry;
}

/**
 * Crown-depth shading baked as vertex colour.
 *
 * The source leaf cards are lit as flat cutouts, so a crown read as one bright
 * disc with no interior. Darkening each vertex by how deep it sits toward the
 * trunk axis and how low it hangs gives the canopy the hollow, shadowed core a
 * real tree has, for free at draw time. The per-instance tint multiplies on
 * top, so the district palette still sets the hue.
 */
function bakeCanopyOcclusion(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const box = geometry.boundingBox;
  if (!position || !box) {
    return;
  }
  const radius = Math.max(0.001, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2);
  const centreX = (box.min.x + box.max.x) / 2;
  const centreZ = (box.min.z + box.max.z) / 2;
  const height = Math.max(0.001, box.max.y - box.min.y);
  const colours = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const radial = Math.min(
      1,
      Math.hypot(position.getX(index) - centreX, position.getZ(index) - centreZ) / radius,
    );
    const lift = Math.min(1, Math.max(0, (position.getY(index) - box.min.y) / height));
    const occlusion = (0.6 + 0.4 * radial ** 0.75) * (0.74 + 0.26 * lift ** 0.6);
    colours[index * 3] = occlusion;
    colours[index * 3 + 1] = occlusion;
    colours[index * 3 + 2] = occlusion;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

function prepareTreeMaterial(
  source: THREE.Material,
  lod: 'high' | 'low',
  isLeaf: boolean,
  hasVertexColour: boolean,
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
    // The baked crown occlusion lives in the vertex colour of the high LOD;
    // billboards are one quad and would only darken at their centre. Only
    // meshes that actually carry a colour attribute may enable it: with
    // `vertexColors` on and no attribute, WebGL feeds the shader the zero
    // default and the whole tree — bark, branches and crown — renders black.
    material.vertexColors = lod === 'high' && hasVertexColour;
    material.roughness = Math.max(material.roughness, isLeaf ? 0.72 : 0.88);
    material.metalness = Math.min(material.metalness, 0.03);
    if (!isLeaf) {
      // Bark used to be darkened here and again per instance, which with the
      // overcast key light left every trunk a black pole. One gentle step.
      material.color.multiplyScalar(lod === 'low' ? 0.7 : 0.9);
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
            material: prepareTreeMaterial(
              sourceMaterial,
              lod,
              isLeaf,
              Boolean(geometry.getAttribute('color')),
            ),
            isLeaf,
            triangles: Math.floor(group.count / 3),
          });
        }
        baked.dispose();
      });
      if (parts.length === 0) {
        throw new Error(`Grassworks tree template ${variant}/${lod} has no renderable meshes`);
      }
      // Same bare-trunk correction as the near-camera flora: the wood has to
      // show trunks under the canopy from the chase lens.
      exposeTreeTrunk(parts, 0.34);
      if (lod === 'low') {
        for (const part of parts) {
          part.geometry.translate(0, -TREE_BILLBOARD_BURY_FRACTION, 0);
          part.geometry.computeBoundingBox();
          part.geometry.computeBoundingSphere();
        }
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

function createTreePlacements(seed: number): readonly TreePlacement[] {
  return sampleGrassworksTreePoints(seed).map((point, index): TreePlacement => {
    const x = point.x / MM;
    const z = point.z / MM;
    // Skewed toward the middle of the range with a few giants: a wood of
    // identical heights reads as a plantation.
    const scaleNoise = hashAt(x, z, 31) ** 1.35;
    return {
      id: `grassworks-tree-${index.toString().padStart(4, '0')}`,
      x,
      z,
      yaw: hashAt(x, z, 29) * Math.PI * 2,
      height:
        TREE_TARGET_HEIGHT_MIN + scaleNoise * (TREE_TARGET_HEIGHT_MAX - TREE_TARGET_HEIGHT_MIN),
      variant: treeVariantForChunk(x, z),
      order: hashAt(x, z, 41),
      upland: isInsideBoundWall(point) || isInsideVaultWall(point),
    };
  });
}

function placementsForTier(
  placements: readonly TreePlacement[],
  tier: GrassworksGraphicsTier,
): readonly TreePlacement[] {
  return tier === 'balanced'
    ? placements
    : placements.filter((placement) => placement.order < REDUCED_TREE_DENSITY);
}

function composeTreeMatrix(placement: TreePlacement): THREE.Matrix4 {
  tempEuler.set(0, placement.yaw, 0);
  tempQuaternion.setFromEuler(tempEuler);
  tempScale.setScalar(placement.height);
  tempPosition.set(placement.x, treeGroundMeters(placement.x, placement.z), placement.z);
  tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
  return tempMatrix.clone();
}

/**
 * Where a trunk meets the ground. On a massif slope the surface under the
 * downhill edge of the trunk is lower than under the centre, so the tree is
 * dropped by the local fall over one metre, capped so the crown stays clear.
 */
function treeGroundMeters(x: number, z: number): number {
  const surfaceAt = (px: number, pz: number): number =>
    dressingSurfaceMeters({ x: Math.round(px * MM), z: Math.round(pz * MM) });
  const centre = surfaceAt(x, z);
  // Probe 1.5 m out in eight directions: a crown-wide card or a buttressed
  // trunk spans more than the metre the old four probes covered, and from a
  // low angle the downhill side of the base showed daylight underneath.
  let fall = 0;
  for (let step = 0; step < 8; step += 1) {
    const angle = (step * Math.PI) / 4;
    fall = Math.max(fall, centre - surfaceAt(x + Math.cos(angle) * 1.5, z + Math.sin(angle) * 1.5));
  }
  return centre - Math.min(TREE_SLOPE_SINK_MAX_METERS, fall);
}

function buildTreeContent(
  templates: ReadonlyMap<string, TreeTemplate>,
  placements: readonly TreePlacement[],
): TreeBuild {
  const root = new THREE.Group();
  root.name = 'grassworks-tree-content';
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
        // Near trees throw real shadows on the balanced tier: trunks and
        // crowns crossing the ground are most of what makes the wood read as
        // lit. The low LOD is a billboard and would cast a flat card.
        mesh.castShadow = lod === 'high';
        mesh.receiveShadow = lod === 'high';
        mesh.frustumCulled = true;
        chunkPlacements.forEach((placement, index) => {
          const matrix = matrices[index] as THREE.Matrix4;
          mesh.setMatrixAt(index, matrix);
          const region = regionAt(placement.x, placement.z);
          const colour = part.isLeaf
            ? canopyTintAt(placement.x, placement.z, placement.upland)
            : new THREE.Color(0x8c7a62).lerp(new THREE.Color(region.groundAlt), 0.3);
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
  let autumnGroundDressing: AutumnGroundDressingLayer | null = null;
  let understory: UnderstoryLayer | null = null;
  let treePlacements: readonly TreePlacement[] | null = null;
  const placements = (): readonly TreePlacement[] => {
    treePlacements ??= createTreePlacements(options.seed);
    return treePlacements;
  };
  const visibilityReference = new THREE.Vector3();
  const focusReference = new THREE.Vector3();
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

  /**
   * Tree LOD. The low/hidden cull follows the camera as before, but the high
   * LOD is chosen by distance to the *focus* (the player). The chase rig keeps
   * the camera 25–30 m behind the hero, so measuring from the camera meant the
   * trees the player stands among were always outside the 26 m high band and
   * the wood was only ever drawn as billboards.
   */
  const updateTreeVisibility = (reference: THREE.Vector3, focus: THREE.Vector3): void => {
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
      const focusDistance = Math.sqrt(
        squaredDistanceToBounds(focus, chunk.minX, chunk.maxX, chunk.minZ, chunk.maxZ, 8),
      );
      const highEnterDistance = Math.max(0, BALANCED_TREE_HIGH_DISTANCE - TREE_HIGH_HYSTERESIS);
      const highExitDistance = BALANCED_TREE_HIGH_DISTANCE + TREE_HIGH_HYSTERESIS;
      const lowEnterDistance = Math.max(0, lowDistance - TREE_LOW_HYSTERESIS);
      const lowExitDistance = lowDistance + TREE_LOW_HYSTERESIS;
      const wantsHigh =
        tier === 'balanced' &&
        focusDistance <= (chunk.lod === 'high' ? highExitDistance : highEnterDistance);
      const withinLow = distance <= (chunk.lod === 'hidden' ? lowEnterDistance : lowExitDistance);
      const lod: TreeChunk['lod'] = wantsHigh ? 'high' : withinLow ? 'low' : 'hidden';
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
    treeBuild = buildTreeContent(templates, placementsForTier(placements(), tier));
    group.add(treeBuild.root);
    occlusion = new FloraOcclusionController(treeBuild.targets);
    // Flora occlusion only fades crowns; trunks remain permanently opaque.
    occlusion.setEnabled(tier === 'balanced');
    treeReady = true;
    updateGrassVisibility(visibilityReference);
    updateTreeVisibility(visibilityReference, focusReference);
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
        grassMaterial = createGrassMaterial(texture);
        const grassPoints = sampleGrassworksGrassPoints(options.seed);
        const shade = new CanopyShadeField(placements());
        const grassBuild = buildGrassChunks(group, grassMaterial, grassPoints, (x, z) =>
          shade.coverageAt(x, z),
        );
        grassChunks = grassBuild.chunks;
        understory?.dispose();
        understory = buildUnderstoryLayer(group, {
          renderer,
          graphicsTier: tier,
          anchors: placements(),
        });
        grassLogicalTileCount = grassBuild.logicalTileCount;
        autumnGroundDressing = buildAutumnGroundDressing(group, grassPoints, tier);
        const autumnDressingRoot = group.getObjectByName('map-autumn-ground-dressing');
        if (autumnDressingRoot) {
          autumnDressingRoot.visible = true;
        }
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
      autumnGroundDressing?.setGraphicsTier(tier);
      understory?.setGraphicsTier(tier);
      rebuildTrees();
      updateGrassVisibility(visibilityReference);
      updateTreeVisibility(visibilityReference, focusReference);
    },
    update(cameraPosition, focusPosition): void {
      if (disposed) {
        return;
      }
      setWindCameraPosition(cameraPosition);
      visibilityReference.copy(cameraPosition);
      focusReference.copy(focusPosition);
      understory?.update(cameraPosition);
      grassFrame = (grassFrame + 1) % GRASS_VISIBILITY_UPDATE_INTERVAL;
      treeFrame = (treeFrame + 1) % TREE_VISIBILITY_UPDATE_INTERVAL;
      if (grassFrame === 0) {
        updateGrassVisibility(visibilityReference);
      }
      if (treeFrame === 0) {
        updateTreeVisibility(visibilityReference, focusReference);
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
      const autumnCounts = autumnGroundDressing?.diagnostics() ?? {
        flowerInstances: 0,
        leafLitterInstances: 0,
      };
      const autumnDrawCalls =
        autumnGroundDressing && group.visible ? autumnGroundDressing.diagnostics().drawCalls : 0;
      const understoryCounts = understory?.diagnostics() ?? {
        status: 'disabled' as const,
        instances: 0,
        visibleInstances: 0,
        drawCalls: 0,
        visibleDrawCalls: 0,
        visibleTriangles: 0,
      };
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
        instancedBatches:
          grassChunks.length +
          (treeBuild?.batches.length ?? 0) +
          (autumnGroundDressing?.diagnostics().drawCalls ?? 0) +
          understoryCounts.drawCalls,
        visibleInstancedBatches:
          visibleGrassBatches.length +
          visibleTreeBatches.length +
          autumnDrawCalls +
          understoryCounts.visibleDrawCalls,
        triangles:
          visibleGrassBatches.reduce(
            (sum, chunk) => sum + GRASS_TRIANGLES_PER_DETAIL * chunk.detail * chunk.visibleCount,
            0,
          ) +
          visibleTreeBatches.reduce(
            (sum, batch) => sum + batch.trianglesPerInstance * batch.instances,
            0,
          ) +
          autumnCounts.flowerInstances * 4 +
          autumnCounts.leafLitterInstances * 2 +
          understoryCounts.visibleTriangles,
        drawCalls:
          visibleGrassBatches.length +
          visibleTreeBatches.length +
          autumnDrawCalls +
          understoryCounts.visibleDrawCalls,
        visible: group.visible,
        tileSizeMeters: GRASS_LOGICAL_TILE_SIZE,
        renderBatchSizeMeters: GRASS_RENDER_BATCH_SIZE,
        maxGrassDistanceMeters:
          tier === 'balanced' ? BALANCED_GRASS_DISTANCE : REDUCED_GRASS_DISTANCE,
        influenceResolution: 0,
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
        autumnFlowerInstances: autumnCounts.flowerInstances,
        autumnLeafLitterInstances: autumnCounts.leafLitterInstances,
        understoryInstances: understoryCounts.instances,
        visibleUnderstoryInstances: understoryCounts.visibleInstances,
        understoryStatus: understoryCounts.status,
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
      autumnGroundDressing?.dispose();
      autumnGroundDressing = null;
      understory?.dispose();
      understory = null;
      grassChunks = [];
      grassLogicalTileCount = 0;
      group.removeFromParent();
      group.clear();
    },
  };
}
