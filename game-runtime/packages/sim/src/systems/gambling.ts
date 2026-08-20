import {
  AUTHORITATIVE_HEROES,
  EQUIPMENT_IDS,
  type EquipmentRarity,
  type EquippedEquipmentInstance,
  getActiveDefinition,
  getEquipmentDefinition,
  getHeroDefinition,
  M1_EQUIPMENT,
  M1_GENERIC_ACTIVES,
  M1_PASSIVES,
  type PassiveLevel,
} from '@jwgb/content';
import {
  activeId,
  distanceSquaredMm,
  type EntityId,
  type EquipmentInstanceId,
  type PassiveId,
} from '@jwgb/core';
import { getRequiredPlayer } from '../state';
import type {
  GambleGoldMode,
  GambleKind,
  GambleOutcome,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
} from '../types';
import { hasDirectLineOfSight } from './active-targeting';
import { grantGeneratedGold } from './equipment-economy';
import {
  createEquipmentInstance,
  dropHandOverflow,
  rebuildEquipmentStats,
} from './equipment-inventory';
import {
  equipmentActiveCooldownTicks,
  equipmentHandCapacity,
  hasEquipment,
} from './equipment-query';
import { clearRemovedEquipmentState } from './equipment-state';
import { clearOwnedActiveStateForReplacement, clearRemovedPassiveState } from './loadout-cleanup';
import { createEquipmentLootDrop, emitLootDropped } from './loot-runtime';
import { canUseWorldResources } from './world-interaction';

const INTERACTION_RADIUS_MM = 2_500;
const RARITIES: readonly EquipmentRarity[] = ['white', 'blue', 'purple', 'gold'];

export type GambleTransactionCode =
  | 'accepted'
  | 'shop-unavailable'
  | 'shop-version-mismatch'
  | 'shop-too-far'
  | 'player-not-alive'
  | 'pvp-combat-lock'
  | 'gamble-limit'
  | 'invalid-wager'
  | 'equipment-not-found'
  | 'equipment-not-eligible'
  | 'passive-not-learned';

export interface GambleTransactionResult {
  readonly accepted: boolean;
  readonly code: GambleTransactionCode;
  readonly outcome?: GambleOutcome;
}

function reject(code: GambleTransactionCode): GambleTransactionResult {
  return { accepted: false, code };
}

function validateGamble(
  state: MutableSimulationState,
  player: PlayerEntity,
  shopId: string,
  expectedVersion: number,
): GambleTransactionCode | null {
  const shop = state.shops.get(shopId);
  if (shop?.kind !== 'heishan') {
    return 'shop-unavailable';
  }
  if (shop.version !== expectedVersion) {
    return 'shop-version-mismatch';
  }
  if (state.tick < shop.openAtTick || state.tick >= shop.closeAtTick) {
    return 'shop-unavailable';
  }
  if (!canUseWorldResources(player)) {
    return 'player-not-alive';
  }
  if (player.pvpCombatTicks > 0) {
    return 'pvp-combat-lock';
  }
  if (
    distanceSquaredMm(player.position, shop.position) >
    INTERACTION_RADIUS_MM * INTERACTION_RADIUS_MM
  ) {
    return 'shop-too-far';
  }
  if (!hasDirectLineOfSight(state, player.position, shop.position)) {
    return 'shop-too-far';
  }
  if (player.heishanGambleCount >= 3) {
    return 'gamble-limit';
  }
  return null;
}

function outcomeFor(
  state: MutableSimulationState,
  player: PlayerEntity,
  baseBigWinPercent: number,
  flatPercent: number,
): GambleOutcome {
  const medalMultiplier = hasEquipment(player, EQUIPMENT_IDS.gamblingMedal) ? 2 : 1;
  const bigWinPercent = Math.min(90, baseBigWinPercent * medalMultiplier);
  const roll = state.random.blackMountain.nextInt(100);
  if (roll < bigWinPercent) {
    return 'big-win';
  }
  return roll < Math.min(100, bigWinPercent + flatPercent) ? 'flat' : 'loss';
}

function emitGamble(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  gambleKind: GambleKind,
  outcome: GambleOutcome,
  values: {
    readonly wagerGold?: number;
    readonly rewardGold?: number;
    readonly equipmentId?: EquippedEquipmentInstance['equipmentId'] | null;
    readonly passiveId?: PassiveId | null;
    readonly activeId?: PlayerEntity['activeAbilityId'] | null;
    readonly goldMode?: GambleGoldMode | null;
  } = {},
): GambleTransactionResult {
  player.heishanGambleCount += 1;
  events.push({
    type: 'gamble-resolved',
    tick: state.tick,
    entityId: player.entityId,
    gambleKind,
    outcome,
    goldMode: values.goldMode ?? null,
    wagerGold: values.wagerGold ?? 0,
    rewardGold: values.rewardGold ?? 0,
    equipmentId: values.equipmentId ?? null,
    passiveId: values.passiveId ?? null,
    activeId: values.activeId ?? null,
  });
  return { accepted: true, code: 'accepted', outcome };
}

export function gamblePassiveResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  shopId: string,
  expectedVersion: number,
  passiveId: PassiveId,
): GambleTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  const failure = validateGamble(state, player, shopId, expectedVersion);
  if (failure) {
    return reject(failure);
  }
  const index = player.passives.findIndex((entry) => entry.passiveId === passiveId);
  const selected = index < 0 ? undefined : player.passives[index];
  if (!selected) {
    return reject('passive-not-learned');
  }
  const outcome = outcomeFor(state, player, 15, 50);
  let resultPassiveId: PassiveId | null = null;
  if (outcome === 'loss') {
    clearRemovedPassiveState(state, events, player, selected.passiveId);
    player.passives.splice(index, 1);
  } else {
    const owned = new Set(player.passives.map((entry) => entry.passiveId));
    const candidates = M1_PASSIVES.filter((candidate) => !owned.has(candidate.id));
    const replacement =
      candidates.length === 0
        ? undefined
        : candidates[state.random.blackMountain.nextInt(candidates.length)];
    if (replacement) {
      resultPassiveId = replacement.id;
      clearRemovedPassiveState(state, events, player, selected.passiveId);
      player.passives[index] = {
        passiveId: replacement.id,
        level:
          outcome === 'big-win'
            ? (Math.min(5, selected.level + 1) as PassiveLevel)
            : selected.level,
      };
    } else {
      resultPassiveId = selected.passiveId;
      if (outcome === 'big-win') {
        player.passives[index] = {
          passiveId: selected.passiveId,
          level: Math.min(5, selected.level + 1) as PassiveLevel,
        };
      }
    }
  }
  return emitGamble(state, events, player, 'passive', outcome, {
    passiveId: resultPassiveId,
  });
}

function findEquipment(
  player: PlayerEntity,
  instanceId: EquipmentInstanceId,
): {
  readonly collection: EquippedEquipmentInstance[];
  readonly index: number;
  readonly equipped: boolean;
  readonly instance: EquippedEquipmentInstance;
} | null {
  const equippedIndex = player.equipment.findIndex((entry) => entry.instanceId === instanceId);
  if (equippedIndex >= 0) {
    const instance = player.equipment[equippedIndex];
    return instance
      ? { collection: player.equipment, index: equippedIndex, equipped: true, instance }
      : null;
  }
  const handIndex = player.inventoryEquipment.findIndex((entry) => entry.instanceId === instanceId);
  const instance = handIndex < 0 ? undefined : player.inventoryEquipment[handIndex];
  return instance
    ? { collection: player.inventoryEquipment, index: handIndex, equipped: false, instance }
    : null;
}

export function gambleEquipmentResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  shopId: string,
  expectedVersion: number,
  instanceId: EquipmentInstanceId,
): GambleTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  const failure = validateGamble(state, player, shopId, expectedVersion);
  if (failure) {
    return reject(failure);
  }
  const selected = findEquipment(player, instanceId);
  if (!selected) {
    return reject('equipment-not-found');
  }
  const selectedDefinition = getEquipmentDefinition(selected.instance.equipmentId);
  if (
    selectedDefinition.rarity !== 'white' &&
    selectedDefinition.rarity !== 'blue' &&
    selectedDefinition.rarity !== 'purple'
  ) {
    return reject('equipment-not-eligible');
  }
  const outcome = outcomeFor(state, player, 15, 40);
  let resultEquipmentId: EquippedEquipmentInstance['equipmentId'] | null = null;
  if (outcome === 'loss') {
    if (selected.equipped) {
      clearRemovedEquipmentState(state, player, selected.instance.equipmentId);
    }
    selected.collection.splice(selected.index, 1);
  } else {
    const currentRank = RARITIES.indexOf(selectedDefinition.rarity);
    const targetRarity =
      outcome === 'big-win'
        ? (RARITIES[Math.min(RARITIES.length - 1, currentRank + 1)] ?? selectedDefinition.rarity)
        : selectedDefinition.rarity;
    let candidates = M1_EQUIPMENT.filter(
      (entry) =>
        entry.rarity === targetRarity &&
        entry.id !== selected.instance.equipmentId &&
        entry.id !== EQUIPMENT_IDS.goldenCudgel,
    ).sort((left, right) => left.id.localeCompare(right.id));
    if (selected.equipped) {
      const equippedIds = new Set(
        player.equipment
          .filter((entry) => entry.instanceId !== selected.instance.instanceId)
          .map((entry) => entry.equipmentId),
      );
      candidates = candidates.filter((entry) => !equippedIds.has(entry.id));
    }
    const replacement =
      candidates.length === 0
        ? undefined
        : candidates[state.random.blackMountain.nextInt(candidates.length)];
    if (replacement) {
      resultEquipmentId = replacement.id;
      if (selected.equipped) {
        clearRemovedEquipmentState(state, player, selected.instance.equipmentId);
      }
      selected.collection[selected.index] = {
        ...selected.instance,
        equipmentId: replacement.id,
      };
    }
  }
  rebuildEquipmentStats(player);
  dropHandOverflow(state, events, player);
  return emitGamble(state, events, player, 'equipment', outcome, {
    equipmentId: resultEquipmentId,
  });
}

export function gambleActiveResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  shopId: string,
  expectedVersion: number,
): GambleTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  const failure = validateGamble(state, player, shopId, expectedVersion);
  if (failure) {
    return reject(failure);
  }
  const outcome = outcomeFor(state, player, 10, 50);
  clearOwnedActiveStateForReplacement(state, events, player, player.activeAbilityId);
  if (outcome === 'big-win') {
    const currentHeroExclusive = getHeroDefinition(player.heroId).active.id;
    const currentExclusive = AUTHORITATIVE_HEROES.some(
      (hero) => hero.active.id === player.activeAbilityId,
    )
      ? player.activeAbilityId
      : currentHeroExclusive;
    const candidates = AUTHORITATIVE_HEROES.map((hero) => activeId(hero.active.id))
      .filter((id) => id !== currentExclusive)
      .sort((left, right) => left.localeCompare(right));
    player.activeAbilityId =
      candidates[state.random.blackMountain.nextInt(candidates.length)] ?? player.activeAbilityId;
  } else if (outcome === 'flat') {
    const candidates = M1_GENERIC_ACTIVES.filter(
      (active) => active.id !== player.activeAbilityId,
    ).sort((left, right) => left.id.localeCompare(right.id));
    player.activeAbilityId =
      candidates[state.random.blackMountain.nextInt(candidates.length)]?.id ??
      player.activeAbilityId;
  } else {
    player.activeAbilityId = getHeroDefinition(player.heroId).active.id;
  }
  player.activeCooldownTicks = equipmentActiveCooldownTicks(
    player,
    getActiveDefinition(player.activeAbilityId).cooldownTicks,
  );
  return emitGamble(state, events, player, 'active', outcome, {
    activeId: player.activeAbilityId,
  });
}

export function gambleGoldResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  shopId: string,
  expectedVersion: number,
  wagerGold: number,
  mode: GambleGoldMode = 'double',
): GambleTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  const failure = validateGamble(state, player, shopId, expectedVersion);
  if (failure) {
    return reject(failure);
  }
  const wager = mode === 'purple' ? 2_000 : Math.trunc(wagerGold);
  if (
    (mode === 'double' && (wager < 500 || wager > 5_000 || wager % 100 !== 0)) ||
    (mode === 'purple' && wagerGold !== 2_000) ||
    (mode !== 'double' && mode !== 'purple') ||
    wager > player.gold
  ) {
    return reject('invalid-wager');
  }
  const outcome = outcomeFor(state, player, 10, 40);
  player.gold -= wager;
  let rewardGold = 0;
  let equipmentId: EquippedEquipmentInstance['equipmentId'] | null = null;
  if (mode === 'double') {
    if (outcome === 'big-win') {
      player.gold += wager;
      rewardGold = grantGeneratedGold(player, wager);
    } else if (outcome === 'flat') {
      player.gold += wager;
    } else {
      player.gold += Math.trunc(wager / 2);
    }
  } else {
    if (outcome === 'big-win') {
      const purple = M1_EQUIPMENT.filter((entry) => entry.rarity === 'purple').sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      equipmentId =
        (purple.length === 0
          ? undefined
          : purple[state.random.blackMountain.nextInt(purple.length)]
        )?.id ?? null;
      if (equipmentId) {
        const instance = createEquipmentInstance(state, equipmentId);
        if (player.inventoryEquipment.length < equipmentHandCapacity(player)) {
          player.inventoryEquipment.push(instance);
        } else {
          const drop = createEquipmentLootDrop(state, player.position, instance);
          emitLootDropped(state, events, drop, player.entityId);
        }
      }
    } else if (outcome === 'flat') {
      player.gold += 2_000;
    } else {
      player.gold += 1_000;
    }
  }
  return emitGamble(state, events, player, 'gold', outcome, {
    goldMode: mode,
    wagerGold: wager,
    rewardGold,
    equipmentId,
  });
}
