import {
  EQUIPMENT_IDS,
  GENERIC_ACTIVE_IDS,
  getActiveDefinition,
  getEquipmentDefinition,
} from '@jwgb/content';
import {
  activeId,
  createPlayerIntent,
  entityId,
  equipmentInstanceId,
  heroId,
  vec2Mm,
} from '@jwgb/core';
import {
  createEquipmentInstance,
  type GameSimulation,
  type MutableSimulationState,
  SHOP_IDS,
} from '@jwgb/sim';
import type { InputController } from '../apps/web/src/input/input-controller';
import { activePresentationRange } from '../apps/web/src/render/combat-range-preview';
import type { LocalWorldScenario } from '../apps/web/src/runtime/local-scenario';
import { localWorldScenarioFromActive } from '../apps/web/src/runtime/local-scenario';
import { LocalWorldHost } from '../apps/web/src/runtime/local-world-host';
import { transactionResultText } from '../apps/web/src/ui/game-hud';

function simulationOf(host: LocalWorldHost): GameSimulation {
  return (host as unknown as { readonly simulation: GameSimulation }).simulation;
}

function stateOf(host: LocalWorldHost): MutableSimulationState {
  return (simulationOf(host) as unknown as { readonly state: MutableSimulationState }).state;
}

const idleInput = {
  sample(sequence: number) {
    return createPlayerIntent({ sequence, moveX: 0, moveZ: 0 });
  },
} as InputController;

function drainTransactions(host: LocalWorldHost) {
  return host.update(0, idleInput).transactionResults;
}

function addEquipmentDrop(
  state: MutableSimulationState,
  equipmentIdValue: (typeof EQUIPMENT_IDS)[keyof typeof EQUIPMENT_IDS],
  position = vec2Mm(0, 0),
) {
  const dropEntityId = entityId(state.nextEntityId);
  state.nextEntityId += 1;
  state.lootDrops.set(dropEntityId, {
    entityId: dropEntityId,
    position,
    gold: 0,
    experience: 0,
    gems: 0,
    equipmentId: equipmentIdValue,
    bookPassiveId: null,
    createdAtTick: state.tick,
    expiresAtTick: Number.MAX_SAFE_INTEGER,
    kind: 'equipment',
    activeId: null,
    equipmentInstanceId: null,
    acquiredAtTick: state.tick,
    permanentAttackBonus: 0,
    stormCoveredSinceTick: null,
  });
  return dropEntityId;
}

function addActiveDrop(state: MutableSimulationState, position: ReturnType<typeof vec2Mm>) {
  const dropEntityId = entityId(state.nextEntityId);
  state.nextEntityId += 1;
  state.lootDrops.set(dropEntityId, {
    entityId: dropEntityId,
    position,
    gold: 0,
    experience: 0,
    gems: 0,
    equipmentId: null,
    bookPassiveId: null,
    createdAtTick: state.tick,
    expiresAtTick: Number.MAX_SAFE_INTEGER,
    kind: 'active',
    activeId: GENERIC_ACTIVE_IDS.blink,
    equipmentInstanceId: null,
    acquiredAtTick: null,
    permanentAttackBonus: 0,
    stormCoveredSinceTick: null,
  });
  return dropEntityId;
}

describe('local host economy and replacement transactions', () => {
  it('buys equipment into equipped and hand slots, then rejects insufficient gold without mutation', () => {
    const host = new LocalWorldHost({
      id: 'M1',
      localPosition: vec2Mm(0, 0),
      staticSolids: [],
      botCount: 0,
    });
    const simulation = simulationOf(host);
    simulation.step(30 * 20);
    const shop = simulation
      .getSnapshot()
      .shops.find((candidate) => candidate.shopId === SHOP_IDS.landGodA);
    if (!shop) {
      throw new Error('land god shop did not open');
    }
    const listings = shop.inventory.filter(
      (listing) => listing.kind === 'equipment' && listing.equipmentId !== null,
    );
    const equippedListing = listings[0];
    const handListing = listings.find(
      (listing) => listing.equipmentId !== equippedListing?.equipmentId,
    );
    if (!equippedListing || !handListing) {
      throw new Error('two equipment listings are required');
    }
    const player = stateOf(host).players.get(host.localEntityId);
    if (!player) {
      throw new Error('local player missing');
    }
    player.position = vec2Mm(shop.position.x, shop.position.z);
    player.gold = 5_000;

    host.purchaseShopListing(shop.shopId, equippedListing.listingId, shop.version, 'equipped');
    expect(drainTransactions(host)).toEqual([
      expect.objectContaining({ operation: 'shop-purchase', accepted: true, code: 'accepted' }),
    ]);
    host.purchaseShopListing(shop.shopId, handListing.listingId, shop.version, 'inventory');
    expect(drainTransactions(host)).toEqual([
      expect.objectContaining({ operation: 'shop-purchase', accepted: true, code: 'accepted' }),
    ]);

    const afterPurchases = host
      .getSnapshot()
      .players.find((candidate) => candidate.entityId === host.localEntityId);
    expect(afterPurchases?.equipment.map((instance) => instance.equipmentId)).toContain(
      equippedListing.equipmentId,
    );
    expect(afterPurchases?.inventoryEquipment.map((instance) => instance.equipmentId)).toContain(
      handListing.equipmentId,
    );

    const currentShop = host
      .getSnapshot()
      .shops.find((candidate) => candidate.shopId === SHOP_IDS.landGodA);
    const unaffordableListing = currentShop?.inventory.find(
      (listing) => listing.kind === 'gem' && listing.price > 0,
    );
    if (!currentShop || !unaffordableListing) {
      throw new Error('remaining priced shop listing is required');
    }
    player.gold = 0;
    const walletBefore = player.gold;
    host.purchaseShopListing(
      currentShop.shopId,
      unaffordableListing.listingId,
      currentShop.version,
      'inventory',
    );
    const [rejected] = drainTransactions(host);
    expect(rejected).toMatchObject({
      operation: 'shop-purchase',
      accepted: false,
      code: 'insufficient-gold',
    });
    expect(player.gold).toBe(walletBefore);
    expect(rejected ? transactionResultText(rejected) : null).toBe('操作失败：金币不足');
  });

  it('replaces a full hand through LocalWorldHost and preserves the displaced instance as loot', () => {
    const host = new LocalWorldHost(localWorldScenarioFromActive('M1'));
    const state = stateOf(host);
    const player = state.players.get(host.localEntityId);
    if (!player) {
      throw new Error('local player missing');
    }
    const handItem = createEquipmentInstance(state, EQUIPMENT_IDS.windPearl);
    player.inventoryEquipment.push(handItem);
    const dropEntityId = addEquipmentDrop(state, EQUIPMENT_IDS.comboShoes, player.position);
    state.pendingEquipmentPickups.set(player.entityId, {
      playerEntityId: player.entityId,
      lootEntityId: dropEntityId,
      equipmentId: EQUIPMENT_IDS.comboShoes,
      equipmentInstanceId: null,
      requestedAtTick: state.tick,
    });

    host.pickupEquipmentLoot(dropEntityId, 'inventory', handItem.instanceId);
    expect(drainTransactions(host)).toEqual([
      expect.objectContaining({
        operation: 'equipment-loot-pickup',
        accepted: true,
        code: 'accepted',
      }),
    ]);
    const snapshot = host.getSnapshot();
    const updated = snapshot.players.find((candidate) => candidate.entityId === host.localEntityId);
    expect(updated?.inventoryEquipment.map((instance) => instance.equipmentId)).toEqual([
      EQUIPMENT_IDS.comboShoes,
    ]);
    expect(snapshot.lootDrops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          equipmentId: EQUIPMENT_IDS.windPearl,
          equipmentInstanceId: handItem.instanceId,
        }),
      ]),
    );
  });

  it('reports authoritative distance and line-of-sight failures through the host result channel', () => {
    const scenario: LocalWorldScenario = {
      id: 'D6',
      localHeroId: heroId('H005'),
      localPosition: vec2Mm(-1_200, 0),
      botCount: 0,
      staticSolids: [
        {
          solidId: 'replacement-wall',
          minimumX: -200,
          maximumX: 200,
          minimumZ: -2_000,
          maximumZ: 2_000,
        },
      ],
    };
    const host = new LocalWorldHost(scenario);
    const state = stateOf(host);
    const player = state.players.get(host.localEntityId);
    if (!player) {
      throw new Error('local player missing');
    }

    const blockedDrop = addActiveDrop(state, vec2Mm(1_200, 0));
    state.pendingActiveReplacements.set(player.entityId, {
      playerEntityId: player.entityId,
      lootEntityId: blockedDrop,
      activeId: GENERIC_ACTIVE_IDS.blink,
      requestedAtTick: state.tick,
    });
    host.replaceActiveLoot(blockedDrop, true);
    expect(drainTransactions(host)).toEqual([
      expect.objectContaining({
        accepted: false,
        code: 'active-loot-line-of-sight',
      }),
    ]);

    const distantDrop = addActiveDrop(state, vec2Mm(8_000, 0));
    state.pendingActiveReplacements.set(player.entityId, {
      playerEntityId: player.entityId,
      lootEntityId: distantDrop,
      activeId: GENERIC_ACTIVE_IDS.blink,
      requestedAtTick: state.tick,
    });
    host.replaceActiveLoot(distantDrop, true);
    const [distantResult] = drainTransactions(host);
    expect(distantResult).toMatchObject({
      accepted: false,
      code: 'active-loot-too-far',
    });
    expect(distantResult ? transactionResultText(distantResult) : null).toBe(
      '操作失败：距离目标过远',
    );
  });
});

describe('active range presentation and authoritative rejection', () => {
  it('shows the same range used when a target cast is rejected by distance or line of sight', () => {
    const definition = getActiveDefinition(activeId('H005'));
    expect(activePresentationRange(definition)).toEqual({ rangeMm: 25_000, source: 'range' });

    const scenario: LocalWorldScenario = {
      id: 'D6',
      localHeroId: heroId('H005'),
      localPosition: vec2Mm(-2_000, 0),
      botCount: 1,
      staticSolids: [
        {
          solidId: 'active-cast-wall',
          minimumX: -200,
          maximumX: 200,
          minimumZ: -2_000,
          maximumZ: 2_000,
        },
      ],
    };
    const host = new LocalWorldHost(scenario);
    const state = stateOf(host);
    const hostilePlayers = [...state.players.values()].filter(
      (candidate) => candidate.entityId !== host.localEntityId,
    );
    const target = hostilePlayers[0];
    if (!target) {
      throw new Error('target player missing');
    }
    state.monsters.clear();
    state.summons.clear();
    state.activeZones.clear();
    for (const hostile of hostilePlayers) {
      hostile.position = vec2Mm(2_000, 0);
    }
    const castingInput = {
      sample(sequence: number) {
        return createPlayerIntent({
          sequence,
          moveX: 0,
          moveZ: 0,
          aimX: 1_000,
          aimZ: 0,
          castActive: true,
          targetEntityId: target.entityId,
        });
      },
    } as InputController;

    const blockedFrame = host.update(50, castingInput);
    expect(blockedFrame.events).toContainEqual(
      expect.objectContaining({
        type: 'active-target-missing',
        entityId: host.localEntityId,
      }),
    );
    const local = host
      .getSnapshot()
      .players.find((candidate) => candidate.entityId === host.localEntityId);
    expect(local?.activeCooldownTicks).toBe(0);

    state.monsters.clear();
    state.summons.clear();
    state.activeZones.clear();
    for (const hostile of hostilePlayers) {
      hostile.position = vec2Mm(30_000, 0);
    }
    const distantFrame = host.update(50, castingInput);
    expect(distantFrame.events).toContainEqual(
      expect.objectContaining({
        type: 'active-target-missing',
        entityId: host.localEntityId,
      }),
    );
    expect(
      host.getSnapshot().players.find((candidate) => candidate.entityId === host.localEntityId)
        ?.activeCooldownTicks,
    ).toBe(0);
  });

  it('keeps equipment ids used by the host backed by concrete definitions', () => {
    expect(getEquipmentDefinition(EQUIPMENT_IDS.comboShoes).name.length).toBeGreaterThan(0);
    expect(equipmentInstanceId(1)).toBe(1);
  });
});
