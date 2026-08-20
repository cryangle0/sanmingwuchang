import {
  type EquipmentId,
  type EquipmentInstanceId,
  equipmentId,
  secondsToTicks,
} from '@jwgb/core';

export type EquipmentRarity = 'white' | 'blue' | 'purple' | 'gold';

/**
 * Runtime modifiers are deliberately closed over the authoritative content
 * set. A typo here must fail at compile time instead of becoming a silent
 * definition-only item.
 */
export type EquipmentModifierId =
  | 'none'
  | 'monster-damage-30'
  | 'basic-reduction-8'
  | 'skill-reduction-15'
  | 'displacement-resist-50'
  | 'out-of-combat-heal-8'
  | 'critical-damage-30'
  | 'backstab-reduction-50'
  | 'monster-kill-gold-30'
  | 'vision-20'
  | 'summon-attack-30'
  | 'storm-damage-reduction-30'
  | 'slow-reduction-50'
  | 'offensive-stealth-break-speed'
  | 'low-hp-target-damage-25'
  | 'basic-attack-burn'
  | 'hard-control-duration-500'
  | 'hero-kill-heal-30'
  | 'passive-heal-8'
  | 'active-cooldown-20'
  | 'summon-stat-60'
  | 'hand-capacity-plus-1'
  | 'reveal-stealth'
  | 'gamble-win-double'
  | 'hero-kill-active-reset'
  | 'basic-reflect-20'
  | 'stillness-stealth'
  | 'basic-lifesteal-10'
  | 'slow-immune'
  | 'same-target-basic-attack-speed'
  | 'hard-control-displacement-resist-70'
  | 'element-counter-double'
  | 'storm-damage-reduction-70'
  | 'out-of-combat-flight'
  | 'gold-income-50'
  | 'higher-hp-target-damage-25'
  | 'enemy-active-reveal'
  | 'kill-permanent-attack';

export type EquipmentStat =
  | {
      readonly stat: 'attack-flat';
      readonly amount: number;
    }
  | {
      readonly stat: 'max-hp-flat';
      readonly amount: number;
    }
  | {
      readonly stat: 'move-speed-flat';
      readonly amount: number;
    }
  | {
      readonly stat: 'attack-speed-percent';
      readonly amount: number;
    };

interface EquipmentDefinitionBase {
  readonly id: EquipmentId;
  readonly name: string;
  readonly rarity: EquipmentRarity;
  readonly price: number | null;
  readonly sellPrice: number;
  readonly stats: readonly EquipmentStat[];
}

export type EquipmentDefinition =
  | (EquipmentDefinitionBase & {
      readonly effect: 'none';
    })
  | (EquipmentDefinitionBase & {
      readonly effect: 'lethal-protection-consumable';
      readonly restoreHpPercent: 100;
      readonly invulnerableTicks: number;
    })
  | (EquipmentDefinitionBase & {
      readonly effect: 'basic-attack-range-flat';
      readonly rangeBonusMm: number;
    })
  | (EquipmentDefinitionBase & {
      readonly effect: 'rule-modifier';
      readonly modifierId: EquipmentModifierId;
    });

const WHITE_PRICE = 600;
const BLUE_PRICE = 2_000;
const PURPLE_PRICE = 6_000;
const GOLD_SELL_PRICE = 4_000;

function white(
  id: EquipmentId,
  name: string,
  stats: readonly EquipmentStat[],
): EquipmentDefinition {
  return {
    id,
    name,
    rarity: 'white',
    price: WHITE_PRICE,
    sellPrice: 240,
    stats,
    effect: 'none',
  };
}

function blue(
  id: EquipmentId,
  name: string,
  stats: readonly EquipmentStat[],
  modifierId: EquipmentModifierId,
): EquipmentDefinition {
  return {
    id,
    name,
    rarity: 'blue',
    price: BLUE_PRICE,
    sellPrice: 800,
    stats,
    effect: 'rule-modifier',
    modifierId,
  };
}

function purple(
  id: EquipmentId,
  name: string,
  stats: readonly EquipmentStat[],
  modifierId: EquipmentModifierId,
): EquipmentDefinition {
  return {
    id,
    name,
    rarity: 'purple',
    price: PURPLE_PRICE,
    sellPrice: 2_400,
    stats,
    effect: 'rule-modifier',
    modifierId,
  };
}

function gold(
  id: EquipmentId,
  name: string,
  stats: readonly EquipmentStat[],
  modifierId: EquipmentModifierId,
): EquipmentDefinition {
  return {
    id,
    name,
    rarity: 'gold',
    price: null,
    sellPrice: GOLD_SELL_PRICE,
    stats,
    effect: 'rule-modifier',
    modifierId,
  };
}

export const EQUIPMENT_IDS = {
  refinedIronStaff: equipmentId('W1'),
  coarseClothArmor: equipmentId('W2'),
  strawSandal: equipmentId('W3'),
  copperBracer: equipmentId('W4'),
  lightArmorVest: equipmentId('W5'),
  pilgrimBelt: equipmentId('W6'),
  wolfFang: equipmentId('B1'),
  tigerSkirt: equipmentId('B2'),
  waterPearl: equipmentId('B3'),
  windPearl: equipmentId('B4'),
  medicineGourd: equipmentId('B5'),
  whetstone: equipmentId('B6'),
  bronzeMirror: equipmentId('B7'),
  treasureBag: equipmentId('B8'),
  nightWatchLamp: equipmentId('B9'),
  beastWhip: equipmentId('B10'),
  lightningTablet: equipmentId('B11'),
  thousandMileBoots: equipmentId('B12'),
  cloudStepShoes: equipmentId('B13'),
  dormantBoots: equipmentId('B14'),
  sevenStarSword: equipmentId('P1'),
  fireTipSpear: equipmentId('P2'),
  goldRope: equipmentId('P3'),
  ginsengFruit: equipmentId('P4'),
  tenThousandYearLingzhi: equipmentId('P5'),
  windBag: equipmentId('P6'),
  soulBanner: equipmentId('P7'),
  clothBag: equipmentId('P8'),
  demonRevealingPearl: equipmentId('P9'),
  gamblingMedal: equipmentId('P10'),
  judgeBrush: equipmentId('P11'),
  thornArmor: equipmentId('P12'),
  nightCloak: equipmentId('P13'),
  bloodJadeGourd: equipmentId('P14'),
  galeBoots: equipmentId('P15'),
  comboShoes: equipmentId('P16'),
  starPickingBoots: equipmentId('P17'),
  bedrockBoots: equipmentId('P18'),
  nineTurnPill: equipmentId('G1'),
  primordialPearl: equipmentId('G2'),
  tribulationBell: equipmentId('G3'),
  cloudRide: equipmentId('G4'),
  treasureBasin: equipmentId('G5'),
  demonSubduingMace: equipmentId('G6'),
  keenEars: equipmentId('G7'),
  thunderChisel: equipmentId('G8'),
  soulDevouringRing: equipmentId('G9'),
  goldenCudgel: equipmentId('G10'),
} as const;

export const M1_EQUIPMENT: readonly EquipmentDefinition[] = [
  white(EQUIPMENT_IDS.refinedIronStaff, '精铁棍', [{ stat: 'attack-flat', amount: 15 }]),
  white(EQUIPMENT_IDS.coarseClothArmor, '粗布战衣', [{ stat: 'max-hp-flat', amount: 220 }]),
  white(EQUIPMENT_IDS.strawSandal, '草鞋', [{ stat: 'move-speed-flat', amount: 18 }]),
  white(EQUIPMENT_IDS.copperBracer, '铜护腕', [
    { stat: 'attack-flat', amount: 10 },
    { stat: 'max-hp-flat', amount: 100 },
  ]),
  white(EQUIPMENT_IDS.lightArmorVest, '轻甲背心', [
    { stat: 'max-hp-flat', amount: 110 },
    { stat: 'move-speed-flat', amount: 10 },
  ]),
  white(EQUIPMENT_IDS.pilgrimBelt, '行者束带', [
    { stat: 'attack-flat', amount: 8 },
    { stat: 'move-speed-flat', amount: 10 },
  ]),
  blue(
    EQUIPMENT_IDS.wolfFang,
    '狼牙棒',
    [{ stat: 'attack-flat', amount: 20 }],
    'monster-damage-30',
  ),
  blue(
    EQUIPMENT_IDS.tigerSkirt,
    '虎皮裙',
    [{ stat: 'max-hp-flat', amount: 280 }],
    'basic-reduction-8',
  ),
  blue(
    EQUIPMENT_IDS.waterPearl,
    '避水珠',
    [{ stat: 'max-hp-flat', amount: 200 }],
    'skill-reduction-15',
  ),
  blue(
    EQUIPMENT_IDS.windPearl,
    '定风珠',
    [{ stat: 'max-hp-flat', amount: 200 }],
    'displacement-resist-50',
  ),
  blue(
    EQUIPMENT_IDS.medicineGourd,
    '药葫芦',
    [{ stat: 'max-hp-flat', amount: 150 }],
    'out-of-combat-heal-8',
  ),
  blue(
    EQUIPMENT_IDS.whetstone,
    '磨刀石',
    [{ stat: 'attack-flat', amount: 12 }],
    'critical-damage-30',
  ),
  blue(
    EQUIPMENT_IDS.bronzeMirror,
    '铜镜',
    [{ stat: 'max-hp-flat', amount: 200 }],
    'backstab-reduction-50',
  ),
  blue(
    EQUIPMENT_IDS.treasureBag,
    '聚宝袋',
    [{ stat: 'max-hp-flat', amount: 120 }],
    'monster-kill-gold-30',
  ),
  blue(EQUIPMENT_IDS.nightWatchLamp, '夜巡灯', [{ stat: 'attack-flat', amount: 10 }], 'vision-20'),
  blue(
    EQUIPMENT_IDS.beastWhip,
    '驭兽鞭',
    [{ stat: 'attack-flat', amount: 12 }],
    'summon-attack-30',
  ),
  blue(
    EQUIPMENT_IDS.lightningTablet,
    '避雷木牌',
    [{ stat: 'max-hp-flat', amount: 200 }],
    'storm-damage-reduction-30',
  ),
  blue(
    EQUIPMENT_IDS.thousandMileBoots,
    '千里靴',
    [{ stat: 'move-speed-flat', amount: 26 }],
    'none',
  ),
  blue(
    EQUIPMENT_IDS.cloudStepShoes,
    '登云履',
    [{ stat: 'move-speed-flat', amount: 20 }],
    'slow-reduction-50',
  ),
  blue(
    EQUIPMENT_IDS.dormantBoots,
    '蛰伏靴',
    [{ stat: 'move-speed-flat', amount: 20 }],
    'offensive-stealth-break-speed',
  ),
  purple(
    EQUIPMENT_IDS.sevenStarSword,
    '七星剑',
    [{ stat: 'attack-flat', amount: 35 }],
    'low-hp-target-damage-25',
  ),
  purple(
    EQUIPMENT_IDS.fireTipSpear,
    '火尖枪',
    [{ stat: 'attack-flat', amount: 28 }],
    'basic-attack-burn',
  ),
  purple(
    EQUIPMENT_IDS.goldRope,
    '幌金绳',
    [{ stat: 'attack-flat', amount: 18 }],
    'hard-control-duration-500',
  ),
  purple(
    EQUIPMENT_IDS.ginsengFruit,
    '人参果',
    [{ stat: 'max-hp-flat', amount: 400 }],
    'hero-kill-heal-30',
  ),
  purple(
    EQUIPMENT_IDS.tenThousandYearLingzhi,
    '万年灵芝',
    [{ stat: 'max-hp-flat', amount: 500 }],
    'passive-heal-8',
  ),
  purple(
    EQUIPMENT_IDS.windBag,
    '风袋',
    [{ stat: 'max-hp-flat', amount: 200 }],
    'active-cooldown-20',
  ),
  purple(
    EQUIPMENT_IDS.soulBanner,
    '招魂幡',
    [{ stat: 'attack-flat', amount: 18 }],
    'summon-stat-60',
  ),
  purple(EQUIPMENT_IDS.clothBag, '布袋', [], 'hand-capacity-plus-1'),
  purple(
    EQUIPMENT_IDS.demonRevealingPearl,
    '照妖珠',
    [{ stat: 'max-hp-flat', amount: 250 }],
    'reveal-stealth',
  ),
  purple(
    EQUIPMENT_IDS.gamblingMedal,
    '赌坊金牌',
    [{ stat: 'max-hp-flat', amount: 150 }],
    'gamble-win-double',
  ),
  purple(
    EQUIPMENT_IDS.judgeBrush,
    '判官笔',
    [{ stat: 'attack-flat', amount: 25 }],
    'hero-kill-active-reset',
  ),
  purple(
    EQUIPMENT_IDS.thornArmor,
    '荆棘甲',
    [{ stat: 'max-hp-flat', amount: 400 }],
    'basic-reflect-20',
  ),
  purple(
    EQUIPMENT_IDS.nightCloak,
    '夜行斗篷',
    [{ stat: 'move-speed-flat', amount: 25 }],
    'stillness-stealth',
  ),
  purple(
    EQUIPMENT_IDS.bloodJadeGourd,
    '血玉葫芦',
    [{ stat: 'attack-flat', amount: 25 }],
    'basic-lifesteal-10',
  ),
  purple(
    EQUIPMENT_IDS.galeBoots,
    '疾风靴',
    [{ stat: 'move-speed-flat', amount: 30 }],
    'slow-immune',
  ),
  purple(
    EQUIPMENT_IDS.comboShoes,
    '连珠履',
    [{ stat: 'move-speed-flat', amount: 24 }],
    'same-target-basic-attack-speed',
  ),
  {
    id: EQUIPMENT_IDS.starPickingBoots,
    name: '摘星靴',
    rarity: 'purple',
    price: PURPLE_PRICE,
    sellPrice: 2_400,
    stats: [{ stat: 'move-speed-flat', amount: 22 }],
    effect: 'basic-attack-range-flat',
    rangeBonusMm: 700,
  },
  purple(
    EQUIPMENT_IDS.bedrockBoots,
    '磐岩履',
    [{ stat: 'move-speed-flat', amount: 24 }],
    'hard-control-displacement-resist-70',
  ),
  {
    id: EQUIPMENT_IDS.nineTurnPill,
    name: '九转金丹',
    rarity: 'gold',
    price: null,
    sellPrice: GOLD_SELL_PRICE,
    stats: [],
    effect: 'lethal-protection-consumable',
    restoreHpPercent: 100,
    invulnerableTicks: secondsToTicks(2),
  },
  gold(
    EQUIPMENT_IDS.primordialPearl,
    '混元珠',
    [{ stat: 'attack-flat', amount: 25 }],
    'element-counter-double',
  ),
  gold(
    EQUIPMENT_IDS.tribulationBell,
    '渡劫铃',
    [{ stat: 'max-hp-flat', amount: 350 }],
    'storm-damage-reduction-70',
  ),
  gold(
    EQUIPMENT_IDS.cloudRide,
    '筋斗云',
    [{ stat: 'move-speed-flat', amount: 40 }],
    'out-of-combat-flight',
  ),
  gold(EQUIPMENT_IDS.treasureBasin, '聚宝盆', [], 'gold-income-50'),
  gold(
    EQUIPMENT_IDS.demonSubduingMace,
    '降魔杵',
    [{ stat: 'attack-flat', amount: 60 }],
    'higher-hp-target-damage-25',
  ),
  gold(
    EQUIPMENT_IDS.keenEars,
    '顺风耳',
    [{ stat: 'max-hp-flat', amount: 300 }],
    'enemy-active-reveal',
  ),
  gold(
    EQUIPMENT_IDS.thunderChisel,
    '雷公凿',
    [
      { stat: 'attack-flat', amount: 20 },
      { stat: 'attack-speed-percent', amount: 40 },
    ],
    'none',
  ),
  gold(EQUIPMENT_IDS.soulDevouringRing, '噬魂戒', [], 'kill-permanent-attack'),
  {
    id: EQUIPMENT_IDS.goldenCudgel,
    name: '金箍棒',
    rarity: 'gold',
    price: null,
    sellPrice: GOLD_SELL_PRICE,
    stats: [{ stat: 'attack-flat', amount: 80 }],
    effect: 'basic-attack-range-flat',
    rangeBonusMm: 3_000,
  },
] as const;

const EQUIPMENT_BY_ID = new Map<EquipmentId, EquipmentDefinition>(
  M1_EQUIPMENT.map((equipment) => [equipment.id, equipment]),
);

export function getEquipmentDefinition(id: EquipmentId): EquipmentDefinition {
  const equipment = EQUIPMENT_BY_ID.get(id);
  if (!equipment) {
    throw new Error(`equipment ${id} is not available in the M1 content set`);
  }
  return equipment;
}

export interface EquipmentStatTotals {
  readonly attackFlat: number;
  readonly maxHpFlat: number;
  readonly moveSpeedFlat: number;
  readonly attackSpeedPercent: number;
  readonly basicAttackRangeFlatMm: number;
}

export function getEquipmentStatTotals(ids: readonly EquipmentId[]): EquipmentStatTotals {
  let attackFlat = 0;
  let maxHpFlat = 0;
  let moveSpeedFlat = 0;
  let attackSpeedPercent = 0;
  let basicAttackRangeFlatMm = 0;

  for (const id of ids) {
    const definition = getEquipmentDefinition(id);
    for (const stat of definition.stats) {
      if (stat.stat === 'attack-flat') {
        attackFlat += stat.amount;
      } else if (stat.stat === 'max-hp-flat') {
        maxHpFlat += stat.amount;
      } else if (stat.stat === 'move-speed-flat') {
        moveSpeedFlat += stat.amount;
      } else {
        attackSpeedPercent += stat.amount;
      }
    }
    if (definition.effect === 'basic-attack-range-flat') {
      basicAttackRangeFlatMm += definition.rangeBonusMm;
    }
  }

  return {
    attackFlat,
    maxHpFlat,
    moveSpeedFlat,
    attackSpeedPercent,
    basicAttackRangeFlatMm,
  };
}

export interface EquippedEquipmentInstance {
  readonly instanceId: EquipmentInstanceId;
  readonly equipmentId: EquipmentId;
  readonly acquiredAtTick: number;
  permanentAttackBonus: number;
}
