import { EQUIPMENT_IDS, GENERIC_ACTIVE_IDS, HERO_IDS, PASSIVE_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, SeededRng, vec2Mm } from '@jwgb/core';
import { GameSimulation, replaySimulation } from '@jwgb/sim';

function findSeedForCombatRolls(expectations: readonly boolean[], chancePercent = 20): number {
  for (let seed = 1; seed < 100_000; seed += 1) {
    const rng = new SeededRng(seed).fork('combat');
    if (expectations.every((expected) => rng.nextInt(100) < chancePercent === expected)) {
      return seed;
    }
  }
  throw new Error('unable to find deterministic combat-proc seed');
}

describe('B06 deterministic critical hit', () => {
  it('rolls on a committed basic hit and applies the level-five 230% multiplier', () => {
    const simulation = new GameSimulation({ rootSeed: findSeedForCombatRolls([true]) });
    const attacker = simulation.addPlayer({
      playerId: playerId('critical-attacker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.critical, level: 5 }],
    });
    const target = simulation.addPlayer({
      playerId: playerId('critical-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(4_000, 0),
    });

    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step();

    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      489,
    );
    expect(simulation.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'critical-hit',
          sourceEntityId: attacker,
          targetEntityId: target,
          criticalDamagePercent: 230,
          shieldBypassPercent: 30,
        }),
        expect.objectContaining({
          type: 'damage',
          sourceEntityId: attacker,
          targetEntityId: target,
          isCritical: true,
          amount: 138,
        }),
      ]),
    );
  });

  it('splits level-five critical damage into an HP child and shield child after total damage', () => {
    const simulation = new GameSimulation({ rootSeed: findSeedForCombatRolls([true]) });
    const attacker = simulation.addPlayer({
      playerId: playerId('critical-bypass-attacker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.critical, level: 5 }],
    });
    const target = simulation.addPlayer({
      playerId: playerId('critical-bypass-target'),
      heroId: HERO_IDS.bullDemonKing,
      activeAbilityId: GENERIC_ACTIVE_IDS.ironShirt,
      position: vec2Mm(4_000, 0),
    });
    simulation.submitIntent(
      target,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
      }),
    );
    simulation.step();
    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step();

    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === target),
    ).toMatchObject({
      hp: 586,
      totalShield: 503,
    });
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        isCritical: true,
        amount: 138,
        shieldDamage: 97,
        hpDamage: 41,
        shieldBypassHpDamage: 41,
      }),
    );
  });

  it('reads H009 passive magnitudes at the hit tick without increasing proc chance', () => {
    const simulation = new GameSimulation({ rootSeed: findSeedForCombatRolls([true]) });
    const attacker = simulation.addPlayer({
      playerId: playerId('critical-h009-attacker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.critical, level: 5 }],
    });
    const target = simulation.addPlayer({
      playerId: playerId('critical-h009-target'),
      heroId: HERO_IDS.bullDemonKing,
      activeAbilityId: GENERIC_ACTIVE_IDS.ironShirt,
      position: vec2Mm(4_000, 0),
    });
    simulation.submitIntent(
      target,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
      }),
    );
    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
        castActive: true,
      }),
    );
    simulation.step();

    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === target),
    ).toMatchObject({
      hp: 462,
      totalShield: 489,
    });
    expect(simulation.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'critical-hit',
          criticalDamagePercent: 460,
          shieldBypassPercent: 60,
        }),
        expect.objectContaining({
          type: 'damage',
          amount: 276,
          shieldDamage: 111,
          hpDamage: 165,
          shieldBypassHpDamage: 165,
        }),
      ]),
    );
  });

  it('replays critical rolls and equipment-derived damage to the same hash', () => {
    const simulation = new GameSimulation({ rootSeed: findSeedForCombatRolls([true, false]) });
    const attacker = simulation.addPlayer({
      playerId: playerId('critical-replay-attacker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.critical, level: 5 }],
      equipmentIds: [EQUIPMENT_IDS.refinedIronStaff],
    });
    const target = simulation.addPlayer({
      playerId: playerId('critical-replay-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(4_000, 0),
    });
    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step(20);

    const tape = simulation.exportReplay();
    expect(replaySimulation(tape).getStateHash()).toBe(tape.expectedStateHash);
  });
});
