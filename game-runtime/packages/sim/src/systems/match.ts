import { M0_RULES } from '@jwgb/content';
import { type EntityId, invariant } from '@jwgb/core';
import { sortedPlayers } from '../state';
import type { MatchOutcome, MutableSimulationState, SimEvent } from '../types';

export function startMatchIfReady(state: MutableSimulationState, events: SimEvent[]): void {
  if (state.match.status !== 'waiting' || state.players.size < 2) {
    return;
  }
  state.match.status = 'running';
  state.match.startedAtTick = state.tick;
  events.push({
    type: 'match-started',
    tick: state.tick,
    competitorCount: state.players.size,
  });
}

function eliminationGroups(state: MutableSimulationState): EntityId[][] {
  const byTick = new Map<number, EntityId[]>();
  for (const entityId of state.eliminationOrder) {
    const tick = state.eliminationTicks.get(entityId) ?? state.tick;
    const group = byTick.get(tick) ?? [];
    group.push(entityId);
    byTick.set(tick, group);
  }
  return [...byTick.entries()]
    .sort(([left], [right]) => right - left)
    .map(([, entityIds]) => [...entityIds].sort((left, right) => Number(left) - Number(right)));
}

function finishMatch(
  state: MutableSimulationState,
  events: SimEvent[],
  outcome: MatchOutcome,
  winnerEntityIds: readonly EntityId[],
  placementGroups: readonly (readonly EntityId[])[],
  voidAbort: boolean,
): void {
  const placements = placementGroups.flatMap((group) => [...group]);
  if (!voidAbort) {
    invariant(
      placements.length === state.players.size,
      'match placements must include every competitor',
    );
  }
  const cultivationAwards = voidAbort
    ? sortedPlayers(state).map((player) => ({
        entityId: player.entityId,
        amount: M0_RULES.voidAbortCultivationCompensation,
      }))
    : [];
  state.match.status = 'finished';
  state.match.finishedAtTick = state.tick;
  state.match.outcome = outcome;
  state.match.winnerEntityId = winnerEntityIds.length === 1 ? (winnerEntityIds[0] ?? null) : null;
  state.match.winnerEntityIds = [...winnerEntityIds];
  state.match.placements = placements;
  state.match.placementGroups = placementGroups.map((group) => [...group]);
  state.match.voidAbortReason = voidAbort ? 'VOID_ABORT' : null;
  state.match.mmrEligible = !voidAbort;
  state.match.cultivationAwards = cultivationAwards;
  state.match.diagnosticReplayRequired = voidAbort;
  events.push({
    type: 'match-ended',
    tick: state.tick,
    outcome,
    winnerEntityId: state.match.winnerEntityId,
    winnerEntityIds: [...winnerEntityIds],
    placements: [...placements],
    placementGroups: state.match.placementGroups.map((group) => [...group]),
    voidAbortReason: state.match.voidAbortReason,
    mmrEligible: state.match.mmrEligible,
    cultivationAwards: cultivationAwards.map((award) => ({ ...award })),
    diagnosticReplayRequired: state.match.diagnosticReplayRequired,
  });
}

export function resolveMatchOutcome(state: MutableSimulationState, events: SimEvent[]): void {
  if (state.match.status !== 'running') {
    return;
  }
  const contenders = sortedPlayers(state).filter((player) => player.lifeState !== 'eliminated');
  const eliminatedGroups = eliminationGroups(state);

  if (contenders.length > 1) {
    const elapsedTicks = state.tick - (state.match.startedAtTick ?? state.tick);
    if (elapsedTicks >= M0_RULES.matchVoidAbortTicks) {
      finishMatch(state, events, 'void-abort', [], [], true);
    }
    return;
  }

  if (contenders.length === 1) {
    const winner = contenders[0];
    invariant(winner, 'winner contender must exist');
    finishMatch(
      state,
      events,
      'winner',
      [winner.entityId],
      [[winner.entityId], ...eliminatedGroups],
      false,
    );
    return;
  }

  const latestEliminatedGroup = eliminatedGroups[0] ?? [];
  const outcome: MatchOutcome = latestEliminatedGroup.length > 1 ? 'tied-first' : 'draw';
  finishMatch(
    state,
    events,
    outcome,
    outcome === 'tied-first' ? latestEliminatedGroup : [],
    eliminatedGroups,
    false,
  );
}
