import { type ActiveId, activeId } from '@jwgb/core';
import type { ActiveAbilityDefinition } from './hero';
import { createScriptedActiveDefinition } from './scripted-active';

export const GENERIC_ACTIVE_IDS = {
  hook: activeId('D1'),
  lightning: activeId('D3'),
  polymorph: activeId('D4'),
  blink: activeId('D6'),
  stealth: activeId('D7'),
  arrowRain: activeId('D9'),
  chainLightning: activeId('D10'),
  roulette: activeId('D11'),
  mark: activeId('D12'),
  swap: activeId('D13'),
  rewind: activeId('D14'),
  pickpocket: activeId('D15'),
  fortune: activeId('D16'),
  bountyStreak: activeId('D17'),
  treasureSense: activeId('D18'),
  beanSoldiers: activeId('D19'),
  trap: activeId('D20'),
  iceCoffin: activeId('D21'),
  ironShirt: activeId('D22'),
} as const;

export const M1_GENERIC_ACTIVES: readonly ActiveAbilityDefinition[] = [
  createScriptedActiveDefinition('D1', '钩锁', 28 * 20),
  createScriptedActiveDefinition('D3', '雷击', 24 * 20),
  createScriptedActiveDefinition('D4', '变羊', 32 * 20),
  {
    id: GENERIC_ACTIVE_IDS.blink,
    name: '闪现',
    cooldownTicks: 15 * 20,
    effect: 'capsule-sweep-blink',
    distanceMm: 15_000,
    maxContinuousSolidChordMm: 1_500,
    postCastLockTicks: 0,
  },
  createScriptedActiveDefinition('D7', '潜行', 32 * 20),
  createScriptedActiveDefinition('D9', '箭雨', 24 * 20),
  createScriptedActiveDefinition('D10', '电链', 85 * 20),
  {
    id: GENERIC_ACTIVE_IDS.roulette,
    name: '轮盘',
    cooldownTicks: 50 * 20,
    effect: 'target-random-damage',
    rangeMm: 40_000,
    minimumDamage: 1,
    maximumDamage: 999,
  },
  createScriptedActiveDefinition('D12', '标记', 70 * 20),
  createScriptedActiveDefinition('D13', '换位', 62 * 20),
  createScriptedActiveDefinition('D14', '回溯', 95 * 20),
  createScriptedActiveDefinition('D15', '妙手空空', 38 * 20),
  {
    id: GENERIC_ACTIVE_IDS.fortune,
    name: '聚财',
    cooldownTicks: 85 * 20,
    effect: 'gold-grant',
    goldAmount: 800,
  },
  createScriptedActiveDefinition('D17', '连赏', 55 * 20),
  createScriptedActiveDefinition('D18', '淘金狂热', 16 * 20),
  createScriptedActiveDefinition('D19', '豆兵', 50 * 20),
  createScriptedActiveDefinition('D20', '陷阱', 16 * 20),
  {
    id: GENERIC_ACTIVE_IDS.iceCoffin,
    name: '冰棺',
    cooldownTicks: 75 * 20,
    effect: 'self-lock-invulnerability',
    durationTicks: 4 * 20,
    canMove: false,
    canBasic: false,
    canCast: false,
  },
  {
    id: GENERIC_ACTIVE_IDS.ironShirt,
    name: '铁布衫',
    cooldownTicks: 45 * 20,
    effect: 'self-shield',
    durationTicks: 5 * 20,
    shieldAmount: 600,
  },
] as const;

const GENERIC_ACTIVE_BY_ID = new Map<ActiveId, ActiveAbilityDefinition>(
  M1_GENERIC_ACTIVES.map((active) => [active.id, active]),
);

export function getGenericActiveDefinition(id: ActiveId): ActiveAbilityDefinition | undefined {
  return GENERIC_ACTIVE_BY_ID.get(id);
}
