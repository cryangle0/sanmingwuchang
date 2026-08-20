import { MAP_CHESTS, MAP_SPAWN_POINTS } from '@jwgb/content';
import * as THREE from 'three';
import {
  buildRoofOcclusionBatch,
  disposeRoofOcclusionBatchTargets,
  type MapRoofOccluderSource,
  type MapRoofOcclusionBatch,
} from '../map-occlusion';
import type { MapMaterialLibrary } from '../map-palette';
import { type RegionId, regionAt } from '../map-regions';
import { createRandomStream, sampleOpenGround } from '../map-sampling';
import { dressBaizu } from './baizu';
import { buildChokeGates } from './chokes';
import { dressDuanjin } from './duanjin';
import { dressJinshui } from './jinshui';
import { dressLongji } from './longji';
import { dressMihun } from './mihun';
import { buildNestMarkers } from './nests';
import { type BagRenderSpec, type GeometryBag, mergeBagsIntoGroup, type Site } from './prop-kit';
import { dressSanting } from './santing';
import { dressZhusi } from './zhusi';

const MM = 1_000;

/**
 * District dressing orchestrator: turns the six 真源 district briefs into
 * themed prop families (fields, webs, dragon bones, embers, ruins, lanterns),
 * plus the choke-pass gates and monster nest markers that previously had no
 * visual presence at all. Everything samples open walkable ground away from
 * roads, chests and spawn pads, bakes into world space, and merges into one
 * draw call per shared material.
 */

export type DressingMaterialLibrary = Pick<
  MapMaterialLibrary,
  | 'wallTrim'
  | 'timber'
  | 'lacquer'
  | 'roofTile'
  | 'courtInlay'
  | 'rock'
  | 'bone'
  | 'charred'
  | 'straw'
  | 'cloth'
  | 'web'
  | 'soil'
  | 'clay'
  | 'iron'
>;

export interface DressingBags {
  readonly stone: GeometryBag;
  readonly timber: GeometryBag;
  readonly lacquer: GeometryBag;
  readonly roof: GeometryBag;
  readonly gold: GeometryBag;
  readonly rock: GeometryBag;
  readonly bone: GeometryBag;
  readonly charred: GeometryBag;
  readonly straw: GeometryBag;
  readonly cloth: GeometryBag;
  readonly web: GeometryBag;
  readonly soil: GeometryBag;
  readonly clay: GeometryBag;
  readonly iron: GeometryBag;
}

export type OuterRegionId = Exclude<RegionId, 'santing'>;

export interface RegionDressingSummary {
  readonly clustersByRegion: Readonly<Record<OuterRegionId, number>>;
  readonly courtArrays: number;
  readonly courtBannerPoles: number;
  readonly chokeGates: number;
  readonly nestMarkers: Readonly<Record<'MEL' | 'RNG' | 'FLY', number>>;
  readonly drawCalls: number;
  /** Cluster anchor points in metres, for placement-legality tests. */
  readonly clusterSites: readonly { readonly x: number; readonly z: number }[];
}

/** Cluster targets per district, tuned against the draw/vertex budget. */
const CLUSTER_TARGETS: Readonly<Record<OuterRegionId, number>> = {
  duanjin: 40,
  zhusi: 38,
  longji: 36,
  baizu: 38,
  jinshui: 40,
  mihun: 40,
};

/** Minimum spacing between cluster anchors within a district, metres. */
const CLUSTER_SPACING_METERS = 11;

export function buildRegionDressing(
  parent: THREE.Group,
  materials: DressingMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  seed: number,
  registerRoofBatch?: (batch: MapRoofOcclusionBatch) => void,
): RegionDressingSummary {
  const root = new THREE.Group();
  root.name = 'map-dressing';
  const nextRandom = createRandomStream(seed ^ 0x7d21c3a9);

  const sampled = sampleOpenGround(920, 12_000, nextRandom, { roadVergeMm: 2_600 }).filter(
    (point) => !nearChestOrSpawn(point.x, point.z),
  );

  const siteBuckets: Record<OuterRegionId, Site[]> = {
    duanjin: [],
    zhusi: [],
    longji: [],
    baizu: [],
    jinshui: [],
    mihun: [],
  };
  for (const point of sampled) {
    const xMeters = point.x / MM;
    const zMeters = point.z / MM;
    const region = regionAt(xMeters, zMeters);
    if (region.id === 'santing') {
      continue;
    }
    const bucket = siteBuckets[region.id];
    if (bucket.length >= CLUSTER_TARGETS[region.id]) {
      continue;
    }
    if (!isSpaced(bucket, xMeters, zMeters)) {
      continue;
    }
    bucket.push({ x: xMeters, z: zMeters, yaw: nextRandom() * Math.PI * 2 });
  }

  const bags: DressingBags = {
    stone: [],
    timber: [],
    lacquer: [],
    roof: [],
    gold: [],
    rock: [],
    bone: [],
    charred: [],
    straw: [],
    cloth: [],
    web: [],
    soil: [],
    clay: [],
    iron: [],
  };

  // Fixed call order keeps the shared random stream deterministic.
  const clustersByRegion: Record<OuterRegionId, number> = {
    duanjin: dressDuanjin(bags, siteBuckets.duanjin, nextRandom),
    zhusi: dressZhusi(bags, siteBuckets.zhusi, nextRandom),
    longji: dressLongji(bags, siteBuckets.longji, nextRandom),
    baizu: dressBaizu(bags, siteBuckets.baizu, nextRandom),
    jinshui: dressJinshui(bags, siteBuckets.jinshui, nextRandom),
    mihun: dressMihun(bags, siteBuckets.mihun, nextRandom),
  };
  const santing = dressSanting(bags, nextRandom);
  const roofOccluders: MapRoofOccluderSource[] = [];
  const chokeGates = buildChokeGates(bags, roofOccluders);
  const nestMarkers = buildNestMarkers(bags, nextRandom);

  const renderSpecs: readonly BagRenderSpec[] = [
    {
      name: 'dressing-stone',
      geometries: bags.stone,
      material: materials.wallTrim,
      castShadow: true,
    },
    {
      name: 'dressing-timber',
      geometries: bags.timber,
      material: materials.timber,
      castShadow: true,
    },
    {
      name: 'dressing-lacquer',
      geometries: bags.lacquer,
      material: materials.lacquer,
      castShadow: true,
    },
    {
      name: 'dressing-gold',
      geometries: bags.gold,
      material: materials.courtInlay,
      castShadow: false,
    },
    { name: 'dressing-rock', geometries: bags.rock, material: materials.rock, castShadow: true },
    { name: 'dressing-bone', geometries: bags.bone, material: materials.bone, castShadow: true },
    {
      name: 'dressing-charred',
      geometries: bags.charred,
      material: materials.charred,
      castShadow: true,
    },
    { name: 'dressing-straw', geometries: bags.straw, material: materials.straw, castShadow: true },
    { name: 'dressing-cloth', geometries: bags.cloth, material: materials.cloth, castShadow: true },
    { name: 'dressing-web', geometries: bags.web, material: materials.web, castShadow: false },
    { name: 'dressing-soil', geometries: bags.soil, material: materials.soil, castShadow: false },
    { name: 'dressing-clay', geometries: bags.clay, material: materials.clay, castShadow: true },
    { name: 'dressing-iron', geometries: bags.iron, material: materials.iron, castShadow: true },
  ];
  const mergedDrawCalls = mergeBagsIntoGroup(root, renderSpecs, track);
  const roofBatch = buildRoofOcclusionBatch(
    root,
    'dressing-roof',
    bags.roof,
    roofOccluders,
    materials.roofTile,
    track,
  );
  if (roofBatch) {
    if (registerRoofBatch) {
      registerRoofBatch(roofBatch);
    } else {
      disposeRoofOcclusionBatchTargets(roofBatch);
    }
  }
  const drawCalls = mergedDrawCalls + (roofBatch ? 1 : 0);

  const summary: RegionDressingSummary = {
    clustersByRegion,
    courtArrays: santing.courtArrays,
    courtBannerPoles: santing.bannerPoles,
    chokeGates,
    nestMarkers,
    drawCalls,
    clusterSites: Object.values(siteBuckets)
      .flat()
      .map((site) => ({ x: site.x, z: site.z })),
  };
  root.userData.dressingSummary = summary;
  parent.add(root);
  return summary;
}

function isSpaced(bucket: readonly Site[], xMeters: number, zMeters: number): boolean {
  for (const site of bucket) {
    const dx = site.x - xMeters;
    const dz = site.z - zMeters;
    if (dx * dx + dz * dz < CLUSTER_SPACING_METERS * CLUSTER_SPACING_METERS) {
      return false;
    }
  }
  return true;
}

const CHEST_CLEAR_MM = 2_200;
const SPAWN_CLEAR_MM = 3_200;

function nearChestOrSpawn(xMm: number, zMm: number): boolean {
  for (const chest of MAP_CHESTS) {
    const dx = chest.position.x - xMm;
    const dz = chest.position.z - zMm;
    if (dx * dx + dz * dz < CHEST_CLEAR_MM * CHEST_CLEAR_MM) {
      return true;
    }
  }
  for (const spawn of MAP_SPAWN_POINTS) {
    const dx = spawn.position.x - xMm;
    const dz = spawn.position.z - zMm;
    if (dx * dx + dz * dz < SPAWN_CLEAR_MM * SPAWN_CLEAR_MM) {
      return true;
    }
  }
  return false;
}
