import { EQUIPMENT_IDS, getActiveDefinition, PASSIVE_IDS } from '@jwgb/content';
import type { MutableSimulationState, PlayerEntity } from '../types';
import { hasEquipment } from './equipment-query';
import {
  findPassiveLoadout,
  huntSpeedBonusPercent,
  stormWardSpeedBonusPercent,
} from './passive-runtime';

export function currentMoveSpeedMmPerSecond(
  state: MutableSimulationState,
  player: PlayerEntity,
): number {
  const active = getActiveDefinition(player.activeAbilityId);
  const activeMultiplierBasisPoints =
    player.whirlwindTicks > 0 && active.effect === 'mobile-channel-area-damage'
      ? active.selfMoveMultiplierBasisPoints
      : 10_000;
  const momentum = findPassiveLoadout(player, PASSIVE_IDS.momentum);
  const momentumPerStack = momentum ? ([100, 120, 150, 180, 200][momentum.level - 1] ?? 0) : 0;
  const dodgeBonus = player.b15SpeedBoostTicks > 0 ? player.b15SpeedBonusPercent : 0;
  const sprintBonus = player.b27SpeedBoostTicks > 0 ? player.b27SpeedBonusPercent : 0;
  const huntBonus = huntSpeedBonusPercent(state, player);
  const bountyHunterBonus = player.b42SpeedBoostTicks > 0 ? player.b42SpeedBonusPercent : 0;
  const stormWardBonus = stormWardSpeedBonusPercent(state, player);
  const scriptedActiveBonus =
    (player.activeSpeedBonusTicks > 0 ? player.activeSpeedBonusPercent : 0) +
    (player.polymorphTicks > 0 ? player.polymorphSpeedBonusPercent : 0);
  const dormantBootsMultiplierBasisPoints = player.dormantBootsSpeedTicks > 0 ? 13_000 : 10_000;
  const sprint = findPassiveLoadout(player, PASSIVE_IDS.sprint);
  const slowBasisPoints =
    hasEquipment(player, EQUIPMENT_IDS.galeBoots) ||
    (player.b27SpeedBoostTicks > 0 && sprint?.level === 5)
      ? 10_000
      : player.slowBasisPoints;
  const speedWithPercentBonuses = Math.trunc(
    (player.moveSpeedMmPerSecond *
      (100 +
        dodgeBonus +
        sprintBonus +
        huntBonus +
        bountyHunterBonus +
        stormWardBonus +
        scriptedActiveBonus)) /
      100,
  );
  const speedWithMomentum = Math.trunc(
    (speedWithPercentBonuses * (10_000 + player.b36Stacks * momentumPerStack)) / 10_000,
  );
  return Math.trunc(
    (speedWithMomentum *
      activeMultiplierBasisPoints *
      slowBasisPoints *
      dormantBootsMultiplierBasisPoints) /
      1_000_000_000_000,
  );
}
