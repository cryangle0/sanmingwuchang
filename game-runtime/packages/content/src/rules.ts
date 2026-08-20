import { secondsToTicks, type Vec2Mm, vec2Mm } from '@jwgb/core';
import type { FiveElement } from './hero';

export const RULESET_VERSION = '3.1.0-m1.4';

export const M0_RULES = {
  playerLives: 3,
  playerCapsuleRadiusMm: 450,
  arenaRadiusMm: 120_000,
  soulSpeedMmPerSecond: 18_000,
  reviveProtectionTicks: secondsToTicks(3),
  apocalypseStartTick: secondsToTicks(1_200),
  apocalypseFirstDamageTick: secondsToTicks(1_201),
  apocalypseDamageIntervalTicks: secondsToTicks(1),
  stormCourtAnnouncementTick: secondsToTicks(12 * 60),
  stormCenterMoveStartTick: secondsToTicks(13 * 60),
  stormCenterArrivalTick: secondsToTicks(17 * 60 + 30),
  stormWarningTick: secondsToTicks(19 * 60 + 55),
  matchVoidAbortTicks: secondsToTicks(30 * 60),
  voidAbortCultivationCompensation: 20,
} as const;

export const M0_SPAWN_POINTS: readonly Vec2Mm[] = [
  vec2Mm(90_000, 0),
  vec2Mm(88_033, 18_712),
  vec2Mm(82_219, 36_606),
  vec2Mm(72_812, 52_901),
  vec2Mm(60_222, 66_883),
  vec2Mm(45_000, 77_942),
  vec2Mm(27_812, 85_595),
  vec2Mm(9_408, 89_507),
  vec2Mm(-9_408, 89_507),
  vec2Mm(-27_812, 85_595),
  vec2Mm(-45_000, 77_942),
  vec2Mm(-60_222, 66_883),
  vec2Mm(-72_812, 52_901),
  vec2Mm(-82_219, 36_606),
  vec2Mm(-88_033, 18_712),
  vec2Mm(-90_000, 0),
  vec2Mm(-88_033, -18_712),
  vec2Mm(-82_219, -36_606),
  vec2Mm(-72_812, -52_901),
  vec2Mm(-60_222, -66_883),
  vec2Mm(-45_000, -77_942),
  vec2Mm(-27_812, -85_595),
  vec2Mm(-9_408, -89_507),
  vec2Mm(9_408, -89_507),
  vec2Mm(27_812, -85_595),
  vec2Mm(45_000, -77_942),
  vec2Mm(60_222, -66_883),
  vec2Mm(72_812, -52_901),
  vec2Mm(82_219, -36_606),
  vec2Mm(88_033, -18_712),
] as const;

const COUNTERS: Readonly<Record<FiveElement, FiveElement>> = {
  metal: 'wood',
  wood: 'earth',
  earth: 'water',
  water: 'fire',
  fire: 'metal',
};

export function elementDamageBasisPoints(attacker: FiveElement, defender: FiveElement): number {
  return COUNTERS[attacker] === defender ? 15_000 : 10_000;
}
