import { HERO_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation } from '@jwgb/sim';

function createWhirlwindScenario(): {
  readonly simulation: GameSimulation;
  readonly owner: ReturnType<GameSimulation['addPlayer']>;
  readonly target: ReturnType<GameSimulation['addPlayer']>;
} {
  const simulation = new GameSimulation({ rootSeed: 81 });
  const owner = simulation.addPlayer({
    playerId: playerId('whirlwind-owner'),
    heroId: HERO_IDS.bullDemonKing,
    position: vec2Mm(0, 0),
  });
  const target = simulation.addPlayer({
    playerId: playerId('whirlwind-target'),
    heroId: HERO_IDS.bullDemonKing,
    position: vec2Mm(7_000, 0),
  });
  return { simulation, owner, target };
}

describe('Bull Demon King whirlwind', () => {
  it('deals three one-second pulses using fixed plus attack coefficient damage', () => {
    const { simulation, owner, target } = createWhirlwindScenario();
    simulation.submitIntent(
      owner,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
      }),
    );
    simulation.step();
    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      627,
    );

    simulation.step(20);
    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      501,
    );

    simulation.step(40);
    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      249,
    );
    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === owner)?.whirlwindTicks,
    ).toBe(0);
  });

  it('moves at half speed while channeling and stops immediately on hard control', () => {
    const { simulation, owner, target } = createWhirlwindScenario();
    simulation.submitIntent(
      owner,
      createPlayerIntent({
        sequence: 1,
        moveX: 1_000,
        moveZ: 0,
        castActive: true,
      }),
    );
    simulation.step(20);
    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === owner)?.position,
    ).toEqual(vec2Mm(1_380, 0));

    simulation.hardControl(owner, 10);
    simulation.step(41);
    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === owner)?.whirlwindTicks,
    ).toBe(0);
    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      627,
    );
  });
});
