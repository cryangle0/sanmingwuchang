import { describe, expect, it } from 'vitest';
import { MAX_ROAD_SURFACE_Y } from '../apps/web/src/render/map/roads';
import {
  WEB_HERO_MODELS,
  WEB_MONSTER_MODELS,
} from '../apps/web/src/render/models/web-model-catalog';
import { WORLD_SCALE_PROFILE } from '../apps/web/src/render/world-scale-profile';

describe('web world scale profile', () => {
  it('keeps characters in metre scale without a second presentation multiplier', () => {
    expect(WORLD_SCALE_PROFILE.character.playerModelScale).toBe(1);
    expect(WORLD_SCALE_PROFILE.character.monsterModelScale).toBe(1);
    expect(Math.min(...WEB_HERO_MODELS.map((model) => model.height))).toBeGreaterThanOrEqual(2.2);
    expect(Math.max(...WEB_HERO_MODELS.map((model) => model.height))).toBeLessThanOrEqual(2.5);
    expect(Math.min(...WEB_MONSTER_MODELS.map((model) => model.height))).toBeGreaterThanOrEqual(
      1.7,
    );
    expect(Math.max(...WEB_MONSTER_MODELS.map((model) => model.height))).toBeLessThanOrEqual(4.4);
  });

  it('keeps architecture, trees, rocks, and groundcover in coherent relative ranges', () => {
    const landmarkHeights = WORLD_SCALE_PROFILE.map.landmarkWorldHeights;
    const architectureHeights = [
      landmarkHeights['wuxia-gate-court'],
      landmarkHeights['wuxia-citadel'],
      landmarkHeights['wuxia-east-asia-hall'],
      landmarkHeights['wuxia-mountain-gate'],
      landmarkHeights['lowpoly-asian-village'],
      landmarkHeights['lowpoly-asian-house'],
      landmarkHeights['lowpoly-torii'],
    ];
    const treeHeights = Object.values(WORLD_SCALE_PROFILE.flora.treeTargetHeights);

    expect(Math.min(...architectureHeights)).toBeGreaterThanOrEqual(7.5);
    expect(Math.max(...architectureHeights)).toBeLessThanOrEqual(15);
    expect(Math.min(...treeHeights)).toBeGreaterThanOrEqual(6.8);
    expect(Math.max(...treeHeights)).toBeLessThanOrEqual(7.8);
    expect(Math.min(...treeHeights)).toBeGreaterThan(2.2 * 3);
    expect(WORLD_SCALE_PROFILE.map.rockMinWorldHeight).toBeGreaterThanOrEqual(1.45);
    expect(WORLD_SCALE_PROFILE.map.rockMaxWorldHeight).toBeLessThanOrEqual(4.25);
    expect(WORLD_SCALE_PROFILE.flora.burdockTargetHeight).toBeLessThan(1.1);
    expect(WORLD_SCALE_PROFILE.flora.burdockTargetHeight).toBeLessThan(
      WORLD_SCALE_PROFILE.flora.fernTargetHeight,
    );
    expect(WORLD_SCALE_PROFILE.flora.burdockTargetHeight).toBeLessThan(
      WORLD_SCALE_PROFILE.flora.bushTargetHeight / 2,
    );
  });

  it('keeps the local-player selection ring above every road surface', () => {
    expect(WORLD_SCALE_PROFILE.character.playerSelectionRing.elevation).toBeGreaterThan(
      MAX_ROAD_SURFACE_Y,
    );
    expect(WORLD_SCALE_PROFILE.character.playerSelectionRing.innerRadius).toBeLessThan(0.85);
    expect(WORLD_SCALE_PROFILE.character.playerSelectionRing.outerRadius).toBeGreaterThan(
      WORLD_SCALE_PROFILE.character.playerSelectionRing.innerRadius,
    );
  });
});
