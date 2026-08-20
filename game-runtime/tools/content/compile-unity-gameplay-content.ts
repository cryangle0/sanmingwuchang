import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHORITATIVE_HEROES } from '../../packages/content/src/authoritative.generated';
import { M1_EQUIPMENT } from '../../packages/content/src/equipment';
import { M1_GENERIC_ACTIVES } from '../../packages/content/src/generic-active';
import { getHeroDefinition } from '../../packages/content/src/hero';
import { M1_PASSIVES } from '../../packages/content/src/passive';
import { heroId } from '../../packages/core/src/ids';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outputPath = resolve(
  repositoryRoot,
  'unity',
  'Packages',
  'com.jwgb.content',
  'Runtime',
  'Gameplay',
  'GeneratedGameplayCatalog.g.cs',
);

const activeEffectNames: Record<string, string> = {
  'wind-wall': 'WindWall',
  'self-combat-buff': 'SelfCombatBuff',
  'mobile-channel-area-damage': 'MobileChannelAreaDamage',
  'self-shield': 'SelfShield',
  'capsule-sweep-blink': 'CapsuleSweepBlink',
  'self-lock-invulnerability': 'SelfLockInvulnerability',
  'target-damage-control': 'TargetDamageControl',
  'area-damage': 'AreaDamage',
  'target-random-damage': 'TargetRandomDamage',
  'gold-grant': 'GoldGrant',
  scripted: 'Scripted',
  'definition-only': 'DefinitionOnly',
};

const passiveEffectNames: Record<string, string> = {
  'basic-slow': 'BasicSlow',
  'basic-silence': 'BasicSilence',
  'critical-knockback': 'CriticalKnockback',
  'basic-blind': 'BasicBlind',
  'basic-stun': 'BasicStun',
  'basic-critical': 'BasicCritical',
  'basic-splash': 'BasicSplash',
  'basic-burn-stack': 'BasicBurnStack',
  'basic-poison-stack': 'BasicPoisonStack',
  'low-hp-execute': 'LowHpExecute',
  'basic-combo': 'BasicCombo',
  'summon-wolf': 'SummonWolf',
  'summon-fire-spirit': 'SummonFireSpirit',
  'cold-arrow': 'ColdArrow',
  'basic-dodge': 'BasicDodge',
  'basic-reduction': 'BasicReduction',
  'incoming-basic-shield': 'IncomingBasicShield',
  'low-hp-offense': 'LowHpOffense',
  'lethal-proc': 'LethalProc',
  'once-per-match-revive': 'OncePerMatchRevive',
  'out-of-combat-recovery': 'OutOfCombatRecovery',
  'basic-reflect': 'BasicReflect',
  'basic-counter': 'BasicCounter',
  'skill-absorption': 'SkillAbsorption',
  'critical-rage': 'CriticalRage',
  backstab: 'Backstab',
  'hit-speed-boost': 'HitSpeedBoost',
  'low-hp-hunt': 'LowHpHunt',
  ambush: 'Ambush',
  afterimage: 'Afterimage',
  pickpocket: 'Pickpocket',
  'monster-kill-gold': 'MonsterKillGold',
  'treasure-hunter': 'TreasureHunter',
  interest: 'Interest',
  'sale-bonus': 'SaleBonus',
  momentum: 'Momentum',
  'summon-resonance': 'SummonResonance',
  'controlled-recovery': 'ControlledRecovery',
  'out-of-combat-statue': 'OutOfCombatStatue',
  'kill-growth': 'KillGrowth',
  'bounty-mark': 'BountyMark',
  'bounty-hunter': 'BountyHunter',
  'storm-ward': 'StormWard',
  thunderstorm: 'Thunderstorm',
  'definition-only': 'DefinitionOnly',
};

const equipmentEffectNames: Record<string, string> = {
  none: 'None',
  'lethal-protection-consumable': 'LethalProtectionConsumable',
  'basic-attack-range-flat': 'BasicAttackRangeFlat',
  'rule-modifier': 'RuleModifier',
};

const rarityNames: Record<string, string> = {
  white: 'White',
  blue: 'Blue',
  purple: 'Purple',
  gold: 'Gold',
};

const archetypeNames: Record<string, string> = {
  repeater: 'Repeater',
  assassin: 'Assassin',
  fighter: 'Fighter',
};

const movementClassNames: Record<string, string> = {
  ground: 'Ground',
  flying: 'Flying',
};

const elementNames: Record<string, string> = {
  metal: 'Metal',
  wood: 'Wood',
  water: 'Water',
  fire: 'Fire',
  earth: 'Earth',
};

const basicAttackKindNames: Record<string, string> = {
  melee: 'Melee',
  'ranged-projectile': 'RangedProjectile',
};

function csharpString(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  let result = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22) {
      result += '\\"';
    } else if (code === 0x5c) {
      result += '\\\\';
    } else if (code >= 0x20 && code <= 0x7e) {
      result += value[index];
    } else {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
    }
  }
  return `${result}"`;
}

function csharpInt(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`expected safe integer, got ${value}`);
  }
  return String(value);
}

function csharpBool(value: boolean): string {
  return value ? 'true' : 'false';
}

function pascalCase(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function enumValue(table: Readonly<Record<string, string>>, value: string, kind: string): string {
  const mapped = table[value];
  if (!mapped) {
    throw new Error(`unknown ${kind} value ${value}`);
  }
  return mapped;
}

function emitStats(stats: {
  attack: number;
  maxHp: number;
  moveSpeedMmPerSecond: number;
  attackRangeMm: number;
  attacksPerSecondMilli: number;
}): string {
  return `new HeroStats(${csharpInt(stats.attack)}, ${csharpInt(stats.maxHp)}, ${csharpInt(
    stats.moveSpeedMmPerSecond,
  )}, ${csharpInt(stats.attackRangeMm)}, ${csharpInt(stats.attacksPerSecondMilli)})`;
}

function emitActive(active: Record<string, unknown>, indent: string): string {
  const properties: string[] = [
    `Id = ${csharpString(String(active.id))}`,
    `Name = ${csharpString(String(active.name))}`,
    `CooldownTicks = ${csharpInt(Number(active.cooldownTicks))}`,
    `Effect = ActiveEffect.${enumValue(activeEffectNames, String(active.effect), 'active effect')}`,
  ];
  for (const [key, value] of Object.entries(active)) {
    if (key === 'id' || key === 'name' || key === 'cooldownTicks' || key === 'effect') {
      continue;
    }
    const property = pascalCase(key);
    if (typeof value === 'number') {
      properties.push(`${property} = ${csharpInt(value)}`);
    } else if (typeof value === 'boolean') {
      properties.push(`${property} = ${csharpBool(value)}`);
    } else if (typeof value === 'string') {
      properties.push(`${property} = ${csharpString(value)}`);
    } else {
      throw new Error(`unsupported active field ${key}`);
    }
  }
  return `new ActiveDefinition\n${indent}{ ${properties.join(`,\n${indent}  `)} }`;
}

function emitPassive(passive: Record<string, unknown>, indent: string): string {
  const properties: string[] = [
    `Id = ${csharpString(String(passive.id))}`,
    `Name = ${csharpString(String(passive.name))}`,
    `Effect = PassiveEffect.${enumValue(
      passiveEffectNames,
      String(passive.effect),
      'passive effect',
    )}`,
  ];
  for (const [key, value] of Object.entries(passive)) {
    if (key === 'id' || key === 'name' || key === 'effect') {
      continue;
    }
    const property = pascalCase(key);
    if (typeof value === 'number') {
      properties.push(`${property} = ${csharpInt(value)}`);
    } else if (typeof value === 'boolean') {
      properties.push(`${property} = ${csharpBool(value)}`);
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      properties.push(`${property} = new[] { ${(value as number[]).map(csharpInt).join(', ')} }`);
    } else {
      throw new Error(`unsupported passive field ${key}`);
    }
  }
  return `new PassiveDefinition\n${indent}{ ${properties.join(`,\n${indent}  `)} }`;
}

function emitEquipment(equipment: Record<string, unknown>, indent: string): string {
  const stats = equipment.stats as readonly { stat: string; amount: number }[];
  let attackFlat = 0;
  let maxHpFlat = 0;
  let moveSpeedFlat = 0;
  let attackSpeedPercent = 0;
  for (const stat of stats) {
    if (stat.stat === 'attack-flat') {
      attackFlat += stat.amount;
    } else if (stat.stat === 'max-hp-flat') {
      maxHpFlat += stat.amount;
    } else if (stat.stat === 'move-speed-flat') {
      moveSpeedFlat += stat.amount;
    } else if (stat.stat === 'attack-speed-percent') {
      attackSpeedPercent += stat.amount;
    } else {
      throw new Error(`unsupported equipment stat ${stat.stat}`);
    }
  }
  const properties: string[] = [
    `Id = ${csharpString(String(equipment.id))}`,
    `Name = ${csharpString(String(equipment.name))}`,
    `Rarity = EquipmentRarity.${enumValue(
      rarityNames,
      String(equipment.rarity),
      'equipment rarity',
    )}`,
    `Price = ${equipment.price === null ? 'null' : csharpInt(Number(equipment.price))}`,
    `SellPrice = ${csharpInt(Number(equipment.sellPrice))}`,
    `AttackFlat = ${csharpInt(attackFlat)}`,
    `MaxHpFlat = ${csharpInt(maxHpFlat)}`,
    `MoveSpeedFlat = ${csharpInt(moveSpeedFlat)}`,
    `AttackSpeedPercent = ${csharpInt(attackSpeedPercent)}`,
    `Effect = EquipmentEffect.${enumValue(
      equipmentEffectNames,
      String(equipment.effect),
      'equipment effect',
    )}`,
  ];
  if (equipment.modifierId !== undefined) {
    properties.push(`ModifierId = ${csharpString(String(equipment.modifierId))}`);
  }
  if (equipment.restoreHpPercent !== undefined) {
    properties.push(`RestoreHpPercent = ${csharpInt(Number(equipment.restoreHpPercent))}`);
  }
  if (equipment.invulnerableTicks !== undefined) {
    properties.push(`InvulnerableTicks = ${csharpInt(Number(equipment.invulnerableTicks))}`);
  }
  if (equipment.rangeBonusMm !== undefined) {
    properties.push(`RangeBonusMm = ${csharpInt(Number(equipment.rangeBonusMm))}`);
  }
  return `new EquipmentDefinition\n${indent}{ ${properties.join(`,\n${indent}  `)} }`;
}

const heroes = AUTHORITATIVE_HEROES.map((record) => getHeroDefinition(heroId(record.id))).map(
  (hero) => ({
    ...hero,
    active: { ...hero.active },
    level1: { ...hero.level1 },
    level15: { ...hero.level15 },
  }),
);
const heroActives = heroes.map((hero) => hero.active);
const actives = [...heroActives, ...M1_GENERIC_ACTIVES].filter(
  (active, index, all) => all.findIndex((candidate) => candidate.id === active.id) === index,
);

const heroRecords = heroes
  .map((hero) => {
    const projectile =
      hero.basicProjectile === null
        ? 'null'
        : `new BasicProjectileDefinition\n                    { SpeedMmPerSecond = ${csharpInt(
            hero.basicProjectile.speedMmPerSecond,
          )}, CollisionRadiusMm = ${csharpInt(
            hero.basicProjectile.collisionRadiusMm,
          )}, MaxTravelDistanceMm = ${csharpInt(hero.basicProjectile.maxTravelDistanceMm)} }`;
    return `            new HeroDefinition\n            {\n                Id = ${csharpString(
      String(hero.id),
    )},\n                Name = ${csharpString(String(hero.name))},\n                Archetype = HeroArchetype.${enumValue(
      archetypeNames,
      hero.archetype,
      'hero archetype',
    )},\n                BasicAttackKind = BasicAttackKind.${enumValue(
      basicAttackKindNames,
      hero.basicAttackKind,
      'basic attack kind',
    )},\n                BasicProjectile = ${projectile},\n                MovementClass = MovementClass.${enumValue(
      movementClassNames,
      hero.movementClass,
      'movement class',
    )},\n                Element = FiveElement.${enumValue(
      elementNames,
      hero.element,
      'element',
    )},\n                Level1 = ${emitStats(hero.level1)},\n                Level15 = ${emitStats(hero.level15)},\n                Active = ${emitActive(hero.active as unknown as Record<string, unknown>, '                ')}\n            }`;
  })
  .join(',\n');

const generated = `// Generated by tools/content/compile-unity-gameplay-content.ts. Do not edit.
using System;
using System.Collections.Generic;

namespace Jwgb.Content
{
    public static class GeneratedGameplayCatalog
    {
        public const int HeroCount = ${heroes.length};
        public const int HeroActiveCount = ${heroActives.length};
        public const int GenericActiveCount = ${M1_GENERIC_ACTIVES.length};
        public const int ActiveCount = ${actives.length};
        public const int PassiveCount = ${M1_PASSIVES.length};
        public const int EquipmentCount = ${M1_EQUIPMENT.length};

        public static readonly HeroDefinition[] Heroes =
        {
${heroRecords}
        };

        public static readonly ActiveDefinition[] Actives =
        {
${actives
  .map(
    (active) =>
      `            ${emitActive(active as unknown as Record<string, unknown>, '            ')}`,
  )
  .join(',\n')}
        };

        public static readonly PassiveDefinition[] Passives =
        {
${M1_PASSIVES.map(
  (passive) =>
    `            ${emitPassive(passive as unknown as Record<string, unknown>, '            ')}`,
).join(',\n')}
        };

        public static readonly EquipmentDefinition[] Equipment =
        {
${M1_EQUIPMENT.map(
  (equipment) =>
    `            ${emitEquipment(equipment as unknown as Record<string, unknown>, '            ')}`,
).join(',\n')}
        };

        private static readonly Dictionary<string, HeroDefinition> HeroesById =
            Index(Heroes);

        private static readonly Dictionary<string, ActiveDefinition> ActivesById =
            Index(Actives);

        private static readonly Dictionary<string, PassiveDefinition> PassivesById =
            Index(Passives);

        private static readonly Dictionary<string, EquipmentDefinition> EquipmentById =
            Index(Equipment);

        public static HeroDefinition GetHero(string id)
        {
            return Get(HeroesById, id, "hero");
        }

        public static ActiveDefinition GetActive(string id)
        {
            return Get(ActivesById, id, "active");
        }

        public static bool TryGetActive(
            string id,
            out ActiveDefinition definition)
        {
            if (id == null)
            {
                definition = null;
                return false;
            }
            return ActivesById.TryGetValue(id, out definition);
        }

        public static PassiveDefinition GetPassive(string id)
        {
            return Get(PassivesById, id, "passive");
        }

        public static EquipmentDefinition GetEquipment(string id)
        {
            return Get(EquipmentById, id, "equipment");
        }

        public static EquipmentStatTotals GetStatTotals(IReadOnlyList<string> ids)
        {
            var attackFlat = 0;
            var maxHpFlat = 0;
            var moveSpeedFlat = 0;
            var attackSpeedPercent = 0;
            var basicAttackRangeFlatMm = 0;
            for (var index = 0; index < ids.Count; index += 1)
            {
                var definition = GetEquipment(ids[index]);
                attackFlat = checked(attackFlat + definition.AttackFlat);
                maxHpFlat = checked(maxHpFlat + definition.MaxHpFlat);
                moveSpeedFlat = checked(moveSpeedFlat + definition.MoveSpeedFlat);
                attackSpeedPercent = checked(
                    attackSpeedPercent + definition.AttackSpeedPercent);
                basicAttackRangeFlatMm = checked(
                    basicAttackRangeFlatMm + definition.RangeBonusMm);
            }
            return new EquipmentStatTotals(
                attackFlat,
                maxHpFlat,
                moveSpeedFlat,
                attackSpeedPercent,
                basicAttackRangeFlatMm);
        }

        private static Dictionary<string, T> Index<T>(IReadOnlyList<T> values)
            where T : class
        {
            var result = new Dictionary<string, T>(StringComparer.Ordinal);
            for (var index = 0; index < values.Count; index += 1)
            {
                var value = values[index];
                var id = value is HeroDefinition hero
                    ? hero.Id
                    : value is ActiveDefinition active
                        ? active.Id
                        : value is PassiveDefinition passive
                            ? passive.Id
                            : ((EquipmentDefinition)(object)value).Id;
                result.Add(id, value);
            }
            return result;
        }

        private static T Get<T>(
            Dictionary<string, T> values,
            string id,
            string kind)
            where T : class
        {
            if (id == null || !values.TryGetValue(id, out var value))
            {
                throw new ArgumentException(
                    $"${'{'}kind} ${'{'}id ?? "<null>"} is not available in the complete content set.",
                    nameof(id));
            }
            return value;
        }
    }
}
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, generated, 'utf8');

console.log(
  JSON.stringify(
    {
      outputPath,
      heroes: heroes.length,
      heroActives: heroActives.length,
      genericActives: M1_GENERIC_ACTIVES.length,
      actives: actives.length,
      passives: M1_PASSIVES.length,
      equipment: M1_EQUIPMENT.length,
    },
    null,
    2,
  ),
);
