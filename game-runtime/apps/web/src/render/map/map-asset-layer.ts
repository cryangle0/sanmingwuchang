import {
  MAP_CHESTS,
  MAP_HIGHLANDS,
  MAP_SPAWN_POINTS,
  type MapPointMm,
  terrainHeightMeters,
} from '@jwgb/content';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { appendAssetVersion, webAssetUrl } from '../../runtime/asset-url';
import { normalizedAssetScale, WORLD_SCALE_PROFILE } from '../world-scale-profile';
import { yawToward } from './dressing/prop-kit';
import { type RegionId, regionAt } from './map-regions';
import { createRandomStream, type ExclusionZone, sampleOpenGround } from './map-sampling';

const MM = 1_000;
const ASSET_DIR = 'models/map-assets/';
const LANDMARK_CULL_DISTANCE = 210;
const ROCK_CULL_DISTANCE = 165;
const STRUCTURE_CULL_DISTANCE = 195;
const LANDMARK_PREFETCH_DISTANCE = LANDMARK_CULL_DISTANCE + 34;
const ROCK_PREFETCH_DISTANCE = ROCK_CULL_DISTANCE + 24;
const STRUCTURE_PREFETCH_DISTANCE = STRUCTURE_CULL_DISTANCE + 30;
const OCCLUSION_UPDATE_INTERVAL_FRAMES = 3;

export type MapAssetGraphicsTier = 'balanced' | 'reduced';

export interface MapAssetCatalogEntry {
  readonly id: string;
  readonly fileName: string;
  readonly kind: 'landmark' | 'rock' | 'structure';
  readonly targetHeight: number;
  readonly source: string;
}

/**
 * Runtime catalog for the converted assets only. Source packages stay outside
 * the web bundle; this list is the small, optimized delivery surface.
 */
export const MAP_ASSET_CATALOG: readonly MapAssetCatalogEntry[] = [
  {
    id: 'wuxia-gate-court',
    fileName: 'wuxia-gate-court.glb',
    kind: 'landmark',
    targetHeight: 30,
    source: '80 wuxia scene pack / 51.FBX',
  },
  {
    id: 'wuxia-citadel',
    fileName: 'wuxia-citadel.glb',
    kind: 'landmark',
    targetHeight: 34,
    source: '80 wuxia scene pack / 45.FBX',
  },
  {
    id: 'wuxia-east-asia-hall',
    fileName: 'wuxia-east-asia-hall.glb',
    kind: 'landmark',
    targetHeight: 32,
    source: '80 wuxia scene pack / 54.FBX',
  },
  {
    id: 'wuxia-mountain-gate',
    fileName: 'wuxia-mountain-gate.glb',
    kind: 'landmark',
    targetHeight: 34,
    source: '80 wuxia scene pack / 60.FBX',
  },
  {
    id: 'lowpoly-asian-village',
    fileName: 'lowpoly-asian-village.glb',
    kind: 'landmark',
    targetHeight: 18,
    source: '0072 Lowpoly Style Ultra Pack 1.2 / precomposed Asian village',
  },
  {
    id: 'lowpoly-asian-house',
    fileName: 'asia-house.glb',
    kind: 'landmark',
    targetHeight: 12,
    source: '0072 Lowpoly Style Ultra Pack 1.2 / AsianHouse_2.fbx',
  },
  {
    id: 'lowpoly-torii',
    fileName: 'torii-2.glb',
    kind: 'landmark',
    targetHeight: 10,
    source: '0072 Lowpoly Style Ultra Pack 1.2 / Torii2.fbx',
  },
  {
    id: 'lowpoly-rock-formation',
    fileName: 'rock-formation-2.glb',
    kind: 'landmark',
    targetHeight: 5.2,
    source: '0072 Lowpoly Style Ultra Pack 1.2 / RockFormation2.fbx',
  },
  {
    id: 'free-pagoda-niko313',
    fileName: 'free-pagoda-niko313.glb',
    kind: 'landmark',
    targetHeight: 16,
    source: 'free-assets-3d/_converted/sketchfab-pagoda-niko313.glb',
  },
  {
    id: 'free-stone-cart',
    fileName: 'free-stone-cart.glb',
    kind: 'landmark',
    targetHeight: 2.866,
    source: 'free-assets-3d/_converted/stone-cart-daydev.glb',
  },
  {
    id: 'free-stone-lion',
    fileName: 'free-stone-lion.glb',
    kind: 'landmark',
    targetHeight: 1.8,
    source: 'free-assets-3d/_converted/stone-lion-fpan.glb',
  },
  {
    id: 'tang-hall',
    fileName: 'tang-hall.glb',
    kind: 'structure',
    targetHeight: 10.29,
    source: 'procedural 唐宋建筑族 / 重檐大殿',
  },
  {
    id: 'tang-pagoda',
    fileName: 'tang-pagoda.glb',
    kind: 'structure',
    targetHeight: 20,
    source: 'procedural 唐宋建筑族 / 八角宝塔',
  },
  {
    id: 'tang-paifang',
    fileName: 'tang-paifang.glb',
    kind: 'structure',
    targetHeight: 6.49,
    source: 'procedural 唐宋建筑族 / 牌坊',
  },
  {
    id: 'tang-gate-tower',
    fileName: 'tang-gate-tower.glb',
    kind: 'structure',
    targetHeight: 11.64,
    source: 'procedural 唐宋建筑族 / 城门楼',
  },
  {
    id: 'tang-inn',
    fileName: 'tang-inn.glb',
    kind: 'structure',
    targetHeight: 9.591,
    source: 'procedural 唐宋建筑族 / 客栈',
  },
  {
    id: 'tang-teahouse',
    fileName: 'tang-teahouse.glb',
    kind: 'structure',
    targetHeight: 5.14,
    source: 'procedural 唐宋建筑族 / 茶棚',
  },
  {
    id: 'tang-shrine',
    fileName: 'tang-shrine.glb',
    kind: 'structure',
    targetHeight: 4.09,
    source: 'procedural 唐宋建筑族 / 土地庙',
  },
  {
    id: 'tang-drum-tower',
    fileName: 'tang-drum-tower.glb',
    kind: 'structure',
    targetHeight: 10.8,
    source: 'procedural 唐宋建筑族 / 钟鼓楼',
  },
  {
    id: 'tang-corridor',
    fileName: 'tang-corridor.glb',
    kind: 'structure',
    targetHeight: 4.689,
    source: 'procedural 唐宋建筑族 / 回廊',
  },
  {
    id: 'tang-scripture-pillar',
    fileName: 'tang-scripture-pillar.glb',
    kind: 'structure',
    targetHeight: 7.355,
    source: 'procedural 唐宋建筑族 / 经幢',
  },
  {
    id: 'tang-stele',
    fileName: 'tang-stele.glb',
    kind: 'structure',
    targetHeight: 3.77,
    source: 'procedural 唐宋建筑族 / 石碑',
  },
  {
    id: 'tang-lantern-post',
    fileName: 'tang-lantern-post.glb',
    kind: 'structure',
    targetHeight: 4.295,
    source: 'procedural 唐宋建筑族 / 灯柱',
  },
  {
    id: 'tang-well',
    fileName: 'tang-well.glb',
    kind: 'structure',
    targetHeight: 3.99,
    source: 'procedural 唐宋建筑族 / 井亭',
  },
  {
    id: 'free-pagoda-ruin',
    fileName: 'free-pagoda-ruin.glb',
    kind: 'landmark',
    targetHeight: 14,
    source: 'free-assets-3d/_converted/stone-pagoda-ruin-daydev.glb',
  },
  {
    id: 'desert-rock-01',
    fileName: 'desert-rock-01.glb',
    kind: 'rock',
    targetHeight: 2.8,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-02',
    fileName: 'desert-rock-02.glb',
    kind: 'rock',
    targetHeight: 3.4,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-03',
    fileName: 'desert-rock-03.glb',
    kind: 'rock',
    targetHeight: 4.1,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-04',
    fileName: 'desert-rock-04.glb',
    kind: 'rock',
    targetHeight: 2.3,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-05',
    fileName: 'desert-rock-05.glb',
    kind: 'rock',
    targetHeight: 3.1,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-06',
    fileName: 'desert-rock-06.glb',
    kind: 'rock',
    targetHeight: 2.6,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-07',
    fileName: 'desert-rock-07.glb',
    kind: 'rock',
    targetHeight: 3.8,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-08',
    fileName: 'desert-rock-08.glb',
    kind: 'rock',
    targetHeight: 2.2,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-09',
    fileName: 'desert-rock-09.glb',
    kind: 'rock',
    targetHeight: 1.9,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-10',
    fileName: 'desert-rock-10.glb',
    kind: 'rock',
    targetHeight: 1.6,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-11',
    fileName: 'desert-rock-11.glb',
    kind: 'rock',
    targetHeight: 1.7,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-12',
    fileName: 'desert-rock-12.glb',
    kind: 'rock',
    targetHeight: 1.8,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-13',
    fileName: 'desert-rock-13.glb',
    kind: 'rock',
    targetHeight: 1.5,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-14',
    fileName: 'desert-rock-14.glb',
    kind: 'rock',
    targetHeight: 1.4,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-15',
    fileName: 'desert-rock-15.glb',
    kind: 'rock',
    targetHeight: 1.3,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'stylized-rock-01',
    fileName: 'stylized-rock-01.glb',
    kind: 'rock',
    targetHeight: 3.2,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-02',
    fileName: 'stylized-rock-02.glb',
    kind: 'rock',
    targetHeight: 2.1,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-03',
    fileName: 'stylized-rock-03.glb',
    kind: 'rock',
    targetHeight: 2.6,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-04',
    fileName: 'stylized-rock-04.glb',
    kind: 'rock',
    targetHeight: 3.3,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-05',
    fileName: 'stylized-rock-05.glb',
    kind: 'rock',
    targetHeight: 3.8,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-06',
    fileName: 'stylized-rock-06.glb',
    kind: 'rock',
    targetHeight: 4.1,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-07',
    fileName: 'stylized-rock-07.glb',
    kind: 'rock',
    targetHeight: 4.6,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-08',
    fileName: 'stylized-rock-08.glb',
    kind: 'rock',
    targetHeight: 4.2,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-09',
    fileName: 'stylized-rock-09.glb',
    kind: 'rock',
    targetHeight: 4.6,
    source: 'C1524 stone01 / ST-PaCK',
  },
] as const;

const CATALOG_BY_ID = new Map(MAP_ASSET_CATALOG.map((entry) => [entry.id, entry]));
const REDUCED_LANDMARK_ASSET_IDS = [
  'lowpoly-asian-village',
  'free-pagoda-niko313',
  'free-pagoda-ruin',
] as const;
const REDUCED_ROCK_ASSET_IDS = [
  'desert-rock-01',
  'desert-rock-05',
  'desert-rock-09',
  'desert-rock-13',
  'stylized-rock-01',
  'stylized-rock-04',
  'stylized-rock-07',
] as const;
/** The reduced tier keeps only the silhouette-defining buildings per district. */
const REDUCED_STRUCTURE_ASSET_IDS = [
  'tang-hall',
  'tang-pagoda',
  'tang-gate-tower',
  'tang-inn',
  'tang-shrine',
] as const;
const REDUCED_LANDMARK_ASSET_SET = new Set<string>(REDUCED_LANDMARK_ASSET_IDS);
const REDUCED_STRUCTURE_ASSET_SET = new Set<string>(REDUCED_STRUCTURE_ASSET_IDS);
const CITADEL_ITEM_SOURCE_GROUND_Y = 4.475;
const CITADEL_PLATEAU_TARGET_Y = -0.45;

interface CitadelGroundSite {
  readonly x: number;
  readonly z: number;
  readonly sourceGroundY: number;
  readonly targetGroundY?: number;
}

/**
 * 45.FBX authored each pavilion on a different source-terrain step. The
 * converter intentionally removed that terrain, then mesh optimization joined
 * the pavilions into two large meshes, so node-level grounding cannot fix the
 * remaining gaps. These anchors preserve each pavilion as a rigid local group
 * while moving its original footing onto the runtime plateau.
 */
const CITADEL_GROUND_SITES: readonly CitadelGroundSite[] = [
  { x: -26.009, z: -32.384, sourceGroundY: 0.002 },
  { x: -30.148, z: 26.741, sourceGroundY: 0.504 },
  { x: -26.859, z: -16.301, sourceGroundY: 4.804 },
  { x: 30.373, z: 9.084, sourceGroundY: 5.137 },
  { x: 16.484, z: 45.627, sourceGroundY: 7.293 },
  // This southern pavilion extends beyond the authored plateau and lands on
  // the rising terrain below, whose surface is 2.3 local metres above it.
  { x: 25.638, z: -59.043, sourceGroundY: 10.056, targetGroundY: 2.3 },
  { x: 29.825, z: -5.996, sourceGroundY: 11.872 },
  { x: 21.219, z: -33.078, sourceGroundY: 12.022 },
  { x: 27.018, z: -23.12, sourceGroundY: 14.694 },
  { x: 11.621, z: -47.11, sourceGroundY: 19.515 },
  { x: -22.568, z: 46.475, sourceGroundY: 19.502 },
] as const;

export interface MapAssetPlacement {
  readonly id: string;
  readonly assetId: string;
  readonly kind: 'landmark' | 'rock' | 'structure';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly worldHeight: number;
  readonly scale: number;
  readonly maxDistance: number;
}

export interface MapAssetLayerDiagnostics {
  readonly status: 'disabled' | 'loading' | 'ready' | 'failed' | 'disposed';
  readonly loadedAssets: readonly string[];
  readonly failedAssets: readonly string[];
  readonly landmarks: readonly MapAssetLandmarkDiagnostics[];
  readonly landmarkInstances: number;
  readonly visibleLandmarkInstances: number;
  readonly rockInstances: number;
  readonly visibleRockInstances: number;
  readonly structureInstances: number;
  readonly visibleStructureInstances: number;
  /** Nearest structures to the last visibility reference, capped for size. */
  readonly structures: readonly MapAssetStructureDiagnostics[];
  readonly instancedBatches: number;
  readonly triangles: number;
  readonly drawCalls: number;
  readonly visible: boolean;
}

export interface MapAssetStructureDiagnostics {
  readonly id: string;
  readonly assetId: string;
  readonly position: readonly [number, number, number];
  readonly worldHeight: number;
  readonly scale: number;
  readonly distance: number;
  readonly visible: boolean;
}

export interface MapAssetLandmarkDiagnostics {
  readonly id: string;
  readonly assetId: string;
  readonly position: readonly [number, number, number];
  readonly worldHeight: number;
  readonly scale: number;
  readonly visible: boolean;
  readonly meshCount: number;
  readonly triangles: number;
  readonly bounds: readonly [number, number, number, number, number, number];
}

export interface MapAssetLayer {
  readonly group: THREE.Group;
  setGraphicsTier(tier: MapAssetGraphicsTier): void;
  update(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void;
  diagnostics(): MapAssetLayerDiagnostics;
  dispose(): void;
}

interface AssetPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly triangles: number;
}

interface AssetTemplate {
  readonly id: string;
  readonly path: string;
  readonly parts: readonly AssetPart[];
  readonly triangles: number;
}

interface LandmarkRuntime {
  readonly placement: MapAssetPlacement;
  readonly group: THREE.Group;
  readonly bounds: THREE.Box3;
}

interface RockBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly trianglesPerInstance: number;
  readonly placements: readonly MapAssetPlacement[];
  readonly matrices: readonly THREE.Matrix4[];
  readonly colours: readonly THREE.Color[];
}

interface FallbackRockMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly matricesByPlacementId: ReadonlyMap<string, THREE.Matrix4>;
  readonly originalMatrices: readonly THREE.Matrix4[];
  readonly originalCount: number;
}

const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();
const tempScale = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const tempColour = new THREE.Color();
const neutralRock = new THREE.Color(0x7c776c);

function hashAt(x: number, z: number, salt: number, seed: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7 + seed * 0.0001) * 43_758.5453123;
  return value - Math.floor(value);
}

function averagePoint(points: readonly MapPointMm[]): { readonly x: number; readonly z: number } {
  if (points.length === 0) {
    return { x: 0, z: 0 };
  }
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length / MM,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length / MM,
  };
}

function catalogEntry(assetId: string): MapAssetCatalogEntry {
  const entry = CATALOG_BY_ID.get(assetId);
  if (!entry) {
    throw new Error(`map assets: unknown asset ${assetId}`);
  }
  return entry;
}

function landmarkPlacement(
  id: string,
  assetId: string,
  point: { readonly x: number; readonly z: number },
  worldHeight: number,
  yaw: number,
  lift = 0.08,
): MapAssetPlacement {
  return assetPlacement(id, assetId, point, worldHeight, yaw, 'landmark', lift);
}

function assetPlacement(
  id: string,
  assetId: string,
  point: { readonly x: number; readonly z: number },
  worldHeight: number,
  yaw: number,
  kind: 'landmark' | 'structure',
  lift: number,
  scaleMultiplier = 1,
  groundY?: number,
): MapAssetPlacement {
  const targetHeight = catalogEntry(assetId).targetHeight;
  return {
    id,
    assetId,
    kind,
    x: point.x,
    y: (groundY ?? terrainHeightMeters(point.x, point.z)) + lift,
    z: point.z,
    yaw,
    worldHeight,
    scale: normalizedAssetScale(targetHeight, worldHeight) * scaleMultiplier,
    maxDistance: kind === 'structure' ? STRUCTURE_CULL_DISTANCE : LANDMARK_CULL_DISTANCE,
  };
}

/**
 * Themed building mix per district. Every list is ordered so that the scatter
 * cycles through the whole family before repeating, which keeps a district from
 * filling up with one silhouette.
 */
const DISTRICT_BUILDING_MIX: Readonly<Record<RegionId, readonly string[]>> = {
  duanjin: ['tang-inn', 'tang-teahouse', 'tang-paifang', 'tang-lantern-post', 'tang-stele'],
  zhusi: ['tang-shrine', 'tang-stele', 'tang-scripture-pillar', 'tang-lantern-post', 'tang-well'],
  longji: ['tang-scripture-pillar', 'tang-pagoda', 'tang-drum-tower', 'tang-stele', 'tang-well'],
  baizu: [
    'tang-hall',
    'tang-gate-tower',
    'tang-pagoda',
    'tang-drum-tower',
    'tang-corridor',
    'tang-lantern-post',
  ],
  jinshui: ['tang-inn', 'tang-teahouse', 'tang-paifang', 'tang-lantern-post', 'tang-well'],
  mihun: ['tang-shrine', 'tang-teahouse', 'tang-well', 'tang-stele', 'tang-scripture-pillar'],
  santing: ['tang-hall', 'tang-pagoda', 'tang-paifang', 'tang-drum-tower', 'tang-corridor'],
};

/** Buildings placed per district, tuned against the instanced draw budget. */
const DISTRICT_BUILDING_TARGETS: Readonly<Record<RegionId, number>> = {
  duanjin: 12,
  zhusi: 10,
  longji: 10,
  baizu: 14,
  jinshui: 12,
  mihun: 10,
  santing: 6,
};

const BUILDING_SPACING_METERS = 26;
/** Imported landmarks are authored scenic anchors; keep buildings off them. */
const BUILDING_LANDMARK_CLEAR_METERS = 30;
/** Radius the vegetation layers keep clear around each building site, mm. */
const BUILDING_CLEARING_MM = 13_000;
/**
 * Clearances are measured from the site anchor, so they must cover the largest
 * footprint (a 14 m gate tower at up to +8% scale) plus room to walk past it.
 */
const BUILDING_ROAD_VERGE_MM = 9_000;
const BUILDING_CHEST_CLEAR_MM = 9_000;
const BUILDING_SPAWN_CLEAR_MM = 15_000;

function buildingSites(
  seed: number,
  landmarkSites: readonly { readonly x: number; readonly z: number }[],
): readonly {
  readonly region: RegionId;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly groundY: number;
  readonly step: number;
}[] {
  const nextRandom = createRandomStream(seed ^ 0x5bf03635);
  const sampled = sampleOpenGround(2_400, 26_000, nextRandom, {
    roadVergeMm: BUILDING_ROAD_VERGE_MM,
  });
  const buckets = new Map<
    RegionId,
    { x: number; z: number; yaw: number; groundY: number; step: number }[]
  >();
  for (const point of sampled) {
    const xMeters = point.x / MM;
    const zMeters = point.z / MM;
    if (nearBuildingBlocker(point.x, point.z)) {
      continue;
    }
    if (
      landmarkSites.some(
        (landmark) =>
          Math.hypot(landmark.x - xMeters, landmark.z - zMeters) < BUILDING_LANDMARK_CLEAR_METERS,
      )
    ) {
      continue;
    }
    const region = regionAt(xMeters, zMeters);
    const bucket = buckets.get(region.id) ?? [];
    if (bucket.length >= DISTRICT_BUILDING_TARGETS[region.id]) {
      continue;
    }
    const spaced = bucket.every((site) => {
      const dx = site.x - xMeters;
      const dz = site.z - zMeters;
      return dx * dx + dz * dz >= BUILDING_SPACING_METERS * BUILDING_SPACING_METERS;
    });
    if (!spaced) {
      continue;
    }
    // A flat-bottomed building on a slope floats on its downhill side. Reject
    // sites whose footprint steps more than the plinth can absorb, and ground
    // the survivors on the lowest corner so nothing hovers.
    const footprint = footprintGroundMeters(xMeters, zMeters);
    if (footprint === null) {
      continue;
    }
    bucket.push({
      x: xMeters,
      z: zMeters,
      yaw: nextRandom() * Math.PI * 2,
      groundY: footprint.groundY,
      step: footprint.step,
    });
    buckets.set(region.id, bucket);
  }
  return [...buckets.entries()].flatMap(([region, sites]) =>
    sites.map((site) => ({ region, ...site })),
  );
}

/** Largest footprint half-extent in the family (the 14 m gate tower). */
const BUILDING_FOOTPRINT_HALF_METERS = 7.2;
/**
 * Terrain step a footprint may span, metres. Buildings are grounded on their
 * lowest corner, so this is how deep the uphill side may bury: past ~1.5 m a
 * hall still reads as built into the slope, which is why steeper sites are
 * dropped rather than sunk.
 */
const BUILDING_MAX_FOOTPRINT_STEP_METERS = 1.5;

/**
 * Ground height for a building centred here, or null when the footprint is too
 * steep to sit on. Returns the lowest corner, so the downhill edge of the
 * plinth always meets the terrain and the uphill edge buries into the slope.
 */
function footprintGroundMeters(
  xMeters: number,
  zMeters: number,
): { readonly groundY: number; readonly step: number } | null {
  const offsets: readonly (readonly [number, number])[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [0.7, -0.7],
    [-0.7, 0.7],
    [-0.7, -0.7],
  ];
  let lowest = terrainHeightMeters(xMeters, zMeters);
  let highest = lowest;
  for (const [dx, dz] of offsets) {
    const height = terrainHeightMeters(
      xMeters + dx * BUILDING_FOOTPRINT_HALF_METERS,
      zMeters + dz * BUILDING_FOOTPRINT_HALF_METERS,
    );
    lowest = Math.min(lowest, height);
    highest = Math.max(highest, height);
  }
  if (highest - lowest > BUILDING_MAX_FOOTPRINT_STEP_METERS) {
    return null;
  }
  return { groundY: lowest, step: highest - lowest };
}

function nearBuildingBlocker(xMm: number, zMm: number): boolean {
  for (const chest of MAP_CHESTS) {
    const dx = chest.position.x - xMm;
    const dz = chest.position.z - zMm;
    if (dx * dx + dz * dz < BUILDING_CHEST_CLEAR_MM * BUILDING_CHEST_CLEAR_MM) {
      return true;
    }
  }
  for (const spawn of MAP_SPAWN_POINTS) {
    const dx = spawn.position.x - xMm;
    const dz = spawn.position.z - zMm;
    if (dx * dx + dz * dz < BUILDING_SPAWN_CLEAR_MM * BUILDING_SPAWN_CLEAR_MM) {
      return true;
    }
  }
  return false;
}

/**
 * Clearings the vegetation layers must keep free so every building stands in
 * the open instead of under the canopy. Pure and seed-stable, so the flora,
 * grass and understory passes agree with the placement plan without sharing
 * mutable state.
 */
export function configureMapBuildingClearings(seed: number): readonly ExclusionZone[] {
  if (buildingClearingsCache?.seed !== seed) {
    const landmarks = importedLandmarkPlacements();
    buildingClearingsCache = {
      seed,
      zones: buildingSites(seed, landmarks).map((site) => ({
        x: Math.round(site.x * MM),
        z: Math.round(site.z * MM),
        radiusMm: BUILDING_CLEARING_MM,
      })),
    };
  }
  return buildingClearingsCache.zones;
}

/**
 * Clearings for the map build that is currently being assembled. The map
 * environment configures the seed once; every vegetation pass then reads the
 * same discs, so no sampler can plant a tree inside a hall.
 */
export function mapBuildingClearanceZones(): readonly ExclusionZone[] {
  return buildingClearingsCache?.zones ?? configureMapBuildingClearings(1);
}

let buildingClearingsCache: { seed: number; zones: readonly ExclusionZone[] } | null = null;

/**
 * Places imported scenery on authored highland/edge anchors plus the
 * procedural building family in every district, instead of walkable combat
 * lanes. The plan is render-only and never enters collision.
 */
export function createMapAssetPlacementPlan(seed = 1): readonly MapAssetPlacement[] {
  return [...importedLandmarkPlacements(), ...buildingPlacements(seed)];
}

/** The authored imported landmarks, before the procedural buildings. */
export function importedLandmarkPlacements(): readonly MapAssetPlacement[] {
  const highlandCentral = averagePoint(MAP_HIGHLANDS[1]?.vertices ?? []);
  const highlandNorth = averagePoint(MAP_HIGHLANDS[2]?.vertices ?? []);
  // The converted wuxia citadel and gate court are not placed. Their source
  // scenes authored buildings and props on separate terrain steps; after that
  // terrain was stripped, the surviving nodes read as shattered, floating
  // compounds when viewed from the eastern and western map rims.
  const centralHallSite = { x: -70, z: -56 };
  const northHighlandSite = { x: highlandNorth.x + 4, z: highlandNorth.z - 5 };
  const westVillageSite = { x: -342, z: -68 };
  const westGateSite = { x: -365, z: 36 };
  const westHouseSite = { x: westVillageSite.x - 18, z: westVillageSite.z - 25 };
  const freePagodaSite = { x: highlandCentral.x - 7, z: highlandCentral.z + 3 };
  const freeRuinPagodaSite = { x: highlandNorth.x + 15, z: highlandNorth.z + 12 };
  const freeStoneLionSite = { x: westGateSite.x + 9, z: westGateSite.z + 12 };
  const freeStoneCartSite = { x: westVillageSite.x + 22, z: westVillageSite.z + 13 };

  const landmarks: MapAssetPlacement[] = [
    landmarkPlacement(
      'imported-landmark-central-hall',
      'wuxia-east-asia-hall',
      centralHallSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['wuxia-east-asia-hall'],
      yawToward(centralHallSite.x, centralHallSite.z, -12.3, -58.6) - 0.18,
      0.06,
    ),
    landmarkPlacement(
      'imported-landmark-north-highland',
      'wuxia-mountain-gate',
      northHighlandSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['wuxia-mountain-gate'],
      yawToward(northHighlandSite.x, northHighlandSite.z, highlandNorth.x, highlandNorth.z) + 0.2,
    ),
    landmarkPlacement(
      'imported-landmark-west-village',
      'lowpoly-asian-village',
      westVillageSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['lowpoly-asian-village'],
      yawToward(westVillageSite.x, westVillageSite.z, -330.7, -82) + 0.12,
    ),
    landmarkPlacement(
      'imported-landmark-west-house',
      'lowpoly-asian-house',
      westHouseSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['lowpoly-asian-house'],
      yawToward(westHouseSite.x, westHouseSite.z, westVillageSite.x, westVillageSite.z) + 0.18,
    ),
    landmarkPlacement(
      'imported-landmark-west-torii',
      'lowpoly-torii',
      { x: westVillageSite.x - 3, z: westVillageSite.z + 19 },
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['lowpoly-torii'],
      yawToward(westVillageSite.x - 3, westVillageSite.z + 19, -330.7, -82),
    ),
    landmarkPlacement(
      'imported-landmark-north-rock-formation',
      'lowpoly-rock-formation',
      { x: northHighlandSite.x + 13, z: northHighlandSite.z + 8 },
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['lowpoly-rock-formation'],
      yawToward(
        northHighlandSite.x + 13,
        northHighlandSite.z + 8,
        highlandNorth.x,
        highlandNorth.z,
      ),
    ),
    landmarkPlacement(
      'free-landmark-pagoda',
      'free-pagoda-niko313',
      freePagodaSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['free-pagoda-niko313'],
      yawToward(freePagodaSite.x, freePagodaSite.z, highlandCentral.x, highlandCentral.z) + 0.16,
    ),
    landmarkPlacement(
      'free-landmark-ruin-pagoda',
      'free-pagoda-ruin',
      freeRuinPagodaSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['free-pagoda-ruin'],
      yawToward(freeRuinPagodaSite.x, freeRuinPagodaSite.z, highlandNorth.x, highlandNorth.z) - 0.1,
    ),
    landmarkPlacement(
      'free-landmark-stone-lion',
      'free-stone-lion',
      freeStoneLionSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['free-stone-lion'],
      yawToward(freeStoneLionSite.x, freeStoneLionSite.z, westGateSite.x, westGateSite.z),
    ),
    landmarkPlacement(
      'free-landmark-stone-cart',
      'free-stone-cart',
      freeStoneCartSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['free-stone-cart'],
      yawToward(freeStoneCartSite.x, freeStoneCartSite.z, westVillageSite.x, westVillageSite.z) +
        0.3,
    ),
  ];

  // Imported MAP_ROCKS were visibly faceted, pale low-poly placeholders in
  // the forest. Keep their catalog entries for asset provenance, but do not
  // place either the imported meshes or their procedural fallback markers.
  return landmarks;
}

/**
 * Scatters the 唐宋 building family across every district so the maze reads as
 * an inhabited city instead of an empty arena. Sites come from the shared open
 * ground sampler, so buildings never block a road, chest or spawn pad.
 */
function buildingPlacements(seed: number): readonly MapAssetPlacement[] {
  const placements: MapAssetPlacement[] = [];
  const usedPerAsset = new Map<string, number>();
  const sites = buildingSites(seed, importedLandmarkPlacements());
  const perRegionCount = new Map<RegionId, number>();
  for (const site of sites) {
    const mix = DISTRICT_BUILDING_MIX[site.region];
    const index = perRegionCount.get(site.region) ?? 0;
    perRegionCount.set(site.region, index + 1);
    const assetId = mix[index % mix.length] as string;
    const height = WORLD_SCALE_PROFILE.map.structureWorldHeights[assetId];
    if (!height) {
      throw new Error(`map assets: no structure world height for ${assetId}`);
    }
    const ordinal = (usedPerAsset.get(assetId) ?? 0) + 1;
    usedPerAsset.set(assetId, ordinal);
    // A small deterministic scale spread keeps rows of the same building from
    // reading as exact clones.
    const scaleMultiplier = 0.92 + ((ordinal * 37) % 17) / 100;
    placements.push(
      assetPlacement(
        `building-${site.region}-${assetId}-${ordinal}`,
        assetId,
        site,
        height,
        site.yaw,
        'structure',
        0.03,
        scaleMultiplier,
        site.groundY,
      ),
    );
  }
  return placements;
}

function assetUrl(assetId: string): string {
  return appendAssetVersion(webAssetUrl(`${ASSET_DIR}${catalogEntry(assetId).fileName}`));
}

function copyMaterial(source: THREE.Material, assetId: string): THREE.Material {
  const material = source.clone();
  material.name = `${assetId}-${source.name || 'material'}`;
  material.side = THREE.FrontSide;
  if (
    material instanceof THREE.MeshStandardMaterial &&
    (assetId === 'lowpoly-asian-house' || assetId === 'lowpoly-torii') &&
    /roof|tile/i.test(source.name)
  ) {
    // Older converted deliveries may still contain the source package's
    // black BLEND roof material. Keep the runtime resilient while the
    // converter produces the corrected opaque, tinted roof.
    material.color.set(0xa84d35);
    material.transparent = false;
    material.opacity = 1;
    material.alphaTest = 0;
    material.depthWrite = true;
    material.roughness = Math.max(material.roughness, 0.84);
    material.metalness = Math.min(material.metalness, 0.04);
    material.emissive.set(0x2a0b06);
    material.emissiveIntensity = 0.12;
    material.needsUpdate = true;
  }
  material.needsUpdate = true;
  return material;
}

function materializeGeometryAttributes(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.clone();
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name);
    const values = new Float32Array(attribute.count * attribute.itemSize);
    for (let index = 0; index < attribute.count; index += 1) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        values[index * attribute.itemSize + component] = attribute.getComponent(index, component);
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, false));
  }
  return geometry;
}

export function mapAssetVertexGroundingOffset(
  assetId: string,
  nodeName: string,
  x: number,
  z: number,
): number {
  if (
    assetId !== 'wuxia-citadel' ||
    (nodeName !== '3005_Building_05' && nodeName !== '3005_Item_15') ||
    !Number.isFinite(x) ||
    !Number.isFinite(z)
  ) {
    return 0;
  }
  let nearest = CITADEL_GROUND_SITES[0] as CitadelGroundSite;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const site of CITADEL_GROUND_SITES) {
    const dx = x - site.x;
    const dz = z - site.z;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared < nearestDistanceSquared) {
      nearest = site;
      nearestDistanceSquared = distanceSquared;
    }
  }
  const sourceGroundY =
    nodeName === '3005_Item_15'
      ? Math.max(CITADEL_ITEM_SOURCE_GROUND_Y, nearest.sourceGroundY)
      : nearest.sourceGroundY;
  return (nearest.targetGroundY ?? CITADEL_PLATEAU_TARGET_Y) - sourceGroundY;
}

function groundMapAssetGeometry(
  assetId: string,
  nodeName: string,
  geometry: THREE.BufferGeometry,
): void {
  const position = geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute)) {
    return;
  }
  const index = geometry.getIndex();
  const drawStart = geometry.drawRange.start;
  const availableCount = index?.count ?? position.count;
  const drawCount = Number.isFinite(geometry.drawRange.count)
    ? Math.min(geometry.drawRange.count, availableCount - drawStart)
    : availableCount - drawStart;
  let changed = false;
  for (let cursor = drawStart; cursor + 2 < drawStart + drawCount; cursor += 3) {
    const first = index?.getX(cursor) ?? cursor;
    const second = index?.getX(cursor + 1) ?? cursor + 1;
    const third = index?.getX(cursor + 2) ?? cursor + 2;
    const centreX = (position.getX(first) + position.getX(second) + position.getX(third)) / 3;
    const centreZ = (position.getZ(first) + position.getZ(second) + position.getZ(third)) / 3;
    const offset = mapAssetVertexGroundingOffset(assetId, nodeName, centreX, centreZ);
    if (offset === 0) {
      continue;
    }
    position.setY(first, position.getY(first) + offset);
    position.setY(second, position.getY(second) + offset);
    position.setY(third, position.getY(third) + offset);
    changed = true;
  }
  if (changed) {
    position.needsUpdate = true;
  }
}

function extractTemplate(assetId: string, scene: THREE.Group): AssetTemplate {
  scene.updateMatrixWorld(true);
  const parts: AssetPart[] = [];
  const sourceGeometries = new Set<THREE.BufferGeometry>();
  const sourceMaterials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    sourceGeometries.add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      sourceMaterials.add(material);
    });
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
    for (const group of groups) {
      const sourceMaterial = materials[group.materialIndex ?? 0] ?? materials[0];
      if (!sourceMaterial || group.count <= 0) {
        continue;
      }
      // GLTF meshopt/quantized assets commonly expose normalized
      // InterleavedBufferAttributes. BufferGeometry.applyMatrix4() cannot
      // write transformed values back into those integer buffers without
      // clamping them to [-1, 1], which collapses imported landmarks to tiny
      // invisible dots. Materialize to float attributes before baking the
      // node transform.
      const geometry = materializeGeometryAttributes(object.geometry);
      geometry.clearGroups();
      geometry.setDrawRange(group.start, group.count);
      geometry.applyMatrix4(object.matrixWorld);
      groundMapAssetGeometry(assetId, object.name, geometry);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const position = geometry.getAttribute('position');
      const triangles = Math.floor((geometry.index?.count ?? position?.count ?? 0) / 3);
      parts.push({
        geometry,
        material: copyMaterial(sourceMaterial, assetId),
        triangles,
      });
    }
  });
  for (const geometry of sourceGeometries) {
    geometry.dispose();
  }
  for (const material of sourceMaterials) {
    material.dispose();
  }
  if (parts.length === 0) {
    throw new Error(`map assets: ${assetId} has no renderable parts`);
  }
  return {
    id: assetId,
    path: assetUrl(assetId),
    parts,
    triangles: parts.reduce((sum, part) => sum + part.triangles, 0),
  };
}

async function loadTemplate(loader: GLTFLoader, assetId: string): Promise<AssetTemplate> {
  const gltf = await loader.loadAsync(assetUrl(assetId));
  return extractTemplate(assetId, gltf.scene);
}

function disposeTemplate(template: AssetTemplate): void {
  const textures = new Set<THREE.Texture>();
  for (const part of template.parts) {
    part.geometry.dispose();
    for (const value of Object.values(part.material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) {
        textures.add(value);
      }
    }
    part.material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
  }
}

function disposeRockBatches(batches: readonly RockBatch[]): void {
  for (const batch of batches) {
    batch.mesh.removeFromParent();
  }
}

function colorForRock(placement: MapAssetPlacement): THREE.Color {
  const region = regionAt(placement.x, placement.z);
  tempColour.setHex(region.groundAlt).lerp(neutralRock, 0.64);
  tempColour.offsetHSL(
    (hashAt(placement.x, placement.z, 31, 1) - 0.5) * 0.025,
    (hashAt(placement.x, placement.z, 37, 1) - 0.5) * 0.07,
    (hashAt(placement.x, placement.z, 41, 1) - 0.5) * 0.06,
  );
  return tempColour.clone();
}

function makeStructureMatrix(placement: MapAssetPlacement): THREE.Matrix4 {
  // Buildings stay upright: only a tiny deterministic yaw jitter so repeated
  // models do not line up, never a tilt that would lift a corner off the ground.
  tempEuler.set(0, placement.yaw + (hashAt(placement.x, placement.z, 61, 1) - 0.5) * 0.14, 0);
  tempQuaternion.setFromEuler(tempEuler);
  tempScale.setScalar(placement.scale);
  tempPosition.set(placement.x, placement.y, placement.z);
  tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
  return tempMatrix.clone();
}

/** Buildings carry their colour in the mesh, so instance tint stays neutral. */
function colorForStructure(): THREE.Color {
  return tempColour.setRGB(1, 1, 1).clone();
}

function makeRockMatrix(placement: MapAssetPlacement): THREE.Matrix4 {
  tempEuler.set(
    (hashAt(placement.x, placement.z, 47, 1) - 0.5) * 0.12,
    placement.yaw,
    (hashAt(placement.x, placement.z, 53, 1) - 0.5) * 0.12,
  );
  tempQuaternion.setFromEuler(tempEuler);
  tempScale.setScalar(placement.scale);
  tempPosition.set(placement.x, placement.y, placement.z);
  tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
  return tempMatrix.clone();
}

function placementsForTier(
  placements: readonly MapAssetPlacement[],
  tier: MapAssetGraphicsTier,
): {
  readonly landmarks: readonly MapAssetPlacement[];
  readonly rocks: readonly MapAssetPlacement[];
  readonly structures: readonly MapAssetPlacement[];
} {
  const landmarks = placements.filter(
    (placement) =>
      placement.kind === 'landmark' &&
      (tier === 'balanced' || REDUCED_LANDMARK_ASSET_SET.has(placement.assetId)),
  );
  const structures = placements
    .filter((placement) => placement.kind === 'structure')
    .filter(
      (placement) => tier === 'balanced' || REDUCED_STRUCTURE_ASSET_SET.has(placement.assetId),
    );
  const rockPlacements = placements
    .filter((placement) => placement.kind === 'rock')
    .filter((_, index) => tier === 'balanced' || index % 2 === 0);
  const rocks =
    tier === 'balanced'
      ? rockPlacements
      : rockPlacements.map((placement, index) => {
          const assetId =
            REDUCED_ROCK_ASSET_IDS[
              Math.floor(
                hashAt(placement.x, placement.z, 67 + index, 1) * REDUCED_ROCK_ASSET_IDS.length,
              )
            ] ?? REDUCED_ROCK_ASSET_IDS[0];
          return {
            ...placement,
            assetId,
            scale: normalizedAssetScale(catalogEntry(assetId).targetHeight, placement.worldHeight),
          };
        });
  return { landmarks, rocks, structures };
}

function createLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export function buildMapAssetLayer(
  parent: THREE.Group,
  options: {
    readonly renderer: THREE.WebGLRenderer | null;
    readonly graphicsTier: MapAssetGraphicsTier;
    readonly seed: number;
    readonly fallbackRockGroup?: THREE.Object3D | null;
  },
): MapAssetLayer {
  const group = new THREE.Group();
  group.name = 'map-imported-assets';
  group.visible = false;
  const landmarkGroup = new THREE.Group();
  landmarkGroup.name = 'map-imported-landmarks';
  const structureGroup = new THREE.Group();
  structureGroup.name = 'map-imported-buildings';
  const rockGroup = new THREE.Group();
  rockGroup.name = 'map-imported-rocks';
  group.add(landmarkGroup, structureGroup, rockGroup);
  parent.add(group);

  let tier = options.graphicsTier;
  let status: MapAssetLayerDiagnostics['status'] = options.renderer ? 'loading' : 'disabled';
  let disposed = false;
  let frameCounter = OCCLUSION_UPDATE_INTERVAL_FRAMES - 1;
  let visibleLandmarkInstances = 0;
  let visibleRockInstances = 0;
  let visibleStructureInstances = 0;
  let batches: RockBatch[] = [];
  let structureBatches: RockBatch[] = [];
  let landmarkRuntimes: LandmarkRuntime[] = [];
  const templates = new Map<string, AssetTemplate>();
  const failedAssets: string[] = [];
  const requestedLoads = new Map<string, Promise<void>>();
  const placements = createMapAssetPlacementPlan(options.seed);
  const rockPlacementById = new Map(
    placements
      .filter((placement) => placement.kind === 'rock')
      .map((placement) => [placement.id, placement]),
  );
  const fallbackRockMeshes: FallbackRockMesh[] = [];
  options.fallbackRockGroup?.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh)) {
      return;
    }
    const originalMatrices: THREE.Matrix4[] = [];
    for (let index = 0; index < object.count; index += 1) {
      const source = new THREE.Matrix4();
      object.getMatrixAt(index, source);
      originalMatrices.push(source);
    }
    const matricesByPlacementId = new Map<string, THREE.Matrix4>();
    for (const [index, placement] of [...rockPlacementById.values()].entries()) {
      const source = originalMatrices[index];
      if (source) {
        matricesByPlacementId.set(placement.id, source);
      }
    }
    fallbackRockMeshes.push({
      mesh: object,
      matricesByPlacementId,
      originalMatrices,
      originalCount: object.count,
    });
  });

  const rebuild = (): void => {
    if (disposed) {
      return;
    }
    for (const runtime of landmarkRuntimes) {
      runtime.group.removeFromParent();
    }
    disposeRockBatches(batches);
    batches = [];
    landmarkRuntimes = [];
    const selected = placementsForTier(placements, tier);

    for (const placement of selected.landmarks) {
      const template = templates.get(placement.assetId);
      if (!template) {
        continue;
      }
      const instanceGroup = new THREE.Group();
      instanceGroup.name = placement.id;
      instanceGroup.position.set(placement.x, placement.y, placement.z);
      instanceGroup.rotation.y = placement.yaw;
      instanceGroup.scale.setScalar(placement.scale);
      instanceGroup.userData.mapAssetId = placement.assetId;
      for (const [partIndex, part] of template.parts.entries()) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.name = `${placement.id}-part-${partIndex}`;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        instanceGroup.add(mesh);
      }
      landmarkGroup.add(instanceGroup);
      instanceGroup.updateMatrixWorld(true);
      landmarkRuntimes.push({
        placement,
        group: instanceGroup,
        bounds: new THREE.Box3().setFromObject(instanceGroup),
      });
    }

    const byAsset = new Map<string, MapAssetPlacement[]>();
    for (const placement of selected.rocks) {
      const list = byAsset.get(placement.assetId);
      if (list) {
        list.push(placement);
      } else {
        byAsset.set(placement.assetId, [placement]);
      }
    }
    for (const [assetId, list] of byAsset) {
      const template = templates.get(assetId);
      if (!template) {
        continue;
      }
      for (const [partIndex, part] of template.parts.entries()) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        mesh.name = `map-imported-rock-${assetId}-${partIndex}`;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        const matrices = list.map((placement) => makeRockMatrix(placement));
        const colours = list.map((placement) => colorForRock(placement));
        for (const [index, matrix] of matrices.entries()) {
          mesh.setMatrixAt(index, matrix);
          mesh.setColorAt(index, colours[index] as THREE.Color);
        }
        mesh.count = 0;
        mesh.visible = false;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true;
        }
        rockGroup.add(mesh);
        batches.push({
          mesh,
          geometry: part.geometry,
          material: part.material,
          trianglesPerInstance: part.triangles,
          placements: list,
          matrices,
          colours,
        });
      }
    }

    // The 唐宋 building family reuses the rock instancing path: one
    // InstancedMesh per (asset, part) keeps the whole family inside a handful
    // of draw calls while individual buildings are culled in the same loop.
    const byStructureAsset = new Map<string, MapAssetPlacement[]>();
    for (const placement of selected.structures) {
      const list = byStructureAsset.get(placement.assetId);
      if (list) {
        list.push(placement);
      } else {
        byStructureAsset.set(placement.assetId, [placement]);
      }
    }
    for (const [assetId, list] of byStructureAsset) {
      const template = templates.get(assetId);
      if (!template) {
        continue;
      }
      for (const [partIndex, part] of template.parts.entries()) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        mesh.name = `map-imported-building-${assetId}-${partIndex}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        const matrices = list.map((placement) => makeStructureMatrix(placement));
        const colours = list.map(() => colorForStructure());
        for (const [index, matrix] of matrices.entries()) {
          mesh.setMatrixAt(index, matrix);
          mesh.setColorAt(index, colours[index] as THREE.Color);
        }
        mesh.count = 0;
        mesh.visible = false;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true;
        }
        structureGroup.add(mesh);
        structureBatches.push({
          mesh,
          geometry: part.geometry,
          material: part.material,
          trianglesPerInstance: part.triangles,
          placements: list,
          matrices,
          colours,
        });
      }
    }
    const hasRocks = batches.length > 0;
    group.visible = landmarkRuntimes.length > 0 || hasRocks;
    const reference = visibilityReference ?? new THREE.Vector3();
    updateVisibility(reference, reference);
  };

  const loadIds = async (ids: readonly string[]): Promise<void> => {
    if (!options.renderer || disposed) {
      return;
    }
    const loader = createLoader();
    const jobs = ids.map((assetId) => {
      if (templates.has(assetId) || failedAssets.includes(assetUrl(assetId))) {
        return Promise.resolve();
      }
      const existing = requestedLoads.get(assetId);
      if (existing) {
        return existing;
      }
      const job = loadTemplate(loader, assetId)
        .then((template) => {
          if (!disposed) {
            templates.set(assetId, template);
          } else {
            disposeTemplate(template);
          }
        })
        .catch((error: unknown) => {
          failedAssets.push(assetUrl(assetId));
          console.warn(`JWGB map asset failed to load: ${assetId}`, error);
        });
      requestedLoads.set(assetId, job);
      return job;
    });
    await Promise.all(jobs);
  };

  let visibilityReference: THREE.Vector3 | null = null;
  let focusLoadPromise: Promise<void> | null = null;
  let queuedLoadReference: THREE.Vector3 | null = null;
  let lastLoadSignature = '';

  const placementsForRequest = (reference: THREE.Vector3): readonly MapAssetPlacement[] => {
    const selected = placementsForTier(placements, tier);
    return [...selected.landmarks, ...selected.rocks, ...selected.structures].filter(
      (placement) => {
        const dx = placement.x - reference.x;
        const dz = placement.z - reference.z;
        const distanceSquared = dx * dx + dz * dz;
        const prefetchDistance =
          placement.kind === 'landmark'
            ? LANDMARK_PREFETCH_DISTANCE
            : placement.kind === 'structure'
              ? STRUCTURE_PREFETCH_DISTANCE
              : ROCK_PREFETCH_DISTANCE;
        return distanceSquared <= prefetchDistance * prefetchDistance;
      },
    );
  };

  const loadForFocus = (reference: THREE.Vector3): Promise<void> => {
    if (!options.renderer || disposed) {
      return Promise.resolve();
    }
    queuedLoadReference ??= new THREE.Vector3();
    queuedLoadReference.copy(reference);
    if (focusLoadPromise) {
      return focusLoadPromise;
    }
    focusLoadPromise = (async () => {
      try {
        while (queuedLoadReference && !disposed) {
          const requestedReference = queuedLoadReference.clone();
          queuedLoadReference = null;
          const ids = [
            ...new Set(
              placementsForRequest(requestedReference).map((placement) => placement.assetId),
            ),
          ].sort();
          const signature = `${tier}|${ids.join('|')}`;
          if (signature === lastLoadSignature) {
            continue;
          }
          status = templates.size > 0 ? 'ready' : 'loading';
          await loadIds(ids);
          if (disposed) {
            return;
          }
          rebuild();
          lastLoadSignature = signature;
          status = templates.size > 0 ? 'ready' : ids.length > 0 ? 'failed' : 'loading';
        }
      } catch (error) {
        status = 'failed';
        failedAssets.push(`loader: ${String(error)}`);
        console.warn(
          'JWGB imported map asset layer unavailable; procedural fallback remains active',
          error,
        );
      } finally {
        focusLoadPromise = null;
      }
    })();
    return focusLoadPromise;
  };

  function updateFallbackRocks(reference: THREE.Vector3): void {
    if (!options.renderer || fallbackRockMeshes.length === 0) {
      return;
    }
    const uncoveredPlacementIds = placementsForTier(placements, tier)
      .rocks.filter((placement) => {
        const dx = placement.x - reference.x;
        const dz = placement.z - reference.z;
        return (
          dx * dx + dz * dz <= placement.maxDistance * placement.maxDistance &&
          !templates.has(placement.assetId)
        );
      })
      .map((placement) => placement.id);
    for (const fallback of fallbackRockMeshes) {
      let slot = 0;
      for (const placementId of uncoveredPlacementIds) {
        const source = fallback.matricesByPlacementId.get(placementId);
        if (!source) {
          continue;
        }
        fallback.mesh.setMatrixAt(slot, source);
        slot += 1;
      }
      fallback.mesh.count = slot;
      fallback.mesh.visible = slot > 0;
      if (slot > 0) {
        fallback.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  function updateVisibility(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void {
    const reference = focusPosition.lengthSq() > 0 ? focusPosition : cameraPosition;
    visibilityReference ??= new THREE.Vector3();
    visibilityReference.copy(reference);
    visibleLandmarkInstances = 0;
    for (const runtime of landmarkRuntimes) {
      const dx = runtime.placement.x - reference.x;
      const dz = runtime.placement.z - reference.z;
      const visible =
        group.visible &&
        dx * dx + dz * dz <= runtime.placement.maxDistance * runtime.placement.maxDistance;
      runtime.group.visible = visible;
      if (visible) {
        visibleLandmarkInstances += 1;
      }
    }
    const visibleRockPlacementIds = new Set<string>();
    const visibleStructurePlacementIds = new Set<string>();
    for (const batch of [...batches, ...structureBatches]) {
      const isStructure = structureBatches.includes(batch);
      const visibleIds = isStructure ? visibleStructurePlacementIds : visibleRockPlacementIds;
      const visibleIndices: number[] = [];
      for (const [index, placement] of batch.placements.entries()) {
        const dx = placement.x - reference.x;
        const dz = placement.z - reference.z;
        const visible =
          group.visible && dx * dx + dz * dz <= placement.maxDistance * placement.maxDistance;
        if (visible) {
          visibleIndices.push(index);
          visibleIds.add(placement.id);
        }
      }
      for (const [slot, sourceIndex] of visibleIndices.entries()) {
        const matrix = batch.matrices[sourceIndex];
        const colour = batch.colours[sourceIndex];
        if (matrix) {
          batch.mesh.setMatrixAt(slot, matrix);
        }
        if (colour) {
          batch.mesh.setColorAt(slot, colour);
        }
      }
      batch.mesh.count = visibleIndices.length;
      batch.mesh.visible = visibleIndices.length > 0;
      if (visibleIndices.length > 0) {
        batch.mesh.instanceMatrix.needsUpdate = true;
        if (batch.mesh.instanceColor) {
          batch.mesh.instanceColor.needsUpdate = true;
        }
        batch.mesh.computeBoundingSphere();
      }
    }
    visibleRockInstances = visibleRockPlacementIds.size;
    visibleStructureInstances = visibleStructurePlacementIds.size;
    landmarkGroup.visible = visibleLandmarkInstances > 0;
    structureGroup.visible = visibleStructureInstances > 0;
    rockGroup.visible = visibleRockInstances > 0;
    updateFallbackRocks(reference);
  }

  return {
    group,
    setGraphicsTier(nextTier): void {
      tier = nextTier;
      if (!options.renderer || disposed) {
        return;
      }
      const reference = visibilityReference ?? new THREE.Vector3();
      void loadForFocus(reference);
    },
    update(cameraPosition, focusPosition): void {
      frameCounter = (frameCounter + 1) % OCCLUSION_UPDATE_INTERVAL_FRAMES;
      if (frameCounter === 0) {
        updateVisibility(cameraPosition, focusPosition);
        if (options.renderer) {
          void loadForFocus(focusPosition.lengthSq() > 0 ? focusPosition : cameraPosition);
        }
      }
    },
    diagnostics(): MapAssetLayerDiagnostics {
      const visibleBatches = [...batches, ...structureBatches].filter(
        (batch) => batch.mesh.visible && batch.mesh.count > 0,
      );
      const visibleLandmarks = landmarkRuntimes.filter((runtime) => runtime.group.visible);
      const triangles =
        visibleBatches.reduce(
          (sum, batch) => sum + batch.trianglesPerInstance * batch.mesh.count,
          0,
        ) +
        visibleLandmarks.reduce(
          (sum, runtime) =>
            sum +
            runtime.group.children.reduce((partSum, child) => {
              if (!(child instanceof THREE.Mesh)) {
                return partSum;
              }
              const position = child.geometry.getAttribute('position');
              const index = child.geometry.getIndex();
              return partSum + Math.floor((index?.count ?? position?.count ?? 0) / 3);
            }, 0),
          0,
        );
      const drawCalls =
        visibleBatches.length +
        visibleLandmarks.reduce((sum, runtime) => sum + runtime.group.children.length, 0);
      return {
        status,
        loadedAssets: [...templates.values()].map((template) => template.path).sort(),
        failedAssets: [...failedAssets].sort(),
        landmarks: landmarkRuntimes.flatMap(({ placement, group, bounds }) => [
          {
            id: placement.id,
            assetId: placement.assetId,
            position: [placement.x, placement.y, placement.z] as const,
            worldHeight: placement.worldHeight,
            scale: placement.scale,
            visible: group.visible,
            meshCount: group.children.length,
            triangles: group.children.reduce((sum, child) => {
              if (!(child instanceof THREE.Mesh)) {
                return sum;
              }
              const position = child.geometry.getAttribute('position');
              const index = child.geometry.getIndex();
              return sum + Math.floor((index?.count ?? position?.count ?? 0) / 3);
            }, 0),
            bounds: [
              bounds.min.x,
              bounds.min.y,
              bounds.min.z,
              bounds.max.x,
              bounds.max.y,
              bounds.max.z,
            ] as const,
          },
        ]),
        landmarkInstances: landmarkRuntimes.length,
        visibleLandmarkInstances,
        rockInstances: new Set(batches.flatMap((batch) => batch.placements.map((p) => p.id))).size,
        visibleRockInstances,
        structureInstances: new Set(
          structureBatches.flatMap((batch) => batch.placements.map((p) => p.id)),
        ).size,
        visibleStructureInstances,
        structures: [
          ...new Map(
            structureBatches
              .flatMap((batch) => batch.placements)
              .map((placement) => [placement.id, placement] as const),
          ).values(),
        ]
          .map((placement) => ({
            id: placement.id,
            assetId: placement.assetId,
            position: [placement.x, placement.y, placement.z] as const,
            worldHeight: placement.worldHeight,
            scale: placement.scale,
            distance: Math.hypot(
              placement.x - (visibilityReference?.x ?? 0),
              placement.z - (visibilityReference?.z ?? 0),
            ),
            visible:
              Math.hypot(
                placement.x - (visibilityReference?.x ?? 0),
                placement.z - (visibilityReference?.z ?? 0),
              ) <= placement.maxDistance,
          }))
          .sort((first, second) => first.distance - second.distance)
          .slice(0, 12),
        instancedBatches: batches.length + structureBatches.length,
        triangles,
        drawCalls,
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
      for (const runtime of landmarkRuntimes) {
        runtime.group.removeFromParent();
      }
      disposeRockBatches(batches);
      disposeRockBatches(structureBatches);
      batches = [];
      structureBatches = [];
      for (const template of templates.values()) {
        disposeTemplate(template);
      }
      templates.clear();
      for (const fallback of fallbackRockMeshes) {
        for (const [index, source] of fallback.originalMatrices.entries()) {
          fallback.mesh.setMatrixAt(index, source);
        }
        fallback.mesh.count = fallback.originalCount;
        fallback.mesh.visible = true;
        fallback.mesh.instanceMatrix.needsUpdate = true;
      }
      options.fallbackRockGroup?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.visible = true;
        }
      });
    },
  };
}
