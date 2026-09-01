import { terrainHeightMeters } from '@jwgb/content';
import { AUTUMN_STORM } from './autumn-storm';
import type { RegionId, RegionStyle } from './map-regions';
import { regionBlendAt } from './map-regions';

/**
 * Render-only climate per 真源 district. Weather never enters the sim:
 * rain and falling leaves are particles, lighting and fog are atmosphere,
 * ground wetness/soil are vertex colours plus the ground splat shader.
 *
 * The whole map is one autumn storm. Districts still keep their own wetness,
 * soil and a small key/fog offset so 烬水市 reads warmer than 蛛丝峡, but
 * nobody stands in clear weather or snow. Fog stays thin enough that roads,
 * drops and telegraphs remain readable in the foreground.
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

function stormClimate(overrides: Partial<RegionClimate> = {}): RegionClimate {
  return {
    weather: AUTUMN_STORM.weather,
    intensity: AUTUMN_STORM.rainIntensity,
    fogDensity: AUTUMN_STORM.fogDensity,
    sunIntensity: AUTUMN_STORM.sunIntensity,
    sunColor: AUTUMN_STORM.sunColor,
    hemiSky: AUTUMN_STORM.hemiSky,
    hemiGround: AUTUMN_STORM.hemiGround,
    wetness: AUTUMN_STORM.wetness,
    soilBias: 0.16,
    frost: AUTUMN_STORM.frost,
    ...overrides,
  };
}

const CLIMATE: Readonly<Record<RegionId, RegionClimate>> = {
  duanjin: stormClimate({
    fogDensity: 0.0016,
    sunIntensity: 1.42,
    soilBias: 0.24,
    wetness: 0.56,
  }),
  zhusi: stormClimate({
    fogDensity: 0.00195,
    sunIntensity: 1.3,
    sunColor: 0xc8d8de,
    hemiSky: 0x9fb6c0,
    hemiGround: 0x5a6567,
    wetness: 0.72,
    soilBias: 0.12,
  }),
  longji: stormClimate({
    fogDensity: 0.0018,
    sunIntensity: 1.36,
    sunColor: 0xc6d7d2,
    hemiSky: 0xa3b9b8,
    hemiGround: 0x5c6962,
    wetness: 0.64,
    soilBias: 0.08,
  }),
  baizu: stormClimate({
    fogDensity: 0.0016,
    sunIntensity: 1.44,
    soilBias: 0.08,
    wetness: 0.6,
  }),
  jinshui: stormClimate({
    fogDensity: 0.00165,
    sunIntensity: 1.4,
    sunColor: 0xd8c1a6,
    hemiSky: 0xa9a19a,
    hemiGround: 0x665342,
    wetness: 0.54,
    soilBias: 0.28,
  }),
  mihun: stormClimate({
    fogDensity: 0.00195,
    sunIntensity: 1.3,
    sunColor: 0xc5d6c7,
    hemiSky: 0x9bb59f,
    hemiGround: 0x596952,
    wetness: 0.82,
    soilBias: 0.14,
  }),
  santing: stormClimate({
    fogDensity: 0.00155,
    sunIntensity: 1.48,
    sunColor: 0xe0cda9,
    wetness: 0.54,
    soilBias: 0.2,
  }),
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
