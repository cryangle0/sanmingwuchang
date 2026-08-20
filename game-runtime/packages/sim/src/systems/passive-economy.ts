import {
  EQUIPMENT_IDS,
  getEquipmentDefinition,
  getPassiveDefinition,
  M1_EQUIPMENT,
  PASSIVE_IDS,
  passiveLevelValue,
} from '@jwgb/content';
import { type EntityId, TICKS_PER_SECOND } from '@jwgb/core';
import type {
  LootDrop,
  MonsterEntity,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
} from '../types';
import { grantGeneratedGold, transferGold } from './equipment-economy';
import { createRuntimeLootDrop } from './loot-runtime';
import {
  findPassiveLoadout,
  getOrCreatePassiveTargetState,
  scalePassiveMagnitude,
} from './passive-runtime';

const GOLD_EQUIPMENT_POOL = M1_EQUIPMENT.filter(
  (equipment) => equipment.rarity === 'gold' && equipment.id !== EQUIPMENT_IDS.goldenCudgel,
).map((equipment) => equipment.id);

export function resolvePickpocket(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: PlayerEntity,
): void {
  const loadout = findPassiveLoadout(owner, PASSIVE_IDS.pickpocket);
  if (!loadout) {
    return;
  }
  const targetState = getOrCreatePassiveTargetState(state, owner.entityId, target.entityId);
  if (targetState.pickpocketCooldownTicks > 0) {
    return;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.pickpocket);
  if (
    definition.effect !== 'pickpocket' ||
    state.random.combat.nextInt(100) >=
      passiveLevelValue(definition.chancePercentByLevel, loadout.level)
  ) {
    return;
  }
  targetState.pickpocketCooldownTicks = definition.internalCooldownTicks;
  const transferred = transferGold(
    target,
    owner,
    passiveLevelValue(definition.goldByLevel, loadout.level),
  );
  if (loadout.level === 5 && transferred > 0) {
    owner.hp = Math.min(
      owner.maxHp,
      owner.hp +
        scalePassiveMagnitude(
          Math.trunc((transferred * definition.level5HealPercent) / 100),
          owner,
        ),
    );
  }
  events.push({
    type: 'passive-proc',
    tick: state.tick,
    passiveId: PASSIVE_IDS.pickpocket,
    sourceEntityId: owner.entityId,
    targetEntityId: target.entityId,
    detail: 'gold-transfer',
    amount: transferred,
    durationTicks: definition.internalCooldownTicks,
  });
}

export function advancePassiveEconomy(state: MutableSimulationState, events: SimEvent[]): void {
  for (const player of state.players.values()) {
    const loadout = findPassiveLoadout(player, PASSIVE_IDS.interest);
    if (!loadout || player.lifeState === 'eliminated') {
      continue;
    }
    const definition = getPassiveDefinition(PASSIVE_IDS.interest);
    if (
      definition.effect !== 'interest' ||
      state.tick === 0 ||
      state.tick % definition.intervalTicks !== 0
    ) {
      continue;
    }
    const percent = passiveLevelValue(definition.interestPercentByLevel, loadout.level);
    const baseCap = passiveLevelValue(definition.capByLevel, loadout.level);
    const cap = loadout.level === 5 ? baseCap * definition.level5CapMultiplier : baseCap;
    const interest = Math.min(cap, Math.trunc((player.gold * percent) / 100));
    if (interest <= 0) {
      continue;
    }
    const granted = grantGeneratedGold(player, interest);
    events.push({
      type: 'passive-proc',
      tick: state.tick,
      passiveId: PASSIVE_IDS.interest,
      sourceEntityId: player.entityId,
      targetEntityId: null,
      detail: 'interest',
      amount: granted,
      durationTicks: definition.intervalTicks,
    });
  }
}

export function scavengerSaleGold(player: PlayerEntity, baseSellPrice: number): number {
  const loadout = findPassiveLoadout(player, PASSIVE_IDS.scavenger);
  if (!loadout) {
    return baseSellPrice;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.scavenger);
  if (definition.effect !== 'sale-bonus') {
    return baseSellPrice;
  }
  const bonusPercent = passiveLevelValue(definition.saleBonusPercentByLevel, loadout.level);
  return baseSellPrice + Math.trunc((baseSellPrice * bonusPercent) / 100);
}

export function scavengerPickupGold(
  player: PlayerEntity,
  equipmentId: NonNullable<LootDrop['equipmentId']>,
): number {
  const loadout = findPassiveLoadout(player, PASSIVE_IDS.scavenger);
  if (loadout?.level !== 5) {
    return 0;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.scavenger);
  if (definition.effect !== 'sale-bonus') {
    return 0;
  }
  return Math.trunc(
    (getEquipmentDefinition(equipmentId).sellPrice * definition.pickupGoldPercent) / 100,
  );
}

export function createTreasureHunterDrop(
  state: MutableSimulationState,
  sourceEntityId: EntityId,
  monster: MonsterEntity,
): LootDrop | null {
  const player = state.players.get(sourceEntityId);
  if (!player) {
    return null;
  }
  const loadout = findPassiveLoadout(player, PASSIVE_IDS.treasureHunter);
  if (!loadout) {
    return null;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.treasureHunter);
  if (
    definition.effect !== 'treasure-hunter' ||
    state.random.combat.nextInt(100) >=
      passiveLevelValue(definition.chestChancePercentByLevel, loadout.level)
  ) {
    return null;
  }
  const gems =
    state.random.combat.nextInt(100) <
    passiveLevelValue(definition.gemChancePercentByLevel, loadout.level)
      ? 1
      : 0;
  const equipmentId =
    loadout.level === 5 && state.random.combat.nextInt(100) < definition.goldEquipmentChancePercent
      ? (GOLD_EQUIPMENT_POOL[state.random.combat.nextInt(GOLD_EQUIPMENT_POOL.length)] ?? null)
      : null;
  return createRuntimeLootDrop(state, {
    position: monster.position,
    kind: 'chest',
    gold: passiveLevelValue(definition.chestGoldByLevel, loadout.level),
    gems,
    equipmentId,
    expiresAtTick: state.tick + 60 * TICKS_PER_SECOND,
  });
}
