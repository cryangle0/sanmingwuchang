import { HERO_IDS, M0_RULES } from '@jwgb/content';
import { playerId, vec2Mm } from '@jwgb/core';
import type { SimEvent } from '@jwgb/sim';
import { addPlayerToState, createSimulationState } from '../packages/sim/src/state';
import { resolveApocalypseStorm } from '../packages/sim/src/systems/storm';

describe('same-tick true-death ordering', () => {
  it('commits every eligible storm death before the tick ends in entity order', () => {
    const state = createSimulationState(1_201);
    const first = addPlayerToState(state, {
      playerId: playerId('simultaneous-first'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(-1_000, 0),
    });
    const second = addPlayerToState(state, {
      playerId: playerId('simultaneous-second'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(1_000, 0),
    });
    first.hp = 1;
    first.livesRemaining = 1;
    first.trueDeaths = 2;
    second.hp = 1;
    second.livesRemaining = 1;
    second.trueDeaths = 2;
    state.tick = M0_RULES.apocalypseFirstDamageTick;
    const events: SimEvent[] = [];

    resolveApocalypseStorm(state, events);

    expect([first.lifeState, second.lifeState]).toEqual(['eliminated', 'eliminated']);
    expect(
      events
        .filter((event) => event.type === 'eliminated')
        .map((event) => ({ tick: event.tick, entityId: event.entityId })),
    ).toEqual([
      { tick: M0_RULES.apocalypseFirstDamageTick, entityId: first.entityId },
      { tick: M0_RULES.apocalypseFirstDamageTick, entityId: second.entityId },
    ]);
  });
});
