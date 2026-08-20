import { type EntityId, invariant, type PlayerIntent } from '@jwgb/core';
import { GameSimulation } from '../simulation';
import type { ReplayRosterEntry, SimulationReplay } from '../types';

function groupByTick<Entry extends { readonly atTick: number }>(
  entries: readonly Entry[],
): Map<number, Entry[]> {
  const entriesByTick = new Map<number, Entry[]>();
  for (const entry of entries) {
    const tickEntries = entriesByTick.get(entry.atTick) ?? [];
    tickEntries.push(entry);
    entriesByTick.set(entry.atTick, tickEntries);
  }
  return entriesByTick;
}

function addReplayPlayer(
  simulation: GameSimulation,
  entry: ReplayRosterEntry,
  replayEntityIds: Map<EntityId, EntityId>,
): void {
  invariant(!replayEntityIds.has(entry.entityId), `duplicate replay entity ${entry.entityId}`);
  const replayEntityId = simulation.addPlayer(entry);
  replayEntityIds.set(entry.entityId, replayEntityId);
}

function remapIntent(
  intent: PlayerIntent,
  replayEntityIds: ReadonlyMap<EntityId, EntityId>,
): PlayerIntent {
  if (
    intent.targetEntityId === null &&
    (intent.secondaryTargetEntityId === null || intent.secondaryTargetEntityId === undefined)
  ) {
    return intent;
  }
  const replayTargetEntityId =
    intent.targetEntityId === null
      ? null
      : (replayEntityIds.get(intent.targetEntityId) ?? intent.targetEntityId);
  const replaySecondaryTargetEntityId =
    intent.secondaryTargetEntityId === null || intent.secondaryTargetEntityId === undefined
      ? null
      : (replayEntityIds.get(intent.secondaryTargetEntityId) ?? intent.secondaryTargetEntityId);
  return {
    ...intent,
    targetEntityId: replayTargetEntityId,
    secondaryTargetEntityId: replaySecondaryTargetEntityId,
  };
}

export function replaySimulation(tape: SimulationReplay): GameSimulation {
  const simulation = new GameSimulation({
    rootSeed: tape.rootSeed,
    staticSolids: tape.staticSolids,
    ...(tape.pve ? { pve: tape.pve } : {}),
    ...(tape.map ? { map: tape.map } : {}),
  });
  const replayEntityIds = new Map<EntityId, EntityId>();
  const rosterByTick = groupByTick(
    tape.roster.map((entry) => ({ ...entry, atTick: entry.joinedAtTick })),
  );
  const inputsByTick = groupByTick(tape.inputs);

  while (simulation.tick <= tape.finalTick) {
    for (const entry of rosterByTick.get(simulation.tick) ?? []) {
      addReplayPlayer(simulation, entry, replayEntityIds);
    }
    for (const input of inputsByTick.get(simulation.tick) ?? []) {
      const replayEntityId = replayEntityIds.get(input.entityId);
      invariant(replayEntityId !== undefined, `unknown replay input entity ${input.entityId}`);
      simulation.submitIntent(replayEntityId, remapIntent(input.intent, replayEntityIds));
    }
    if (simulation.tick === tape.finalTick) {
      break;
    }
    simulation.step();
  }

  return simulation;
}
