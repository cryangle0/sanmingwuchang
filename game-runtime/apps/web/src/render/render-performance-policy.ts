const FULL_RATE_DISTANCE_SQUARED = 18_000 ** 2;
const ANIMATION_DISTANCE_SQUARED = 34_000 ** 2;
const NEARBY_SHADOW_DISTANCE_SQUARED = 24_000 ** 2;
const ADAPTIVE_SAMPLE_COUNT = 120;
const ADAPTIVE_AVERAGE_FRAME_MS = 18.5;
const ADAPTIVE_P95_FRAME_MS = 24;

export function characterAnimationIntervalSeconds(
  graphicsTier: 'balanced' | 'reduced',
  distanceSquared: number,
  isLocal: boolean,
): number {
  if (isLocal || distanceSquared <= FULL_RATE_DISTANCE_SQUARED) {
    return 0;
  }
  if (distanceSquared <= ANIMATION_DISTANCE_SQUARED) {
    return graphicsTier === 'reduced' ? 1 / 20 : 1 / 30;
  }
  return graphicsTier === 'reduced' ? 1 / 10 : 1 / 15;
}

export function shouldCastCharacterShadow(
  graphicsTier: 'balanced' | 'reduced',
  distanceSquared: number,
  isLocal: boolean,
): boolean {
  return graphicsTier === 'balanced' && (isLocal || distanceSquared <= NEARBY_SHADOW_DISTANCE_SQUARED);
}

export function shouldReduceGraphicsLoad(frameIntervalsMs: readonly number[]): boolean {
  if (frameIntervalsMs.length < ADAPTIVE_SAMPLE_COUNT) {
    return false;
  }

  const recent = frameIntervalsMs.slice(-ADAPTIVE_SAMPLE_COUNT).sort((left, right) => left - right);
  const average = recent.reduce((sum, interval) => sum + interval, 0) / ADAPTIVE_SAMPLE_COUNT;
  const p95 = recent[Math.floor(ADAPTIVE_SAMPLE_COUNT * 0.95)] ?? 0;
  return average > ADAPTIVE_AVERAGE_FRAME_MS || p95 > ADAPTIVE_P95_FRAME_MS;
}
