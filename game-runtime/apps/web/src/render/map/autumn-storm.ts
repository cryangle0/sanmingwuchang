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
  fogDensity: 0.00152,
  fogColor: 0x71838a,
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
  // Neutral warm glow: the canopy carries its own hue per instance now, and
  // an orange emissive under a green crown read as rust.
  leafEmissive: { r: 0.14, g: 0.13, b: 0.09 },
  leafEmissiveHigh: 0.12,
  leafEmissiveLow: 0.06,
  // Raised for the "make the wind obvious" pass: canopies now move visibly
  // from the chase lens instead of only under close inspection.
  windLeafHigh: 0.078,
  windLeafLow: 0.055,
  windTrunk: 0.026,
  rainWindX: 14,
  rainWindZ: 5.6,
} as const;
