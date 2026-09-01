import { describe, expect, it } from 'vitest';
import { AUTUMN_STORM } from '../apps/web/src/render/map/autumn-storm';
import { FALLING_LEAF_PROFILE } from '../apps/web/src/render/map/falling-leaves';
import { regionStyles } from '../apps/web/src/render/map/map-regions';
import { climateOf } from '../apps/web/src/render/map/region-climate';

describe('autumn storm look', () => {
  it('keeps the whole map readable, wet and raining', () => {
    expect(AUTUMN_STORM.weather).toBe('rain');
    expect(AUTUMN_STORM.backgroundIntensity).toBeGreaterThanOrEqual(0.72);
    expect(AUTUMN_STORM.backgroundIntensity).toBeLessThanOrEqual(0.86);
    expect(AUTUMN_STORM.sunIntensity).toBeGreaterThanOrEqual(1.25);
    expect(AUTUMN_STORM.sunIntensity).toBeLessThanOrEqual(1.55);
    expect(AUTUMN_STORM.hemiIntensity).toBeGreaterThanOrEqual(1.2);
    expect(AUTUMN_STORM.hemiIntensity).toBeLessThanOrEqual(1.5);
    expect(AUTUMN_STORM.exposure).toBeGreaterThanOrEqual(1.08);
    expect(AUTUMN_STORM.exposure).toBeLessThanOrEqual(1.24);
    expect(AUTUMN_STORM.windLeafHigh).toBeGreaterThan(0.03);
    expect(AUTUMN_STORM.frost).toBe(0);
    for (const region of regionStyles()) {
      expect(climateOf(region.id).weather).toBe('rain');
    }
  });

  it('drives falling teardrop leaves with the storm wind', () => {
    expect(FALLING_LEAF_PROFILE.countBalanced).toBeGreaterThan(80);
    expect(FALLING_LEAF_PROFILE.countBalanced).toBeLessThan(280);
    expect(FALLING_LEAF_PROFILE.windX).toBeGreaterThan(4);
    expect(FALLING_LEAF_PROFILE.sizeMax).toBeGreaterThan(FALLING_LEAF_PROFILE.sizeMin);
    expect(FALLING_LEAF_PROFILE.fall).toBeGreaterThan(2);
  });
});
