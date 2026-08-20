import { type ActiveId, activeId } from '@jwgb/core';

export type ScriptedActiveKind =
  | 'fire-wall'
  | 'damage-slow-zone'
  | 'venom-burst'
  | 'petrify-target'
  | 'spreading-poison-zone'
  | 'delayed-area-strike'
  | 'delayed-target-strike'
  | 'arm-next-basic'
  | 'dash-first-target'
  | 'decoy-summon'
  | 'teleport-backstab'
  | 'blink-decoy-bomb'
  | 'cone-damage-slow'
  | 'line-dash'
  | 'radial-knockback'
  | 'delayed-silence-zone'
  | 'combat-summon'
  | 'area-pull'
  | 'gold-true-damage'
  | 'target-dot-reveal'
  | 'line-projectile'
  | 'lifesteal-aura'
  | 'target-damage-stun'
  | 'target-heal'
  | 'damage-mark'
  | 'healing-zone'
  | 'ring-wall'
  | 'mobile-invulnerability'
  | 'displacement-lock-zone'
  | 'damage-reduction-speed'
  | 'root-projectile'
  | 'ice-wall'
  | 'self-or-target-petrify'
  | 'smoke-zone'
  | 'hook'
  | 'polymorph'
  | 'stealth'
  | 'chain-lightning'
  | 'reward-mark'
  | 'swap'
  | 'rewind'
  | 'active-pickpocket'
  | 'self-bounty'
  | 'treasure-sense'
  | 'bean-soldiers'
  | 'trap';

export interface ScriptedActiveDefinition {
  readonly id: ActiveId;
  readonly name: string;
  readonly cooldownTicks: number;
  readonly effect: 'scripted';
  readonly script: ScriptedActiveKind;
  readonly rangeMm?: number;
  readonly radiusMm?: number;
  readonly lengthMm?: number;
  readonly durationTicks?: number;
  readonly pulseIntervalTicks?: number;
  readonly delayTicks?: number;
  readonly fixedDamage?: number;
  readonly attackCoefficientBasisPoints?: number;
  readonly slowPercent?: number;
  readonly slowDurationTicks?: number;
  readonly hardControlTicks?: number;
  readonly rootTicks?: number;
  readonly displacementMm?: number;
  readonly distanceMm?: number;
  readonly burnDamagePerSecond?: number;
  readonly burnDurationTicks?: number;
  readonly maximumTargets?: number;
  readonly damageDecayBasisPoints?: number;
  readonly missingHpDamagePercent?: number;
  readonly maximumStacks?: number;
  readonly percentDamage?: number;
  readonly summonCount?: number;
  readonly summonHp?: number;
  readonly summonAttack?: number;
  readonly speedBonusPercent?: number;
  readonly lifestealPercent?: number;
  readonly damageReductionBasisPoints?: number;
  readonly healAmount?: number;
  readonly goldPercent?: number;
  readonly rewardGold?: number;
  readonly revealTicks?: number;
  readonly wallHp?: number;
  readonly projectileSpeedMmPerSecond?: number;
  readonly collisionRadiusMm?: number;
  readonly targetDamageBonusPercent?: number;
  readonly executeThresholdPercent?: number;
  readonly stealGoldPercent?: number;
  readonly maximumGoldAmount?: number;
  readonly damagePerDistanceBasisPoints?: number;
  readonly maximumDistanceBonusPercent?: number;
  readonly summonAttributeBasisPoints?: number;
  readonly damagePercent?: number;
  readonly minimumGoldAmount?: number;
  readonly stealFlatGold?: number;
  readonly minimumLootAgeTicks?: number;
  readonly detonationDamage?: number;
  readonly detonationAttackCoefficientBasisPoints?: number;
  readonly triggerHardControlTicks?: number;
  readonly triggerRevealTicks?: number;
  readonly triggerRadiusMm?: number;
  readonly maximumInstances?: number;
  readonly permanent?: boolean;
  readonly lootGoldMultiplier?: number;
}

type ScriptedActiveRule = Omit<
  ScriptedActiveDefinition,
  'id' | 'name' | 'cooldownTicks' | 'effect'
>;

const RULES: Readonly<Record<string, ScriptedActiveRule>> = {
  H002: {
    script: 'fire-wall',
    rangeMm: 15_000,
    lengthMm: 15_000,
    radiusMm: 900,
    durationTicks: 100,
    pulseIntervalTicks: 20,
    fixedDamage: 100,
    attackCoefficientBasisPoints: 4_000,
    burnDamagePerSecond: 30,
    burnDurationTicks: 60,
  },
  H003: {
    script: 'damage-slow-zone',
    rangeMm: 20_000,
    radiusMm: 8_000,
    durationTicks: 80,
    pulseIntervalTicks: 20,
    fixedDamage: 40,
    attackCoefficientBasisPoints: 2_000,
    slowPercent: 25,
    slowDurationTicks: 40,
  },
  H004: {
    script: 'venom-burst',
    rangeMm: 25_000,
    durationTicks: 80,
    pulseIntervalTicks: 20,
    fixedDamage: 5,
    maximumStacks: 10,
    percentDamage: 3,
  },
  H005: {
    script: 'petrify-target',
    rangeMm: 25_000,
    durationTicks: 30,
  },
  H006: {
    script: 'spreading-poison-zone',
    rangeMm: 25_000,
    radiusMm: 8_000,
    durationTicks: 160,
    pulseIntervalTicks: 20,
    fixedDamage: 40,
    attackCoefficientBasisPoints: 2_000,
    burnDurationTicks: 60,
  },
  H007: {
    script: 'damage-slow-zone',
    rangeMm: 25_000,
    radiusMm: 10_000,
    durationTicks: 80,
    pulseIntervalTicks: 20,
    fixedDamage: 60,
    attackCoefficientBasisPoints: 3_000,
    slowPercent: 40,
    slowDurationTicks: 40,
  },
  H008: {
    script: 'delayed-area-strike',
    rangeMm: 30_000,
    radiusMm: 12_000,
    delayTicks: 30,
    fixedDamage: 400,
    attackCoefficientBasisPoints: 12_000,
  },
  H010: {
    script: 'arm-next-basic',
    missingHpDamagePercent: 15,
  },
  H011: {
    script: 'dash-first-target',
    distanceMm: 25_000,
    radiusMm: 1_200,
    fixedDamage: 100,
    attackCoefficientBasisPoints: 5_000,
    hardControlTicks: 16,
  },
  H012: {
    script: 'decoy-summon',
    durationTicks: 160,
    summonCount: 2,
    summonAttributeBasisPoints: 3_000,
  },
  H013: {
    script: 'teleport-backstab',
    rangeMm: 40_000,
    displacementMm: 1_500,
  },
  H014: {
    script: 'blink-decoy-bomb',
    distanceMm: 15_000,
    delayTicks: 20,
    radiusMm: 4_500,
    fixedDamage: 120,
    attackCoefficientBasisPoints: 5_000,
  },
  H015: {
    script: 'cone-damage-slow',
    rangeMm: 9_000,
    radiusMm: 7_000,
    fixedDamage: 160,
    attackCoefficientBasisPoints: 7_000,
    slowPercent: 30,
    slowDurationTicks: 40,
  },
  H016: {
    script: 'line-dash',
    distanceMm: 25_000,
    radiusMm: 1_500,
    fixedDamage: 100,
    attackCoefficientBasisPoints: 5_000,
    displacementMm: 2_000,
  },
  H017: {
    script: 'radial-knockback',
    radiusMm: 12_000,
    fixedDamage: 150,
    attackCoefficientBasisPoints: 7_000,
    displacementMm: 5_000,
    hardControlTicks: 20,
  },
  H019: {
    script: 'delayed-silence-zone',
    rangeMm: 25_000,
    radiusMm: 10_000,
    durationTicks: 1,
    pulseIntervalTicks: 1,
    hardControlTicks: 60,
  },
  H020: {
    script: 'combat-summon',
    durationTicks: 400,
    summonCount: 1,
    summonHp: 500,
    summonAttack: 30,
  },
  H021: {
    script: 'area-pull',
    radiusMm: 15_000,
    delayTicks: 20,
    displacementMm: 15_000,
    maximumTargets: 8,
    fixedDamage: 120,
    attackCoefficientBasisPoints: 6_000,
  },
  H022: {
    script: 'gold-true-damage',
    rangeMm: 20_000,
    goldPercent: 20,
    minimumGoldAmount: 500,
    maximumGoldAmount: 5_000,
    damagePercent: 10,
  },
  H023: {
    script: 'target-dot-reveal',
    rangeMm: 25_000,
    durationTicks: 160,
    pulseIntervalTicks: 40,
    fixedDamage: 40,
    attackCoefficientBasisPoints: 2_000,
    revealTicks: 160,
  },
  H024: {
    script: 'line-projectile',
    rangeMm: 840_000,
    fixedDamage: 150,
    attackCoefficientBasisPoints: 10_000,
    projectileSpeedMmPerSecond: 70_000,
    collisionRadiusMm: 180,
    damagePerDistanceBasisPoints: 500,
    maximumDistanceBonusPercent: 50,
  },
  H025: {
    script: 'lifesteal-aura',
    durationTicks: 120,
    pulseIntervalTicks: 20,
    radiusMm: 5_000,
    fixedDamage: 30,
    lifestealPercent: 50,
  },
  H026: {
    script: 'target-damage-stun',
    rangeMm: 20_000,
    fixedDamage: 60,
    attackCoefficientBasisPoints: 3_000,
    hardControlTicks: 40,
  },
  H027: {
    script: 'target-heal',
    rangeMm: 50_000,
    healAmount: 220,
  },
  H028: {
    script: 'damage-mark',
    rangeMm: 30_000,
    radiusMm: 30_000,
    durationTicks: 160,
    targetDamageBonusPercent: 30,
  },
  H029: {
    script: 'delayed-area-strike',
    rangeMm: 22_000,
    radiusMm: 8_000,
    delayTicks: 24,
    fixedDamage: 300,
    attackCoefficientBasisPoints: 10_000,
    slowPercent: 40,
    slowDurationTicks: 40,
  },
  H030: {
    script: 'healing-zone',
    rangeMm: 20_000,
    radiusMm: 8_000,
    durationTicks: 80,
    pulseIntervalTicks: 20,
    healAmount: 40,
  },
  H031: {
    script: 'ring-wall',
    rangeMm: 16_000,
    radiusMm: 10_000,
    lengthMm: 900,
    durationTicks: 100,
  },
  H032: {
    script: 'mobile-invulnerability',
    durationTicks: 60,
  },
  H033: {
    script: 'displacement-lock-zone',
    rangeMm: 18_000,
    radiusMm: 8_000,
    durationTicks: 80,
    pulseIntervalTicks: 20,
    fixedDamage: 50,
    attackCoefficientBasisPoints: 2_500,
    slowPercent: 60,
    slowDurationTicks: 60,
  },
  H034: {
    script: 'damage-reduction-speed',
    durationTicks: 80,
    damageReductionBasisPoints: 2_000,
    speedBonusPercent: 15,
  },
  H035: {
    script: 'root-projectile',
    rangeMm: 60_000,
    rootTicks: 40,
    projectileSpeedMmPerSecond: 60_000,
    collisionRadiusMm: 180,
  },
  H036: {
    script: 'ice-wall',
    rangeMm: 15_000,
    lengthMm: 10_000,
    radiusMm: 700,
    durationTicks: 40 * 20,
    wallHp: 300,
  },
  H037: {
    script: 'self-or-target-petrify',
    rangeMm: 20_000,
    durationTicks: 30,
  },
  H038: {
    script: 'smoke-zone',
    rangeMm: 20_000,
    radiusMm: 8_000,
    durationTicks: 80,
  },
  D1: {
    script: 'hook',
    rangeMm: 80_000,
    fixedDamage: 80,
    attackCoefficientBasisPoints: 4_000,
    displacementMm: 1_200,
    projectileSpeedMmPerSecond: 60_000,
    collisionRadiusMm: 180,
    triggerHardControlTicks: 6,
  },
  D3: {
    script: 'delayed-target-strike',
    rangeMm: 70_000,
    delayTicks: 10,
    fixedDamage: 140,
    attackCoefficientBasisPoints: 8_000,
    hardControlTicks: 20,
  },
  D4: {
    script: 'polymorph',
    rangeMm: 45_000,
    durationTicks: 40,
    speedBonusPercent: 30,
    projectileSpeedMmPerSecond: 60_000,
    collisionRadiusMm: 180,
  },
  D7: {
    script: 'stealth',
    durationTicks: 100,
    speedBonusPercent: 30,
  },
  D9: {
    script: 'delayed-area-strike',
    rangeMm: 35_000,
    radiusMm: 8_000,
    delayTicks: 16,
    fixedDamage: 130,
    attackCoefficientBasisPoints: 6_000,
  },
  D10: {
    script: 'chain-lightning',
    rangeMm: 30_000,
    radiusMm: 15_000,
    fixedDamage: 300,
    attackCoefficientBasisPoints: 10_000,
    maximumTargets: 6,
    damageDecayBasisPoints: 8_500,
  },
  D12: {
    script: 'reward-mark',
    rangeMm: 60_000,
    durationTicks: 1_800,
    revealTicks: 1_800,
    rewardGold: 800,
  },
  D13: {
    script: 'swap',
    rangeMm: 50_000,
  },
  D14: {
    script: 'rewind',
    durationTicks: 100,
  },
  D15: {
    script: 'active-pickpocket',
    rangeMm: 30_000,
    executeThresholdPercent: 100,
    stealFlatGold: 500,
    lootGoldMultiplier: 3,
  },
  D17: {
    script: 'self-bounty',
    rewardGold: 500,
  },
  D18: {
    script: 'treasure-sense',
    rangeMm: 80_000,
    durationTicks: 400,
    revealTicks: 400,
    minimumLootAgeTicks: 200,
  },
  D19: {
    script: 'bean-soldiers',
    durationTicks: 300,
    summonCount: 3,
    summonHp: 150,
    summonAttack: 15,
  },
  D20: {
    script: 'trap',
    radiusMm: 6_000,
    durationTicks: 1_800,
    fixedDamage: 180,
    attackCoefficientBasisPoints: 8_000,
    detonationDamage: 100,
    detonationAttackCoefficientBasisPoints: 6_000,
    triggerHardControlTicks: 30,
    triggerRevealTicks: 160,
    triggerRadiusMm: 900,
    maximumInstances: 3,
    wallHp: 1,
  },
};

export function createScriptedActiveDefinition(
  idValue: string,
  name: string,
  cooldownTicks: number,
): ScriptedActiveDefinition {
  const rule = RULES[idValue];
  if (!rule) {
    throw new Error(`scripted active ${idValue} has no runtime rule`);
  }

  return {
    id: activeId(idValue),
    name,
    cooldownTicks,
    effect: 'scripted',
    ...rule,
  };
}

export function isScriptedActiveId(idValue: string): boolean {
  return Object.hasOwn(RULES, idValue);
}
