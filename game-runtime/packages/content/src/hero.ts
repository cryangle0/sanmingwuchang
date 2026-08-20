import { type ActiveId, activeId, type HeroId, heroId } from '@jwgb/core';
import { AUTHORITATIVE_HEROES } from './authoritative.generated';
import { createScriptedActiveDefinition, type ScriptedActiveDefinition } from './scripted-active';

export type FiveElement = 'metal' | 'wood' | 'water' | 'fire' | 'earth';
export type HeroArchetype = 'repeater' | 'assassin' | 'fighter';
export type MovementClass = 'ground' | 'flying';

export interface HeroStats {
  readonly attack: number;
  readonly maxHp: number;
  readonly moveSpeedMmPerSecond: number;
  readonly attackRangeMm: number;
  readonly attacksPerSecondMilli: number;
}

export interface BasicProjectileDefinition {
  readonly speedMmPerSecond: number;
  readonly collisionRadiusMm: number;
  readonly maxTravelDistanceMm: number;
}

interface ActiveAbilityBase {
  readonly id: ActiveId;
  readonly name: string;
  readonly cooldownTicks: number;
}

export type ActiveAbilityDefinition =
  | (ActiveAbilityBase & {
      readonly effect: 'wind-wall';
      readonly rangeMm: number;
      readonly lengthMm: number;
      readonly durationTicks: number;
      readonly knockbackMm: number;
      readonly blocksProjectileTag: 'blockable-by-wind-wall';
    })
  | (ActiveAbilityBase & {
      readonly effect: 'self-combat-buff';
      readonly durationTicks: number;
      readonly attackSpeedPercent: number;
      readonly incomingDamageBasisPoints: number;
      readonly passiveEffectMagnitudeBasisPoints: number;
    })
  | (ActiveAbilityBase & {
      readonly effect: 'mobile-channel-area-damage';
      readonly durationTicks: number;
      readonly pulseIntervalTicks: number;
      readonly radiusMm: number;
      readonly fixedDamage: number;
      readonly attackCoefficientBasisPoints: number;
      readonly selfMoveMultiplierBasisPoints: number;
    })
  | (ActiveAbilityBase & {
      readonly effect: 'self-shield';
      readonly durationTicks: number;
      readonly shieldAmount: number;
    })
  | (ActiveAbilityBase & {
      readonly effect: 'capsule-sweep-blink';
      readonly distanceMm: number;
      readonly maxContinuousSolidChordMm: number;
      readonly postCastLockTicks: number;
    })
  | (ActiveAbilityBase & {
      readonly effect: 'self-lock-invulnerability';
      readonly durationTicks: number;
      readonly canMove: false;
      readonly canBasic: false;
      readonly canCast: false;
    })
  | (ActiveAbilityBase & {
      readonly effect: 'target-damage-control';
      readonly rangeMm: number;
      readonly fixedDamage: number;
      readonly attackCoefficientBasisPoints: number;
      readonly hardControlTicks: number;
    })
  | (ActiveAbilityBase & {
      readonly effect: 'area-damage';
      readonly rangeMm: number;
      readonly radiusMm: number;
      readonly fixedDamage: number;
      readonly attackCoefficientBasisPoints: number;
    })
  | (ActiveAbilityBase & {
      readonly effect: 'target-random-damage';
      readonly rangeMm: number;
      readonly minimumDamage: number;
      readonly maximumDamage: number;
    })
  | (ActiveAbilityBase & {
      readonly effect: 'gold-grant';
      readonly goldAmount: number;
    })
  | ScriptedActiveDefinition
  | (ActiveAbilityBase & {
      readonly effect: 'definition-only';
    });

export interface HeroDefinition {
  readonly id: HeroId;
  readonly name: string;
  readonly archetype: HeroArchetype;
  readonly basicAttackKind: 'melee' | 'ranged-projectile';
  readonly basicProjectile: BasicProjectileDefinition | null;
  readonly movementClass: MovementClass;
  readonly element: FiveElement;
  readonly level1: HeroStats;
  readonly level15: HeroStats;
  readonly active: ActiveAbilityDefinition;
}

export const HERO_IDS = {
  ironFanPrincess: heroId('H001'),
  sunWukong: heroId('H009'),
  bullDemonKing: heroId('H018'),
} as const;

export const M0_HEROES: readonly HeroDefinition[] = [
  {
    id: HERO_IDS.ironFanPrincess,
    name: '铁扇公主',
    archetype: 'repeater',
    basicAttackKind: 'ranged-projectile',
    basicProjectile: {
      speedMmPerSecond: 55_000,
      collisionRadiusMm: 120,
      maxTravelDistanceMm: 20_000,
    },
    movementClass: 'ground',
    element: 'fire',
    level1: {
      attack: 41,
      maxHp: 575,
      moveSpeedMmPerSecond: 2_760,
      attackRangeMm: 20_000,
      attacksPerSecondMilli: 1_600,
    },
    level15: {
      attack: 110,
      maxHp: 1_650,
      moveSpeedMmPerSecond: 3_400,
      attackRangeMm: 20_000,
      attacksPerSecondMilli: 1_600,
    },
    active: {
      id: activeId('H001'),
      name: '芭蕉风墙',
      cooldownTicks: 18 * 20,
      effect: 'wind-wall',
      rangeMm: 15_000,
      lengthMm: 12_000,
      durationTicks: 3 * 20,
      knockbackMm: 5_000,
      blocksProjectileTag: 'blockable-by-wind-wall',
    },
  },
  {
    id: HERO_IDS.sunWukong,
    name: '孙悟空',
    archetype: 'assassin',
    basicAttackKind: 'melee',
    basicProjectile: null,
    movementClass: 'ground',
    element: 'metal',
    level1: {
      attack: 60,
      maxHp: 488,
      moveSpeedMmPerSecond: 3_010,
      attackRangeMm: 5_000,
      attacksPerSecondMilli: 1_400,
    },
    level15: {
      attack: 160,
      maxHp: 1_400,
      moveSpeedMmPerSecond: 3_700,
      attackRangeMm: 5_000,
      attacksPerSecondMilli: 1_400,
    },
    active: {
      id: activeId('H009'),
      name: '大闹天宫',
      cooldownTicks: 40 * 20,
      effect: 'self-combat-buff',
      durationTicks: 5 * 20,
      attackSpeedPercent: 80,
      incomingDamageBasisPoints: 12_000,
      passiveEffectMagnitudeBasisPoints: 20_000,
    },
  },
  {
    id: HERO_IDS.bullDemonKing,
    name: '牛魔王',
    archetype: 'fighter',
    basicAttackKind: 'melee',
    basicProjectile: null,
    movementClass: 'ground',
    element: 'fire',
    level1: {
      attack: 52,
      maxHp: 627,
      moveSpeedMmPerSecond: 2_760,
      attackRangeMm: 5_000,
      attacksPerSecondMilli: 1_100,
    },
    level15: {
      attack: 140,
      maxHp: 1_800,
      moveSpeedMmPerSecond: 3_400,
      attackRangeMm: 5_000,
      attacksPerSecondMilli: 1_100,
    },
    active: {
      id: activeId('H018'),
      name: '旋风',
      cooldownTicks: 38 * 20,
      effect: 'mobile-channel-area-damage',
      durationTicks: 3 * 20,
      pulseIntervalTicks: 1 * 20,
      radiusMm: 8_000,
      fixedDamage: 100,
      attackCoefficientBasisPoints: 5_000,
      selfMoveMultiplierBasisPoints: 5_000,
    },
  },
] as const;

const HERO_BY_ID = new Map<HeroId, HeroDefinition>(M0_HEROES.map((hero) => [hero.id, hero]));
const HERO_ACTIVE_BY_ID = new Map<ActiveId, ActiveAbilityDefinition>(
  M0_HEROES.map((hero) => [hero.active.id, hero.active]),
);

const FLYING_HERO_IDS = new Set(['H006', 'H007', 'H013']);
const RANGED_HERO_IDS = new Set(['H001', 'H002', 'H003', 'H004', 'H005', 'H006', 'H007', 'H008']);
const ELEMENT_BY_HERO_ID: Readonly<Record<string, FiveElement>> = {
  H001: 'fire',
  H002: 'fire',
  H003: 'wood',
  H004: 'earth',
  H005: 'wood',
  H006: 'water',
  H007: 'wood',
  H008: 'fire',
  H009: 'metal',
  H010: 'metal',
  H011: 'fire',
  H012: 'metal',
  H013: 'metal',
  H014: 'earth',
  H015: 'water',
  H016: 'water',
  H017: 'earth',
  H018: 'fire',
  H019: 'metal',
  H020: 'earth',
  H021: 'metal',
  H022: 'water',
  H023: 'wood',
  H024: 'fire',
  H025: 'wood',
  H026: 'metal',
  H027: 'earth',
  H028: 'wood',
  H029: 'earth',
  H030: 'wood',
  H031: 'earth',
  H032: 'metal',
  H033: 'water',
  H034: 'wood',
  H035: 'water',
  H036: 'water',
  H037: 'wood',
  H038: 'fire',
};

function derivedLevel1Stats(heroIdValue: string, _level15: HeroStats): HeroStats {
  if (heroIdValue <= 'H004') {
    return {
      attack: 41,
      maxHp: 575,
      moveSpeedMmPerSecond: 2_760,
      attackRangeMm: 20_000,
      attacksPerSecondMilli: 1_600,
    };
  }
  if (heroIdValue <= 'H008') {
    return {
      attack: 50,
      maxHp: 540,
      moveSpeedMmPerSecond: 2_600,
      attackRangeMm: 30_000,
      attacksPerSecondMilli: 900,
    };
  }
  if (heroIdValue <= 'H014') {
    return {
      attack: 60,
      maxHp: 488,
      moveSpeedMmPerSecond: 3_010,
      attackRangeMm: 5_000,
      attacksPerSecondMilli: 1_400,
    };
  }
  if (heroIdValue <= 'H028') {
    return {
      attack: 52,
      maxHp: 627,
      moveSpeedMmPerSecond: 2_760,
      attackRangeMm: 5_000,
      attacksPerSecondMilli: 1_100,
    };
  }
  return {
    attack: 37,
    maxHp: 766,
    moveSpeedMmPerSecond: 2_400,
    attackRangeMm: 5_000,
    attacksPerSecondMilli: 900,
  };
}

function addAuthoritativeHeroes(): void {
  for (const source of AUTHORITATIVE_HEROES) {
    const id = heroId(source.id);
    if (HERO_BY_ID.has(id)) {
      continue;
    }
    const active = createScriptedActiveDefinition(
      source.active.id,
      source.active.name,
      source.active.cooldownTicks,
    );
    const level15 = source.level15;
    const hero: HeroDefinition = {
      id,
      name: source.name,
      archetype:
        Number(source.id.slice(1)) <= 8
          ? 'repeater'
          : Number(source.id.slice(1)) <= 14
            ? 'assassin'
            : Number(source.id.slice(1)) <= 28
              ? 'fighter'
              : 'fighter',
      basicAttackKind: RANGED_HERO_IDS.has(source.id) ? 'ranged-projectile' : 'melee',
      basicProjectile: RANGED_HERO_IDS.has(source.id)
        ? {
            speedMmPerSecond: 55_000,
            collisionRadiusMm: 120,
            maxTravelDistanceMm: level15.attackRangeMm,
          }
        : null,
      movementClass: FLYING_HERO_IDS.has(source.id) ? 'flying' : 'ground',
      element: ELEMENT_BY_HERO_ID[source.id] ?? 'metal',
      level1: derivedLevel1Stats(source.id, level15),
      level15,
      active,
    };
    HERO_BY_ID.set(id, hero);
    HERO_ACTIVE_BY_ID.set(active.id, active);
  }
}

addAuthoritativeHeroes();

export function getHeroDefinition(id: HeroId): HeroDefinition {
  const hero = HERO_BY_ID.get(id);
  if (!hero) {
    throw new Error(`hero ${id} is not available in the M0 content set`);
  }
  return hero;
}

export function getHeroActiveDefinition(id: ActiveId): ActiveAbilityDefinition | undefined {
  return HERO_ACTIVE_BY_ID.get(id);
}
