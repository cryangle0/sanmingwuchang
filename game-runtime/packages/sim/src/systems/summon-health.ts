import { PASSIVE_IDS } from '@jwgb/content';
import type { ActiveId, EntityId } from '@jwgb/core';
import type { MutableSimulationState, SimEvent, SummonEntity } from '../types';

export function applySummonDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  sourceEntityId: EntityId,
  summon: SummonEntity,
  amount: number,
  options: { readonly activeAbilityId?: ActiveId } = {},
): number {
  if (amount <= 0 || !summon.targetable || summon.hp <= 0 || !state.summons.has(summon.entityId)) {
    return 0;
  }
  const actualDamage = Math.min(summon.hp, amount);
  summon.hp -= actualDamage;
  if (summon.hp === 0) {
    const sourcePlayer = state.players.get(sourceEntityId);
    const sourceSummon = state.summons.get(sourceEntityId);
    summon.destroyedByHostileDamage =
      state.monsters.has(sourceEntityId) ||
      (sourcePlayer !== undefined && sourcePlayer.entityId !== summon.ownerEntityId) ||
      (sourceSummon !== undefined && sourceSummon.ownerEntityId !== summon.ownerEntityId);
  }
  events.push({
    type: 'passive-proc',
    tick: state.tick,
    passiveId: summon.kind === 'stone-statue' ? PASSIVE_IDS.stoneStatue : PASSIVE_IDS.wolfSpirit,
    sourceEntityId,
    targetEntityId: summon.entityId,
    detail: 'summon-damaged',
    amount: actualDamage,
    durationTicks: 0,
    ...(options.activeAbilityId === undefined
      ? {}
      : { activeAbilityId: options.activeAbilityId }),
  });
  return actualDamage;
}
