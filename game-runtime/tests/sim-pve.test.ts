import { HERO_IDS } from '@jwgb/content';
import { createPlayerIntent, entityId, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, replaySimulation } from '@jwgb/sim';

function createPveScenario(): {
  simulation: GameSimulation;
  player: ReturnType<GameSimulation['addPlayer']>;
  targetMonster: number;
} {
  const simulation = new GameSimulation({
    rootSeed: 0x4d31,
    pve: { enabled: true, population: 'demo' },
  });
  const firstMonster = simulation.getSnapshot().monsters[0];
  if (!firstMonster) {
    throw new Error('PVE demo did not spawn a monster');
  }
  const player = simulation.addPlayer({
    playerId: playerId('pve-hunter'),
    heroId: HERO_IDS.sunWukong,
    position: vec2Mm(firstMonster.position.x, firstMonster.position.z),
  });
  simulation.addPlayer({
    playerId: playerId('pve-observer'),
    heroId: HERO_IDS.ironFanPrincess,
    position: vec2Mm(0, 0),
  });
  return { simulation, player, targetMonster: Number(firstMonster.entityId) };
}

describe('PVE runtime', () => {
  it('spawns the full authoritative simultaneous population when requested', () => {
    const simulation = new GameSimulation({
      rootSeed: 77,
      pve: { enabled: true, population: 'full' },
    });

    expect(simulation.getSnapshot().monsters).toHaveLength(123);
    expect(
      simulation.drainEvents().filter((event) => event.type === 'monster-spawned'),
    ).toHaveLength(123);
  });

  it('binds each active map dragon to the element of its selected palace', () => {
    const expectedByPosition = new Map([
      ['153000,229200', 'metal'],
      ['288900,106600', 'wood'],
      ['-228100,-74600', 'water'],
      ['-100200,-165200', 'fire'],
      ['200900,-154600', 'earth'],
    ]);

    for (let rootSeed = 0; rootSeed < 100; rootSeed += 1) {
      const simulation = new GameSimulation({
        rootSeed,
        map: { enabled: true },
        pve: { enabled: true, population: 'full' },
      });
      const dragons = simulation
        .getSnapshot()
        .monsters.filter((monster) => monster.kind === 'dragon-king');
      expect(dragons, `root seed ${rootSeed}`).toHaveLength(2);
      for (const dragon of dragons) {
        expect(dragon.element, `root seed ${rootSeed}`).toBe(
          expectedByPosition.get(`${dragon.homePosition.x},${dragon.homePosition.z}`),
        );
      }
    }
  });

  it('lets a player kill a monster, receive a real drop, and pick it up', () => {
    const { simulation, player, targetMonster } = createPveScenario();
    simulation.drainEvents();
    simulation.submitIntent(
      player,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: entityId(targetMonster),
      }),
    );

    for (let tick = 0; tick < 150; tick += 1) {
      simulation.step();
    }

    const combatEvents = simulation.drainEvents();
    expect(
      combatEvents.some(
        (event) =>
          event.type === 'basic-attack' &&
          event.sourceEntityId === player &&
          Number(event.targetEntityId) === targetMonster,
      ),
    ).toBe(true);
    const killedEvents = combatEvents.filter((event) => event.type === 'monster-killed');
    expect(killedEvents).toHaveLength(1);
    expect(simulation.getSnapshot().lootDrops).toHaveLength(1);

    simulation.submitIntent(
      player,
      createPlayerIntent({
        sequence: 2,
        moveX: 0,
        moveZ: 0,
        interact: true,
      }),
    );
    simulation.step();

    const playerSnapshot = simulation
      .getSnapshot()
      .players.find((candidate) => candidate.entityId === player);
    expect(playerSnapshot?.gold).toBeGreaterThan(500);
    expect(playerSnapshot?.experience).toBeGreaterThan(0);
    expect(simulation.getSnapshot().lootDrops).toHaveLength(0);
  });

  it('keeps PVE entity order and combat deterministic through replay', () => {
    const { simulation, player, targetMonster } = createPveScenario();
    simulation.drainEvents();
    simulation.submitIntent(
      player,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: entityId(targetMonster),
      }),
    );
    simulation.step(80);

    const tape = simulation.exportReplay();
    expect(replaySimulation(tape).getStateHash()).toBe(tape.expectedStateHash);
  });
});
