import {
  EQUIPMENT_IDS,
  type EquippedEquipmentInstance,
  getEquipmentStatTotals,
  getHeroDefinition,
  type HeroStats,
} from '@jwgb/content';
import { type EntityId, equipmentInstanceId } from '@jwgb/core';
import { getRequiredPlayer } from '../state';
import type { MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import { equipmentHandCapacity } from './equipment-query';
import { clearRemovedEquipmentState } from './equipment-state';
import { createEquipmentLootDrop, emitLootDropped } from './loot-runtime';

export type EquipmentTransactionCode =
  | 'accepted'
  | 'player-not-alive'
  | 'equipment-not-found'
  | 'hand-full'
  | 'equipped-full'
  | 'duplicate-equipped'
  | 'replacement-required'
  | 'invalid-replacement';

export interface EquipmentTransactionResult {
  readonly accepted: boolean;
  readonly code: EquipmentTransactionCode;
  readonly lootEntityId?: EntityId;
}

export function createEquipmentInstance(
  state: MutableSimulationState,
  equipmentId: EquippedEquipmentInstance['equipmentId'],
  source: Pick<EquippedEquipmentInstance, 'acquiredAtTick' | 'permanentAttackBonus'> = {
    acquiredAtTick: state.tick,
    permanentAttackBonus: 0,
  },
): EquippedEquipmentInstance {
  const instance: EquippedEquipmentInstance = {
    instanceId: equipmentInstanceId(state.nextEquipmentInstanceId),
    equipmentId,
    acquiredAtTick: source.acquiredAtTick,
    permanentAttackBonus: source.permanentAttackBonus,
  };
  state.nextEquipmentInstanceId += 1;
  return instance;
}

/**
 * Rebuilds all derived combat stats after an equipment or hero change.
 * Permanent G9 growth lives on the instance and must survive this rebuild.
 */
export function rebuildEquipmentStats(player: PlayerEntity): void {
  const hero = getHeroDefinition(player.heroId);
  const heroStats = heroStatsForLevel(hero.level1, hero.level15, player.level);
  const totals = getEquipmentStatTotals(player.equipment.map((instance) => instance.equipmentId));
  const previousMaxHp = player.maxHp;
  const nextMaxHp = heroStats.maxHp + totals.maxHpFlat + player.b40BonusMaxHp;
  player.maxHp = nextMaxHp;
  if (nextMaxHp > previousMaxHp && player.lifeState === 'alive') {
    player.hp = Math.min(nextMaxHp, player.hp + nextMaxHp - previousMaxHp);
  } else {
    player.hp = Math.min(player.hp, nextMaxHp);
  }
  player.attackPower =
    heroStats.attack +
    totals.attackFlat +
    player.equipment.reduce((total, instance) => total + instance.permanentAttackBonus, 0);
  player.moveSpeedMmPerSecond = heroStats.moveSpeedMmPerSecond + totals.moveSpeedFlat;
  player.attackRangeMm = heroStats.attackRangeMm + totals.basicAttackRangeFlatMm;
  player.attacksPerSecondMilli = Math.trunc(
    (heroStats.attacksPerSecondMilli * (100 + totals.attackSpeedPercent)) / 100,
  );
  player.attackPeriodTicks = Math.max(1, Math.ceil((20 * 1_000) / player.attacksPerSecondMilli));
}

function interpolateLevelStat(level1: number, level15: number, level: number): number {
  const boundedLevel = Math.max(1, Math.min(15, Math.trunc(level)));
  return level1 + Math.trunc(((level15 - level1) * (boundedLevel - 1)) / 14);
}

export function heroStatsForLevel(level1: HeroStats, level15: HeroStats, level: number): HeroStats {
  return {
    attack: interpolateLevelStat(level1.attack, level15.attack, level),
    maxHp: interpolateLevelStat(level1.maxHp, level15.maxHp, level),
    moveSpeedMmPerSecond: interpolateLevelStat(
      level1.moveSpeedMmPerSecond,
      level15.moveSpeedMmPerSecond,
      level,
    ),
    attackRangeMm: interpolateLevelStat(level1.attackRangeMm, level15.attackRangeMm, level),
    attacksPerSecondMilli: interpolateLevelStat(
      level1.attacksPerSecondMilli,
      level15.attacksPerSecondMilli,
      level,
    ),
  };
}

function result(code: EquipmentTransactionCode, accepted = false): EquipmentTransactionResult {
  return { accepted, code };
}

function findEquipment(
  player: PlayerEntity,
  instanceId: EquippedEquipmentInstance['instanceId'],
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

function canInteract(player: PlayerEntity): boolean {
  return player.lifeState === 'alive' && player.worldInteractionLockTicks <= 0;
}

export function dropHandOverflow(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
): EntityId[] {
  const capacity = equipmentHandCapacity(player);
  if (player.inventoryEquipment.length <= capacity) {
    return [];
  }
  const ordered = [...player.inventoryEquipment].sort(
    (left, right) =>
      left.acquiredAtTick - right.acquiredAtTick ||
      Number(left.instanceId) - Number(right.instanceId),
  );
  const kept = ordered.slice(0, capacity);
  const overflow = ordered.slice(capacity);
  player.inventoryEquipment.splice(0, player.inventoryEquipment.length, ...kept);
  const dropIds: EntityId[] = [];
  for (const instance of overflow) {
    const drop = createEquipmentLootDrop(state, player.position, instance);
    emitLootDropped(state, events, drop, player.entityId);
    dropIds.push(drop.entityId);
  }
  return dropIds;
}

export function equipInventoryEquipmentResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  instanceId: EquippedEquipmentInstance['instanceId'],
  replacementInstanceId: EquippedEquipmentInstance['instanceId'] | null = null,
): EquipmentTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  if (!canInteract(player)) {
    return result('player-not-alive');
  }
  const incomingIndex = player.inventoryEquipment.findIndex(
    (instance) => instance.instanceId === instanceId,
  );
  const incoming = incomingIndex < 0 ? undefined : player.inventoryEquipment[incomingIndex];
  if (!incoming) {
    return result('equipment-not-found');
  }
  if (player.equipment.some((instance) => instance.equipmentId === incoming.equipmentId)) {
    return result('duplicate-equipped');
  }

  let replacementIndex = -1;
  let replacement: EquippedEquipmentInstance | undefined;
  if (replacementInstanceId !== null) {
    replacementIndex = player.equipment.findIndex(
      (instance) => instance.instanceId === replacementInstanceId,
    );
    replacement = replacementIndex < 0 ? undefined : player.equipment[replacementIndex];
    if (!replacement) {
      return result('invalid-replacement');
    }
  } else if (player.equipment.length >= 3) {
    return result('replacement-required');
  }

  player.inventoryEquipment.splice(incomingIndex, 1);
  if (replacement) {
    clearRemovedEquipmentState(state, player, replacement.equipmentId);
    player.equipment.splice(replacementIndex, 1, incoming);
    player.inventoryEquipment.push(replacement);
  } else {
    player.equipment.push(incoming);
  }
  rebuildEquipmentStats(player);
  dropHandOverflow(state, events, player);
  events.push({
    type: 'equipment-equipped',
    tick: state.tick,
    entityId: player.entityId,
    instanceId: incoming.instanceId,
    equipmentId: incoming.equipmentId,
    replacementInstanceId: replacement?.instanceId ?? null,
  });
  return result('accepted', true);
}

export function unequipEquipmentResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  instanceId: EquippedEquipmentInstance['instanceId'],
): EquipmentTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  if (!canInteract(player)) {
    return result('player-not-alive');
  }
  const instanceIndex = player.equipment.findIndex(
    (instance) => instance.instanceId === instanceId,
  );
  const candidate = instanceIndex < 0 ? undefined : player.equipment[instanceIndex];
  if (!candidate) {
    return result('equipment-not-found');
  }
  const changesCapacity = candidate.equipmentId === EQUIPMENT_IDS.clothBag;
  if (!changesCapacity && player.inventoryEquipment.length >= equipmentHandCapacity(player)) {
    return result('hand-full');
  }
  clearRemovedEquipmentState(state, player, candidate.equipmentId);
  player.equipment.splice(instanceIndex, 1);
  player.inventoryEquipment.push(candidate);
  rebuildEquipmentStats(player);
  dropHandOverflow(state, events, player);
  events.push({
    type: 'equipment-unequipped',
    tick: state.tick,
    entityId: player.entityId,
    instanceId: candidate.instanceId,
    equipmentId: candidate.equipmentId,
  });
  return result('accepted', true);
}

export function discardEquipmentResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  instanceId: EquippedEquipmentInstance['instanceId'],
): EquipmentTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  if (!canInteract(player)) {
    return result('player-not-alive');
  }
  const found = findEquipment(player, instanceId);
  if (!found) {
    return result('equipment-not-found');
  }
  if (found.source === 'equipped') {
    clearRemovedEquipmentState(state, player, found.instance.equipmentId);
    player.equipment.splice(found.index, 1);
    rebuildEquipmentStats(player);
  } else {
    player.inventoryEquipment.splice(found.index, 1);
  }
  const drop = createEquipmentLootDrop(state, player.position, found.instance);
  emitLootDropped(state, events, drop, player.entityId);
  events.push({
    type: 'equipment-discarded',
    tick: state.tick,
    entityId: player.entityId,
    instanceId: found.instance.instanceId,
    equipmentId: found.instance.equipmentId,
  });
  return {
    accepted: true,
    code: 'accepted',
    lootEntityId: drop.entityId,
  };
}

export function dropEquipmentInstances(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  instances: readonly EquippedEquipmentInstance[],
): void {
  for (const instance of instances) {
    const drop = createEquipmentLootDrop(state, player.position, instance, 'death-equipment');
    emitLootDropped(state, events, drop, player.entityId);
  }
}
