import { EQUIPMENT_IDS } from '@jwgb/content';
import type { EntityId } from '@jwgb/core';
import type { MutableSimulationState, PlayerEntity } from '../types';

export function clearDormantBootsState(player: PlayerEntity): void {
  player.dormantBootsSpeedTicks = 0;
  player.dormantBootsCooldownTicks = 0;
  player.dormantBootsStealthEpisodeActive = false;
  player.dormantBootsTriggeredThisEpisode = false;
}

export function clearComboShoesState(state: MutableSimulationState, ownerEntityId: EntityId): void {
  for (const targetState of state.passiveTargetStates.values()) {
    if (targetState.sourceEntityId !== ownerEntityId) {
      continue;
    }
    targetState.comboShoesStacks = 0;
    targetState.comboShoesExpiresAtTick = 0;
  }
}

export function clearComboShoesTargetState(
  state: MutableSimulationState,
  targetEntityId: EntityId,
): void {
  for (const targetState of state.passiveTargetStates.values()) {
    if (targetState.targetEntityId !== targetEntityId) {
      continue;
    }
    targetState.comboShoesStacks = 0;
    targetState.comboShoesExpiresAtTick = 0;
  }
}

/**
 * Removes transient effects whose lifetime is tied to an equipped item.
 * Persistent instance data (for example G9 attack growth) stays on the item.
 */
export function clearRemovedEquipmentState(
  state: MutableSimulationState,
  player: PlayerEntity,
  equipmentId: PlayerEntity['equipment'][number]['equipmentId'],
): void {
  if (equipmentId === EQUIPMENT_IDS.dormantBoots) {
    clearDormantBootsState(player);
  } else if (equipmentId === EQUIPMENT_IDS.comboShoes) {
    clearComboShoesState(state, player.entityId);
  } else if (equipmentId === EQUIPMENT_IDS.nightCloak) {
    player.nightCloakStillTicks = 0;
    player.nightCloakStealthed = false;
    player.stealthTicks = 0;
  } else if (equipmentId === EQUIPMENT_IDS.cloudRide) {
    player.flightActive = false;
  }
}

export function clearEquipmentStateOnTrueDeath(
  state: MutableSimulationState,
  player: PlayerEntity,
): void {
  clearDormantBootsState(player);
  clearComboShoesState(state, player.entityId);
  clearComboShoesTargetState(state, player.entityId);
  player.nightCloakStillTicks = 0;
  player.nightCloakStealthed = false;
  player.flightActive = false;
}
