/**
 * 百眼迷城 region model: the art direction layer over the compiled geometry.
 *
 * The engineering source names six outer districts plus the central 万劫三庭
 * but ships no region polygons, so regions are reconstructed here as a Voronoi
 * partition over one anchor per district, with the courts claiming a radius
 * around themselves. That is deterministic, needs no extra authored data, and
 * produces organic borders that follow the road network.
 *
 * Palette direction follows JourneyWestGreatBrawl_AI游戏场景提示词 section 6:
 * multi-hue layering on a 青玉绿 / 暖灰石 base, with 朱砂红, 金色 and 五行 accents.
 * Every district owns its own hue family so a player can name where they are
 * from a single frame, and any wide shot spans at least three separable hues
 * (district ground, district accent, and the water / sky / court set).
 *
 * Saturation stays moderate (14-40% on ground tones) rather than desaturated:
 * the prompt forbids 浑浊或灰败 and 大面积灰雾, but 30 saturated hero silhouettes
 * still have to read against the world, so accents carry the saturation and
 * ground tones stay one step below the characters.
 *
 * 断金坊 is deliberately the most neutral district: the prompt describes it as
 * 低风险、清晰的石坡和断墙, so it reads as clean warm stone while its neighbours
 * carry hue. That keeps it distinguishable from the two other warm districts
 * (烬水市 amber, 万劫三庭 gold) by saturation rather than by hue alone.
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
    // 低风险、清晰的石坡和断墙: clean warm stone, the map's neutral reference.
    ground: 0x9f977f,
    groundAlt: 0x6a614e,
    soil: 0x957750,
    mist: 0xd0cbbe,
    accent: 0xcf6530,
    scatter: 0x858351,
  },
  {
    id: 'zhusi',
    name: '蛛丝峡',
    anchor: { x: -10, z: 268 },
    // 狭窄峡谷、垂直岩壁、蛛网: 青灰岩 walls, cold blue web glow.
    ground: 0x668499,
    groundAlt: 0x3e5265,
    soil: 0x5e6f78,
    mist: 0xb2c6d2,
    accent: 0x707ccd,
    scatter: 0x546f78,
  },
  {
    id: 'longji',
    name: '龙脊渊',
    anchor: { x: 322, z: 175 },
    // 高台、龙宫、水汽和远距离视野: 青玉 jade over wet stone.
    ground: 0x57948c,
    groundAlt: 0x366362,
    soil: 0x58746d,
    mist: 0xbddbda,
    accent: 0x3eccaf,
    scatter: 0x487a69,
  },
  {
    id: 'baizu',
    name: '百足城',
    anchor: { x: -282, z: -180 },
    // 密集道路、城墙、建筑: 草木绿 over 青灰石, 朱砂红 city banners.
    ground: 0x668d53,
    groundAlt: 0x465c38,
    soil: 0x87784f,
    mist: 0xbed0b3,
    accent: 0xc44531,
    scatter: 0x47713d,
  },
  {
    id: 'jinshui',
    name: '烬水市',
    anchor: { x: 300, z: -145 },
    // 商店、桥梁、灯火: warm timber and amber lantern light.
    ground: 0xa47551,
    groundAlt: 0x674937,
    soil: 0x7c5646,
    mist: 0xd9c2ab,
    accent: 0xdf973a,
    scatter: 0x745c44,
  },
  {
    id: 'mihun',
    name: '迷魂田',
    anchor: { x: -20, z: -265 },
    // 森林、猪窝、伏击点: deep 草木绿 with a 五行 purple accent.
    ground: 0x487a52,
    groundAlt: 0x2e5239,
    soil: 0x626845,
    mist: 0xa8c7ac,
    accent: 0xa35dc0,
    scatter: 0x366345,
  },
  {
    id: 'santing',
    name: '万劫三庭',
    anchor: { x: 53, z: -3 },
    // 金色、白色雷光和强烈的五行对比: the map's brightest, most saturated set.
    ground: 0xb7a466,
    groundAlt: 0x806d42,
    soil: 0x968054,
    mist: 0xe3dcbf,
    accent: 0xe7be40,
    scatter: 0x8b8b55,
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
