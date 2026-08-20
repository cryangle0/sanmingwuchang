/**
 * 百眼迷城 region model: the art direction layer over the compiled geometry.
 *
 * The engineering source names six outer districts plus the central 万劫三庭
 * but ships no region polygons, so regions are reconstructed here as a Voronoi
 * partition over one anchor per district, with the courts claiming a radius
 * around themselves. That is deterministic, needs no extra authored data, and
 * produces organic borders that follow the road network.
 *
 * Palette direction is 暗黑西游·水墨写意: a desaturated blue-grey ink base with
 * one saturated accent per district, so a player can name where they are from
 * a single frame while 30 characters stay readable against it.
 */

import { MAP_COURTS } from '@jwgb/content';
import { toMeters } from './map-units';

export type RegionId =
  | 'duanjin' // 断金坊 · 西北 · 断墙巷战
  | 'zhusi' // 蛛丝峡 · 北 · 双折峡谷
  | 'longji' // 龙脊渊 · 东北 · 高台深潭
  | 'baizu' // 百足城 · 西南 · 窄巷网
  | 'jinshui' // 烬水市 · 东 · 高价值中圈
  | 'mihun' // 迷魂田 · 南 · 深穴群
  | 'santing'; // 万劫三庭 · 中央

export interface RegionStyle {
  readonly id: RegionId;
  readonly name: string;
  /** Anchor in render meters; unused for the court region. */
  readonly anchor: { readonly x: number; readonly z: number };
  /** Ground tint multiplied into the splat result. */
  readonly ground: number;
  /** Secondary ground tone the splat mixes toward on slopes and verges. */
  readonly groundAlt: number;
  /** Packed earth exposed by wear and broad dry patches. */
  readonly soil: number;
  /** Distance mist colour when the camera sits over this district. */
  readonly mist: number;
  /** Saturated district accent for trims, banners and minimap wash. */
  readonly accent: number;
  /** Vegetation and debris tint for scattered dressing. */
  readonly scatter: number;
}

/**
 * Anchors are placed from the district compass positions in
 * 02_百眼迷城_地图工程真源_v2.txt section 2, pulled toward the real POI
 * clusters (highlands sit at x≈330 north-east, the 观星台 at x≈-3 z≈254).
 */
const REGION_STYLES: readonly RegionStyle[] = [
  {
    id: 'duanjin',
    name: '断金坊',
    anchor: { x: -270, z: 210 },
    ground: 0x838b72,
    groundAlt: 0x525848,
    soil: 0x88745d,
    mist: 0xabb3a1,
    accent: 0xb8763f,
    scatter: 0x5d6b52,
  },
  {
    id: 'zhusi',
    name: '蛛丝峡',
    anchor: { x: -10, z: 268 },
    ground: 0x7f9d93,
    groundAlt: 0x4d655e,
    soil: 0x68736d,
    mist: 0xa9c1bd,
    accent: 0x8199ce,
    scatter: 0x4f7268,
  },
  {
    id: 'longji',
    name: '龙脊渊',
    anchor: { x: 322, z: 175 },
    ground: 0x6d9883,
    groundAlt: 0x405e50,
    soil: 0x657566,
    mist: 0x9fc2b1,
    accent: 0x3f9d8e,
    scatter: 0x4b765a,
  },
  {
    id: 'baizu',
    name: '百足城',
    anchor: { x: -282, z: -180 },
    ground: 0x799956,
    groundAlt: 0x465f38,
    soil: 0x8b7650,
    mist: 0xaab98a,
    accent: 0x759c4e,
    scatter: 0x587c42,
  },
  {
    id: 'jinshui',
    name: '烬水市',
    anchor: { x: 300, z: -145 },
    ground: 0xa77c59,
    groundAlt: 0x684934,
    soil: 0x7b5140,
    mist: 0xc4a181,
    accent: 0xc96838,
    scatter: 0x795339,
  },
  {
    id: 'mihun',
    name: '迷魂田',
    anchor: { x: -20, z: -265 },
    ground: 0x859060,
    groundAlt: 0x4e573b,
    soil: 0x76684d,
    mist: 0xb3ba8c,
    accent: 0x9d6f62,
    scatter: 0x596946,
  },
  {
    id: 'santing',
    name: '万劫三庭',
    anchor: { x: 53, z: -3 },
    ground: 0xb69f63,
    groundAlt: 0x725a36,
    soil: 0x92784d,
    mist: 0xc9b57b,
    accent: 0xcbaa4c,
    scatter: 0x75804d,
  },
];

/** Anything within this distance of a court centre is 万劫三庭. */
const COURT_CLAIM_RADIUS_METERS = 115;

const OUTER_REGIONS = REGION_STYLES.filter((region) => region.id !== 'santing');
const COURT_REGION = REGION_STYLES.find((region) => region.id === 'santing') as RegionStyle;

const COURT_CENTRES = MAP_COURTS.map((court) => ({
  x: toMeters(court.center.x),
  z: toMeters(court.center.z),
}));

export function regionStyles(): readonly RegionStyle[] {
  return REGION_STYLES;
}

export function regionById(id: RegionId): RegionStyle {
  const found = REGION_STYLES.find((region) => region.id === id);
  if (!found) {
    throw new Error(`map-regions: unknown region ${id}`);
  }
  return found;
}

/** Classifies a render-space point into its district. */
export function regionAt(xMeters: number, zMeters: number): RegionStyle {
  for (const centre of COURT_CENTRES) {
    const dx = xMeters - centre.x;
    const dz = zMeters - centre.z;
    if (dx * dx + dz * dz <= COURT_CLAIM_RADIUS_METERS * COURT_CLAIM_RADIUS_METERS) {
      return COURT_REGION;
    }
  }
  let best = OUTER_REGIONS[0] as RegionStyle;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const region of OUTER_REGIONS) {
    const dx = xMeters - region.anchor.x;
    const dz = zMeters - region.anchor.z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region;
    }
  }
  return best;
}

/**
 * Soft district blend for vertex shading. Returns the dominant region plus a
 * 0..1 blend weight toward the runner-up, so ground colour crossfades across
 * a border instead of switching on a hard line.
 */
export function regionBlendAt(
  xMeters: number,
  zMeters: number,
): { readonly primary: RegionStyle; readonly secondary: RegionStyle; readonly mix: number } {
  for (const centre of COURT_CENTRES) {
    const dx = xMeters - centre.x;
    const dz = zMeters - centre.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= COURT_CLAIM_RADIUS_METERS) {
      const outer = nearestOuter(xMeters, zMeters);
      // Fade the court palette out over the last 35m of its claim.
      const mix = Math.max(0, Math.min(1, (distance - (COURT_CLAIM_RADIUS_METERS - 35)) / 35));
      return { primary: COURT_REGION, secondary: outer.region, mix: mix * 0.5 };
    }
  }
  const { region, distance, runnerUp, runnerUpDistance } = nearestTwoOuter(xMeters, zMeters);
  const span = runnerUpDistance - distance;
  // Within 60m of equidistant the two districts blend.
  const mix = Math.max(0, Math.min(0.5, (60 - span) / 120));
  return { primary: region, secondary: runnerUp, mix };
}

function nearestOuter(
  xMeters: number,
  zMeters: number,
): { readonly region: RegionStyle; readonly distance: number } {
  let best = OUTER_REGIONS[0] as RegionStyle;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const region of OUTER_REGIONS) {
    const distance = Math.hypot(xMeters - region.anchor.x, zMeters - region.anchor.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region;
    }
  }
  return { region: best, distance: bestDistance };
}

function nearestTwoOuter(
  xMeters: number,
  zMeters: number,
): {
  readonly region: RegionStyle;
  readonly distance: number;
  readonly runnerUp: RegionStyle;
  readonly runnerUpDistance: number;
} {
  let best = OUTER_REGIONS[0] as RegionStyle;
  let bestDistance = Number.POSITIVE_INFINITY;
  let second = OUTER_REGIONS[1] as RegionStyle;
  let secondDistance = Number.POSITIVE_INFINITY;
  for (const region of OUTER_REGIONS) {
    const distance = Math.hypot(xMeters - region.anchor.x, zMeters - region.anchor.z);
    if (distance < bestDistance) {
      second = best;
      secondDistance = bestDistance;
      best = region;
      bestDistance = distance;
    } else if (distance < secondDistance) {
      second = region;
      secondDistance = distance;
    }
  }
  return {
    region: best,
    distance: bestDistance,
    runnerUp: second,
    runnerUpDistance: secondDistance,
  };
}
