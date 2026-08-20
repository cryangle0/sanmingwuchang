import { EQUIPMENT_IDS, getHeroDefinition, HERO_IDS, PASSIVE_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, SHOP_IDS, syncShops } from '@jwgb/sim';
import { describe, expect, it } from 'vitest';
import type { MutableSimulationState, PlayerEntity, ShopEntity } from '../packages/sim/src/types';

interface ServiceScenario {
  readonly simulation: GameSimulation;
  readonly state: MutableSimulationState;
  readonly player: PlayerEntity;
  readonly opponent: PlayerEntity;
  readonly shop: ShopEntity;
}

function createServiceScenario(
  shopId: string,
  openTick: number,
  options: {
    readonly equipmentIds?: PlayerEntity['equipment'][number]['equipmentId'][];
  } = {},
): ServiceScenario {
  const simulation = new GameSimulation({ rootSeed: 0x5e_71_ce });
  const playerEntityId = simulation.addPlayer({
    playerId: playerId(`service-${shopId}`),
    heroId: HERO_IDS.sunWukong,
    passives: [{ passiveId: PASSIVE_IDS.critical, level: 2 }],
    equipmentIds: options.equipmentIds ?? [],
    position: vec2Mm(0, 0),
  });
  const opponentEntityId = simulation.addPlayer({
    playerId: playerId(`service-${shopId}-opponent`),
    heroId: HERO_IDS.bullDemonKing,
    position: vec2Mm(50_000, 0),
  });
  const state = (simulation as unknown as { readonly state: MutableSimulationState }).state;
  state.tick = openTick;
  syncShops(state, []);
  const shop = state.shops.get(shopId);
  const player = state.players.get(playerEntityId);
  const opponent = state.players.get(opponentEntityId);
  if (!shop || !player || !opponent) {
    throw new Error(`failed to create ${shopId} service scenario`);
  }
  shop.position = vec2Mm(0, 0);
  player.position = vec2Mm(0, 0);
  player.gold = 5_000;
  simulation.drainEvents();
  return { simulation, state, player, opponent, shop };
}

describe('Taibai hero swap service', () => {
  it('allows movement inside the tether and cancels only after actually leaving 3 meters', () => {
    const scenario = createServiceScenario(SHOP_IDS.taibai, 60 * 20);
    const result = scenario.simulation.startHeroSwapResult(
      scenario.player.entityId,
      scenario.shop.shopId,
      scenario.shop.version,
      HERO_IDS.ironFanPrincess,
    );
    expect(result).toEqual({ accepted: true, code: 'accepted' });
    expect(scenario.player.taibaiChannelTicks).toBe(60);

    scenario.simulation.submitIntent(
      scenario.player.entityId,
      createPlayerIntent({ sequence: 1, moveX: 1_000, moveZ: 0 }),
    );
    scenario.simulation.step();
    expect(scenario.player.position.x).toBeGreaterThan(0);
    expect(scenario.player.taibaiChannelTicks).toBe(59);

    scenario.player.position = vec2Mm(2_900, 0);
    scenario.simulation.submitIntent(
      scenario.player.entityId,
      createPlayerIntent({ sequence: 2, moveX: 1_000, moveZ: 0 }),
    );
    scenario.simulation.step();

    expect(scenario.player.position.x).toBeGreaterThan(3_000);
    expect(scenario.player.taibaiChannelTicks).toBe(0);
    expect(scenario.player.taibaiTargetHeroId).toBeNull();
    expect(scenario.player.gold).toBe(5_000);
    expect(scenario.player.taibaiCooldownTicks).toBe(0);
    expect(scenario.simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'hero-swap-channel',
        entityId: scenario.player.entityId,
        phase: 'cancelled',
        reason: 'left-tether',
        goldSpent: 0,
      }),
    );
  });

  it('ignores world damage but cancels on positive player-owned damage without charging', () => {
    const scenario = createServiceScenario(SHOP_IDS.taibai, 60 * 20);
    expect(
      scenario.simulation.startHeroSwapResult(
        scenario.player.entityId,
        scenario.shop.shopId,
        scenario.shop.version,
        HERO_IDS.ironFanPrincess,
      ),
    ).toEqual({ accepted: true, code: 'accepted' });

    expect(scenario.simulation.damage(scenario.player.entityId, 10, null, 'storm')).toBe(10);
    expect(scenario.player.taibaiChannelTicks).toBe(60);

    expect(
      scenario.simulation.damage(scenario.player.entityId, 10, scenario.opponent.entityId, 'basic'),
    ).toBeGreaterThan(0);
    expect(scenario.player.taibaiChannelTicks).toBe(0);
    expect(scenario.player.gold).toBe(5_000);
    expect(scenario.player.taibaiCooldownTicks).toBe(0);
    expect(scenario.simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'hero-swap-channel',
        entityId: scenario.player.entityId,
        phase: 'cancelled',
        reason: 'damaged',
      }),
    );
  });

  it('does not advance a channel when same-tick transactions are submitted', () => {
    const scenario = createServiceScenario(SHOP_IDS.taibai, 60 * 20);
    expect(
      scenario.simulation.startHeroSwapResult(
        scenario.player.entityId,
        scenario.shop.shopId,
        scenario.shop.version,
        HERO_IDS.ironFanPrincess,
      ).accepted,
    ).toBe(true);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(
        scenario.simulation.gambleActiveResult(
          scenario.player.entityId,
          scenario.shop.shopId,
          scenario.shop.version,
        ),
      ).toEqual({ accepted: false, code: 'shop-unavailable' });
    }

    expect(scenario.player.taibaiChannelTicks).toBe(60);
    expect(scenario.player.taibaiCooldownTicks).toBe(0);
  });

  it('commits atomically while preserving build state and current health ratio', () => {
    const scenario = createServiceScenario(SHOP_IDS.taibai, 60 * 20, {
      equipmentIds: [EQUIPMENT_IDS.soulDevouringRing],
    });
    scenario.player.level = 7;
    scenario.player.experience = 1_234;
    scenario.player.gems = 3;
    scenario.player.b40BonusMaxHp = 75;
    scenario.player.activeBuffTicks = 100;
    const equipped = scenario.player.equipment[0];
    if (!equipped) {
      throw new Error('hero swap preservation equipment is missing');
    }
    equipped.permanentAttackBonus = 22;
    scenario.player.hp = Math.trunc((scenario.player.maxHp * 4) / 10);
    const originalMaxHp = scenario.player.maxHp;
    const originalHp = scenario.player.hp;
    const originalPassives = scenario.player.passives.map((entry) => ({ ...entry }));
    const originalEquipment = scenario.player.equipment.map((entry) => ({ ...entry }));
    const healthBasisPoints = Math.trunc((originalHp * 10_000) / originalMaxHp);

    expect(
      scenario.simulation.startHeroSwapResult(
        scenario.player.entityId,
        scenario.shop.shopId,
        scenario.shop.version,
        HERO_IDS.ironFanPrincess,
      ),
    ).toEqual({ accepted: true, code: 'accepted' });
    scenario.simulation.step(60);

    const expectedHero = getHeroDefinition(HERO_IDS.ironFanPrincess);
    expect(scenario.player.heroId).toBe(HERO_IDS.ironFanPrincess);
    expect(scenario.player.activeAbilityId).toBe(expectedHero.active.id);
    expect(scenario.player.activeCooldownTicks).toBe(0);
    expect(scenario.player.hp).toBe(
      Math.max(1, Math.trunc((scenario.player.maxHp * healthBasisPoints) / 10_000)),
    );
    expect(scenario.player.level).toBe(7);
    expect(scenario.player.experience).toBe(1_234);
    expect(scenario.player.gold).toBe(3_500);
    expect(scenario.player.gems).toBe(3);
    expect(scenario.player.passives).toEqual(originalPassives);
    expect(scenario.player.equipment).toEqual(originalEquipment);
    expect(scenario.player.b40BonusMaxHp).toBe(75);
    expect(scenario.player.activeBuffTicks).toBe(40);
    expect(scenario.player.taibaiCooldownTicks).toBe(120 * 20);
    expect(
      scenario.simulation.startHeroSwapResult(
        scenario.player.entityId,
        scenario.shop.shopId,
        scenario.shop.version,
        HERO_IDS.sunWukong,
      ),
    ).toEqual({ accepted: false, code: 'service-cooldown' });
    expect(scenario.simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'hero-swap-channel',
        entityId: scenario.player.entityId,
        phase: 'completed',
        goldSpent: 1_500,
      }),
    );
  });

  it('allows the same hero and preserves its naturally elapsed active cooldown', () => {
    const scenario = createServiceScenario(SHOP_IDS.taibai, 60 * 20);
    scenario.player.activeCooldownTicks = 200;

    expect(
      scenario.simulation.startHeroSwapResult(
        scenario.player.entityId,
        scenario.shop.shopId,
        scenario.shop.version,
        HERO_IDS.sunWukong,
      ),
    ).toEqual({ accepted: true, code: 'accepted' });
    scenario.simulation.step(60);

    expect(scenario.player.heroId).toBe(HERO_IDS.sunWukong);
    expect(scenario.player.activeCooldownTicks).toBe(140);
    expect(scenario.player.taibaiCooldownTicks).toBe(120 * 20);
  });
});

describe('shop consumables', () => {
  it('applies vision and reveal consumables immediately on atomic purchase', () => {
    const scenario = createServiceScenario(SHOP_IDS.landGodA, 30 * 20);
    const clairvoyance = scenario.shop.inventory.find(
      (listing) => listing.consumableId === 'clairvoyance-talisman',
    );
    const mirror = scenario.shop.inventory.find(
      (listing) => listing.consumableId === 'demon-revealing-mirror',
    );
    if (!clairvoyance || !mirror) {
      throw new Error('land god consumables are missing');
    }

    expect(
      scenario.simulation.purchaseShopListingResult(
        scenario.player.entityId,
        scenario.shop.shopId,
        clairvoyance.listingId,
        scenario.shop.version,
      ),
    ).toEqual({ accepted: true, code: 'accepted' });
    expect(scenario.player.consumableVisionTicks).toBe(10 * 20);

    expect(
      scenario.simulation.purchaseShopListingResult(
        scenario.player.entityId,
        scenario.shop.shopId,
        mirror.listingId,
        scenario.shop.version,
      ),
    ).toEqual({ accepted: true, code: 'accepted' });
    expect(scenario.player.consumableRevealTicks).toBe(3 * 20);
    expect(scenario.player.gold).toBe(4_200);
  });

  it('rejects an otherwise-near purchase through a static wall without changing stock or gold', () => {
    const scenario = createServiceScenario(SHOP_IDS.landGodA, 30 * 20);
    const listing = scenario.shop.inventory.find((candidate) => candidate.kind === 'equipment');
    if (!listing) {
      throw new Error('land god equipment listing is missing');
    }
    scenario.player.position = vec2Mm(0, 0);
    scenario.shop.position = vec2Mm(2_000, 0);
    scenario.state.staticSolids.push({
      solidId: 'shop-visibility-wall',
      minimumX: 900,
      maximumX: 1_100,
      minimumZ: -1_000,
      maximumZ: 1_000,
    });
    const originalGold = scenario.player.gold;
    const originalListingIds = scenario.shop.inventory.map((candidate) => candidate.listingId);

    expect(
      scenario.simulation.purchaseShopListingResult(
        scenario.player.entityId,
        scenario.shop.shopId,
        listing.listingId,
        scenario.shop.version,
        'equipped',
      ),
    ).toEqual({ accepted: false, code: 'shop-unavailable' });
    expect(scenario.shop.status).toBe('relocating');
    expect(scenario.player.gold).toBe(originalGold);
    expect(scenario.shop.inventory.map((candidate) => candidate.listingId)).toEqual(
      originalListingIds,
    );
  });
});
