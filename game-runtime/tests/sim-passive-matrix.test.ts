import {
  EQUIPMENT_IDS,
  getEquipmentDefinition,
  HERO_IDS,
  PASSIVE_IDS,
  type PassiveLoadoutEntry,
} from '@jwgb/content';
import { createPlayerIntent, type EntityId, playerId, SeededRng, vec2Mm } from '@jwgb/core';
import { GameSimulation, type MutableSimulationState, type PlayerEntity } from '@jwgb/sim';
import { createBasicAttackSnapshot, resolveBasicHit } from '../packages/sim/src/systems/basic-hit';
import {
  advancePassiveEconomy,
  createTreasureHunterDrop,
  resolvePickpocket,
  scavengerPickupGold,
  scavengerSaleGold,
} from '../packages/sim/src/systems/passive-economy';
import { resolvePassiveKill } from '../packages/sim/src/systems/passive-kill';
import {
  applyBasicHitStatuses,
  basicLifestealPercent,
  effectiveAttackPower,
  getOrCreatePassiveTargetState,
  huntSpeedBonusPercent,
  resolveBasicAttackModifier,
  resolveBasicHitPassiveEffects,
  resolveIncomingBasicPassiveEffects,
  resolveIncomingDamageModifier,
  stormWardSpeedBonusPercent,
  targetDamageBonusBasisPoints,
} from '../packages/sim/src/systems/passive-runtime';
import { currentMoveSpeedMmPerSecond } from '../packages/sim/src/systems/player-speed';
import { resolveApocalypseStorm } from '../packages/sim/src/systems/storm';
import { trySpawnPassiveSummons } from '../packages/sim/src/systems/summon';
import { applySummonDamage } from '../packages/sim/src/systems/summon-health';

interface PassiveScenario {
  readonly simulation: GameSimulation;
  readonly state: MutableSimulationState;
  readonly ownerId: EntityId;
  readonly targetId: EntityId;
  readonly owner: PlayerEntity;
  readonly target: PlayerEntity;
}

function internalState(simulation: GameSimulation): MutableSimulationState {
  return (
    simulation as unknown as {
      readonly state: MutableSimulationState;
    }
  ).state;
}

function requiredPlayer(state: MutableSimulationState, targetEntityId: EntityId): PlayerEntity {
  const player = state.players.get(targetEntityId);
  if (!player) {
    throw new Error(`missing player ${targetEntityId}`);
  }
  return player;
}

function createScenario(
  ownerPassives: readonly PassiveLoadoutEntry[],
  options: {
    readonly rootSeed?: number;
    readonly targetPassives?: readonly PassiveLoadoutEntry[];
    readonly ownerPosition?: { readonly x: number; readonly z: number };
    readonly targetPosition?: { readonly x: number; readonly z: number };
  } = {},
): PassiveScenario {
  const simulation = new GameSimulation({ rootSeed: options.rootSeed ?? 0x6200 });
  const ownerId = simulation.addPlayer({
    playerId: playerId(`passive-owner-${ownerPassives[0]?.passiveId ?? 'none'}`),
    heroId: HERO_IDS.sunWukong,
    position: options.ownerPosition
      ? vec2Mm(options.ownerPosition.x, options.ownerPosition.z)
      : vec2Mm(0, 0),
    passives: ownerPassives,
  });
  const targetId = simulation.addPlayer({
    playerId: playerId(`passive-target-${ownerPassives[0]?.passiveId ?? 'none'}`),
    heroId: HERO_IDS.sunWukong,
    position: options.targetPosition
      ? vec2Mm(options.targetPosition.x, options.targetPosition.z)
      : vec2Mm(4_000, 0),
    passives: options.targetPassives ?? [],
  });
  const state = internalState(simulation);
  simulation.drainEvents();
  return {
    simulation,
    state,
    ownerId,
    targetId,
    owner: requiredPlayer(state, ownerId),
    target: requiredPlayer(state, targetId),
  };
}

function rootSeedForCombatRolls(predicate: (rolls: readonly number[]) => boolean): number {
  for (let rootSeed = 1; rootSeed < 100_000; rootSeed += 1) {
    const random = new SeededRng(rootSeed).fork('combat');
    const rolls = Array.from({ length: 8 }, () => random.nextInt(100));
    if (predicate(rolls)) {
      return rootSeed;
    }
  }
  throw new Error('no matching combat seed');
}

function rootSeedForStormRoll(predicate: (roll: number) => boolean): number {
  for (let rootSeed = 1; rootSeed < 100_000; rootSeed += 1) {
    const roll = new SeededRng(rootSeed).fork('storm').nextInt(100);
    if (predicate(roll)) {
      return rootSeed;
    }
  }
  throw new Error('no matching storm seed');
}

describe('B01-B14 outgoing passive behavior', () => {
  it('B01 applies its level-five primary slow and nearby area slow', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.frost, level: 5 }]);
    const nearbyId = scenario.simulation.addPlayer({
      playerId: playerId('b01-nearby'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(6_000, 0),
    });
    const nearby = requiredPlayer(scenario.state, nearbyId);

    applyBasicHitStatuses(
      scenario.state,
      [],
      scenario.owner,
      scenario.target,
      false,
      PASSIVE_IDS.frost,
    );

    expect(scenario.target).toMatchObject({ slowTicks: 60, slowBasisPoints: 2_000 });
    expect(nearby).toMatchObject({ slowTicks: 60, slowBasisPoints: 6_500 });
  });

  it('B02 applies silence immediately and adds its level-five cooldown penalty on expiry', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.paralysis, level: 5 }]);
    scenario.target.activeCooldownTicks = 100;
    applyBasicHitStatuses(
      scenario.state,
      [],
      scenario.owner,
      scenario.target,
      false,
      PASSIVE_IDS.paralysis,
    );
    expect(scenario.target).toMatchObject({
      silenceTicks: 30,
      silenceCooldownPenaltyTicks: 60,
    });

    scenario.simulation.step(30);
    expect(scenario.target).toMatchObject({
      silenceTicks: 0,
      silenceCooldownPenaltyTicks: 0,
      activeCooldownTicks: 130,
    });
  });

  it('B03 applies its level-five primary and area knockbacks', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.knockback, level: 5 }]);
    const nearbyId = scenario.simulation.addPlayer({
      playerId: playerId('b03-nearby'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(5_000, 0),
    });
    const nearby = requiredPlayer(scenario.state, nearbyId);

    applyBasicHitStatuses(
      scenario.state,
      [],
      scenario.owner,
      scenario.target,
      true,
      PASSIVE_IDS.knockback,
    );

    expect(scenario.target.position.x).toBe(9_000);
    expect(nearby.position.x).toBeLessThan(5_000);
  });

  it('B04 levels one to four allow criticals while level five prevents them during blind', () => {
    const rootSeed = rootSeedForCombatRolls(
      (rolls) => (rolls[0] ?? 0) >= 80 && (rolls[1] ?? 100) < 20,
    );
    const level4 = createScenario([{ passiveId: PASSIVE_IDS.critical, level: 5 }], { rootSeed });
    level4.owner.blindTicks = 50;
    level4.owner.blindMissPercent = 80;
    const level4Events: Parameters<typeof resolveBasicHit>[1] = [];
    resolveBasicHit(
      level4.state,
      level4Events,
      level4.owner,
      level4.target,
      createBasicAttackSnapshot(level4.owner, 10_000),
    );
    expect(level4Events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'critical-hit',
          passiveId: PASSIVE_IDS.critical,
        }),
      ]),
    );

    const level5 = createScenario([{ passiveId: PASSIVE_IDS.critical, level: 5 }], { rootSeed });
    level5.owner.blindTicks = 60;
    level5.owner.blindMissPercent = 80;
    level5.owner.blindPreventsCritical = true;
    const level5Events: Parameters<typeof resolveBasicHit>[1] = [];
    resolveBasicHit(
      level5.state,
      level5Events,
      level5.owner,
      level5.target,
      createBasicAttackSnapshot(level5.owner, 10_000),
    );
    expect(level5Events.some((event) => event.type === 'critical-hit')).toBe(false);
  });

  it('B05 enforces its target cooldown and level-five area control', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.stun, level: 5 }]);
    const nearbyId = scenario.simulation.addPlayer({
      playerId: playerId('b05-nearby'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(6_000, 0),
    });
    const nearby = requiredPlayer(scenario.state, nearbyId);
    applyBasicHitStatuses(
      scenario.state,
      [],
      scenario.owner,
      scenario.target,
      false,
      PASSIVE_IDS.stun,
    );

    expect(scenario.target.hardControlTicks).toBe(16);
    expect(nearby.hardControlTicks).toBe(6);
    expect(
      getOrCreatePassiveTargetState(scenario.state, scenario.ownerId, scenario.targetId)
        .stunCooldownTicks,
    ).toBe(40);
  });

  it('B06 level-five critical damage and shield bypass remain covered by the combat contract', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.critical, level: 5 }]);
    const events: Parameters<typeof resolveBasicHit>[1] = [];
    resolveBasicHit(scenario.state, events, scenario.owner, scenario.target, {
      ...createBasicAttackSnapshot(scenario.owner, 10_000),
      forcedCritical: true,
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'critical-hit',
          passiveId: PASSIVE_IDS.critical,
          criticalDamagePercent: 230,
          shieldBypassPercent: 30,
        }),
      ]),
    );
  });

  it('B07 level five splashes sixty percent damage onto the main and nearby targets', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.splash, level: 5 }]);
    const nearbyId = scenario.simulation.addPlayer({
      playerId: playerId('b07-nearby'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(6_000, 0),
    });
    const targetHp = scenario.target.hp;
    const nearby = requiredPlayer(scenario.state, nearbyId);
    const nearbyHp = nearby.hp;
    resolveBasicHit(scenario.state, [], scenario.owner, scenario.target, {
      ...createBasicAttackSnapshot(scenario.owner, 10_000),
      forcedPassiveId: PASSIVE_IDS.splash,
    });

    expect(targetHp - scenario.target.hp).toBeGreaterThan(scenario.owner.attackPower);
    expect(nearby.hp).toBeLessThan(nearbyHp);
  });

  it('B08 detonates at four level-five stacks and spreads two stacks nearby', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.burn, level: 5 }]);
    const nearbyId = scenario.simulation.addPlayer({
      playerId: playerId('b08-nearby'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(6_000, 0),
    });
    scenario.target.hp = Math.trunc(scenario.target.maxHp / 2);
    const first = resolveBasicHitPassiveEffects(
      scenario.state,
      [],
      scenario.owner,
      scenario.target,
      PASSIVE_IDS.burn,
    );
    const second = resolveBasicHitPassiveEffects(
      scenario.state,
      [],
      scenario.owner,
      scenario.target,
      PASSIVE_IDS.burn,
    );

    expect(first.burnDetonationDamage).toBe(0);
    expect(second.burnDetonationDamage).toBe(
      Math.trunc(((scenario.target.maxHp - scenario.target.hp) * 15) / 100),
    );
    expect(
      getOrCreatePassiveTargetState(scenario.state, scenario.ownerId, nearbyId).burnStacks,
    ).toBe(2);
  });

  it('B09 caps at five stacks and applies the level-five full-stack DoT multiplier', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.poison, level: 5 }]);
    for (let index = 0; index < 3; index += 1) {
      resolveBasicHitPassiveEffects(
        scenario.state,
        [],
        scenario.owner,
        scenario.target,
        PASSIVE_IDS.poison,
      );
    }
    const targetState = getOrCreatePassiveTargetState(
      scenario.state,
      scenario.ownerId,
      scenario.targetId,
    );
    const hpBefore = scenario.target.hp;
    expect(targetState.poisonStacks).toBe(5);
    scenario.simulation.step(20);
    expect(hpBefore - scenario.target.hp).toBe(60);
  });

  it('B10 adds fifty-percent execute damage and heals ten percent on an eligible kill', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.execute, level: 5 }]);
    scenario.target.hp = Math.trunc((scenario.target.maxHp * 29) / 100);
    scenario.owner.hp -= 200;
    expect(targetDamageBonusBasisPoints(scenario.owner, scenario.target)).toBe(15_000);
    const hpBefore = scenario.owner.hp;
    resolvePassiveKill(scenario.state, [], {
      sourceEntityId: scenario.ownerId,
      victimEntityId: scenario.targetId,
      victimKind: 'hero',
      victimHpBefore: scenario.target.hp,
      victimMaxHp: scenario.target.maxHp,
      victimPlayer: scenario.target,
    });
    expect(scenario.owner.hp - hpBefore).toBe(Math.trunc(scenario.owner.maxHp / 10));
  });

  it('B11 produces one to three independent extra hits at level five', () => {
    const rootSeed = rootSeedForCombatRolls((rolls) => (rolls[0] ?? 100) < 20);
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.combo, level: 5 }], { rootSeed });
    const effects = resolveBasicHitPassiveEffects(
      scenario.state,
      [],
      scenario.owner,
      scenario.target,
    );
    expect(effects.comboExtraHits).toBeGreaterThanOrEqual(1);
    expect(effects.comboExtraHits).toBeLessThanOrEqual(3);
  });

  it.each([
    {
      passiveId: PASSIVE_IDS.wolfSpirit,
      kind: 'wolf-spirit',
      hp: 350,
      attackPower: 40,
      expiresAtTick: 300,
    },
    {
      passiveId: PASSIVE_IDS.fireSpirit,
      kind: 'fire-spirit',
      hp: 1,
      attackPower: 0,
      expiresAtTick: 160,
    },
  ])('$passiveId creates its authored level-five summon', (entry) => {
    const scenario = createScenario([{ passiveId: entry.passiveId, level: 5 }]);
    trySpawnPassiveSummons(scenario.state, [], scenario.owner, entry.passiveId);
    expect([...scenario.state.summons.values()]).toEqual([
      expect.objectContaining({
        kind: entry.kind,
        hp: entry.hp,
        maxHp: entry.hp,
        attackPower: entry.attackPower,
        expiresAtTick: entry.expiresAtTick,
      }),
    ]);
  });

  it('B14 launches a fifty-meter cold-arrow projectile with level-five damage', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.coldArrow, level: 5 }], {
      targetPosition: vec2Mm(20_000, 0),
    });
    resolveBasicHit(scenario.state, [], scenario.owner, scenario.target, {
      ...createBasicAttackSnapshot(scenario.owner, 10_000),
      forcedPassiveId: PASSIVE_IDS.coldArrow,
    });
    expect([...scenario.state.projectiles.values()]).toEqual([
      expect.objectContaining({
        kind: 'cold-arrow',
        baseDamage: 150,
        remainingTravelMm: 50_000,
      }),
    ]);
  });
});

describe('B15-B25 defensive and survival passive behavior', () => {
  it('B15 level-five dodge avoids the basic hit and grants speed plus slow immunity', () => {
    const rootSeed = rootSeedForCombatRolls((rolls) => (rolls[0] ?? 100) < 25);
    const scenario = createScenario([], {
      rootSeed,
      targetPassives: [{ passiveId: PASSIVE_IDS.dodge, level: 5 }],
    });
    scenario.target.slowTicks = 60;
    scenario.target.slowBasisPoints = 2_000;
    const result = resolveIncomingDamageModifier(scenario.state, scenario.target, {
      sourceEntityId: scenario.ownerId,
      targetEntityId: scenario.targetId,
      amount: 100,
      cause: 'basic',
      form: 'basic',
    });
    expect(result).toEqual({ amount: 0, avoided: true });
    expect(scenario.target).toMatchObject({
      b15SpeedBoostTicks: 40,
      b15SpeedBonusPercent: 30,
    });
  });

  it('B16 subtracts twenty-five damage and never reduces a committed basic below one', () => {
    const scenario = createScenario([], {
      targetPassives: [{ passiveId: PASSIVE_IDS.ironSkin, level: 5 }],
    });
    const result = resolveIncomingDamageModifier(scenario.state, scenario.target, {
      sourceEntityId: scenario.ownerId,
      targetEntityId: scenario.targetId,
      amount: 20,
      cause: 'basic',
      form: 'basic',
    });
    expect(result).toEqual({ amount: 1, avoided: false });
  });

  it('B17 creates the level-five reactive shield before basic damage', () => {
    const rootSeed = rootSeedForCombatRolls((rolls) => (rolls[0] ?? 100) < 20);
    const scenario = createScenario([], {
      rootSeed,
      targetPassives: [{ passiveId: PASSIVE_IDS.reactiveShield, level: 5 }],
    });
    scenario.simulation.damage(scenario.targetId, 100, scenario.ownerId, 'basic');
    expect(scenario.target.shields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { kind: 'passive', passiveId: PASSIVE_IDS.reactiveShield },
          remainingAmount: 60,
        }),
      ]),
    );
  });

  it('B18 scales attack by missing-health steps and grants low-health basic lifesteal', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.bloodlust, level: 5 }]);
    scenario.owner.hp = Math.trunc(scenario.owner.maxHp / 5);
    expect(effectiveAttackPower(scenario.owner)).toBe(
      Math.trunc((scenario.owner.attackPower * 164) / 100),
    );
    expect(basicLifestealPercent(scenario.owner)).toBe(10);
  });

  it('B19 and B20 retain their tested lethal-protection priority and match ledger', () => {
    const scenario = createScenario(
      [
        { passiveId: PASSIVE_IDS.feignDeath, level: 5 },
        { passiveId: PASSIVE_IDS.passiveRevive, level: 5 },
      ],
      {
        rootSeed: rootSeedForCombatRolls((rolls) => (rolls[0] ?? 100) < 10),
      },
    );
    scenario.simulation.damage(scenario.ownerId, scenario.owner.maxHp * 2, scenario.targetId);
    expect(scenario.owner.lifeState).toBe('alive');
    expect(scenario.owner.b19RetriggerLockTicks).toBe(20);
    expect(scenario.state.consumedB20PlayerIds.has(scenario.owner.playerId)).toBe(false);
  });

  it('B21 starts healing after three seconds and arms the first-hit bonus', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.recovery, level: 5 }]);
    scenario.owner.hp -= 100;
    const hpBefore = scenario.owner.hp;
    scenario.simulation.step(60);
    expect(scenario.owner.hp).toBe(hpBefore + 15);
    expect(scenario.owner.b21FirstHitReady).toBe(true);
    expect(
      resolveBasicAttackModifier(scenario.state, scenario.owner, scenario.target),
    ).toMatchObject({
      damageBasisPoints: 13_000,
    });
    expect(scenario.owner.b21FirstHitReady).toBe(false);
  });

  it('B22 reflects twenty-five percent of post-reduction basic damage', () => {
    const scenario = createScenario([], {
      targetPassives: [{ passiveId: PASSIVE_IDS.reflect, level: 5 }],
    });
    const ownerHp = scenario.owner.hp;
    scenario.simulation.damage(scenario.targetId, 100, scenario.ownerId, 'basic');
    expect(scenario.owner.hp).toBeLessThanOrEqual(ownerHp - 25);
  });

  it('B23 level five counters with a guaranteed critical and a ten-tick target cooldown', () => {
    const rootSeed = rootSeedForCombatRolls((rolls) => (rolls[0] ?? 100) < 16);
    const scenario = createScenario([], {
      rootSeed,
      targetPassives: [{ passiveId: PASSIVE_IDS.counter, level: 5 }],
    });
    const eventsBefore = scenario.simulation.drainEvents();
    expect(eventsBefore).toHaveLength(0);
    scenario.simulation.damage(scenario.targetId, 20, scenario.ownerId, 'skill');
    expect(
      getOrCreatePassiveTargetState(scenario.state, scenario.targetId, scenario.ownerId)
        .counterCooldownTicks,
    ).toBe(10);
    expect(scenario.simulation.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'critical-hit',
          passiveId: PASSIVE_IDS.counter,
        }),
      ]),
    );
  });

  it('B24 heals twenty-five percent of skill damage and reflects half the absorbed amount', () => {
    const scenario = createScenario([], {
      targetPassives: [{ passiveId: PASSIVE_IDS.absorption, level: 5 }],
    });
    const ownerHp = scenario.owner.hp;
    const targetHp = scenario.target.hp;
    scenario.simulation.damage(scenario.targetId, 100, scenario.ownerId, 'skill');
    expect(scenario.target.hp).toBe(targetHp - 75);
    expect(scenario.owner.hp).toBe(ownerHp - 12);
  });

  it('B25 arms fifty-five-percent next-hit damage and forty-percent attack speed after a crit', () => {
    const scenario = createScenario([], {
      targetPassives: [{ passiveId: PASSIVE_IDS.rage, level: 5 }],
    });
    resolveIncomingBasicPassiveEffects(scenario.state, [], scenario.target, scenario.ownerId, true);
    expect(scenario.target).toMatchObject({
      b25NextBasicBonusPercent: 55,
      b25AttackSpeedBoostTicks: 40,
      b25AttackSpeedBonusPercent: 40,
    });
  });
});

describe('B26-B40 tactical, economic, and growth passive behavior', () => {
  it('B26 level five guarantees a critical and adds seventy percent from behind', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.backstab, level: 5 }], {
      ownerPosition: vec2Mm(-4_000, 0),
      targetPosition: vec2Mm(0, 0),
    });
    scenario.target.facing = vec2Mm(1_000, 0);
    expect(resolveBasicAttackModifier(scenario.state, scenario.owner, scenario.target)).toEqual({
      damageBasisPoints: 17_000,
      guaranteedCritical: true,
    });
  });

  it('B27 level five grants forty-percent speed and clears all slow on proc', () => {
    const rootSeed = rootSeedForCombatRolls((rolls) => (rolls[0] ?? 100) < 25);
    const scenario = createScenario([], {
      rootSeed,
      targetPassives: [{ passiveId: PASSIVE_IDS.sprint, level: 5 }],
    });
    scenario.target.slowTicks = 50;
    scenario.target.slowBasisPoints = 2_000;
    resolveIncomingBasicPassiveEffects(
      scenario.state,
      [],
      scenario.target,
      scenario.ownerId,
      false,
    );
    expect(scenario.target).toMatchObject({
      b27SpeedBoostTicks: 60,
      b27SpeedBonusPercent: 40,
      slowTicks: 0,
      slowBasisPoints: 10_000,
    });
  });

  it('B28 finds a low-health target in range and grants speed plus level-five damage', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.hunt, level: 5 }], {
      targetPosition: vec2Mm(70_000, 0),
    });
    scenario.target.hp = Math.trunc((scenario.target.maxHp * 29) / 100);
    expect(huntSpeedBonusPercent(scenario.state, scenario.owner)).toBe(25);
    expect(targetDamageBonusBasisPoints(scenario.owner, scenario.target)).toBe(12_000);
  });

  it('B29 grants the level-five first-hit bonus and private reveal after three seconds', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.ambush, level: 5 }]);
    scenario.state.tick = 60;
    const modifier = resolveBasicAttackModifier(scenario.state, scenario.owner, scenario.target);
    expect(modifier.damageBasisPoints).toBe(17_000);
    expect(
      getOrCreatePassiveTargetState(scenario.state, scenario.ownerId, scenario.targetId)
        .revealExpiresAtTick,
    ).toBe(120);
  });

  it('B30 leaves a level-five afterimage every second while moving', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.afterimage, level: 5 }], {
      targetPosition: vec2Mm(80_000, 0),
    });
    scenario.simulation.submitIntent(
      scenario.ownerId,
      createPlayerIntent({
        sequence: 1,
        moveX: 1_000,
        moveZ: 0,
      }),
    );
    scenario.simulation.step(21);
    expect([...scenario.state.afterimages.values()]).toEqual([
      expect.objectContaining({
        ownerEntityId: scenario.ownerId,
        slowPercent: 35,
        slowDurationTicks: 60,
        explosionDamage: 80,
        explosionRadiusMm: 3_000,
      }),
    ]);
  });

  it('B31 transfers eighty gold and heals ten percent of the stolen amount', () => {
    const rootSeed = rootSeedForCombatRolls((rolls) => (rolls[0] ?? 100) < 16);
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.pickpocket, level: 5 }], {
      rootSeed,
    });
    scenario.owner.hp -= 100;
    const hpBefore = scenario.owner.hp;
    const ownerGold = scenario.owner.gold;
    const targetGold = scenario.target.gold;
    resolvePickpocket(scenario.state, [], scenario.owner, scenario.target);
    expect(scenario.owner.gold).toBe(ownerGold + 80);
    expect(scenario.target.gold).toBe(targetGold - 80);
    expect(scenario.owner.hp).toBe(hpBefore + 8);
  });

  it('B32 grants one hundred fifty gold for monsters and two hundred fifty for heroes', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.greed, level: 5 }]);
    const goldBefore = scenario.owner.gold;
    resolvePassiveKill(scenario.state, [], {
      sourceEntityId: scenario.ownerId,
      victimEntityId: scenario.targetId,
      victimKind: 'monster',
      victimHpBefore: 1,
      victimMaxHp: 100,
    });
    resolvePassiveKill(scenario.state, [], {
      sourceEntityId: scenario.ownerId,
      victimEntityId: scenario.targetId,
      victimKind: 'hero',
      victimHpBefore: 1,
      victimMaxHp: scenario.target.maxHp,
      victimPlayer: scenario.target,
    });
    expect(scenario.owner.gold).toBe(goldBefore + 400);
  });

  it('B33 can create a level-five chest containing gold, a gem, and gold equipment', () => {
    const rootSeed = rootSeedForCombatRolls(
      (rolls) => (rolls[0] ?? 100) < 20 && (rolls[1] ?? 100) < 20 && (rolls[2] ?? 100) < 5,
    );
    const simulation = new GameSimulation({
      rootSeed,
      pve: { enabled: true, population: 'demo' },
    });
    const ownerId = simulation.addPlayer({
      playerId: playerId('b33-owner'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.treasureHunter, level: 5 }],
    });
    const state = internalState(simulation);
    const monster = [...state.monsters.values()][0];
    if (!monster) throw new Error('missing B33 monster');
    const drop = createTreasureHunterDrop(state, ownerId, monster);
    expect(drop).toMatchObject({
      gold: 120,
      gems: 1,
    });
    expect(drop?.equipmentId).not.toBeNull();
    if (drop?.equipmentId) {
      expect(getEquipmentDefinition(drop.equipmentId).rarity).toBe('gold');
    }
  });

  it('B34 pays capped level-five interest once per minute', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.interest, level: 5 }]);
    scenario.owner.gold = 20_000;
    scenario.state.tick = 1_200;
    advancePassiveEconomy(scenario.state, []);
    expect(scenario.owner.gold).toBe(21_600);
  });

  it('B35 applies its sale premium and immediate level-five pickup gold', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.scavenger, level: 5 }]);
    expect(scavengerSaleGold(scenario.owner, 800)).toBe(1_000);
    expect(scavengerPickupGold(scenario.owner, EQUIPMENT_IDS.wolfFang)).toBe(160);
  });

  it('B36 reaches eight movement stacks and adds speed-scaled level-five basic damage', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.momentum, level: 5 }]);
    scenario.owner.b36Stacks = 8;
    const speed = currentMoveSpeedMmPerSecond(scenario.state, scenario.owner);
    expect(speed).toBeGreaterThan(scenario.owner.moveSpeedMmPerSecond);
    const hpBefore = scenario.target.hp;
    resolveBasicHit(
      scenario.state,
      [],
      scenario.owner,
      scenario.target,
      createBasicAttackSnapshot(scenario.owner, 10_000),
    );
    expect(hpBefore - scenario.target.hp).toBeGreaterThan(scenario.owner.attackPower);
  });

  it('B37 heals and explodes only when a summon is destroyed by hostile damage', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.resonance, level: 5 }]);
    scenario.owner.hp -= 100;
    trySpawnPassiveSummons(scenario.state, [], scenario.owner, PASSIVE_IDS.wolfSpirit);
    const summon = [...scenario.state.summons.values()][0];
    expect(summon).toBeUndefined();

    scenario.owner.passives.push({ passiveId: PASSIVE_IDS.wolfSpirit, level: 1 });
    trySpawnPassiveSummons(scenario.state, [], scenario.owner, PASSIVE_IDS.wolfSpirit);
    const spawned = [...scenario.state.summons.values()][0];
    if (!spawned) throw new Error('missing B37 summon');
    applySummonDamage(scenario.state, [], scenario.targetId, spawned, spawned.hp);
    scenario.simulation.step();
    expect(scenario.owner.hp).toBe(scenario.owner.maxHp - 55);
  });

  it('B38 reduces damage by thirty-five percent while controlled and heals two percent per second', () => {
    const scenario = createScenario([], {
      targetPassives: [{ passiveId: PASSIVE_IDS.adversity, level: 5 }],
    });
    scenario.target.hardControlTicks = 40;
    scenario.target.hp -= 100;
    const result = resolveIncomingDamageModifier(scenario.state, scenario.target, {
      sourceEntityId: scenario.ownerId,
      targetEntityId: scenario.targetId,
      amount: 100,
      cause: 'active',
      form: 'skill',
    });
    expect(result).toEqual({ amount: 65, avoided: false });
    const hpBefore = scenario.target.hp;
    scenario.simulation.step();
    expect(scenario.target.hp - hpBefore).toBe(Math.trunc((scenario.target.maxHp * 2) / 100));
  });

  it('B39 creates a 500-health statue after five seconds out of combat', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.stoneStatue, level: 5 }], {
      targetPosition: vec2Mm(20_000, 0),
    });
    scenario.simulation.step(100);
    expect([...scenario.state.summons.values()]).toEqual([
      expect.objectContaining({
        kind: 'stone-statue',
        ownerEntityId: scenario.ownerId,
        hp: 500,
        maxHp: 500,
        attackPower: 0,
      }),
    ]);
  });

  it('B40 gains ten health per kill plus one hundred sixty at each fifty-kill milestone', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.tenacity, level: 5 }]);
    const maxHpBefore = scenario.owner.maxHp;
    for (let index = 0; index < 50; index += 1) {
      resolvePassiveKill(scenario.state, [], {
        sourceEntityId: scenario.ownerId,
        victimEntityId: scenario.targetId,
        victimKind: 'monster',
        victimHpBefore: 1,
        victimMaxHp: 1,
      });
    }
    expect(scenario.owner).toMatchObject({
      b40KillCount: 50,
      b40BonusMaxHp: 660,
      maxHp: maxHpBefore + 660,
    });
  });
});

describe('B41-B44 bounty and storm passive behavior', () => {
  it('B41 marks its killer for 1,500 gold and global reveal at level five', () => {
    const scenario = createScenario([], {
      targetPassives: [{ passiveId: PASSIVE_IDS.bounty, level: 5 }],
    });
    resolvePassiveKill(scenario.state, [], {
      sourceEntityId: scenario.ownerId,
      victimEntityId: scenario.targetId,
      victimKind: 'hero',
      victimHpBefore: 1,
      victimMaxHp: scenario.target.maxHp,
      victimPlayer: scenario.target,
    });
    expect(scenario.state.bountyMarks).toEqual([
      expect.objectContaining({
        sourceEntityId: scenario.targetId,
        targetEntityId: scenario.ownerId,
        rewardGold: 1_500,
        revealToAll: true,
        expiresAtTick: 2_400,
      }),
    ]);
  });

  it('B42 removes thirty seconds of active cooldown and grants five seconds of speed', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.bountyHunter, level: 5 }]);
    scenario.owner.activeCooldownTicks = 800;
    scenario.state.bountyMarks.push({
      sourceEntityId: scenario.targetId,
      targetEntityId: scenario.targetId,
      rewardGold: 400,
      rewardRecipientEntityId: null,
      revealToAll: true,
      expiresAtTick: 1_000,
    });
    resolvePassiveKill(scenario.state, [], {
      sourceEntityId: scenario.ownerId,
      victimEntityId: scenario.targetId,
      victimKind: 'hero',
      victimHpBefore: 1,
      victimMaxHp: scenario.target.maxHp,
      victimPlayer: scenario.target,
    });
    expect(scenario.owner).toMatchObject({
      activeCooldownTicks: 200,
      b42SpeedBoostTicks: 100,
      b42SpeedBonusPercent: 40,
    });
  });

  it('B43 reduces normal-storm strike probability and grants storm-zone speed', () => {
    const rootSeed = rootSeedForStormRoll((roll) => roll >= 20 && roll < 50);
    const protectedScenario = createScenario([{ passiveId: PASSIVE_IDS.stormWard, level: 5 }], {
      rootSeed,
      ownerPosition: vec2Mm(600_000, 0),
    });
    protectedScenario.state.tick = 60;
    const protectedHp = protectedScenario.owner.hp;
    resolveApocalypseStorm(protectedScenario.state, []);
    expect(protectedScenario.owner.hp).toBe(protectedHp);
    expect(stormWardSpeedBonusPercent(protectedScenario.state, protectedScenario.owner)).toBe(15);

    const unprotected = createScenario([], {
      rootSeed,
      ownerPosition: vec2Mm(600_000, 0),
    });
    unprotected.state.tick = 60;
    const unprotectedHp = unprotected.owner.hp;
    resolveApocalypseStorm(unprotected.state, []);
    expect(unprotected.owner.hp).toBeLessThan(unprotectedHp);
  });

  it('B44 creates a level-five 130-damage, five-meter lightning effect', () => {
    const scenario = createScenario([{ passiveId: PASSIVE_IDS.thunderstorm, level: 5 }]);
    const effects = resolveBasicHitPassiveEffects(
      scenario.state,
      [],
      scenario.owner,
      scenario.target,
      PASSIVE_IDS.thunderstorm,
    );
    expect(effects).toMatchObject({
      thunderstormTriggered: true,
      thunderstormDamage: 130,
      thunderstormRadiusMm: 5_000,
    });
  });
});
