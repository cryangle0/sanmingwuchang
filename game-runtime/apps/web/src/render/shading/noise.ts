/**
 * Deterministic, allocation-free coordinate noise for procedural map dressing.
 *
 * Everything is a pure function of (coordinate, seed): no internal state, no
 * Math.random. Two clients that pass the same seed build byte-identical
 * geometry, which is what lets the renderer key its scatter off the compiled
 * map geometry hash and still look the same on every machine.
 *
 * This is presentation-only. The authoritative simulation has its own integer
 * RNG in @jwgb/core and must never consume anything from this module.
 */

/** Mixes a 32 bit integer into a well-distributed unit float. */
export function hash1(value: number, seed = 0): number {
  let mixed = Math.imul(value ^ seed, 0x27d4_eb2d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x85eb_ca6b);
  mixed ^= mixed >>> 13;
  return (mixed >>> 0) / 0xffff_ffff;
}

/** Stateless 2D lattice hash in [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let mixed = Math.imul(x | 0, 0x1f1f_1f1f) ^ Math.imul(y | 0, 0x8da6_b343) ^ seed;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb_352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846c_a68b);
  mixed ^= mixed >>> 16;
  return (mixed >>> 0) / 0x1_0000_0000;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise in [0, 1). Cheap, smooth, and good enough for dressing. */
export function noise2(x: number, y: number, seed = 0): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fractionX = smoothstep(x - cellX);
  const fractionY = smoothstep(y - cellY);

  const topLeft = hash2(cellX, cellY, seed);
  const topRight = hash2(cellX + 1, cellY, seed);
  const bottomLeft = hash2(cellX, cellY + 1, seed);
  const bottomRight = hash2(cellX + 1, cellY + 1, seed);

  const top = topLeft + (topRight - topLeft) * fractionX;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * fractionX;
  return top + (bottom - top) * fractionY;
}

/** Fractal Brownian motion, normalised to [0, 1). */
export function fbm2(x: number, y: number, seed = 0, octaves = 4): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normalisation = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += amplitude * noise2(x * frequency, y * frequency, seed + octave * 1013);
    normalisation += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / normalisation;
}

/**
 * Ridged noise in [0, 1): sharp creases instead of rolling hills. Used for the
 * mountain silhouette outside the playfield, where 水墨 art wants hard ridges.
 */
export function ridged2(x: number, y: number, seed = 0, octaves = 4): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normalisation = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const signed = 1 - Math.abs(noise2(x * frequency, y * frequency, seed + octave * 977) * 2 - 1);
    total += amplitude * signed * signed;
    normalisation += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / normalisation;
}

/**
 * Quantises a rise into stair-stepped terraces with a flat tread and a steep
 * riser. This is what makes a noisy slope read as layered rock rather than
 * pudding, and it is the single highest-value shaping primitive here.
 */
export function terraceStep(height: number, stepHeight: number, treadFraction = 0.6): number {
  if (stepHeight <= 0) {
    return height;
  }
  const band = height / stepHeight;
  const index = Math.floor(band);
  const withinBand = band - index;
  const riser = Math.min(1, withinBand / Math.max(1e-4, 1 - treadFraction));
  return (index + riser) * stepHeight;
}

/** Small stateful sequence for one-shot generation loops (texture painting). */
export function createSequence(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/** Folds a hex string such as the map geometry hash into a numeric seed. */
export function seedFromText(text: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}
