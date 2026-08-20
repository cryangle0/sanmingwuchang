import { EQUIPMENT_IDS } from '@jwgb/content';
import type { EntityId } from '@jwgb/core';
import type { MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import { rebuildEquipmentStats } from './equipment-inventory';
import {
  equipmentGeneratedGold,
  equipmentHasGinseng,
  equipmentHasJudgeBrush,
  equipmentHasPermanentAttackRing,
  equipmentMonsterKillGold,
} from './equipment-query';

export function grantGeneratedGold(player: PlayerEntity, baseAmount: number): number {
  const amount = Math.max(0, equipmentGeneratedGold(player, Math.max(0, baseAmount)));
  player.gold += amount;
  return amount;
}

/**
 * Gold that changes hands between players is deliberately kept out of this
 * helper. G5 only scales newly created currency, never theft, pickpocketing,
 * bounty transfers, or other player-to-player movement.
 */
export function transferGold(
  from: PlayerEntity,
  to: PlayerEntity,
  requestedAmount: number,
): number {
  const amount = Math.min(from.gold, Math.max(0, Math.trunc(requestedAmount)));
  if (amount <= 0) {
    return 0;
  }
  from.gold -= amount;
  to.gold += amount;
  return amount;
}

export function grantExperience(player: PlayerEntity, amount: number): number {
  const granted = Math.max(0, Math.trunc(amount));
  const previousLevel = player.level;
  player.experience += granted;
  while (player.level < 15 && player.experience >= cumulativeExperienceForLevel(player.level + 1)) {
    player.level += 1;
  }
  if (player.level !== previousLevel) {
    rebuildEquipmentStats(player);
  }
  return granted;
}

const XP_CUMULATIVE: readonly number[] = [
  0, 50, 120, 210, 320, 450, 605, 785, 995, 1_235, 1_510, 1_825, 2_275, 2_825, 3_525,
];

function cumulativeExperienceForLevel(level: number): number {
  return XP_CUMULATIVE[Math.max(1, Math.min(15, level))] ?? 3_525;
}

function emitEquipmentProc(
  state: MutableSimulationState,
  events: SimEvent[],
  equipmentId: PlayerEntity['equipment'][number]['equipmentId'],
  sourceEntityId: EntityId,
  targetEntityId: EntityId | null,
  detail: string,
  amount: number,
): void {
  events.push({
    type: 'equipment-proc',
    tick: state.tick,
    equipmentId,
    sourceEntityId,
    targetEntityId,
    detail,
    amount,
    durationTicks: 0,
  });
}

function addRingAttack(
  state: MutableSimulationState,
  events: SimEvent[],
  killer: PlayerEntity,
  victimEntityId: EntityId,
  amount: number,
): void {
  for (const instance of killer.equipment) {
    if (instance.equipmentId !== EQUIPMENT_IDS.soulDevouringRing) {
      continue;
    }
    instance.permanentAttackBonus += amount;
    killer.attackPower += amount;
    emitEquipmentProc(
      state,
      events,
      EQUIPMENT_IDS.soulDevouringRing,
      killer.entityId,
      victimEntityId,
      'permanent-attack-growth',
      amount,
    );
  }
}

export function resolveEquipmentMonsterKill(
  state: MutableSimulationState,
  events: SimEvent[],
  killer: PlayerEntity,
  victimEntityId: EntityId,
): number {
  const gold = equipmentMonsterKillGold(killer);
  if (gold > 0) {
    const granted = grantGeneratedGold(killer, gold);
    emitEquipmentProc(
      state,
      events,
      EQUIPMENT_IDS.treasureBag,
      killer.entityId,
      victimEntityId,
      'monster-kill-gold',
      granted,
    );
  }
  if (equipmentHasPermanentAttackRing(killer)) {
    addRingAttack(state, events, killer, victimEntityId, 2);
  }
  return gold;
}

export function resolveEquipmentHeroKill(
  state: MutableSimulationState,
  events: SimEvent[],
  killer: PlayerEntity,
  victim: PlayerEntity,
): void {
  if (equipmentHasGinseng(killer)) {
    const before = killer.hp;
    killer.hp = Math.min(
      killer.maxHp,
      killer.hp + Math.max(1, Math.trunc((killer.maxHp * 30) / 100)),
    );
    emitEquipmentProc(
      state,
      events,
      EQUIPMENT_IDS.ginsengFruit,
      killer.entityId,
      victim.entityId,
      'hero-kill-heal',
      killer.hp - before,
    );
  }
  if (equipmentHasJudgeBrush(killer)) {
    killer.activeCooldownTicks = 0;
    emitEquipmentProc(
      state,
      events,
      EQUIPMENT_IDS.judgeBrush,
      killer.entityId,
      victim.entityId,
      'hero-kill-active-reset',
      0,
    );
  }
  if (equipmentHasPermanentAttackRing(killer)) {
    addRingAttack(state, events, killer, victim.entityId, 10);
  }
}
