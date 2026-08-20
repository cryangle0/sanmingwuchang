import {
  EQUIPMENT_IDS,
  GENERIC_ACTIVE_IDS,
  getActiveDefinition,
  getEquipmentDefinition,
  getHeroDefinition,
  getPassiveDefinition,
  HERO_IDS,
  M0_HEROES,
  M1_EQUIPMENT,
  PASSIVE_IDS,
} from '@jwgb/content';
import { equipmentId } from '@jwgb/core';

describe('M0 content', () => {
  it('loads the three verified heroes with source stats', () => {
    expect(M0_HEROES).toHaveLength(3);
    expect(getHeroDefinition(HERO_IDS.ironFanPrincess).level1).toMatchObject({
      attack: 41,
      maxHp: 575,
      moveSpeedMmPerSecond: 2_760,
    });
    expect(getHeroDefinition(HERO_IDS.ironFanPrincess).basicProjectile).toEqual({
      speedMmPerSecond: 55_000,
      collisionRadiusMm: 120,
      maxTravelDistanceMm: 20_000,
    });
    expect(getHeroDefinition(HERO_IDS.sunWukong).level1).toMatchObject({
      attack: 60,
      maxHp: 488,
      moveSpeedMmPerSecond: 3_010,
    });
    expect(getHeroDefinition(HERO_IDS.bullDemonKing).level1).toMatchObject({
      attack: 52,
      maxHp: 627,
      moveSpeedMmPerSecond: 2_760,
    });
  });

  it('loads all 38 authoritative hero ids with a runtime active rule', () => {
    for (let index = 1; index <= 38; index += 1) {
      const id = `H${index.toString().padStart(3, '0')}`;
      const hero = getHeroDefinition(id as never);
      expect(hero.id).toBe(id);
      expect(hero.active.id).toBe(id);
    }
    expect(getHeroDefinition('H038' as never).active.effect).toBe('scripted');
  });

  it('loads the verified D22 universal shield definition', () => {
    expect(getActiveDefinition(GENERIC_ACTIVE_IDS.ironShirt)).toMatchObject({
      name: '铁布衫',
      cooldownTicks: 900,
      effect: 'self-shield',
      durationTicks: 100,
      shieldAmount: 600,
    });
  });

  it('loads the verified D6 blink and D21 ice coffin definitions', () => {
    expect(getActiveDefinition(GENERIC_ACTIVE_IDS.blink)).toMatchObject({
      name: '闪现',
      cooldownTicks: 300,
      effect: 'capsule-sweep-blink',
      distanceMm: 15_000,
      maxContinuousSolidChordMm: 1_500,
      postCastLockTicks: 0,
    });
    expect(getActiveDefinition(GENERIC_ACTIVE_IDS.iceCoffin)).toMatchObject({
      name: '冰棺',
      cooldownTicks: 1_500,
      effect: 'self-lock-invulnerability',
      durationTicks: 80,
      canMove: false,
      canBasic: false,
      canCast: false,
    });
  });

  it('loads the verified B06, B17, B19, and B20 passive definitions', () => {
    expect(getPassiveDefinition(PASSIVE_IDS.critical)).toMatchObject({
      name: '暴击',
      chancePercentByLevel: [8, 10, 13, 16, 20],
      criticalDamagePercentByLevel: [180, 190, 200, 210, 230],
      level5ShieldBypassPercent: 30,
    });
    expect(getPassiveDefinition(PASSIVE_IDS.reactiveShield)).toMatchObject({
      name: '护盾',
      chancePercentByLevel: [8, 10, 13, 16, 20],
      shieldAmountByLevel: [60, 80, 100, 130, 160],
      durationTicks: 200,
      level5BreakAoeDamage: 100,
      level5BreakAoeRadiusMm: 3_000,
    });
    expect(getPassiveDefinition(PASSIVE_IDS.feignDeath)).toMatchObject({
      name: '假死',
      chancePercentByLevel: [5, 6, 7, 8, 10],
      healMaxHpPercentByLevel: [10, 12, 15, 18, 20],
      postSuccessRetriggerLockTicks: 20,
    });
    expect(getPassiveDefinition(PASSIVE_IDS.passiveRevive)).toMatchObject({
      name: '复活',
      healMaxHpPercentByLevel: [25, 30, 35, 40, 50],
      level5BuffTicks: 100,
      level5DamageMultiplierBasisPoints: 13_000,
    });
  });

  it('loads all four verified M1 equipment definitions', () => {
    expect(getEquipmentDefinition(EQUIPMENT_IDS.refinedIronStaff)).toMatchObject({
      name: '精铁棍',
      stats: [{ stat: 'attack-flat', amount: 15 }],
      effect: 'none',
    });
    expect(getEquipmentDefinition(EQUIPMENT_IDS.coarseClothArmor)).toMatchObject({
      name: '粗布战衣',
      stats: [{ stat: 'max-hp-flat', amount: 220 }],
      effect: 'none',
    });
    expect(getEquipmentDefinition(EQUIPMENT_IDS.nineTurnPill)).toMatchObject({
      name: '九转金丹',
      restoreHpPercent: 100,
      invulnerableTicks: 40,
    });
    expect(getEquipmentDefinition(EQUIPMENT_IDS.goldenCudgel)).toMatchObject({
      name: '金箍棒',
      stats: [{ stat: 'attack-flat', amount: 80 }],
      effect: 'basic-attack-range-flat',
      rangeBonusMm: 3_000,
    });
  });

  it('accepts the complete 48-item equipment pool with source prices and base stats', () => {
    const ids = [
      'W1',
      'W2',
      'W3',
      'W4',
      'W5',
      'W6',
      'B1',
      'B2',
      'B3',
      'B4',
      'B5',
      'B6',
      'B7',
      'B8',
      'B9',
      'B10',
      'B11',
      'B12',
      'B13',
      'B14',
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
      'P7',
      'P8',
      'P9',
      'P10',
      'P11',
      'P12',
      'P13',
      'P14',
      'P15',
      'P16',
      'P17',
      'P18',
      'G1',
      'G2',
      'G3',
      'G4',
      'G5',
      'G6',
      'G7',
      'G8',
      'G9',
      'G10',
    ] as const;

    expect(M1_EQUIPMENT).toHaveLength(48);
    for (const id of ids) {
      const definition = getEquipmentDefinition(equipmentId(id));
      expect(definition.sellPrice).toBeGreaterThan(0);
      expect(definition.rarity).toMatch(/^(white|blue|purple|gold)$/);
    }
    expect(getEquipmentDefinition(equipmentId('W3'))).toMatchObject({
      stats: [{ stat: 'move-speed-flat', amount: 18 }],
      price: 600,
    });
    expect(getEquipmentDefinition(equipmentId('G8'))).toMatchObject({
      stats: [
        { stat: 'attack-flat', amount: 20 },
        { stat: 'attack-speed-percent', amount: 40 },
      ],
    });
  });
});
