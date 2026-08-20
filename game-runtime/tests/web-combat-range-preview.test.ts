import {
  GENERIC_ACTIVE_IDS,
  getActiveDefinition,
  getHeroDefinition,
  HERO_IDS,
} from '@jwgb/content';
import { activePresentationRange } from '../apps/web/src/render/combat-range-preview';

describe('web combat range presentation', () => {
  it('uses authoritative target or placement range first', () => {
    expect(activePresentationRange(getHeroDefinition(HERO_IDS.ironFanPrincess).active)).toEqual({
      rangeMm: 15_000,
      source: 'range',
    });
  });

  it('uses movement distance for blink-style actives', () => {
    expect(activePresentationRange(getActiveDefinition(GENERIC_ACTIVE_IDS.blink))).toEqual({
      rangeMm: 15_000,
      source: 'distance',
    });
  });

  it('uses an authoritative area radius when that is the only spatial value', () => {
    expect(activePresentationRange(getHeroDefinition(HERO_IDS.bullDemonKing).active)).toEqual({
      rangeMm: 8_000,
      source: 'radius',
    });
  });

  it('hides the active ring for self-only abilities with no spatial value', () => {
    expect(activePresentationRange(getHeroDefinition(HERO_IDS.sunWukong).active)).toBeNull();
    expect(activePresentationRange(getActiveDefinition(GENERIC_ACTIVE_IDS.ironShirt))).toBeNull();
  });
});
