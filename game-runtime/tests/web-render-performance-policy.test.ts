import { describe, expect, it } from 'vitest';
import {
  characterAnimationIntervalSeconds,
  shouldCastCharacterShadow,
  shouldReduceGraphicsLoad,
} from '../apps/web/src/render/render-performance-policy';

describe('web render performance policy', () => {
  it('keeps local and nearby character animation full rate', () => {
    expect(characterAnimationIntervalSeconds('balanced', 80_000 ** 2, true)).toBe(0);
    expect(characterAnimationIntervalSeconds('balanced', 18_000 ** 2, false)).toBe(0);
  });

  it('throttles animation progressively with distance and graphics tier', () => {
    expect(characterAnimationIntervalSeconds('balanced', 25_000 ** 2, false)).toBeCloseTo(1 / 30);
    expect(characterAnimationIntervalSeconds('balanced', 45_000 ** 2, false)).toBeCloseTo(1 / 15);
    expect(characterAnimationIntervalSeconds('reduced', 25_000 ** 2, false)).toBeCloseTo(1 / 20);
    expect(characterAnimationIntervalSeconds('reduced', 45_000 ** 2, false)).toBeCloseTo(1 / 10);
  });

  it('limits character shadow casters to the local combat area', () => {
    expect(shouldCastCharacterShadow('balanced', 80_000 ** 2, true)).toBe(true);
    expect(shouldCastCharacterShadow('balanced', 20_000 ** 2, false)).toBe(true);
    expect(shouldCastCharacterShadow('balanced', 30_000 ** 2, false)).toBe(false);
    expect(shouldCastCharacterShadow('reduced', 0, true)).toBe(false);
  });

  it('waits for a complete stable frame window before adaptive downgrade', () => {
    expect(shouldReduceGraphicsLoad(Array.from({ length: 119 }, () => 30))).toBe(false);
    expect(shouldReduceGraphicsLoad(Array.from({ length: 120 }, () => 16.7))).toBe(false);
  });

  it('downgrades on sustained average or p95 frame pressure', () => {
    expect(shouldReduceGraphicsLoad(Array.from({ length: 120 }, () => 19))).toBe(true);
    expect(
      shouldReduceGraphicsLoad([
        ...Array.from({ length: 114 }, () => 16.7),
        ...Array.from({ length: 6 }, () => 30),
      ]),
    ).toBe(true);
  });
});
