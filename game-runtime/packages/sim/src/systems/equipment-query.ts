import {
  EQUIPMENT_IDS,
  elementDamageBasisPoints,
  type FiveElement,
  getEquipmentDefinition,
} from '@jwgb/content';
import type { EntityId } from '@jwgb/core';
import type { MonsterEntity, MutableSimulationState, PlayerEntity } from '../types';

const BASIS_POINTS = 10_000;
const BASE_VISION_RANGE_MM = 30_000;
const LOW_WALL_HEIGHT_MM = 2_500;

export type HardControlKind =
  | 'stun'
  | 'freeze'
  | 'petrify'
  | 'root'
  | 'fear'
  | 'transform'
  | 'knockup';

export type EquipmentCombatTarget = PlayerEntity | MonsterEntity;

export function hasEquipment(
  player: PlayerEntity,
  equipmentId: PlayerEntity['equipment'][number]['equipmentId'],
): boolean {
  return player.equipment.some((instance) => instance.equipmentId === equipmentId);
}

export function hasEquipmentModifier(
  player: PlayerEntity,
  modifierId: NonNullable<
    Extract<ReturnType<typeof getEquipmentDefinition>, { effect: 'rule-modifier' }>['modifierId']
  >,
): boolean {
  return player.equipment.some((instance) => {
    const definition = getEquipmentDefinition(instance.equipmentId);
    return definition.effect === 'rule-modifier' && definition.modifierId === modifierId;
  });
}

export function equipmentPermanentAttackBonus(player: PlayerEntity): number {
  return player.equipment.reduce((total, instance) => total + instance.permanentAttackBonus, 0);
}

export function equipmentCriticalDamagePercent(
  player: PlayerEntity,
  currentCriticalDamagePercent: number,
): number {
  return hasEquipment(player, EQUIPMENT_IDS.whetstone)
    ? Math.max(currentCriticalDamagePercent, 230)
    : currentCriticalDamagePercent;
}

export function equipmentBackstabBonusBasisPoints(
  target: PlayerEntity,
  bonusBasisPoints: number,
): number {
  return hasEquipment(target, EQUIPMENT_IDS.bronzeMirror)
    ? Math.trunc(bonusBasisPoints / 2)
    : bonusBasisPoints;
}

export function equipmentTargetDamageBasisPoints(
  source: PlayerEntity,
  target: EquipmentCombatTarget,
): number {
  let basisPoints = BASIS_POINTS;
  if (target.hp * 100 < target.maxHp * 30 && hasEquipment(source, EQUIPMENT_IDS.sevenStarSword)) {
    basisPoints += 2_500;
  }
  if (target.hp > source.hp && hasEquipment(source, EQUIPMENT_IDS.demonSubduingMace)) {
    basisPoints += 2_500;
  }
  return basisPoints;
}

export function equipmentMonsterDamageBasisPoints(player: PlayerEntity): number {
  return hasEquipment(player, EQUIPMENT_IDS.wolfFang) ? 13_000 : BASIS_POINTS;
}

export function equipmentElementDamageBasisPoints(
  player: PlayerEntity,
  defenderElement: FiveElement,
): number {
  const base = elementDamageBasisPoints(player.element, defenderElement);
  if (base === 15_000 && hasEquipment(player, EQUIPMENT_IDS.primordialPearl)) {
    return 20_000;
  }
  return base;
}

export function equipmentIncomingDamageBasisPoints(
  target: PlayerEntity,
  form: 'basic' | 'skill' | 'dot' | 'percent' | 'reflect' | 'true' | 'storm',
): number {
  if (form === 'skill' || form === 'dot') {
    if (hasEquipment(target, EQUIPMENT_IDS.waterPearl)) {
      return 8_500;
    }
  }
  return BASIS_POINTS;
}

export function equipmentFixedDamageReduction(
  target: PlayerEntity,
  form: 'basic' | 'skill' | 'dot' | 'percent' | 'reflect' | 'true' | 'storm',
): number {
  if (form === 'true' || form === 'storm') {
    return 0;
  }
  return hasEquipment(target, EQUIPMENT_IDS.tigerSkirt) ? 8 : 0;
}

export function equipmentStormDamageBasisPoints(target: PlayerEntity): number {
  let reduction = 0;
  if (hasEquipment(target, EQUIPMENT_IDS.lightningTablet)) {
    reduction = 3_000;
  }
  if (hasEquipment(target, EQUIPMENT_IDS.tribulationBell)) {
    reduction = Math.max(reduction, 7_000);
  }
  return BASIS_POINTS - reduction;
}

export function equipmentDisplacementBasisPoints(target: PlayerEntity): number {
  let basisPoints = BASIS_POINTS;
  if (hasEquipment(target, EQUIPMENT_IDS.windPearl)) {
    basisPoints = Math.min(basisPoints, 5_000);
  }
  if (hasEquipment(target, EQUIPMENT_IDS.bedrockBoots)) {
    basisPoints = Math.min(basisPoints, 3_000);
  }
  return basisPoints;
}

export function equipmentAdjustedSlowPercent(target: PlayerEntity, slowPercent: number): number {
  if (hasEquipment(target, EQUIPMENT_IDS.galeBoots)) {
    return 0;
  }
  if (hasEquipment(target, EQUIPMENT_IDS.cloudStepShoes)) {
    return Math.trunc(slowPercent / 2);
  }
  return slowPercent;
}

export function equipmentHardControlTicks(owner: PlayerEntity, durationTicks: number): number {
  return hasEquipment(owner, EQUIPMENT_IDS.goldRope) ? durationTicks + 10 : durationTicks;
}

export function equipmentAdjustedHardControlTicks(
  target: PlayerEntity,
  durationTicks: number,
  kind: HardControlKind = 'stun',
): number {
  if (durationTicks <= 0) {
    return 0;
  }
  if (
    hasEquipment(target, EQUIPMENT_IDS.bedrockBoots) &&
    (kind === 'stun' ||
      kind === 'freeze' ||
      kind === 'petrify' ||
      kind === 'root' ||
      kind === 'fear' ||
      kind === 'transform' ||
      kind === 'knockup')
  ) {
    return Math.max(6, Math.trunc((durationTicks * 3) / 10));
  }
  return durationTicks;
}

export function equipmentComboShoesAttackSpeedPercent(
  state: MutableSimulationState,
  owner: PlayerEntity,
  targetEntityId: PlayerEntity['entityId'],
): number {
  if (!hasEquipment(owner, EQUIPMENT_IDS.comboShoes)) {
    return 0;
  }
  const targetState = state.passiveTargetStates.get(
    `${Number(owner.entityId)}:${Number(targetEntityId)}`,
  );
  if (
    !targetState ||
    targetState.comboShoesStacks <= 0 ||
    targetState.comboShoesExpiresAtTick <= state.tick
  ) {
    return 0;
  }
  return Math.min(6, targetState.comboShoesStacks) * 4;
}

export function equipmentActiveCooldownTicks(owner: PlayerEntity, durationTicks: number): number {
  if (!hasEquipment(owner, EQUIPMENT_IDS.windBag)) {
    return durationTicks;
  }
  return Math.trunc((durationTicks * 80) / 100);
}

export function equipmentBasicLifestealPercent(owner: PlayerEntity): number {
  return hasEquipment(owner, EQUIPMENT_IDS.bloodJadeGourd) ? 10 : 0;
}

export function equipmentSummonStatBasisPoints(owner: PlayerEntity, attack: boolean): number {
  let basisPoints = BASIS_POINTS;
  if (hasEquipment(owner, EQUIPMENT_IDS.beastWhip) && attack) {
    basisPoints += 3_000;
  }
  if (hasEquipment(owner, EQUIPMENT_IDS.soulBanner)) {
    basisPoints += 6_000;
  }
  return basisPoints;
}

export function equipmentHandCapacity(player: PlayerEntity): number {
  return hasEquipment(player, EQUIPMENT_IDS.clothBag) ? 2 : 1;
}

export function equipmentVisionRangeMm(player: PlayerEntity): number {
  const equipmentRange = hasEquipment(player, EQUIPMENT_IDS.nightWatchLamp)
    ? Math.trunc((BASE_VISION_RANGE_MM * 120) / 100)
    : BASE_VISION_RANGE_MM;
  return player.consumableVisionTicks > 0
    ? Math.max(equipmentRange, BASE_VISION_RANGE_MM + 15_000)
    : equipmentRange;
}

export function equipmentStealthRevealRangeMm(player: PlayerEntity): number {
  return hasEquipment(player, EQUIPMENT_IDS.demonRevealingPearl) || player.consumableRevealTicks > 0
    ? 20_000
    : 0;
}

export function equipmentFlightWallHeightMm(player: PlayerEntity): number {
  return hasEquipment(player, EQUIPMENT_IDS.cloudRide) ? LOW_WALL_HEIGHT_MM : 0;
}

export function equipmentGeneratedGold(player: PlayerEntity, baseAmount: number): number {
  return hasEquipment(player, EQUIPMENT_IDS.treasureBasin)
    ? baseAmount + Math.trunc(baseAmount / 2)
    : baseAmount;
}

export function equipmentMonsterKillGold(player: PlayerEntity): number {
  return hasEquipment(player, EQUIPMENT_IDS.treasureBag) ? 30 : 0;
}

export function equipmentOutOfCombatHeal(player: PlayerEntity): number {
  let amount = 0;
  if (hasEquipment(player, EQUIPMENT_IDS.medicineGourd)) {
    amount += 8;
  }
  if (hasEquipment(player, EQUIPMENT_IDS.tenThousandYearLingzhi)) {
    amount += 8;
  }
  return amount;
}

export function equipmentHasGinseng(player: PlayerEntity): boolean {
  return hasEquipment(player, EQUIPMENT_IDS.ginsengFruit);
}

export function equipmentHasJudgeBrush(player: PlayerEntity): boolean {
  return hasEquipment(player, EQUIPMENT_IDS.judgeBrush);
}

export function equipmentHasThornArmor(player: PlayerEntity): boolean {
  return hasEquipment(player, EQUIPMENT_IDS.thornArmor);
}

export function equipmentHasNightCloak(player: PlayerEntity): boolean {
  return hasEquipment(player, EQUIPMENT_IDS.nightCloak);
}

export function equipmentHasActiveReveal(player: PlayerEntity): boolean {
  return hasEquipment(player, EQUIPMENT_IDS.keenEars);
}

export function equipmentHasFlight(player: PlayerEntity): boolean {
  return hasEquipment(player, EQUIPMENT_IDS.cloudRide);
}

export function equipmentHasPermanentAttackRing(player: PlayerEntity): boolean {
  return hasEquipment(player, EQUIPMENT_IDS.soulDevouringRing);
}

export function isEquipmentInstanceOwnedBy(
  player: PlayerEntity,
  instanceId: EntityId | PlayerEntity['equipment'][number]['instanceId'],
): boolean {
  return player.equipment.some((instance) => instance.instanceId === instanceId);
}
