import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUTHORITATIVE_CONTENT_COUNTS,
  AUTHORITATIVE_EQUIPMENT,
  AUTHORITATIVE_GENERIC_ACTIVES,
  AUTHORITATIVE_HEROES,
  AUTHORITATIVE_PASSIVES,
  AUTHORITATIVE_WORLD_SUMMARY,
  getAuthoritativeHero,
  getAuthoritativePassive,
} from '@jwgb/content';

interface AuthoritativeContentManifest {
  readonly schema: string;
  readonly counts: {
    readonly heroes: number;
    readonly heroActives: number;
    readonly genericActives: number;
    readonly passives: number;
    readonly skillsTotal: number;
    readonly equipment: number;
  };
  readonly runtimeCoverage: {
    readonly heroActivesImplemented: number;
    readonly genericActivesImplemented: number;
    readonly passivesImplemented: number;
    readonly equipmentImplemented: number;
  };
  readonly pve: {
    readonly simultaneousPopulation: number;
  };
  readonly map: {
    readonly openValidationItems: readonly string[];
  };
}

describe('authoritative content compilation', () => {
  it('captures the complete source inventory without overstating runtime coverage', () => {
    const path = resolve(process.cwd(), 'migration', 'content', 'authoritative-content-v1.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as AuthoritativeContentManifest;

    expect(manifest.schema).toBe('jwgb.authoritative-content.v1');
    expect(manifest.counts).toEqual({
      heroes: 38,
      heroActives: 38,
      genericActives: 19,
      passives: 44,
      skillsTotal: 101,
      equipment: 44,
    });
    expect(manifest.pve.simultaneousPopulation).toBe(123);
    expect(manifest.runtimeCoverage).toEqual({
      heroActivesImplemented: 3,
      genericActivesImplemented: 7,
      passivesImplemented: 4,
      equipmentImplemented: 4,
    });
    expect(manifest.map.openValidationItems.length).toBeGreaterThan(0);
  });

  it('exposes the same full catalog to runtime code', () => {
    expect(AUTHORITATIVE_CONTENT_COUNTS.skillsTotal).toBe(101);
    expect(AUTHORITATIVE_HEROES).toHaveLength(38);
    expect(AUTHORITATIVE_GENERIC_ACTIVES).toHaveLength(19);
    expect(AUTHORITATIVE_PASSIVES).toHaveLength(44);
    expect(AUTHORITATIVE_EQUIPMENT).toHaveLength(44);
    expect(getAuthoritativePassive('B06')).toBe(getAuthoritativePassive('B6'));
    expect(getAuthoritativeHero('H038')).toMatchObject({
      name: '赛太岁',
      active: {
        name: '迷烟',
        runtimeStatus: 'definition-only',
      },
    });
    expect(AUTHORITATIVE_WORLD_SUMMARY.pve.simultaneousPopulation).toBe(123);
  });
});
