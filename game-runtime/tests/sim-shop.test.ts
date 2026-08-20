import { EQUIPMENT_IDS, GENERIC_ACTIVE_IDS, getEquipmentDefinition, HERO_IDS } from '@jwgb/content';
import { createPlayerIntent, type EntityId, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, SHOP_IDS } from '@jwgb/sim';

function openLandGodShop(): {
  simulation: GameSimulation;
  player: EntityId;
  shop: NonNullable<ReturnType<GameSimulation['getSnapshot']>['shops'][number]>;
} {
  const simulation = new GameSimulation({ rootSeed: 301 });
  simulation.step(30 * 20);
  const shop = simulation
    .getSnapshot()
    .shops.find((candidate) => candidate.shopId === SHOP_IDS.landGodA);
  if (!shop) {
    throw new Error('land god shop did not open');
  }
  const player = simulation.addPlayer({
    playerId: playerId('shopper'),
    heroId: HERO_IDS.sunWukong,
    activeAbilityId: GENERIC_ACTIVE_IDS.fortune,
    position: vec2Mm(shop.position.x, shop.position.z),
  });
  return { simulation, player, shop };
}

describe('shop transactions', () => {
  it('opens the authoritative shop schedule and rotates the listing version', () => {
    const { simulation, shop } = openLandGodShop();
    expect(shop.version).toBe(1);
    const equipment = shop.inventory.filter(
      (listing) => listing.kind === 'equipment' && listing.equipmentId !== null,
    );
    const whiteIds = equipment
      .filter(
        (listing) =>
          listing.equipmentId !== null &&
          getEquipmentDefinition(listing.equipmentId).rarity === 'white',
      )
      .map((listing) => listing.equipmentId);
    expect(new Set(whiteIds)).toEqual(
      new Set([
        EQUIPMENT_IDS.refinedIronStaff,
        EQUIPMENT_IDS.coarseClothArmor,
        EQUIPMENT_IDS.copperBracer,
        EQUIPMENT_IDS.lightArmorVest,
        EQUIPMENT_IDS.pilgrimBelt,
      ]),
    );
    expect(
      equipment.filter(
        (listing) =>
          listing.equipmentId !== null &&
          getEquipmentDefinition(listing.equipmentId).rarity === 'blue',
      ),
    ).toHaveLength(3);
    expect(shop.inventory.filter((listing) => listing.kind === 'gem')).toHaveLength(3);
    expect(
      shop.inventory
        .filter((listing) => listing.kind === 'consumable')
        .map((listing) => listing.consumableId)
        .sort(),
    ).toEqual(['clairvoyance-talisman', 'demon-revealing-mirror']);

    simulation.step(3 * 60 * 20);

    const rotated = simulation
      .getSnapshot()
      .shops.find((candidate) => candidate.shopId === SHOP_IDS.landGodA);
    expect(rotated?.version).toBe(2);
    expect(
      simulation
        .drainEvents()
        .filter((event) => event.type === 'shop-opened' && event.shopId === SHOP_IDS.landGodA),
    ).toHaveLength(2);
  });

  it('buys an equipment listing atomically and sells the same instance for its source sell price', () => {
    const { simulation, player } = openLandGodShop();
    simulation.submitIntent(
      player,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
      }),
    );
    simulation.step();

    const currentShop = simulation
      .getSnapshot()
      .shops.find((candidate) => candidate.shopId === SHOP_IDS.landGodA);
    const listing = currentShop?.inventory.find((candidate) => candidate.kind === 'equipment');
    if (!currentShop || !listing) {
      throw new Error('shop equipment listing missing');
    }

    expect(
      simulation.purchaseShopListing(
        player,
        SHOP_IDS.landGodA,
        listing.listingId,
        currentShop.version,
        'equipped',
      ),
    ).toBe(true);
    const afterPurchase = simulation.getSnapshot().players[0];
    expect(afterPurchase?.gold).toBe(700);
    expect(afterPurchase?.equipment).toHaveLength(1);
    expect(afterPurchase?.equipment[0]?.equipmentId).toBe(listing.equipmentId);

    const instance = afterPurchase?.equipment[0];
    if (!instance) {
      throw new Error('purchased equipment instance missing');
    }
    expect(
      simulation.sellShopEquipment(
        player,
        SHOP_IDS.landGodA,
        instance.instanceId,
        currentShop.version,
      ),
    ).toBe(true);
    expect(simulation.getSnapshot().players[0]).toMatchObject({
      gold: 940,
      equipment: [],
    });
  });

  it('rejects stale, distant, and PVP-combat transactions without mutating the wallet', () => {
    const { simulation, player, shop } = openLandGodShop();
    const listing = shop.inventory.find((candidate) => candidate.kind === 'gem');
    if (!listing) {
      throw new Error('shop gem listing missing');
    }

    expect(
      simulation.purchaseShopListing(
        player,
        SHOP_IDS.landGodA,
        listing.listingId,
        shop.version - 1,
      ),
    ).toBe(false);
    expect(simulation.getSnapshot().players[0]?.gold).toBe(500);

    const farSimulation = new GameSimulation({ rootSeed: 302 });
    farSimulation.step(30 * 20);
    const farShop = farSimulation
      .getSnapshot()
      .shops.find((candidate) => candidate.shopId === SHOP_IDS.landGodA);
    if (!farShop) {
      throw new Error('far test shop did not open');
    }
    const farPlayer = farSimulation.addPlayer({
      playerId: playerId('far-shopper'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(farShop.position.x + 3_000, farShop.position.z),
    });
    const farListing = farShop.inventory.find((candidate) => candidate.kind === 'gem');
    if (!farListing) {
      throw new Error('far test listing missing');
    }
    expect(
      farSimulation.purchaseShopListing(
        farPlayer,
        SHOP_IDS.landGodA,
        farListing.listingId,
        farShop.version,
      ),
    ).toBe(false);

    const combatSimulation = new GameSimulation({ rootSeed: 303 });
    combatSimulation.step(30 * 20);
    const combatShop = combatSimulation
      .getSnapshot()
      .shops.find((candidate) => candidate.shopId === SHOP_IDS.landGodA);
    if (!combatShop) {
      throw new Error('combat test shop did not open');
    }
    const attacker = combatSimulation.addPlayer({
      playerId: playerId('combat-attacker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(combatShop.position.x, combatShop.position.z),
    });
    const combatTarget = combatSimulation.addPlayer({
      playerId: playerId('combat-target'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(combatShop.position.x + 1_000, combatShop.position.z),
    });
    const combatListing = combatShop.inventory.find((candidate) => candidate.kind === 'gem');
    if (!combatListing) {
      throw new Error('combat test listing missing');
    }
    combatSimulation.damage(combatTarget, 10, attacker);
    expect(
      combatSimulation.purchaseShopListing(
        combatTarget,
        SHOP_IDS.landGodA,
        combatListing.listingId,
        combatShop.version,
      ),
    ).toBe(false);
    expect(
      combatSimulation
        .getSnapshot()
        .players.find((candidate) => candidate.entityId === combatTarget)?.gold,
    ).toBe(500);
  });
});
