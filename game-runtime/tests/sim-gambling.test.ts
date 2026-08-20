import {
  EQUIPMENT_IDS,
  getActiveDefinition,
  getEquipmentDefinition,
  HERO_IDS,
  PASSIVE_IDS,
  type PassiveLoadoutEntry,
} from '@jwgb/content';
import { playerId, SeededRng, vec2Mm } from '@jwgb/core';
import { GameSimulation, SHOP_IDS, syncShops } from '@jwgb/sim';
import { describe, expect, it } from 'vitest';
import type {
  GambleGoldMode,
  MutableSimulationState,
  PlayerEntity,
  ShopEntity,
} from '../packages/sim/src/types';

interface GambleScenario {
  readonly simulation: GameSimulation;
  readonly state: MutableSimulationState;
  readonly player: PlayerEntity;
  readonly shop: ShopEntity;
}

function findRootSeed(predicate: (rng: SeededRng) => boolean): number {
  for (let seed = 1; seed < 100_000; seed += 1) {
    const rng = new SeededRng(seed).fork('black-mountain');
    if (predicate(rng)) {
      return seed;
    }
  }
  throw new Error('unable to find deterministic black mountain test seed');
}

function seedForFirstRoll(minimumInclusive: number, maximumExclusive: number): number {
  return findRootSeed((rng) => {
    const roll = rng.nextInt(100);
    return roll >= minimumInclusive && roll < maximumExclusive;
  });
}

function createGambleScenario(
  rootSeed: number,
  options: {
    readonly equipmentIds?: PlayerEntity['equipment'][number]['equipmentId'][];
    readonly passives?: readonly PassiveLoadoutEntry[];
  } = {},
): GambleScenario {
  const simulation = new GameSimulation({ rootSeed });
  const playerEntityId = simulation.addPlayer({
    playerId: playerId(`gambler-${rootSeed}-${options.equipmentIds?.join('-') ?? 'none'}`),
    heroId: HERO_IDS.sunWukong,
    equipmentIds: options.equipmentIds ?? [],
    passives: options.passives ?? [],
    position: vec2Mm(0, 0),
  });
  simulation.addPlayer({
    playerId: playerId(`gambler-opponent-${rootSeed}`),
    heroId: HERO_IDS.bullDemonKing,
    position: vec2Mm(50_000, 0),
  });
  const state = (simulation as unknown as { readonly state: MutableSimulationState }).state;
  state.tick = 75 * 20;
  syncShops(state, []);
  const shop = state.shops.get(SHOP_IDS.heishan);
  const player = state.players.get(playerEntityId);
  if (!shop || !player) {
    throw new Error('failed to create black mountain scenario');
  }
  shop.position = vec2Mm(0, 0);
  player.position = vec2Mm(0, 0);
  player.gold = 10_000;
  simulation.drainEvents();
  return { simulation, state, player, shop };
}

function gambleGold(scenario: GambleScenario, mode: GambleGoldMode, wagerGold: number) {
  return scenario.simulation.gambleGoldResult(
    scenario.player.entityId,
    scenario.shop.shopId,
    scenario.shop.version,
    wagerGold,
    mode,
  );
}

describe('Black Mountain gambling', () => {
  it('doubles only the big-win band when P10 is worn', () => {
    const rootSeed = seedForFirstRoll(15, 30);
    const passives: readonly PassiveLoadoutEntry[] = [
      { passiveId: PASSIVE_IDS.critical, level: 2 },
    ];
    const base = createGambleScenario(rootSeed, { passives });
    const medal = createGambleScenario(rootSeed, {
      passives,
      equipmentIds: [EQUIPMENT_IDS.gamblingMedal],
    });

    expect(
      base.simulation.gamblePassiveResult(
        base.player.entityId,
        base.shop.shopId,
        base.shop.version,
        PASSIVE_IDS.critical,
      ),
    ).toEqual({ accepted: true, code: 'accepted', outcome: 'flat' });
    expect(
      medal.simulation.gamblePassiveResult(
        medal.player.entityId,
        medal.shop.shopId,
        medal.shop.version,
        PASSIVE_IDS.critical,
      ),
    ).toEqual({ accepted: true, code: 'accepted', outcome: 'big-win' });

    expect(base.player.passives).toHaveLength(1);
    expect(base.player.passives[0]?.level).toBe(2);
    expect(medal.player.passives).toHaveLength(1);
    expect(medal.player.passives[0]?.level).toBe(3);
  });

  it('limits accepted gambles to three and starts every active result on full cooldown', () => {
    const scenario = createGambleScenario(0x6a_6d_b1);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        scenario.simulation.gambleActiveResult(
          scenario.player.entityId,
          scenario.shop.shopId,
          scenario.shop.version,
        ).accepted,
      ).toBe(true);
      expect(scenario.player.activeCooldownTicks).toBe(
        getActiveDefinition(scenario.player.activeAbilityId).cooldownTicks,
      );
    }
    const rngBeforeRejectedAttempt = scenario.state.random.blackMountain.snapshot();
    expect(
      scenario.simulation.gambleActiveResult(
        scenario.player.entityId,
        scenario.shop.shopId,
        scenario.shop.version,
      ),
    ).toEqual({ accepted: false, code: 'gamble-limit' });
    expect(scenario.player.heishanGambleCount).toBe(3);
    expect(scenario.state.random.blackMountain.snapshot()).toBe(rngBeforeRejectedAttempt);
  });

  it('upgrades a purple equipment big win through the complete G1-G9 pool', () => {
    const rootSeed = findRootSeed((rng) => {
      return rng.nextInt(100) < 15 && rng.nextInt(9) === 0;
    });
    const scenario = createGambleScenario(rootSeed, {
      equipmentIds: [EQUIPMENT_IDS.sevenStarSword],
    });
    const input = scenario.player.equipment[0];
    if (!input) {
      throw new Error('purple equipment gamble input is missing');
    }

    expect(
      scenario.simulation.gambleEquipmentResult(
        scenario.player.entityId,
        scenario.shop.shopId,
        scenario.shop.version,
        input.instanceId,
      ),
    ).toEqual({ accepted: true, code: 'accepted', outcome: 'big-win' });
    expect(scenario.player.equipment[0]?.equipmentId).toBe(EQUIPMENT_IDS.nineTurnPill);
  });

  it('rejects gold equipment and wall-blocked service attempts without consuming RNG', () => {
    const goldInput = createGambleScenario(0x6a_6d_b2, {
      equipmentIds: [EQUIPMENT_IDS.nineTurnPill],
    });
    const instance = goldInput.player.equipment[0];
    if (!instance) {
      throw new Error('gold equipment gamble input is missing');
    }
    const rngBeforeGoldInput = goldInput.state.random.blackMountain.snapshot();
    expect(
      goldInput.simulation.gambleEquipmentResult(
        goldInput.player.entityId,
        goldInput.shop.shopId,
        goldInput.shop.version,
        instance.instanceId,
      ),
    ).toEqual({ accepted: false, code: 'equipment-not-eligible' });
    expect(goldInput.player.heishanGambleCount).toBe(0);
    expect(goldInput.state.random.blackMountain.snapshot()).toBe(rngBeforeGoldInput);

    const wallBlocked = createGambleScenario(0x6a_6d_b3);
    wallBlocked.player.position = vec2Mm(0, 0);
    wallBlocked.shop.position = vec2Mm(2_000, 0);
    wallBlocked.state.staticSolids.push({
      solidId: 'black-mountain-wall',
      minimumX: 900,
      maximumX: 1_100,
      minimumZ: -1_000,
      maximumZ: 1_000,
    });
    const rngBeforeWall = wallBlocked.state.random.blackMountain.snapshot();
    expect(
      wallBlocked.simulation.gambleActiveResult(
        wallBlocked.player.entityId,
        wallBlocked.shop.shopId,
        wallBlocked.shop.version,
      ),
    ).toEqual({ accepted: false, code: 'shop-too-far' });
    expect(wallBlocked.player.heishanGambleCount).toBe(0);
    expect(wallBlocked.state.random.blackMountain.snapshot()).toBe(rngBeforeWall);
  });

  it.each([
    { label: 'big win', range: [0, 10], outcome: 'big-win', expectedGold: 11_000 },
    { label: 'flat', range: [10, 50], outcome: 'flat', expectedGold: 10_000 },
    { label: 'loss', range: [50, 100], outcome: 'loss', expectedGold: 9_500 },
  ] as const)('settles the double-gold $label branch exactly', ({
    range,
    outcome,
    expectedGold,
  }) => {
    const scenario = createGambleScenario(seedForFirstRoll(range[0], range[1]));

    expect(gambleGold(scenario, 'double', 1_000)).toEqual({
      accepted: true,
      code: 'accepted',
      outcome,
    });
    expect(scenario.player.gold).toBe(expectedGold);
    expect(scenario.simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'gamble-resolved',
        gambleKind: 'gold',
        goldMode: 'double',
        wagerGold: 1_000,
        outcome,
      }),
    );
  });

  it.each([
    { label: 'big win', range: [0, 10], outcome: 'big-win', expectedGold: 8_000 },
    { label: 'flat', range: [10, 50], outcome: 'flat', expectedGold: 10_000 },
    { label: 'loss', range: [50, 100], outcome: 'loss', expectedGold: 9_000 },
  ] as const)('settles the purple-equipment $label branch exactly', ({
    range,
    outcome,
    expectedGold,
  }) => {
    const scenario = createGambleScenario(seedForFirstRoll(range[0], range[1]));

    expect(gambleGold(scenario, 'purple', 2_000)).toEqual({
      accepted: true,
      code: 'accepted',
      outcome,
    });
    expect(scenario.player.gold).toBe(expectedGold);
    if (outcome === 'big-win') {
      expect(scenario.player.inventoryEquipment).toHaveLength(1);
      const equipmentId = scenario.player.inventoryEquipment[0]?.equipmentId;
      expect(equipmentId).toBeDefined();
      if (equipmentId) {
        expect(getEquipmentDefinition(equipmentId).rarity).toBe('purple');
      }
    } else {
      expect(scenario.player.inventoryEquipment).toEqual([]);
    }
  });

  it('rejects wagers outside the compiled mode contracts without spending attempts or RNG', () => {
    const scenario = createGambleScenario(0x6a_6d_b4);
    const rngBefore = scenario.state.random.blackMountain.snapshot();

    for (const wager of [100, 550, 5_100]) {
      expect(gambleGold(scenario, 'double', wager)).toEqual({
        accepted: false,
        code: 'invalid-wager',
      });
    }
    expect(gambleGold(scenario, 'purple', 1_999)).toEqual({
      accepted: false,
      code: 'invalid-wager',
    });
    expect(scenario.player.gold).toBe(10_000);
    expect(scenario.player.heishanGambleCount).toBe(0);
    expect(scenario.state.random.blackMountain.snapshot()).toBe(rngBefore);
  });
});
