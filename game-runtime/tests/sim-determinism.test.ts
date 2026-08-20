import { EQUIPMENT_IDS, HERO_IDS, PASSIVE_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, replaySimulation } from '@jwgb/sim';

function createScenario(): {
  simulation: GameSimulation;
  wukong: ReturnType<GameSimulation['addPlayer']>;
  bull: ReturnType<GameSimulation['addPlayer']>;
} {
  const simulation = new GameSimulation({ rootSeed: 0x2026_0723 });
  const wukong = simulation.addPlayer({
    playerId: playerId('wukong'),
    heroId: HERO_IDS.sunWukong,
    position: vec2Mm(-4_000, 0),
  });
  const bull = simulation.addPlayer({
    playerId: playerId('bull'),
    heroId: HERO_IDS.bullDemonKing,
    position: vec2Mm(4_000, 0),
  });
  return { simulation, wukong, bull };
}

function runScenario(): GameSimulation {
  const { simulation, wukong, bull } = createScenario();
  simulation.submitIntent(
    wukong,
    createPlayerIntent({
      sequence: 1,
      moveX: 1_000,
      moveZ: 0,
      attack: true,
      targetEntityId: bull,
    }),
  );
  simulation.submitIntent(
    bull,
    createPlayerIntent({
      sequence: 1,
      moveX: -1_000,
      moveZ: 0,
      attack: true,
      targetEntityId: wukong,
    }),
  );
  simulation.step(180);
  return simulation;
}

describe('simulation determinism', () => {
  it('produces the same state hash for the same seed and input stream', () => {
    expect(runScenario().getStateHash()).toBe(runScenario().getStateHash());
  });

  it('replays accepted inputs to the same final state hash', () => {
    const original = runScenario();
    const tape = original.exportReplay();
    const replayed = replaySimulation(tape);

    expect(replayed.getStateHash()).toBe(tape.expectedStateHash);
  });

  it('replays automatic spawn selection without drifting the spawn random stream', () => {
    const simulation = new GameSimulation({ rootSeed: 0x51a7 });
    simulation.addPlayer({
      playerId: playerId('automatic-spawn-first'),
      heroId: HERO_IDS.sunWukong,
    });
    simulation.addPlayer({
      playerId: playerId('automatic-spawn-second'),
      heroId: HERO_IDS.bullDemonKing,
    });
    simulation.step(5);

    const tape = simulation.exportReplay();
    expect(replaySimulation(tape).getStateHash()).toBe(tape.expectedStateHash);
  });

  it('replays a player joining after a dynamic entity has consumed an entity id', () => {
    const simulation = new GameSimulation({ rootSeed: 0x1a7e });
    const attacker = simulation.addPlayer({
      playerId: playerId('late-join-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('late-join-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(12_000, 0),
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
    expect(simulation.getSnapshot().projectiles).toHaveLength(1);

    const latePlayer = simulation.addPlayer({
      playerId: playerId('late-join-player'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(-10_000, 0),
    });
    simulation.submitIntent(
      latePlayer,
      createPlayerIntent({
        sequence: 1,
        moveX: 750,
        moveZ: 250,
        targetEntityId: target,
      }),
    );
    simulation.step(12);

    const tape = simulation.exportReplay();
    expect(Number(latePlayer)).toBeGreaterThan(3);
    expect(replaySimulation(tape).getStateHash()).toBe(tape.expectedStateHash);
  });

  it('replays one thousand combat-proc seeds without hash drift', () => {
    for (let rootSeed = 1; rootSeed <= 1_000; rootSeed += 1) {
      const simulation = new GameSimulation({ rootSeed });
      const attacker = simulation.addPlayer({
        playerId: playerId(`seed-${rootSeed}-attacker`),
        heroId: HERO_IDS.sunWukong,
        position: vec2Mm(0, 0),
        passives: [{ passiveId: PASSIVE_IDS.critical, level: 5 }],
        equipmentIds: [EQUIPMENT_IDS.refinedIronStaff, EQUIPMENT_IDS.goldenCudgel],
      });
      const target = simulation.addPlayer({
        playerId: playerId(`seed-${rootSeed}-target`),
        heroId: HERO_IDS.bullDemonKing,
        position: vec2Mm(4_000, 0),
        passives: [{ passiveId: PASSIVE_IDS.reactiveShield, level: 5 }],
        equipmentIds: [EQUIPMENT_IDS.coarseClothArmor],
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
      simulation.step(32);

      const tape = simulation.exportReplay();
      expect(replaySimulation(tape).getStateHash(), `root seed ${rootSeed}`).toBe(
        tape.expectedStateHash,
      );
    }
  }, 30_000);
});
