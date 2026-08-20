import { assertSafeInteger, invariant } from './assert';

export const TICKS_PER_SECOND = 20;
export const TICK_DURATION_MS = 1_000 / TICKS_PER_SECOND;

export function secondsToTicks(seconds: number): number {
  assertSafeInteger(seconds, 'seconds');
  invariant(seconds >= 0, 'seconds must be non-negative');
  return seconds * TICKS_PER_SECOND;
}

export function ticksToWholeSeconds(ticks: number): number {
  assertSafeInteger(ticks, 'ticks');
  invariant(ticks >= 0, 'ticks must be non-negative');
  return Math.floor(ticks / TICKS_PER_SECOND);
}
