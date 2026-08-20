import { HERO_IDS, M0_RULES } from '@jwgb/content';
import { playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation } from '@jwgb/sim';

describe('apocalypse storm', () => {
  it('starts at 20:01 and applies deterministic max-health damage', () => {
    const simulation = new GameSimulation({ rootSeed: 17 });
    simulation.addPlayer({
      playerId: playerId('storm-target'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });

    simulation.step(M0_RULES.apocalypseFirstDamageTick);

    expect(simulation.getSnapshot().players[0]).toMatchObject({
      maxHp: 488,
      hp: 479,
      lifeState: 'alive',
    });
  });
});
