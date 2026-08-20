import type { MonsterEntity } from '../types';

export function isCoreBoss(monster: MonsterEntity): boolean {
  return monster.kind === 'core-boss';
}

export function coreBossAdjustedHardControlTicks(
  monster: MonsterEntity,
  durationTicks: number,
): number {
  return isCoreBoss(monster) ? 0 : durationTicks;
}

export function coreBossAdjustedSlowPercent(monster: MonsterEntity, slowPercent: number): number {
  return isCoreBoss(monster) ? Math.trunc(slowPercent / 2) : slowPercent;
}

export function coreBossCanBeForcedDisplaced(monster: MonsterEntity): boolean {
  return !isCoreBoss(monster);
}
