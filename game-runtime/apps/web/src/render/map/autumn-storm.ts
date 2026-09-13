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
  rainIntensity: 0.72,
  fogDensity: 0.0015,
  fogColor: 0x6b7d85,
  sunIntensity: 1.34,
  sunColor: 0xe0e7e9,
  hemiSky: 0xa8bcc5,
  hemiGround: 0x616b63,
  hemiIntensity: 1.22,
  fillIntensity: 0.6,
  fillColor: 0x9db6bc,
  backgroundIntensity: 0.74,
  exposure: 1.1,
  sunHeight: 26,
  sunOffsetX: -24,
  sunOffsetZ: 14,
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
  windLeafHigh: 0.13,
  windLeafLow: 0.095,
  windTrunk: 0.042,
  rainWindX: 14,
  rainWindZ: 5.6,
} as const;
