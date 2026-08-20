import { HERO_IDS } from '@jwgb/content';
import { playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation } from '@jwgb/sim';

function advanceUntilAlive(simulation: GameSimulation, entityId: number): void {
  for (let count = 0; count < 500; count += 1) {
    const player = simulation
      .getSnapshot()
      .players.find((candidate) => Number(candidate.entityId) === entityId);
    if (player?.lifeState === 'alive') {
      return;
    }
    simulation.step();
  }
  throw new Error('player did not return to alive state');
}

describe('three-life state machine', () => {
  it('respawns after the first two true deaths and eliminates on the third', () => {
    const simulation = new GameSimulation({ rootSeed: 99 });
    const entity = simulation.addPlayer({
      playerId: playerId('three-lives'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });

    simulation.damage(entity, 99_999);
    let player = simulation.getSnapshot().players[0];
    expect(player).toMatchObject({
      lifeState: 'soul-flight',
      livesRemaining: 2,
      trueDeaths: 1,
    });

    advanceUntilAlive(simulation, Number(entity));
    player = simulation.getSnapshot().players[0];
    expect(player).toMatchObject({
      hp: 488,
      lifeState: 'alive',
      livesRemaining: 2,
    });

    simulation.damage(entity, 99_999);
    advanceUntilAlive(simulation, Number(entity));
    player = simulation.getSnapshot().players[0];
    expect(player).toMatchObject({
      hp: 488,
      lifeState: 'alive',
      livesRemaining: 1,
      trueDeaths: 2,
    });

    simulation.damage(entity, 99_999);
    player = simulation.getSnapshot().players[0];
    expect(player).toMatchObject({
      hp: 0,
      lifeState: 'eliminated',
      livesRemaining: 0,
      trueDeaths: 3,
    });

    expect(simulation.drainEvents().filter((event) => event.type === 'true-death')).toHaveLength(3);
    expect(simulation.drainEvents()).toHaveLength(0);
  });
});
