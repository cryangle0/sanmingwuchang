import { getActiveDefinition } from '@jwgb/content';
import { type ActiveId, distanceSquaredMm, type EntityId } from '@jwgb/core';
import { getRequiredPlayer } from '../state';
import type {
  ActiveReplacementTransactionCode,
  ActiveReplacementTransactionResult,
  LootDrop,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
} from '../types';
import { hasDirectLineOfSight } from './active-targeting';
import { equipmentActiveCooldownTicks } from './equipment-query';
import { clearOwnedActiveStateForReplacement } from './loadout-cleanup';
import { canUseWorldResources } from './world-interaction';

const LOOT_INTERACTION_RADIUS_MM = 2_500;

function result(
  code: ActiveReplacementTransactionCode,
  accepted = false,
): ActiveReplacementTransactionResult {
  return { accepted, code };
}

function isActiveLoot(
  drop: LootDrop | undefined,
): drop is LootDrop & { readonly activeId: ActiveId } {
  return drop?.activeId !== undefined && drop.activeId !== null;
}

function _isWithinLootInteraction(
  state: MutableSimulationState,
  player: PlayerEntity,
  drop: LootDrop,
): boolean {
  return (
    distanceSquaredMm(player.position, drop.position) <=
      LOOT_INTERACTION_RADIUS_MM * LOOT_INTERACTION_RADIUS_MM &&
    hasDirectLineOfSight(state, player.position, drop.position)
  );
}

export function requestActiveReplacement(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  drop: LootDrop,
): boolean {
  if (!isActiveLoot(drop) || player.activeAbilityId === drop.activeId) {
    return false;
  }
  const previous = state.pendingActiveReplacements.get(player.entityId);
  if (previous?.lootEntityId === drop.entityId && previous.activeId === drop.activeId) {
    return true;
  }
  if (previous) {
    events.push({
      type: 'active-replacement-cancelled',
      tick: state.tick,
      entityId: player.entityId,
      lootEntityId: previous.lootEntityId,
      reason: 'active-changed',
    });
  }
  state.pendingActiveReplacements.set(player.entityId, {
    playerEntityId: player.entityId,
    lootEntityId: drop.entityId,
    activeId: drop.activeId,
    requestedAtTick: state.tick,
  });
  events.push({
    type: 'active-replacement-required',
    tick: state.tick,
    entityId: player.entityId,
    lootEntityId: drop.entityId,
    activeId: drop.activeId,
    currentActiveId: player.activeAbilityId,
  });
  return true;
}

export function clearPendingActiveReplacement(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  reason:
    | 'declined'
    | 'player-unavailable'
    | 'loot-unavailable'
    | 'out-of-range'
    | 'line-of-sight'
    | 'active-changed',
): void {
  const pending = state.pendingActiveReplacements.get(playerEntityId);
  if (!pending) {
    return;
  }
  state.pendingActiveReplacements.delete(playerEntityId);
  events.push({
    type: 'active-replacement-cancelled',
    tick: state.tick,
    entityId: playerEntityId,
    lootEntityId: pending.lootEntityId,
    reason,
  });
}

export function clearPendingActiveReplacementForLoot(
  state: MutableSimulationState,
  events: SimEvent[],
  lootEntityId: EntityId,
): void {
  for (const [playerEntityId, pending] of state.pendingActiveReplacements) {
    if (pending.lootEntityId === lootEntityId) {
      clearPendingActiveReplacement(state, events, playerEntityId, 'loot-unavailable');
    }
  }
}

export function replaceActiveLootResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  lootEntityId: EntityId,
  confirm: boolean,
): ActiveReplacementTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  const pending = state.pendingActiveReplacements.get(playerEntityId);
  if (!pending || pending.lootEntityId !== lootEntityId) {
    return result('active-replacement-not-found');
  }
  if (!confirm) {
    clearPendingActiveReplacement(state, events, playerEntityId, 'declined');
    return result('active-replacement-declined', true);
  }
  if (!canUseWorldResources(player)) {
    return result('player-not-alive');
  }

  const drop = state.lootDrops.get(lootEntityId);
  if (!isActiveLoot(drop) || drop.expiresAtTick <= state.tick) {
    clearPendingActiveReplacement(state, events, playerEntityId, 'loot-unavailable');
    return result('active-loot-not-found');
  }
  if (drop.activeId !== pending.activeId) {
    clearPendingActiveReplacement(state, events, playerEntityId, 'active-changed');
    return result('active-changed');
  }
  if (player.activeAbilityId === pending.activeId) {
    clearPendingActiveReplacement(state, events, playerEntityId, 'active-changed');
    return result('active-already-equipped');
  }
  if (
    distanceSquaredMm(player.position, drop.position) >
    LOOT_INTERACTION_RADIUS_MM * LOOT_INTERACTION_RADIUS_MM
  ) {
    return result('active-loot-too-far');
  }
  if (!hasDirectLineOfSight(state, player.position, drop.position)) {
    return result('active-loot-line-of-sight');
  }

  const previousActiveId = player.activeAbilityId;
  const active = getActiveDefinition(drop.activeId);
  clearOwnedActiveStateForReplacement(state, events, player, previousActiveId);
  player.activeAbilityId = drop.activeId;
  player.activeCooldownTicks = equipmentActiveCooldownTicks(player, active.cooldownTicks);
  state.lootDrops.delete(drop.entityId);
  state.pendingActiveReplacements.delete(playerEntityId);
  events.push({
    type: 'active-replaced',
    tick: state.tick,
    entityId: player.entityId,
    lootEntityId: drop.entityId,
    previousActiveId,
    activeId: drop.activeId,
    cooldownTicks: player.activeCooldownTicks,
  });
  events.push({
    type: 'loot-collected',
    tick: state.tick,
    entityId: drop.entityId,
    collectorEntityId: player.entityId,
    gold: 0,
    experience: 0,
    gems: 0,
    equipmentId: null,
    bookPassiveId: null,
    activeId: drop.activeId,
    ...(drop.kind === undefined ? {} : { lootKind: drop.kind }),
  });
  return result('accepted', true);
}
