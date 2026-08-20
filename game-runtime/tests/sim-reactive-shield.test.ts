import { EQUIPMENT_IDS, HERO_IDS, PASSIVE_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, SeededRng, vec2Mm } from '@jwgb/core';
import { GameSimulation, replaySimulation } from '@jwgb/sim';

function findSeedForB17Rolls(expectations: readonly boolean[]): number {
  for (let seed = 1; seed < 100_000; seed += 1) {
    const rng = new SeededRng(seed).fork('combat');
    if (expectations.every((expected) => rng.nextInt(100) < 20 === expected)) {
      return seed;
    }
  }
  throw new Error('unable to find deterministic B17 seed');
}

describe('B17 incoming basic shield', () => {
  it('creates a ten-second shield before the triggering basic damage is absorbed', () => {
    const simulation = new GameSimulation({ rootSeed: findSeedForB17Rolls([true]) });
    const attacker = simulation.addPlayer({
      playerId: playerId('b17-attacker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(4_000, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('b17-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.reactiveShield, level: 5 }],
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

    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === target),
    ).toMatchObject({
      hp: 627,
      totalShield: 100,
      shields: [
        expect.objectContaining({
          source: { kind: 'passive', passiveId: PASSIVE_IDS.reactiveShield },
          expiresAtTick: 201,
          remainingAmount: 100,
        }),
      ],
    });
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'passive-shield-created',
        entityId: target,
        amount: 160,
        durationTicks: 200,
      }),
    );
  });

  it('emits the level-five elemental skill AOE when damage breaks the shield', () => {
    const simulation = new GameSimulation({ rootSeed: findSeedForB17Rolls([true, false]) });
    const attacker = simulation.addPlayer({
      playerId: playerId('b17-break-attacker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(4_000, 0),
      equipmentIds: [EQUIPMENT_IDS.refinedIronStaff, EQUIPMENT_IDS.goldenCudgel],
    });
    const target = simulation.addPlayer({
      playerId: playerId('b17-break-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.reactiveShield, level: 5 }],
    });
    const bystander = simulation.addPlayer({
      playerId: playerId('b17-break-bystander'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(2_000, 0),
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
    simulation.step(16);

    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === target),
    ).toMatchObject({
      hp: 477,
      totalShield: 0,
    });
    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === bystander)?.hp,
    ).toBe(338);
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        sourceEntityId: target,
        targetEntityId: bystander,
        cause: 'passive',
        form: 'skill',
        amount: 150,
      }),
    );
  });

  it('snapshots the doubled H009 shield magnitude and break damage when B17 triggers', () => {
    const simulation = new GameSimulation({ rootSeed: findSeedForB17Rolls([true]) });
    const attacker = simulation.addPlayer({
      playerId: playerId('b17-h009-attacker'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(4_000, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('b17-h009-target'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.reactiveShield, level: 5 }],
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
      }),
    );
    simulation.step();

    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === target),
    ).toMatchObject({
      totalShield: 227,
      shields: [
        expect.objectContaining({
          breakEffect: expect.objectContaining({
            damage: 200,
            radiusMm: 3_000,
          }),
        }),
      ],
    });
  });

  it('keeps shield instance timing and proc RNG deterministic through replay', () => {
    const simulation = new GameSimulation({ rootSeed: findSeedForB17Rolls([true, false]) });
    const attacker = simulation.addPlayer({
      playerId: playerId('b17-replay-attacker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(4_000, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('b17-replay-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.reactiveShield, level: 5 }],
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
