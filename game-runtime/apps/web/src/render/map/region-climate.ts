import { terrainHeightMeters } from '@jwgb/content';
import type { RegionId, RegionStyle } from './map-regions';
import { regionBlendAt } from './map-regions';

/**
 * Render-only climate per 真源 district. Weather never enters the sim:
 * rain/snow are particles and lighting, ground wetness/soil/frost are
 * vertex colours plus the ground splat shader.
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
  duanjin: {
    weather: 'clear',
    intensity: 0,
    fogDensity: 0.0024,
    sunIntensity: 3.15,
    sunColor: 0xffe0b0,
    hemiSky: 0xe8dcc8,
    hemiGround: 0x6a5c4c,
    wetness: 0.04,
    soilBias: 0.38,
    frost: 0,
  },
  zhusi: {
    weather: 'rain',
    intensity: 0.62,
    fogDensity: 0.004,
    sunIntensity: 2.15,
    sunColor: 0xc5d4dc,
    hemiSky: 0xb7c8c6,
    hemiGround: 0x3f4f4c,
    wetness: 0.72,
    soilBias: 0.12,
    frost: 0,
  },
  longji: {
    weather: 'snow',
    intensity: 0.88,
    fogDensity: 0.0035,
    sunIntensity: 2.55,
    sunColor: 0xe8f2f6,
    hemiSky: 0xd5e4ea,
    hemiGround: 0x4a5c58,
    wetness: 0.18,
    soilBias: 0.08,
    frost: 0.82,
  },
  baizu: {
    weather: 'clear',
    intensity: 0,
    fogDensity: 0.0022,
    sunIntensity: 3.45,
    sunColor: 0xffe8bc,
    hemiSky: 0xe7f2d8,
    hemiGround: 0x556048,
    wetness: 0.08,
    soilBias: 0.06,
    frost: 0,
  },
  jinshui: {
    weather: 'clear',
    intensity: 0,
    fogDensity: 0.0029,
    sunIntensity: 2.85,
    sunColor: 0xffc48a,
    hemiSky: 0xf0d0b0,
    hemiGround: 0x5a4030,
    wetness: 0.02,
    soilBias: 0.58,
    frost: 0,
  },
  mihun: {
    weather: 'rain',
    intensity: 0.95,
    fogDensity: 0.0037,
    sunIntensity: 2.05,
    sunColor: 0xb8c4a8,
    hemiSky: 0xc4cbb0,
    hemiGround: 0x3e4634,
    wetness: 0.86,
    soilBias: 0.22,
    frost: 0,
  },
  santing: {
    weather: 'clear',
    intensity: 0,
    fogDensity: 0.0019,
    sunIntensity: 3.55,
    sunColor: 0xffe7b4,
    hemiSky: 0xf2ecd4,
    hemiGround: 0x6a6048,
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
