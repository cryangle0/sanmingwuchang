import { GENERIC_ACTIVE_IDS, HERO_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, SeededRng, vec2Mm } from '@jwgb/core';
import { GameSimulation } from '@jwgb/sim';

describe('Sun Wukong active', () => {
  it('starts a five-second buff and a forty-second cooldown', () => {
    const simulation = new GameSimulation({ rootSeed: 23 });
    const entity = simulation.addPlayer({
      playerId: playerId('wukong'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });

    simulation.submitIntent(
      entity,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
      }),
    );
    simulation.step();

    expect(simulation.getSnapshot().players[0]).toMatchObject({
      activeBuffTicks: 100,
      activeCooldownTicks: 800,
    });
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'active-cast',
        entityId: entity,
        activeName: '大闹天宫',
      }),
    );
  });

  it('resolves D3 as damage plus one second of hard control', () => {
    const simulation = new GameSimulation({ rootSeed: 24 });
    const caster = simulation.addPlayer({
      playerId: playerId('lightning-caster'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.lightning,
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('lightning-target'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(10_000, 0),
    });
    simulation.drainEvents();

    simulation.submitIntent(
      caster,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
        targetEntityId: target,
      }),
    );
    simulation.step();

    expect(simulation.getSnapshot().activeZones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activeId: GENERIC_ACTIVE_IDS.lightning,
          kind: 'delayed-target-strike',
          targetEntityId: target,
          activatesAtTick: 11,
        }),
      ]),
    );
    const castEvents = simulation.drainEvents();
    expect(castEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'active-cast',
          entityId: caster,
          activeAbilityId: GENERIC_ACTIVE_IDS.lightning,
        }),
      ]),
    );
    simulation.step(10);

    expect(simulation.getSnapshot().players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: target, hp: 300, hardControlTicks: 20 }),
      ]),
    );
    expect(simulation.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'damage',
          sourceEntityId: caster,
          targetEntityId: target,
          cause: 'active',
          form: 'skill',
          hpDamage: 188,
        }),
      ]),
    );
  });

  it('resolves D9 against every enemy inside the selected eight-meter area', () => {
    const simulation = new GameSimulation({ rootSeed: 25 });
    const caster = simulation.addPlayer({
      playerId: playerId('arrow-rain-caster'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.arrowRain,
      position: vec2Mm(0, 0),
    });
    const firstTarget = simulation.addPlayer({
      playerId: playerId('arrow-rain-first'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(10_000, 0),
    });
    const secondTarget = simulation.addPlayer({
      playerId: playerId('arrow-rain-second'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(15_000, 0),
    });
    const outsideTarget = simulation.addPlayer({
      playerId: playerId('arrow-rain-outside'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(24_000, 0),
    });
    simulation.drainEvents();

    simulation.submitIntent(
      caster,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
        targetEntityId: firstTarget,
      }),
    );
    simulation.step();

    expect(simulation.getSnapshot().activeZones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activeId: GENERIC_ACTIVE_IDS.arrowRain,
          kind: 'delayed-strike',
          activatesAtTick: 17,
        }),
      ]),
    );
    simulation.drainEvents();
    simulation.step(16);

    expect(simulation.getSnapshot().players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: firstTarget, hp: 322 }),
        expect.objectContaining({ entityId: secondTarget, hp: 322 }),
        expect.objectContaining({ entityId: outsideTarget, hp: 488 }),
      ]),
    );
    expect(
      simulation
        .drainEvents()
        .filter(
          (event) =>
            event.type === 'damage' && event.sourceEntityId === caster && event.cause === 'active',
        ),
    ).toHaveLength(2);
  });

  it('resolves D11 with a deterministic one-to-999 damage roll', () => {
    function castRoulette(rootSeed: number): { damage: number; hp: number } {
      const simulation = new GameSimulation({ rootSeed });
      const caster = simulation.addPlayer({
        playerId: playerId('roulette-caster'),
        heroId: HERO_IDS.sunWukong,
        activeAbilityId: GENERIC_ACTIVE_IDS.roulette,
        position: vec2Mm(0, 0),
      });
      const target = simulation.addPlayer({
        playerId: playerId('roulette-target'),
        heroId: HERO_IDS.sunWukong,
        position: vec2Mm(10_000, 0),
      });
      simulation.drainEvents();
      simulation.submitIntent(
        caster,
        createPlayerIntent({
          sequence: 1,
          moveX: 0,
          moveZ: 0,
          castActive: true,
          targetEntityId: target,
        }),
      );
      simulation.step();
      const damageEvent = simulation
        .drainEvents()
        .find((event) => event.type === 'damage' && event.sourceEntityId === caster);
      if (damageEvent?.type !== 'damage') {
        throw new Error('roulette did not produce damage');
      }
      return { damage: damageEvent.hpDamage, hp: simulation.getSnapshot().players[1]?.hp ?? 0 };
    }

    const first = castRoulette(26);
    const second = castRoulette(26);
    const expected = new SeededRng(26).fork('combat').nextInt(999) + 1;
    expect(first).toEqual(second);
    expect(first.damage).toBe(Math.min(expected, 488));
    expect(first.damage).toBeGreaterThanOrEqual(1);
    expect(first.damage).toBeLessThanOrEqual(999);
  });

  it('resolves D16 as an 800-gold grant', () => {
    const simulation = new GameSimulation({ rootSeed: 27 });
    const caster = simulation.addPlayer({
      playerId: playerId('fortune-caster'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.fortune,
      position: vec2Mm(0, 0),
    });

    simulation.submitIntent(
      caster,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
      }),
    );
    simulation.step();

    expect(simulation.getSnapshot().players[0]).toMatchObject({
      gold: 1_300,
      activeCooldownTicks: 1_700,
    });
  });
});
