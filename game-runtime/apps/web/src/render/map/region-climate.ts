import { terrainHeightMeters } from '@jwgb/content';
import type { RegionId, RegionStyle } from './map-regions';
import { regionBlendAt } from './map-regions';

/**
 * Render-only climate per 真源 district. Weather never enters the sim:
 * rain/snow are particles and lighting, ground wetness/soil/frost are
 * vertex colours plus the ground splat shader.
 *
 * Balance follows the scene prompt sections 7 and 13. Two rules shape every
 * row below:
 *
 * 1. The key light stays warm and bright in every district. Weather varies
 *    the *ambient* — hemisphere sky goes cool 青 under cloud — rather than
 *    draining the sun to grey, which is what flattened the rainy districts
 *    into the 灰蒙/低对比 the prompt forbids.
 * 2. Fog and precipitation are capped so 前景 and 中景 stay sharp. Districts
 *    still read as wet, frozen or dusty, but mist never covers the roads,
 *    drops, enemies or telegraphs a player is supposed to see.
 */

export type RegionWeather = 'clear' | 'rain' | 'snow';

export interface RegionClimate {
  readonly weather: RegionWeather;
  readonly intensity: number;
  readonly fogDensity: number;
  readonly sunIntensity: number;
  readonly sunColor: number;
  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly wetness: number;
  readonly soilBias: number;
  readonly frost: number;
}

const CLIMATE: Readonly<Record<RegionId, RegionClimate>> = {
  // 断金坡: 低风险、清晰的石坡和断墙. The map's clearest, most legible district.
  duanjin: {
    weather: 'clear',
    intensity: 0,
    fogDensity: 0.0016,
    sunIntensity: 3.25,
    sunColor: 0xffe3b6,
    hemiSky: 0xcbdff0,
    hemiGround: 0x776a55,
    wetness: 0.04,
    soilBias: 0.38,
    frost: 0,
  },
  // 蛛丝峡: 狭窄峡谷、垂直岩壁. Wet rock and a cool sky slot overhead.
  zhusi: {
    weather: 'rain',
    intensity: 0.5,
    fogDensity: 0.0028,
    sunIntensity: 2.6,
    sunColor: 0xe8ecf2,
    hemiSky: 0xb9d0e6,
    hemiGround: 0x4a5866,
    wetness: 0.72,
    soilBias: 0.12,
    frost: 0,
  },
  // 龙脊渊: 高台、龙宫、水汽和远距离视野. Frost belongs to the high ground.
  longji: {
    weather: 'snow',
    intensity: 0.62,
    fogDensity: 0.0025,
    sunIntensity: 2.95,
    sunColor: 0xf2f7fa,
    hemiSky: 0xcfe6ee,
    hemiGround: 0x51625f,
    wetness: 0.18,
    soilBias: 0.08,
    frost: 0.82,
  },
  // 百足城: 密集道路、城墙、建筑. Brightest outer district so chases read.
  baizu: {
    weather: 'clear',
    intensity: 0,
    fogDensity: 0.0015,
    sunIntensity: 3.5,
    sunColor: 0xffe9be,
    hemiSky: 0xcde2f2,
    hemiGround: 0x5c6a4a,
    wetness: 0.08,
    soilBias: 0.06,
    frost: 0,
  },
  // 热水市: 商店、桥梁、灯火. Warmest key in the map, lantern-side.
  jinshui: {
    weather: 'clear',
    intensity: 0,
    fogDensity: 0.002,
    sunIntensity: 3.05,
    sunColor: 0xffcf96,
    hemiSky: 0xdcd6d2,
    hemiGround: 0x6a4c36,
    wetness: 0.02,
    soilBias: 0.58,
    frost: 0,
  },
  // 迷魂滩: 森林、猪窝、伏击点. Damp forest air, not a grey wall of rain.
  mihun: {
    weather: 'rain',
    intensity: 0.6,
    fogDensity: 0.0026,
    sunIntensity: 2.55,
    sunColor: 0xdfe6d8,
    hemiSky: 0xc2d6da,
    hemiGround: 0x46523c,
    wetness: 0.86,
    soilBias: 0.22,
    frost: 0,
  },
  // 万劫三庭: the 终局 stage. Thinnest fog and the strongest key on the map.
  santing: {
    weather: 'clear',
    intensity: 0,
    fogDensity: 0.0013,
    sunIntensity: 3.7,
    sunColor: 0xffeabb,
    hemiSky: 0xdfe9f2,
    hemiGround: 0x746848,
    wetness: 0,
    soilBias: 0.28,
    frost: 0,
  },
};

export function climateOf(id: RegionId): RegionClimate {
  return CLIMATE[id];
}

export function precipForRegion(id: RegionId): Exclude<RegionWeather, 'clear'> | null {
  const weather = CLIMATE[id].weather;
  return weather === 'clear' ? null : weather;
}

export function blendClimateAt(
  xMeters: number,
  zMeters: number,
): {
  readonly primary: RegionStyle;
  readonly secondary: RegionStyle;
  readonly mix: number;
  readonly climate: RegionClimate;
} {
  const blend = regionBlendAt(xMeters, zMeters);
  return {
    ...blend,
    climate: lerpClimate(climateOf(blend.primary.id), climateOf(blend.secondary.id), blend.mix),
  };
}

export function lerpClimate(a: RegionClimate, b: RegionClimate, mix: number): RegionClimate {
  const t = Math.max(0, Math.min(1, mix));
  return {
    weather: t < 0.5 ? a.weather : b.weather,
    intensity: a.intensity + (b.intensity - a.intensity) * t,
    fogDensity: a.fogDensity + (b.fogDensity - a.fogDensity) * t,
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t,
    sunColor: a.sunColor,
    hemiSky: a.hemiSky,
    hemiGround: a.hemiGround,
    wetness: a.wetness + (b.wetness - a.wetness) * t,
    soilBias: a.soilBias + (b.soilBias - a.soilBias) * t,
    frost: a.frost + (b.frost - a.frost) * t,
  };
}

/**
 * Height of the surrounding landform, so "high" and "low" mean high and low
 * *for here* rather than relative to sea level.
 *
 * Averaging four samples a little under the terrain's dominant wavelength
 * away recovers the local trend and leaves the vertex's own hill or hollow in
 * the residual. Absolute thresholds worked only while the whole map lived
 * inside a 5 m band; once districts sit tens of metres apart they would frost
 * an entire highland district and read a whole valley district as marsh.
 */
const CLIMATE_TREND_RADIUS = 80;

export function localBaseMeters(xMeters: number, zMeters: number): number {
  return (
    (terrainHeightMeters(xMeters - CLIMATE_TREND_RADIUS, zMeters) +
      terrainHeightMeters(xMeters + CLIMATE_TREND_RADIUS, zMeters) +
      terrainHeightMeters(xMeters, zMeters - CLIMATE_TREND_RADIUS) +
      terrainHeightMeters(xMeters, zMeters + CLIMATE_TREND_RADIUS)) /
    4
  );
}

/** Height above (positive) or below (negative) the surrounding landform. */
export function localReliefMeters(xMeters: number, zMeters: number, heightMeters: number): number {
  return heightMeters - localBaseMeters(xMeters, zMeters);
}

/** Per-vertex climate weights for the ground splat shader. */
export function climateSplatAt(
  xMeters: number,
  zMeters: number,
  heightMeters: number,
): { readonly soil: number; readonly wet: number; readonly frost: number } {
  const { climate } = blendClimateAt(xMeters, zMeters);
  const relief = localReliefMeters(xMeters, zMeters, heightMeters);
  const highland = smoothstep(3, 11, relief);
  const valley = smoothstep(1, 7, -relief);
  return {
    soil: Math.max(0, Math.min(1, climate.soilBias)),
    wet: Math.max(0, Math.min(1, climate.wetness * (0.72 + valley * 0.28))),
    frost: Math.max(0, Math.min(1, climate.frost * highland)),
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
