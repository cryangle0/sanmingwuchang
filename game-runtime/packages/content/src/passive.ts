import { type PassiveId, passiveId, secondsToTicks, TICKS_PER_SECOND } from '@jwgb/core';

export type PassiveLevel = 1 | 2 | 3 | 4 | 5;

interface PassiveDefinitionBase {
  readonly id: PassiveId;
  readonly name: string;
}

export type PassiveDefinition =
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-slow';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly slowPercentByLevel: readonly [number, number, number, number, number];
      readonly durationTicksByLevel: readonly [number, number, number, number, number];
      readonly level5AoeSlowPercent: number;
      readonly level5AoeRadiusMm: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-silence';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly durationTicksByLevel: readonly [number, number, number, number, number];
      readonly level5CooldownPenaltyTicks: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'critical-knockback';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly distanceMmByLevel: readonly [number, number, number, number, number];
      readonly level5AoeRadiusMm: number;
      readonly level5AoeDistanceMm: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-blind';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly missPercentByLevel: readonly [number, number, number, number, number];
      readonly durationTicksByLevel: readonly [number, number, number, number, number];
      readonly level5PreventsCritical: true;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-stun';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly durationTicksByLevel: readonly [number, number, number, number, number];
      readonly internalCooldownTicks: number;
      readonly level5AoeRadiusMm: number;
      readonly level5AoeDurationTicks: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-critical';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly criticalDamagePercentByLevel: readonly [number, number, number, number, number];
      readonly level5ShieldBypassPercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-splash';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly splashPercentByLevel: readonly [number, number, number, number, number];
      readonly radiusMm: number;
      readonly level5RadiusMm: number;
      readonly level5HitsMainTarget: true;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-burn-stack';
      readonly thresholdByLevel: readonly [number, number, number, number, number];
      readonly lostHpDamagePercentByLevel: readonly [number, number, number, number, number];
      readonly level5SpreadStacks: number;
      readonly spreadRadiusMm: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-poison-stack';
      readonly damagePerSecondByLevel: readonly [number, number, number, number, number];
      readonly maxStacksByLevel: readonly [number, number, number, number, number];
      readonly durationTicksByLevel: readonly [number, number, number, number, number];
      readonly level5FullStackMultiplierBasisPoints: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'low-hp-execute';
      readonly thresholdPercentByLevel: readonly [number, number, number, number, number];
      readonly damageBonusPercentByLevel: readonly [number, number, number, number, number];
      readonly level5KillHealPercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-combo';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly maximumExtraHitsByLevel: readonly [number, number, number, number, number];
      readonly level5ForcedPassiveChancePercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'summon-wolf';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly hpByLevel: readonly [number, number, number, number, number];
      readonly attackByLevel: readonly [number, number, number, number, number];
      readonly durationTicks: number;
      readonly maximumCountByLevel: readonly [number, number, number, number, number];
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'summon-fire-spirit';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly contactDamageByLevel: readonly [number, number, number, number, number];
      readonly durationTicks: number;
      readonly maximumCountByLevel: readonly [number, number, number, number, number];
      readonly contactCooldownTicks: number;
      readonly burnDamagePerSecond: number;
      readonly burnDurationTicks: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'cold-arrow';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly damageByLevel: readonly [number, number, number, number, number];
      readonly rangeMm: number;
      readonly level5CanCritical: true;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-dodge';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly speedBonusPercentByLevel: readonly [number, number, number, number, number];
      readonly durationTicksByLevel: readonly [number, number, number, number, number];
      readonly level5SlowImmune: true;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-reduction';
      readonly reductionByLevel: readonly [number, number, number, number, number];
      readonly level5BlockChancePercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'incoming-basic-shield';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly shieldAmountByLevel: readonly [number, number, number, number, number];
      readonly durationTicks: number;
      readonly level5BreakAoeDamage: number;
      readonly level5BreakAoeRadiusMm: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'low-hp-offense';
      readonly attackBonusPerMissingTenPercentByLevel: readonly [
        number,
        number,
        number,
        number,
        number,
      ];
      readonly level5LifestealPercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'lethal-proc';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly healMaxHpPercentByLevel: readonly [number, number, number, number, number];
      readonly level5BlinkDistanceMm: number;
      readonly postSuccessRetriggerLockTicks: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'once-per-match-revive';
      readonly healMaxHpPercentByLevel: readonly [number, number, number, number, number];
      readonly level5BuffTicks: number;
      readonly level5DamageMultiplierBasisPoints: number;
      readonly level5ControlImmune: true;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'out-of-combat-recovery';
      readonly healPerSecondByLevel: readonly [number, number, number, number, number];
      readonly outOfCombatTicksByLevel: readonly [number, number, number, number, number];
      readonly level5FirstHitBonusPercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-reflect';
      readonly reflectPercentByLevel: readonly [number, number, number, number, number];
      readonly level5CanCritical: true;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'basic-counter';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly damagePercentByLevel: readonly [number, number, number, number, number];
      readonly internalCooldownTicks: number;
      readonly level5GuaranteedCritical: true;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'skill-absorption';
      readonly absorptionPercentByLevel: readonly [number, number, number, number, number];
      readonly level5ReflectPercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'critical-rage';
      readonly nextBasicBonusPercentByLevel: readonly [number, number, number, number, number];
      readonly attackSpeedDurationTicks: number;
      readonly attackSpeedBonusPercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'backstab';
      readonly damageBonusPercentByLevel: readonly [number, number, number, number, number];
      readonly level5GuaranteedCritical: true;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'hit-speed-boost';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly speedBonusPercentByLevel: readonly [number, number, number, number, number];
      readonly durationTicksByLevel: readonly [number, number, number, number, number];
      readonly level5SlowImmune: true;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'low-hp-hunt';
      readonly rangeMmByLevel: readonly [number, number, number, number, number];
      readonly speedBonusPercentByLevel: readonly [number, number, number, number, number];
      readonly level5DamageBonusPercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'ambush';
      readonly damageBonusPercentByLevel: readonly [number, number, number, number, number];
      readonly outOfCombatTicksByLevel: readonly [number, number, number, number, number];
      readonly level5RevealTicks: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'afterimage';
      readonly intervalTicksByLevel: readonly [number, number, number, number, number];
      readonly slowPercentByLevel: readonly [number, number, number, number, number];
      readonly durationTicksByLevel: readonly [number, number, number, number, number];
      readonly level5ExplosionDamage: number;
      readonly level5ExplosionRadiusMm: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'pickpocket';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly goldByLevel: readonly [number, number, number, number, number];
      readonly level5HealPercent: number;
      readonly internalCooldownTicks: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'monster-kill-gold';
      readonly monsterGoldByLevel: readonly [number, number, number, number, number];
      readonly heroKillGold: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'treasure-hunter';
      readonly chestChancePercentByLevel: readonly [number, number, number, number, number];
      readonly chestGoldByLevel: readonly [number, number, number, number, number];
      readonly chestGoldBonusPercentByLevel: readonly [number, number, number, number, number];
      readonly gemChancePercentByLevel: readonly [number, number, number, number, number];
      readonly goldEquipmentChancePercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'interest';
      readonly interestPercentByLevel: readonly [number, number, number, number, number];
      readonly capByLevel: readonly [number, number, number, number, number];
      readonly intervalTicks: number;
      readonly level5CapMultiplier: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'sale-bonus';
      readonly saleBonusPercentByLevel: readonly [number, number, number, number, number];
      readonly pickupGoldPercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'momentum';
      readonly moveBonusBasisPointsByLevel: readonly [number, number, number, number, number];
      readonly maximumStacksByLevel: readonly [number, number, number, number, number];
      readonly level5ExtraDamagePercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'summon-resonance';
      readonly healByLevel: readonly [number, number, number, number, number];
      readonly aoeDamageByLevel: readonly [number, number, number, number, number];
      readonly aoeRadiusMm: number;
      readonly level5EffectMultiplierBasisPoints: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'controlled-recovery';
      readonly damageReductionPercentByLevel: readonly [number, number, number, number, number];
      readonly healPercentPerSecond: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'out-of-combat-statue';
      readonly outOfCombatTicksByLevel: readonly [number, number, number, number, number];
      readonly hpByLevel: readonly [number, number, number, number, number];
      readonly destructionDamage: number;
      readonly destructionRadiusMm: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'kill-growth';
      readonly hpPerKillByLevel: readonly [number, number, number, number, number];
      readonly milestoneKills: number;
      readonly milestoneHpBonus: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'bounty-mark';
      readonly markDurationTicksByLevel: readonly [number, number, number, number, number];
      readonly rewardGoldByLevel: readonly [number, number, number, number, number];
      readonly level5Reveal: true;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'bounty-hunter';
      readonly cooldownReductionTicksByLevel: readonly [number, number, number, number, number];
      readonly speedBonusPercent: number;
      readonly speedDurationTicks: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'storm-ward';
      readonly stormChanceReductionPercentByLevel: readonly [
        number,
        number,
        number,
        number,
        number,
      ];
      readonly stormSpeedBonusPercentByLevel: readonly [number, number, number, number, number];
      readonly level5BasicDamageBonusPercent: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'thunderstorm';
      readonly chancePercentByLevel: readonly [number, number, number, number, number];
      readonly damageByLevel: readonly [number, number, number, number, number];
      readonly radiusMmByLevel: readonly [number, number, number, number, number];
      readonly level5StormChanceMultiplierBasisPoints: number;
    })
  | (PassiveDefinitionBase & {
      readonly effect: 'definition-only';
    });

export interface PassiveLoadoutEntry {
  readonly passiveId: PassiveId;
  readonly level: PassiveLevel;
}

export const PASSIVE_IDS = {
  frost: passiveId('B01'),
  paralysis: passiveId('B02'),
  knockback: passiveId('B03'),
  blind: passiveId('B04'),
  stun: passiveId('B05'),
  critical: passiveId('B06'),
  splash: passiveId('B07'),
  burn: passiveId('B08'),
  poison: passiveId('B09'),
  execute: passiveId('B10'),
  combo: passiveId('B11'),
  wolfSpirit: passiveId('B12'),
  fireSpirit: passiveId('B13'),
  coldArrow: passiveId('B14'),
  dodge: passiveId('B15'),
  ironSkin: passiveId('B16'),
  reactiveShield: passiveId('B17'),
  bloodlust: passiveId('B18'),
  feignDeath: passiveId('B19'),
  passiveRevive: passiveId('B20'),
  recovery: passiveId('B21'),
  reflect: passiveId('B22'),
  counter: passiveId('B23'),
  absorption: passiveId('B24'),
  rage: passiveId('B25'),
  backstab: passiveId('B26'),
  sprint: passiveId('B27'),
  hunt: passiveId('B28'),
  ambush: passiveId('B29'),
  afterimage: passiveId('B30'),
  pickpocket: passiveId('B31'),
  greed: passiveId('B32'),
  treasureHunter: passiveId('B33'),
  interest: passiveId('B34'),
  scavenger: passiveId('B35'),
  momentum: passiveId('B36'),
  resonance: passiveId('B37'),
  adversity: passiveId('B38'),
  stoneStatue: passiveId('B39'),
  tenacity: passiveId('B40'),
  bounty: passiveId('B41'),
  bountyHunter: passiveId('B42'),
  stormWard: passiveId('B43'),
  thunderstorm: passiveId('B44'),
} as const;

export const M1_PASSIVES: readonly PassiveDefinition[] = [
  {
    id: PASSIVE_IDS.frost,
    name: 'Frost',
    effect: 'basic-slow',
    chancePercentByLevel: [10, 13, 16, 20, 25],
    slowPercentByLevel: [30, 40, 50, 60, 80],
    durationTicksByLevel: [40, 40, 50, 50, 60],
    level5AoeSlowPercent: 35,
    level5AoeRadiusMm: 5_000,
  },
  {
    id: PASSIVE_IDS.paralysis,
    name: 'Paralysis',
    effect: 'basic-silence',
    chancePercentByLevel: [8, 10, 12, 15, 18],
    durationTicksByLevel: [16, 20, 24, 28, 30],
    level5CooldownPenaltyTicks: 60,
  },
  {
    id: PASSIVE_IDS.knockback,
    name: 'Knockback',
    effect: 'critical-knockback',
    chancePercentByLevel: [20, 23, 26, 30, 35],
    distanceMmByLevel: [3_000, 3_500, 4_000, 4_500, 5_000],
    level5AoeRadiusMm: 5_000,
    level5AoeDistanceMm: 3_000,
  },
  {
    id: PASSIVE_IDS.blind,
    name: 'Blind',
    effect: 'basic-blind',
    chancePercentByLevel: [10, 12, 14, 17, 20],
    missPercentByLevel: [50, 60, 70, 80, 80],
    durationTicksByLevel: [40, 40, 50, 50, 60],
    level5PreventsCritical: true,
  },
  {
    id: PASSIVE_IDS.stun,
    name: 'Stun',
    effect: 'basic-stun',
    chancePercentByLevel: [5, 6, 7, 8, 10],
    durationTicksByLevel: [8, 10, 12, 14, 16],
    internalCooldownTicks: 40,
    level5AoeRadiusMm: 3_000,
    level5AoeDurationTicks: 6,
  },
  {
    id: PASSIVE_IDS.critical,
    name: '暴击',
    effect: 'basic-critical',
    chancePercentByLevel: [8, 10, 13, 16, 20],
    criticalDamagePercentByLevel: [180, 190, 200, 210, 230],
    level5ShieldBypassPercent: 30,
  },
  {
    id: PASSIVE_IDS.splash,
    name: 'Splash',
    effect: 'basic-splash',
    chancePercentByLevel: [10, 13, 16, 20, 25],
    splashPercentByLevel: [40, 45, 50, 55, 60],
    radiusMm: 3_000,
    level5RadiusMm: 4_500,
    level5HitsMainTarget: true,
  },
  {
    id: PASSIVE_IDS.burn,
    name: 'Burn Ash',
    effect: 'basic-burn-stack',
    thresholdByLevel: [5, 5, 5, 4, 4],
    lostHpDamagePercentByLevel: [8, 10, 12, 12, 15],
    level5SpreadStacks: 2,
    spreadRadiusMm: 3_000,
  },
  {
    id: PASSIVE_IDS.poison,
    name: 'Poison',
    effect: 'basic-poison-stack',
    damagePerSecondByLevel: [3, 4, 5, 6, 8],
    maxStacksByLevel: [3, 4, 4, 5, 5],
    durationTicksByLevel: [60, 60, 80, 80, 80],
    level5FullStackMultiplierBasisPoints: 15_000,
  },
  {
    id: PASSIVE_IDS.execute,
    name: 'Execute',
    effect: 'low-hp-execute',
    thresholdPercentByLevel: [20, 22, 25, 28, 30],
    damageBonusPercentByLevel: [25, 30, 35, 40, 50],
    level5KillHealPercent: 10,
  },
  {
    id: PASSIVE_IDS.combo,
    name: 'Combo',
    effect: 'basic-combo',
    chancePercentByLevel: [8, 10, 12, 15, 20],
    maximumExtraHitsByLevel: [1, 1, 2, 2, 3],
    level5ForcedPassiveChancePercent: 50,
  },
  {
    id: PASSIVE_IDS.wolfSpirit,
    name: 'Wolf Spirit',
    effect: 'summon-wolf',
    chancePercentByLevel: [6, 8, 10, 12, 15],
    hpByLevel: [150, 200, 250, 300, 350],
    attackByLevel: [20, 25, 30, 35, 40],
    durationTicks: secondsToTicks(15),
    maximumCountByLevel: [1, 1, 1, 1, 2],
  },
  {
    id: PASSIVE_IDS.fireSpirit,
    name: 'Fire Spirit',
    effect: 'summon-fire-spirit',
    chancePercentByLevel: [6, 8, 10, 12, 15],
    contactDamageByLevel: [60, 80, 100, 120, 150],
    durationTicks: secondsToTicks(8),
    maximumCountByLevel: [1, 1, 1, 1, 2],
    contactCooldownTicks: secondsToTicks(1),
    burnDamagePerSecond: 20,
    burnDurationTicks: secondsToTicks(3),
  },
  {
    id: PASSIVE_IDS.coldArrow,
    name: 'Cold Arrow',
    effect: 'cold-arrow',
    chancePercentByLevel: [10, 12, 14, 16, 20],
    damageByLevel: [60, 80, 100, 120, 150],
    rangeMm: 50_000,
    level5CanCritical: true,
  },
  {
    id: PASSIVE_IDS.dodge,
    name: 'Dodge',
    effect: 'basic-dodge',
    chancePercentByLevel: [10, 13, 16, 20, 25],
    speedBonusPercentByLevel: [0, 0, 0, 0, 30],
    durationTicksByLevel: [0, 0, 0, 0, 40],
    level5SlowImmune: true,
  },
  {
    id: PASSIVE_IDS.ironSkin,
    name: 'Iron Skin',
    effect: 'basic-reduction',
    reductionByLevel: [6, 10, 14, 18, 25],
    level5BlockChancePercent: 10,
  },
  {
    id: PASSIVE_IDS.reactiveShield,
    name: '护盾',
    effect: 'incoming-basic-shield',
    chancePercentByLevel: [8, 10, 13, 16, 20],
    shieldAmountByLevel: [60, 80, 100, 130, 160],
    durationTicks: secondsToTicks(10),
    level5BreakAoeDamage: 100,
    level5BreakAoeRadiusMm: 3_000,
  },
  {
    id: PASSIVE_IDS.bloodlust,
    name: 'Bloodlust',
    effect: 'low-hp-offense',
    attackBonusPerMissingTenPercentByLevel: [3, 4, 5, 6, 8],
    level5LifestealPercent: 10,
  },
  {
    id: PASSIVE_IDS.feignDeath,
    name: '假死',
    effect: 'lethal-proc',
    chancePercentByLevel: [5, 6, 7, 8, 10],
    healMaxHpPercentByLevel: [10, 12, 15, 18, 20],
    level5BlinkDistanceMm: 8_000,
    postSuccessRetriggerLockTicks: secondsToTicks(1),
  },
  {
    id: PASSIVE_IDS.passiveRevive,
    name: '复活',
    effect: 'once-per-match-revive',
    healMaxHpPercentByLevel: [25, 30, 35, 40, 50],
    level5BuffTicks: secondsToTicks(5),
    level5DamageMultiplierBasisPoints: 13_000,
    level5ControlImmune: true,
  },
  {
    id: PASSIVE_IDS.recovery,
    name: '回复',
    effect: 'out-of-combat-recovery',
    healPerSecondByLevel: [4, 6, 8, 10, 15],
    outOfCombatTicksByLevel: [100, 100, 80, 80, 60],
    level5FirstHitBonusPercent: 30,
  },
  {
    id: PASSIVE_IDS.reflect,
    name: '反伤',
    effect: 'basic-reflect',
    reflectPercentByLevel: [10, 13, 16, 20, 25],
    level5CanCritical: true,
  },
  {
    id: PASSIVE_IDS.counter,
    name: '反击',
    effect: 'basic-counter',
    chancePercentByLevel: [6, 8, 10, 13, 16],
    damagePercentByLevel: [80, 85, 90, 95, 100],
    internalCooldownTicks: TICKS_PER_SECOND / 2,
    level5GuaranteedCritical: true,
  },
  {
    id: PASSIVE_IDS.absorption,
    name: '吸收',
    effect: 'skill-absorption',
    absorptionPercentByLevel: [10, 13, 16, 20, 25],
    level5ReflectPercent: 50,
  },
  {
    id: PASSIVE_IDS.rage,
    name: '暴怒',
    effect: 'critical-rage',
    nextBasicBonusPercentByLevel: [20, 28, 36, 44, 55],
    attackSpeedDurationTicks: secondsToTicks(2),
    attackSpeedBonusPercent: 40,
  },
  {
    id: PASSIVE_IDS.backstab,
    name: '背刺',
    effect: 'backstab',
    damageBonusPercentByLevel: [35, 42, 50, 58, 70],
    level5GuaranteedCritical: true,
  },
  {
    id: PASSIVE_IDS.sprint,
    name: '疾跑',
    effect: 'hit-speed-boost',
    chancePercentByLevel: [10, 13, 16, 20, 25],
    speedBonusPercentByLevel: [20, 25, 30, 35, 40],
    durationTicksByLevel: [40, 40, 50, 50, 60],
    level5SlowImmune: true,
  },
  {
    id: PASSIVE_IDS.hunt,
    name: '猎杀',
    effect: 'low-hp-hunt',
    rangeMmByLevel: [30_000, 40_000, 50_000, 60_000, 80_000],
    speedBonusPercentByLevel: [15, 18, 20, 22, 25],
    level5DamageBonusPercent: 20,
  },
  {
    id: PASSIVE_IDS.ambush,
    name: '伏击',
    effect: 'ambush',
    damageBonusPercentByLevel: [25, 35, 45, 55, 70],
    outOfCombatTicksByLevel: [100, 100, 80, 80, 60],
    level5RevealTicks: secondsToTicks(3),
  },
  {
    id: PASSIVE_IDS.afterimage,
    name: '残影',
    effect: 'afterimage',
    intervalTicksByLevel: [40, 40, 30, 30, 20],
    slowPercentByLevel: [20, 25, 30, 30, 35],
    durationTicksByLevel: [30, 40, 40, 50, 60],
    level5ExplosionDamage: 80,
    level5ExplosionRadiusMm: 3_000,
  },
  {
    id: PASSIVE_IDS.pickpocket,
    name: '偷钱',
    effect: 'pickpocket',
    chancePercentByLevel: [6, 8, 10, 13, 16],
    goldByLevel: [30, 40, 50, 60, 80],
    level5HealPercent: 10,
    internalCooldownTicks: 8,
  },
  {
    id: PASSIVE_IDS.greed,
    name: '贪婪',
    effect: 'monster-kill-gold',
    monsterGoldByLevel: [40, 60, 80, 100, 150],
    heroKillGold: 250,
  },
  {
    id: PASSIVE_IDS.treasureHunter,
    name: '寻宝',
    effect: 'treasure-hunter',
    chestChancePercentByLevel: [8, 10, 13, 16, 20],
    chestGoldByLevel: [100, 120, 120, 120, 120],
    chestGoldBonusPercentByLevel: [0, 20, 20, 20, 20],
    gemChancePercentByLevel: [0, 0, 10, 15, 20],
    goldEquipmentChancePercent: 5,
  },
  {
    id: PASSIVE_IDS.interest,
    name: '利息',
    effect: 'interest',
    interestPercentByLevel: [5, 6, 7, 8, 10],
    capByLevel: [300, 400, 500, 600, 800],
    intervalTicks: secondsToTicks(60),
    level5CapMultiplier: 2,
  },
  {
    id: PASSIVE_IDS.scavenger,
    name: '拾荒',
    effect: 'sale-bonus',
    saleBonusPercentByLevel: [10, 13, 16, 20, 25],
    pickupGoldPercent: 20,
  },
  {
    id: PASSIVE_IDS.momentum,
    name: '奔腾',
    effect: 'momentum',
    moveBonusBasisPointsByLevel: [100, 120, 150, 180, 200],
    maximumStacksByLevel: [5, 6, 6, 7, 8],
    level5ExtraDamagePercent: 20,
  },
  {
    id: PASSIVE_IDS.resonance,
    name: '共鸣',
    effect: 'summon-resonance',
    healByLevel: [10, 15, 20, 25, 30],
    aoeDamageByLevel: [0, 0, 30, 40, 50],
    aoeRadiusMm: 3_000,
    level5EffectMultiplierBasisPoints: 15_000,
  },
  {
    id: PASSIVE_IDS.adversity,
    name: '逆境',
    effect: 'controlled-recovery',
    damageReductionPercentByLevel: [15, 20, 25, 30, 35],
    healPercentPerSecond: 2,
  },
  {
    id: PASSIVE_IDS.stoneStatue,
    name: '石像',
    effect: 'out-of-combat-statue',
    outOfCombatTicksByLevel: [140, 140, 120, 120, 100],
    hpByLevel: [250, 300, 350, 400, 500],
    destructionDamage: 120,
    destructionRadiusMm: 3_000,
  },
  {
    id: PASSIVE_IDS.tenacity,
    name: '强韧',
    effect: 'kill-growth',
    hpPerKillByLevel: [2, 4, 6, 7, 10],
    milestoneKills: 50,
    milestoneHpBonus: 160,
  },
  {
    id: PASSIVE_IDS.bounty,
    name: '赏金',
    effect: 'bounty-mark',
    markDurationTicksByLevel: [1_800, 1_800, 2_400, 2_400, 2_400],
    rewardGoldByLevel: [400, 600, 800, 1_000, 1_500],
    level5Reveal: true,
  },
  {
    id: PASSIVE_IDS.bountyHunter,
    name: '悬赏',
    effect: 'bounty-hunter',
    cooldownReductionTicksByLevel: [200, 300, 400, 500, 600],
    speedBonusPercent: 40,
    speedDurationTicks: secondsToTicks(5),
  },
  {
    id: PASSIVE_IDS.stormWard,
    name: '避雷',
    effect: 'storm-ward',
    stormChanceReductionPercentByLevel: [20, 30, 40, 50, 60],
    stormSpeedBonusPercentByLevel: [0, 0, 10, 10, 15],
    level5BasicDamageBonusPercent: 10,
  },
  {
    id: PASSIVE_IDS.thunderstorm,
    name: '雷暴',
    effect: 'thunderstorm',
    chancePercentByLevel: [8, 10, 13, 16, 20],
    damageByLevel: [80, 90, 100, 110, 130],
    radiusMmByLevel: [3_000, 3_000, 4_000, 4_000, 5_000],
    level5StormChanceMultiplierBasisPoints: 15_000,
  },
] as const;

const PASSIVE_BY_ID = new Map<PassiveId, PassiveDefinition>(
  M1_PASSIVES.map((passive) => [passive.id, passive]),
);

export function getPassiveDefinition(id: PassiveId): PassiveDefinition {
  const passive = PASSIVE_BY_ID.get(id);
  if (!passive) {
    throw new Error(`passive ${id} is not available in the M1 content set`);
  }
  return passive;
}

export function passiveLevelValue<T>(values: readonly [T, T, T, T, T], level: PassiveLevel): T {
  const value = values[level - 1];
  if (value === undefined) {
    throw new Error(`invalid passive level: ${level}`);
  }
  return value;
}
