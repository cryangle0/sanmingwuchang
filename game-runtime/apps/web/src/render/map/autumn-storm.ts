/**
 * Whole-map autumn storm look. Render-only: lighting, fog, rain and falling
 * leaves. Simulation, collision and map geometry hashes stay untouched.
 *
 * Target: a readable, wet and windy autumn storm. The sky stays overcast, but
 * the scene receives enough bounced light for silhouettes, terrain transitions
 * and skill telegraphs to remain clear without washing out the autumn palette.
 */
export const AUTUMN_STORM = {
  weather: 'rain' as const,
  rainIntensity: 0.58,
  fogDensity: 0.00175,
  fogColor: 0x6b7980,
  sunIntensity: 1.42,
  sunColor: 0xe0e7e9,
  hemiSky: 0xb2c5cd,
  hemiGround: 0x69736b,
  hemiIntensity: 1.35,
  fillIntensity: 0.68,
  fillColor: 0x9db6bc,
  backgroundIntensity: 0.78,
  exposure: 1.16,
  sunHeight: 32,
  sunOffsetX: -14,
  sunOffsetZ: 10,
  wetness: 0.66,
  frost: 0,
  canopyTint: 0xd08a38,
  leafEmissive: { r: 0.22, g: 0.11, b: 0.03 },
  leafEmissiveHigh: 0.12,
  leafEmissiveLow: 0.06,
  windLeafHigh: 0.045,
  windLeafLow: 0.032,
  windTrunk: 0.014,
  rainWindX: 14,
  rainWindZ: 5.6,
} as const;
