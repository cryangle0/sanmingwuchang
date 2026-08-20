import { EQUIPMENT_IDS, HERO_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, replaySimulation } from '@jwgb/sim';

describe('M1 representative equipment', () => {
  it('applies W1, W2, and G10 to effective combat stats at player creation', () => {
    const simulation = new GameSimulation({ rootSeed: 1_101 });
    simulation.addPlayer({
      playerId: playerId('equipment-stats'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      equipmentIds: [
        EQUIPMENT_IDS.refinedIronStaff,
        EQUIPMENT_IDS.coarseClothArmor,
        EQUIPMENT_IDS.goldenCudgel,
      ],
    });

    expect(simulation.getSnapshot().players[0]).toMatchObject({
      hp: 708,
      maxHp: 708,
      attackPower: 155,
      attackRangeMm: 8_000,
    });
  });

  it('lets G10 acquire and hit a melee target three meters beyond base range', () => {
    const simulation = new GameSimulation({ rootSeed: 1_102 });
    const attacker = simulation.addPlayer({
      playerId: playerId('g10-melee-attacker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      equipmentIds: [EQUIPMENT_IDS.goldenCudgel],
    });
    const target = simulation.addPlayer({
      playerId: playerId('g10-melee-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(7_500, 0),
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
      487,
    );
  });

  it('extends a ranged projectile travel budget to the G10-adjusted basic range', () => {
    const simulation = new GameSimulation({ rootSeed: 1_103 });
    const attacker = simulation.addPlayer({
      playerId: playerId('g10-ranged-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
      equipmentIds: [EQUIPMENT_IDS.goldenCudgel],
    });
    const target = simulation.addPlayer({
      playerId: playerId('g10-ranged-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(22_000, 0),
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

    expect(simulation.getSnapshot().projectiles[0]).toMatchObject({
      baseDamage: 121,
      outgoingDamageBasisPoints: 10_000,
      remainingTravelMm: 23_000,
    });
    simulation.step(8);
    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      506,
    );
  });

  it('replays equipment-derived stats and projectile range to the same hash', () => {
    const simulation = new GameSimulation({ rootSeed: 1_104 });
    const attacker = simulation.addPlayer({
      playerId: playerId('equipment-replay-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
      equipmentIds: [EQUIPMENT_IDS.coarseClothArmor, EQUIPMENT_IDS.goldenCudgel],
    });
    const target = simulation.addPlayer({
      playerId: playerId('equipment-replay-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(22_000, 0),
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
    simulation.step(4);

    const tape = simulation.exportReplay();
    expect(replaySimulation(tape).getStateHash()).toBe(tape.expectedStateHash);
  });
});
