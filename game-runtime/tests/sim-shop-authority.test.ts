import { EQUIPMENT_IDS, getEquipmentDefinition, MAP_COURTS } from '@jwgb/content';
import { TICKS_PER_SECOND, type Vec2Mm } from '@jwgb/core';
import { GameSimulation, SHOP_IDS, shopNavigationDistanceMm, syncShops } from '@jwgb/sim';
import { describe, expect, it } from 'vitest';
import { advanceStormZone } from '../packages/sim/src/systems/storm-zone';
import type { MutableSimulationState, ShopEntity, SimEvent } from '../packages/sim/src/types';

const atSecond = (seconds: number): number => seconds * TICKS_PER_SECOND;

function internalState(simulation: GameSimulation): MutableSimulationState {
  return (simulation as unknown as { readonly state: MutableSimulationState }).state;
}

function syncAt(state: MutableSimulationState, tick: number, events: SimEvent[] = []): void {
  state.tick = tick;
  advanceStormZone(state, events);
  syncShops(state, events);
}

function shopsAtTick(tick: number, seed = 0x51_0f): readonly ShopEntity[] {
  const simulation = new GameSimulation({
    rootSeed: seed,
    map: { enabled: true },
  });
  const state = internalState(simulation);
  syncAt(state, tick);
  return [...state.shops.values()];
}

function shopsAt(second: number, seed?: number): readonly ShopEntity[] {
  return shopsAtTick(atSecond(second), seed);
}

const WINDOWS = new Map<string, readonly [number, number][]>([
  [
    SHOP_IDS.landGodA,
    [
      [30, 210],
      [210, 390],
      [390, 570],
      [570, 750],
      [750, 900],
      [900, 1_200],
    ],
  ],
  [
    SHOP_IDS.shoemakerA,
    [
      [45, 225],
      [225, 405],
      [405, 585],
      [585, 795],
    ],
  ],
  [
    SHOP_IDS.taibai,
    [
      [60, 240],
      [240, 420],
      [420, 600],
      [600, 780],
      [780, 900],
      [900, 1_200],
    ],
  ],
  [
    SHOP_IDS.heishan,
    [
      [75, 255],
      [255, 435],
      [435, 615],
      [615, 750],
    ],
  ],
  [
    SHOP_IDS.landGodB,
    [
      [90, 270],
      [270, 450],
      [450, 630],
      [630, 885],
    ],
  ],
  [
    SHOP_IDS.shoemakerB,
    [
      [105, 285],
      [285, 465],
      [465, 645],
      [645, 840],
    ],
  ],
]);

const SHOE_IDS = new Set([
  EQUIPMENT_IDS.strawSandal,
  EQUIPMENT_IDS.thousandMileBoots,
  EQUIPMENT_IDS.cloudStepShoes,
  EQUIPMENT_IDS.dormantBoots,
  EQUIPMENT_IDS.galeBoots,
  EQUIPMENT_IDS.comboShoes,
  EQUIPMENT_IDS.starPickingBoots,
  EQUIPMENT_IDS.bedrockBoots,
  EQUIPMENT_IDS.cloudRide,
]);
const SHOEMAKER_BLUE_IDS = new Set([
  EQUIPMENT_IDS.thousandMileBoots,
  EQUIPMENT_IDS.cloudStepShoes,
  EQUIPMENT_IDS.dormantBoots,
]);
const SHOEMAKER_PURPLE_IDS = new Set([
  EQUIPMENT_IDS.galeBoots,
  EQUIPMENT_IDS.comboShoes,
  EQUIPMENT_IDS.starPickingBoots,
  EQUIPMENT_IDS.bedrockBoots,
]);

function positionOf(shop: ShopEntity): Vec2Mm {
  return shop.position;
}

describe('authoritative shop schedule and placement', () => {
  it('uses every exact half-open window boundary', () => {
    for (const [shopId, windows] of WINDOWS) {
      const firstOpen = windows[0]?.[0] ?? 0;
      expect(shopsAtTick(atSecond(firstOpen) - 1).some((shop) => shop.shopId === shopId)).toBe(
        false,
      );

      windows.forEach(([openSecond, closeSecond], index) => {
        const atOpen = shopsAt(openSecond).find((shop) => shop.shopId === shopId);
        expect(atOpen, `${shopId} at ${openSecond}s`).toMatchObject({
          openAtTick: atSecond(openSecond),
          closeAtTick: atSecond(closeSecond),
          version: index + 1,
        });
        const beforeClose = shopsAtTick(atSecond(closeSecond) - 1).find(
          (shop) => shop.shopId === shopId,
        );
        expect(beforeClose, `${shopId} before ${closeSecond}s`).toMatchObject({
          version: index + 1,
        });
        const atClose = shopsAt(closeSecond).find((shop) => shop.shopId === shopId);
        const next = windows[index + 1];
        if (next?.[0] === closeSecond) {
          expect(atClose, `${shopId} at ${closeSecond}s`).toMatchObject({
            version: index + 2,
            openAtTick: atSecond(closeSecond),
          });
        } else {
          expect(atClose, `${shopId} at ${closeSecond}s`).toBeUndefined();
        }
      });
    }
  });

  it('keeps open shops in unique macros and same-kind shops 100m apart by navigation', () => {
    for (const second of [105, 225, 405, 585, 645, 749]) {
      const open = shopsAt(second).filter((shop) => shop.status === 'open');
      const macros = open.map((shop) => shop.macroId);
      expect(new Set(macros).size, `macro collision at ${second}s`).toBe(macros.length);
      for (let leftIndex = 0; leftIndex < open.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < open.length; rightIndex += 1) {
          const left = open[leftIndex];
          const right = open[rightIndex];
          if (!left || !right || left.kind !== right.kind) {
            continue;
          }
          expect(
            shopNavigationDistanceMm(positionOf(left), positionOf(right)),
            `${left.shopId}/${right.shopId} at ${second}s`,
          ).toBeGreaterThanOrEqual(100_000);
        }
      }
    }
  });

  it('assigns LAND_A and TAIBAI to different final-court points at 15:00', () => {
    const simulation = new GameSimulation({
      rootSeed: 0x15_00,
      map: { enabled: true },
    });
    const state = internalState(simulation);
    syncAt(state, atSecond(900));
    const landGod = state.shops.get(SHOP_IDS.landGodA);
    const taibai = state.shops.get(SHOP_IDS.taibai);
    const court = MAP_COURTS.find((candidate) => candidate.id === state.stormZone.selectedCourtId);
    expect(court).toBeDefined();
    expect(landGod?.status).toBe('open');
    expect(taibai?.status).toBe('open');
    expect(landGod?.anchorId).not.toBe(taibai?.anchorId);
    expect(
      court?.finalShops.some(
        (point) => point.x === landGod?.position.x && point.z === landGod.position.z,
      ),
    ).toBe(true);
    expect(
      court?.finalShops.some(
        (point) => point.x === taibai?.position.x && point.z === taibai.position.z,
      ),
    ).toBe(true);
  });

  it('permanently closes every shop at 20:00 when the safe radius reaches zero', () => {
    const simulation = new GameSimulation({ rootSeed: 0x20_00 });
    const state = internalState(simulation);
    syncAt(state, atSecond(1_199));
    expect(state.shops.size).toBeGreaterThan(0);
    const events: SimEvent[] = [];
    syncAt(state, atSecond(1_200), events);
    expect(state.stormZone.radiusMm).toBe(0);
    expect(state.shops.size).toBe(0);
    expect(events.some((event) => event.type === 'shop-closed')).toBe(true);
    syncAt(state, atSecond(1_250), events);
    expect(state.shops.size).toBe(0);
  });
});

describe('authoritative shop inventory and relocation', () => {
  it('builds the exact land-god inventory categories', () => {
    const shop = shopsAt(30).find((candidate) => candidate.shopId === SHOP_IDS.landGodA);
    if (!shop) {
      throw new Error('land-god inventory shop is missing');
    }
    const equipmentIds = shop.inventory.flatMap((listing) =>
      listing.kind === 'equipment' && listing.equipmentId !== null ? [listing.equipmentId] : [],
    );
    const byRarity = (rarity: 'white' | 'blue' | 'purple') =>
      equipmentIds.filter((equipmentId) => getEquipmentDefinition(equipmentId).rarity === rarity);
    expect(new Set(byRarity('white'))).toEqual(
      new Set([
        EQUIPMENT_IDS.refinedIronStaff,
        EQUIPMENT_IDS.coarseClothArmor,
        EQUIPMENT_IDS.copperBracer,
        EQUIPMENT_IDS.lightArmorVest,
        EQUIPMENT_IDS.pilgrimBelt,
      ]),
    );
    expect(byRarity('blue')).toHaveLength(3);
    expect(new Set(byRarity('blue')).size).toBe(3);
    expect(byRarity('purple').length).toBeLessThanOrEqual(1);
    expect(equipmentIds.every((equipmentId) => !SHOE_IDS.has(equipmentId))).toBe(true);
    expect(shop.inventory.filter((listing) => listing.kind === 'gem')).toHaveLength(3);
    expect(
      shop.inventory
        .flatMap((listing) => (listing.consumableId ? [listing.consumableId] : []))
        .sort(),
    ).toEqual(['clairvoyance-talisman', 'demon-revealing-mirror']);
  });

  it('builds the shoemaker inventory without replacement from the exact shoe pools', () => {
    const shop = shopsAt(45).find((candidate) => candidate.shopId === SHOP_IDS.shoemakerA);
    if (!shop) {
      throw new Error('shoemaker inventory shop is missing');
    }
    const equipmentIds = shop.inventory.flatMap((listing) =>
      listing.kind === 'equipment' && listing.equipmentId !== null ? [listing.equipmentId] : [],
    );
    expect(equipmentIds[0]).toBe(EQUIPMENT_IDS.strawSandal);
    const blue = equipmentIds.filter(
      (equipmentId) => getEquipmentDefinition(equipmentId).rarity === 'blue',
    );
    expect(blue).toHaveLength(2);
    expect(new Set(blue).size).toBe(2);
    expect(blue.every((equipmentId) => SHOEMAKER_BLUE_IDS.has(equipmentId))).toBe(true);
    const purple = equipmentIds.filter(
      (equipmentId) => getEquipmentDefinition(equipmentId).rarity === 'purple',
    );
    expect(purple.length).toBeLessThanOrEqual(1);
    expect(purple.every((equipmentId) => SHOEMAKER_PURPLE_IDS.has(equipmentId))).toBe(true);
    expect(
      shop.inventory
        .flatMap((listing) => (listing.consumableId ? [listing.consumableId] : []))
        .sort(),
    ).toEqual(['clairvoyance-talisman', 'demon-revealing-mirror']);
  });

  it('retains sold-out inventory while relocating and retries only every five seconds', () => {
    const simulation = new GameSimulation({ rootSeed: 0x5e_11 });
    const state = internalState(simulation);
    const events: SimEvent[] = [];
    syncAt(state, atSecond(30), events);
    const shop = state.shops.get(SHOP_IDS.landGodA);
    if (!shop) {
      throw new Error('relocation shop is missing');
    }
    shop.inventory.splice(0);
    state.staticSolids.push({
      solidId: 'block-all-shop-anchors',
      minimumX: -1_000_000,
      maximumX: 1_000_000,
      minimumZ: -1_000_000,
      maximumZ: 1_000_000,
    });
    syncShops(state, events);
    expect(shop.status).toBe('relocating');
    expect(shop.inventory).toEqual([]);
    const retryAtTick = shop.nextRelocationAttemptTick;

    state.staticSolids.splice(0);
    syncAt(state, retryAtTick - 1, events);
    expect(shop.status).toBe('relocating');
    syncAt(state, retryAtTick, events);
    const reopened = state.shops.get(SHOP_IDS.landGodA);
    expect(reopened?.status).toBe('open');
    expect(reopened?.inventory).toEqual([]);
    expect(
      events.some((event) => event.type === 'shop-relocating' && event.retryAtTick === retryAtTick),
    ).toBe(true);
  });
});
