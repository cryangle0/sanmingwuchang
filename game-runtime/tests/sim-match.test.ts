import { HERO_IDS, M0_RULES } from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, type SimEvent } from '@jwgb/sim';
import { addPlayerToState, createSimulationState } from '../packages/sim/src/state';
import { resolveMatchOutcome, startMatchIfReady } from '../packages/sim/src/systems/match';
import { resolveApocalypseStorm } from '../packages/sim/src/systems/storm';

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

describe('match lifecycle', () => {
  it('starts with the second competitor and settles a unique winner', () => {
    const simulation = new GameSimulation({ rootSeed: 0x4d31 });
    const winner = simulation.addPlayer({
      playerId: playerId('match-winner'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(-2_000, 0),
    });
    expect(simulation.getSnapshot().match.status).toBe('waiting');
    const loser = simulation.addPlayer({
      playerId: playerId('match-loser'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(2_000, 0),
    });
    expect(simulation.getSnapshot().match.status).toBe('waiting');
    simulation.step();
    expect(simulation.getSnapshot().match.status).toBe('running');
    simulation.drainEvents();

    for (let death = 0; death < 3; death += 1) {
      simulation.damage(loser, 99_999, winner);
      if (death < 2) {
        advanceUntilAlive(simulation, Number(loser));
      }
    }

    expect(simulation.getSnapshot().match).toEqual({
      status: 'finished',
      startedAtTick: 0,
      finishedAtTick: simulation.tick,
      outcome: 'winner',
      winnerEntityId: winner,
      winnerEntityIds: [winner],
      placements: [winner, loser],
      placementGroups: [[winner], [loser]],
      voidAbortReason: null,
      mmrEligible: true,
      cultivationAwards: [],
      diagnosticReplayRequired: false,
    });
    expect(simulation.drainEvents()).toContainEqual({
      type: 'match-ended',
      tick: simulation.tick,
      outcome: 'winner',
      winnerEntityId: winner,
      winnerEntityIds: [winner],
      placements: [winner, loser],
      placementGroups: [[winner], [loser]],
      voidAbortReason: null,
      mmrEligible: true,
      cultivationAwards: [],
      diagnosticReplayRequired: false,
    });

    const finishedTick = simulation.tick;
    expect(
      simulation.submitIntent(winner, createPlayerIntent({ sequence: 1, moveX: 1_000, moveZ: 0 })),
    ).toBe(false);
    simulation.step(10);
    expect(simulation.tick).toBe(finishedTick);
    expect(simulation.damage(winner, 99_999)).toBe(0);
  });

  it('records a deterministic draw when all remaining competitors die in one tick', () => {
    const state = createSimulationState(0x4d32);
    const first = addPlayerToState(state, {
      playerId: playerId('draw-first'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(-1_000, 0),
    });
    const second = addPlayerToState(state, {
      playerId: playerId('draw-second'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(1_000, 0),
    });
    const events: SimEvent[] = [];
    startMatchIfReady(state, events);
    first.hp = 1;
    first.livesRemaining = 1;
    first.trueDeaths = 2;
    second.hp = 1;
    second.livesRemaining = 1;
    second.trueDeaths = 2;
    state.tick = M0_RULES.apocalypseFirstDamageTick;

    resolveApocalypseStorm(state, events);
    resolveMatchOutcome(state, events);

    expect(state.match).toEqual({
      status: 'finished',
      startedAtTick: 0,
      finishedAtTick: M0_RULES.apocalypseFirstDamageTick,
      outcome: 'tied-first',
      winnerEntityId: null,
      winnerEntityIds: [first.entityId, second.entityId],
      placements: [first.entityId, second.entityId],
      placementGroups: [[first.entityId, second.entityId]],
      voidAbortReason: null,
      mmrEligible: true,
      cultivationAwards: [],
      diagnosticReplayRequired: false,
    });
    expect(events.at(-1)).toEqual({
      type: 'match-ended',
      tick: M0_RULES.apocalypseFirstDamageTick,
      outcome: 'tied-first',
      winnerEntityId: null,
      winnerEntityIds: [first.entityId, second.entityId],
      placements: [first.entityId, second.entityId],
      placementGroups: [[first.entityId, second.entityId]],
      voidAbortReason: null,
      mmrEligible: true,
      cultivationAwards: [],
      diagnosticReplayRequired: false,
    });
    const matchEndedIndex = events.findIndex((event) => event.type === 'match-ended');
    expect(matchEndedIndex).toBeGreaterThan(0);
    expect(
      events
        .slice(0, matchEndedIndex)
        .filter((event) => event.type === 'true-death' || event.type === 'eliminated'),
    ).toHaveLength(4);
  });

  it('aborts at 30 minutes without ranking or MMR eligibility and awards cultivation', () => {
    const state = createSimulationState(0x4d33);
    const first = addPlayerToState(state, {
      playerId: playerId('void-first'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(-1_000, 0),
    });
    const second = addPlayerToState(state, {
      playerId: playerId('void-second'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(1_000, 0),
    });
    const events: SimEvent[] = [];
    startMatchIfReady(state, events);
    state.tick = M0_RULES.matchVoidAbortTicks;

    resolveMatchOutcome(state, events);

    expect(state.match).toEqual({
      status: 'finished',
      startedAtTick: 0,
      finishedAtTick: M0_RULES.matchVoidAbortTicks,
      outcome: 'void-abort',
      winnerEntityId: null,
      winnerEntityIds: [],
      placements: [],
      placementGroups: [],
      voidAbortReason: 'VOID_ABORT',
      mmrEligible: false,
      cultivationAwards: [
        { entityId: first.entityId, amount: M0_RULES.voidAbortCultivationCompensation },
        { entityId: second.entityId, amount: M0_RULES.voidAbortCultivationCompensation },
      ],
      diagnosticReplayRequired: true,
    });
    expect(events.at(-1)).toMatchObject({
      type: 'match-ended',
      outcome: 'void-abort',
      voidAbortReason: 'VOID_ABORT',
      mmrEligible: false,
      diagnosticReplayRequired: true,
    });
  });
});
