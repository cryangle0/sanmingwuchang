import type { EquippedEquipmentInstance } from '@jwgb/content';
import type { EntityId, EquipmentInstanceId } from '@jwgb/core';
import { distanceSquaredMm } from '@jwgb/core';
import { getRequiredPlayer, sortedPlayers } from '../state';
import type {
  EquipmentLootPickupDestination,
  EquipmentLootPickupTransactionResult,
  LootDrop,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
} from '../types';
import { hasDirectLineOfSight } from './active-targeting';
import { grantExperience, grantGeneratedGold } from './equipment-economy';
import {
  createEquipmentInstance,
  dropHandOverflow,
  rebuildEquipmentStats,
} from './equipment-inventory';
import { equipmentHandCapacity } from './equipment-query';
import { clearRemovedEquipmentState } from './equipment-state';
import { createEquipmentLootDrop, emitLootDropped } from './loot-runtime';
import { scavengerPickupGold } from './passive-economy';
import { canUseWorldResources } from './world-interaction';

export const EQUIPMENT_LOOT_INTERACTION_RADIUS_MM = 2_500;
const EQUIPPED_CAPACITY = 3;

function result(
  code: EquipmentLootPickupTransactionResult['code'],
  accepted = false,
): EquipmentLootPickupTransactionResult {
  return { accepted, code };
}

function isEquipmentLoot(drop: LootDrop | undefined): drop is LootDrop & {
  readonly equipmentId: NonNullable<LootDrop['equipmentId']>;
} {
  return (
    drop !== undefined &&
    drop.equipmentId !== null &&
    drop.bookPassiveId === null &&
    (drop.activeId === undefined || drop.activeId === null)
  );
}

function isWithinInteraction(
  state: MutableSimulationState,
  player: PlayerEntity,
  drop: LootDrop,
): boolean {
  return (
    distanceSquaredMm(player.position, drop.position) <=
      EQUIPMENT_LOOT_INTERACTION_RADIUS_MM * EQUIPMENT_LOOT_INTERACTION_RADIUS_MM &&
    hasDirectLineOfSight(state, player.position, drop.position)
  );
}

function findInstance(
  player: PlayerEntity,
  instanceId: EquipmentInstanceId,
): {
  readonly source: 'equipped' | 'inventory';
  readonly index: number;
  readonly instance: EquippedEquipmentInstance;
} | null {
  const equippedIndex = player.equipment.findIndex(
    (instance) => instance.instanceId === instanceId,
  );
  if (equippedIndex >= 0) {
    const instance = player.equipment[equippedIndex];
    return instance ? { source: 'equipped', index: equippedIndex, instance } : null;
  }
  const inventoryIndex = player.inventoryEquipment.findIndex(
    (instance) => instance.instanceId === instanceId,
  );
  if (inventoryIndex >= 0) {
    const instance = player.inventoryEquipment[inventoryIndex];
    return instance ? { source: 'inventory', index: inventoryIndex, instance } : null;
  }
  return null;
}

function instanceIsOwnedByAnotherPlayer(
  state: MutableSimulationState,
  owner: PlayerEntity,
  instanceId: EquipmentInstanceId,
): boolean {
  return sortedPlayers(state).some(
    (candidate) =>
      candidate.entityId !== owner.entityId &&
      (candidate.equipment.some((instance) => instance.instanceId === instanceId) ||
        candidate.inventoryEquipment.some((instance) => instance.instanceId === instanceId)),
  );
}

function equipmentInstanceCandidateFromDrop(
  state: MutableSimulationState,
  player: PlayerEntity,
  drop: LootDrop & { readonly equipmentId: NonNullable<LootDrop['equipmentId']> },
): EquippedEquipmentInstance | null {
  if (drop.equipmentInstanceId !== undefined && drop.equipmentInstanceId !== null) {
    if (
      findInstance(player, drop.equipmentInstanceId) ||
      instanceIsOwnedByAnotherPlayer(state, player, drop.equipmentInstanceId)
    ) {
      return null;
    }
    return {
      instanceId: drop.equipmentInstanceId,
      equipmentId: drop.equipmentId,
      acquiredAtTick: drop.acquiredAtTick ?? drop.createdAtTick,
      permanentAttackBonus: drop.permanentAttackBonus ?? 0,
    };
  }
  return {
    instanceId: state.nextEquipmentInstanceId as EquippedEquipmentInstance['instanceId'],
    equipmentId: drop.equipmentId,
    acquiredAtTick: drop.acquiredAtTick ?? state.tick,
    permanentAttackBonus: drop.permanentAttackBonus ?? 0,
  };
}

export function clearPendingEquipmentPickup(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  reason:
    | 'declined'
    | 'player-unavailable'
    | 'loot-unavailable'
    | 'out-of-range'
    | 'line-of-sight'
    | 'equipment-changed',
): void {
  const pending = state.pendingEquipmentPickups.get(playerEntityId);
  if (!pending) {
    return;
  }
  state.pendingEquipmentPickups.delete(playerEntityId);
  events.push({
    type: 'equipment-pickup-replacement-cancelled',
    tick: state.tick,
    entityId: playerEntityId,
    lootEntityId: pending.lootEntityId,
    reason,
  });
}

export function clearPendingEquipmentPickupForLoot(
  state: MutableSimulationState,
  events: SimEvent[],
  lootEntityId: EntityId,
): void {
  for (const [playerEntityId, pending] of state.pendingEquipmentPickups) {
    if (pending.lootEntityId === lootEntityId) {
      clearPendingEquipmentPickup(state, events, playerEntityId, 'loot-unavailable');
    }
  }
}

export function requestEquipmentLootPickup(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  drop: LootDrop,
): boolean {
  if (!isEquipmentLoot(drop) || !canUseWorldResources(player)) {
    return false;
  }
  const previous = state.pendingEquipmentPickups.get(player.entityId);
  if (
    previous?.lootEntityId === drop.entityId &&
    previous.equipmentId === drop.equipmentId &&
    previous.equipmentInstanceId === (drop.equipmentInstanceId ?? null)
  ) {
    return true;
  }
  if (previous) {
    clearPendingEquipmentPickup(state, events, player.entityId, 'equipment-changed');
  }
  state.pendingEquipmentPickups.set(player.entityId, {
    playerEntityId: player.entityId,
    lootEntityId: drop.entityId,
    equipmentId: drop.equipmentId,
    equipmentInstanceId: drop.equipmentInstanceId ?? null,
    requestedAtTick: state.tick,
  });
  events.push({
    type: 'equipment-pickup-replacement-required',
    tick: state.tick,
    entityId: player.entityId,
    lootEntityId: drop.entityId,
    equipmentId: drop.equipmentId,
    equipmentInstanceId: drop.equipmentInstanceId ?? null,
    handCapacity: equipmentHandCapacity(player),
    equippedCapacity: EQUIPPED_CAPACITY,
  });
  return true;
}

function validatePending(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  drop: LootDrop,
): EquipmentLootPickupTransactionResult | null {
  const pending = state.pendingEquipmentPickups.get(player.entityId);
  if (!pending) {
    return null;
  }
  if (
    pending.lootEntityId !== drop.entityId ||
    pending.equipmentId !== drop.equipmentId ||
    pending.equipmentInstanceId !== (drop.equipmentInstanceId ?? null)
  ) {
    clearPendingEquipmentPickup(state, events, player.entityId, 'equipment-changed');
    return result('equipment-changed');
  }
  return null;
}

export function pickupEquipmentLootResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  lootEntityId: EntityId,
  destination: EquipmentLootPickupDestination,
  replacementInstanceId: EquipmentInstanceId | null,
): EquipmentLootPickupTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  const pending = state.pendingEquipmentPickups.get(playerEntityId);

  if (destination === 'cancel') {
    if (!pending || pending.lootEntityId !== lootEntityId) {
      return result('equipment-pickup-not-found');
    }
    clearPendingEquipmentPickup(state, events, playerEntityId, 'declined');
    return result('equipment-pickup-declined', true);
  }

  if (!canUseWorldResources(player)) {
    return result('player-not-alive');
  }
  const drop = state.lootDrops.get(lootEntityId);
  if (!isEquipmentLoot(drop) || drop.expiresAtTick <= state.tick) {
    clearPendingEquipmentPickup(state, events, playerEntityId, 'loot-unavailable');
    return result('equipment-loot-not-found');
  }
  const pendingResult = validatePending(state, events, player, drop);
  if (pendingResult) {
    return pendingResult;
  }
  if (!isWithinInteraction(state, player, drop)) {
    return result(
      distanceSquaredMm(player.position, drop.position) >
        EQUIPMENT_LOOT_INTERACTION_RADIUS_MM * EQUIPMENT_LOOT_INTERACTION_RADIUS_MM
        ? 'equipment-loot-too-far'
        : 'equipment-loot-line-of-sight',
    );
  }

  const incomingCandidate = equipmentInstanceCandidateFromDrop(state, player, drop);
  if (!incomingCandidate) {
    return result('equipment-changed');
  }

  const replacement =
    replacementInstanceId === null ? null : findInstance(player, replacementInstanceId);
  if (replacementInstanceId !== null && !replacement) {
    return result('invalid-replacement');
  }

  if (destination === 'inventory') {
    if (replacement && replacement.source !== 'inventory') {
      return result('invalid-replacement');
    }
    if (!replacement && player.inventoryEquipment.length >= equipmentHandCapacity(player)) {
      return result('replacement-required');
    }
  } else if (destination === 'equipped') {
    if (replacement && replacement.source !== 'equipped') {
      return result('invalid-replacement');
    }
    if (!replacement && player.equipment.length >= EQUIPPED_CAPACITY) {
      return result('replacement-required');
    }
    const remainingEquipment = player.equipment.filter(
      (instance) => instance.instanceId !== replacement?.instance.instanceId,
    );
    if (
      remainingEquipment.some((instance) => instance.equipmentId === incomingCandidate.equipmentId)
    ) {
      return result('duplicate-equipped');
    }
  } else {
    return result('equipment-changed');
  }

  const incoming =
    drop.equipmentInstanceId === undefined || drop.equipmentInstanceId === null
      ? createEquipmentInstance(state, incomingCandidate.equipmentId, {
          acquiredAtTick: incomingCandidate.acquiredAtTick,
          permanentAttackBonus: incomingCandidate.permanentAttackBonus,
        })
      : incomingCandidate;
  if (drop.equipmentInstanceId !== undefined && drop.equipmentInstanceId !== null) {
    state.nextEquipmentInstanceId = Math.max(
      state.nextEquipmentInstanceId,
      Number(drop.equipmentInstanceId) + 1,
    );
  }

  const replacementInstance = replacement?.instance ?? null;
  state.lootDrops.delete(drop.entityId);
  state.pendingEquipmentPickups.delete(playerEntityId);

  if (replacement) {
    if (replacement.source === 'equipped') {
      clearRemovedEquipmentState(state, player, replacement.instance.equipmentId);
      player.equipment.splice(replacement.index, 1);
    } else {
      player.inventoryEquipment.splice(replacement.index, 1);
    }
  }

  if (destination === 'inventory') {
    player.inventoryEquipment.push(incoming);
  } else {
    player.equipment.push(incoming);
  }

  if (destination === 'equipped' || replacement?.source === 'equipped') {
    rebuildEquipmentStats(player);
    dropHandOverflow(state, events, player);
  }

  const collectedGold = grantGeneratedGold(player, drop.gold);
  const collectedExperience = grantExperience(player, drop.experience);
  player.gems += drop.gems;
  grantGeneratedGold(player, scavengerPickupGold(player, incoming.equipmentId));

  events.push({
    type: 'loot-collected',
    tick: state.tick,
    entityId: drop.entityId,
    collectorEntityId: player.entityId,
    gold: collectedGold,
    experience: collectedExperience,
    gems: drop.gems,
    equipmentId: incoming.equipmentId,
    bookPassiveId: null,
    activeId: null,
    ...(drop.kind === undefined ? {} : { lootKind: drop.kind }),
  });

  if (destination === 'equipped') {
    events.push({
      type: 'equipment-equipped',
      tick: state.tick,
      entityId: player.entityId,
      instanceId: incoming.instanceId,
      equipmentId: incoming.equipmentId,
      replacementInstanceId: replacementInstance?.instanceId ?? null,
    });
  }

  if (replacementInstance) {
    const replacementDrop = createEquipmentLootDrop(state, player.position, replacementInstance);
    emitLootDropped(state, events, replacementDrop, player.entityId);
    events.push({
      type: 'equipment-discarded',
      tick: state.tick,
      entityId: player.entityId,
      instanceId: replacementInstance.instanceId,
      equipmentId: replacementInstance.equipmentId,
    });
  }

  clearPendingEquipmentPickupForLoot(state, events, drop.entityId);
  return result('accepted', true);
}
