import { entityId } from '@jwgb/core';
import { GameSimulation, type MonsterKind } from '@jwgb/sim';
import {
  heroModelDefinition,
  monsterModelDefinition,
  WEB_HERO_MODELS,
  WEB_MONSTER_MODELS,
} from '../apps/web/src/render/models/web-model-catalog';

describe('web model catalog', () => {
  it('covers every hero and every delivered monster model exactly once', () => {
    expect(WEB_HERO_MODELS).toHaveLength(38);
    expect(WEB_MONSTER_MODELS).toHaveLength(38);
    expect(new Set(WEB_HERO_MODELS.map((model) => model.id)).size).toBe(38);
    expect(new Set(WEB_MONSTER_MODELS.map((model) => model.id)).size).toBe(38);
    for (let index = 1; index <= 38; index += 1) {
      expect(heroModelDefinition(`H${index.toString().padStart(3, '0')}`)).not.toBeNull();
    }
  });

  it('delivers the fourteen animated heroes as versioned Web GLBs while retaining FBX models', () => {
    for (const id of [
      'H004',
      'H008',
      'H009',
      'H010',
      'H011',
      'H012',
      'H014',
      'H018',
      'H019',
      'H023',
      'H031',
      'H033',
      'H034',
      'H038',
    ]) {
      expect(heroModelDefinition(id)).toMatchObject({
        assetBase: 'web',
        format: 'glb',
        assetPath: `models/characters/${id}/model.glb`,
        height: 2.2,
      });
    }
    expect(heroModelDefinition('H017')).toMatchObject({
      assetBase: 'model-cdn',
      format: 'fbx',
      assetPath: 'heroes/H017/model.fbx',
    });
  });

  it('selects a stable model from the matching monster kind', () => {
    const first = monsterModelDefinition('ground-melee', entityId(42));
    const second = monsterModelDefinition('ground-melee', entityId(42));
    expect(first).toEqual(second);
    expect(first?.kind).toBe('ground-melee');
    expect(monsterModelDefinition('core-boss', entityId(42))?.kind).toBe('core-boss');
  });

  it('makes every delivered monster model reachable through stable entity ids', () => {
    const kinds = new Set(WEB_MONSTER_MODELS.map((model) => model.kind as MonsterKind));
    for (const kind of kinds) {
      if (kind === 'core-boss' || kind === 'dragon-king') {
        continue;
      }
      const expected = WEB_MONSTER_MODELS.filter((model) => model.kind === kind).map(
        (model) => model.id,
      );
      const count = expected.length;
      const resolved = expected.map((_, index) => {
        return monsterModelDefinition(kind, entityId(count + index))?.id;
      });
      expect(resolved).toEqual(expected);
    }
  });

  it('matches elemental pig and dragon models to the simulation element', () => {
    const expectedPigs = {
      earth: 'M018',
      wood: 'M019',
      water: 'M020',
      fire: 'M021',
      metal: 'M022',
    } as const;
    const expectedDragons = {
      earth: 'M034',
      wood: 'M035',
      water: 'M036',
      fire: 'M037',
      metal: 'M038',
    } as const;

    for (const element of Object.keys(expectedPigs) as (keyof typeof expectedPigs)[]) {
      expect(monsterModelDefinition('pig', entityId(1), element)?.id).toBe(expectedPigs[element]);
      expect(monsterModelDefinition('dragon-king', entityId(1), element)?.id).toBe(
        expectedDragons[element],
      );
    }
    expect(monsterModelDefinition('pig', entityId(6), 'fire')?.id).toBe('M015');
  });

  it('selects all six core boss models from the authoritative root seed', () => {
    const resolved = Array.from(
      { length: 6 },
      (_, rootSeed) => monsterModelDefinition('core-boss', entityId(123), null, rootSeed)?.id,
    );
    expect(resolved).toEqual(['M027', 'M028', 'M029', 'M030', 'M031', 'M032']);
  });

  it('maps the real full PVE population without elemental model mismatches', () => {
    const simulation = new GameSimulation({
      rootSeed: 77,
      map: { enabled: true },
      pve: { enabled: true, population: 'full' },
    });
    const monsters = simulation.getSnapshot().monsters;
    const pigModelIds = new Set<string>();
    const expectedByElement = {
      earth: { pig: 'M018', dragon: 'M034' },
      wood: { pig: 'M019', dragon: 'M035' },
      water: { pig: 'M020', dragon: 'M036' },
      fire: { pig: 'M021', dragon: 'M037' },
      metal: { pig: 'M022', dragon: 'M038' },
    } as const;

    for (const monster of monsters) {
      const definition = monsterModelDefinition(
        monster.kind,
        monster.entityId,
        monster.element,
        simulation.getSnapshot().rootSeed,
      );
      expect(definition).not.toBeNull();
      if (monster.kind === 'pig') {
        pigModelIds.add(definition?.id ?? '');
        if (definition?.id !== 'M015') {
          expect(definition?.id).toBe(expectedByElement[monster.element ?? 'metal'].pig);
        }
      } else if (monster.kind === 'dragon-king') {
        expect(definition?.id).toBe(expectedByElement[monster.element ?? 'metal'].dragon);
      }
    }

    expect(pigModelIds).toEqual(new Set(['M015', 'M018', 'M019', 'M020', 'M021', 'M022']));
  });

  it('makes all 38 delivered monster models reachable in real full PVE matches', () => {
    const resolved = new Set<string>();
    for (let rootSeed = 0; rootSeed < 500; rootSeed += 1) {
      const simulation = new GameSimulation({
        rootSeed,
        map: { enabled: true },
        pve: { enabled: true, population: 'full' },
      });
      const snapshot = simulation.getSnapshot();
      expect(snapshot.monsters, `root seed ${rootSeed}`).toHaveLength(123);
      for (const monster of snapshot.monsters) {
        const definition = monsterModelDefinition(
          monster.kind,
          monster.entityId,
          monster.element,
          snapshot.rootSeed,
        );
        expect(definition, `root seed ${rootSeed}, entity ${monster.entityId}`).not.toBeNull();
        if (definition) {
          resolved.add(definition.id);
        }
      }
    }

    expect(resolved).toEqual(new Set(WEB_MONSTER_MODELS.map((model) => model.id)));
  });
});
