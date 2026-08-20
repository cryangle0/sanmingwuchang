import {
  EQUIPMENT_IDS,
  type EquippedEquipmentInstance,
  getEquipmentDefinition,
  getHeroDefinition,
  M1_EQUIPMENT,
  MAP_COURTS,
  MAP_ROUTE_EDGES,
  MAP_ROUTE_NODES,
  MAP_SHOPS,
} from '@jwgb/content';
import {
  distanceSquaredMm,
  type EntityId,
  type HeroId,
  TICKS_PER_SECOND,
  type Vec2Mm,
  vec2Mm,
} from '@jwgb/core';
import { getRequiredPlayer } from '../state';
import type {
  MutableSimulationState,
  PlayerEntity,
  ShopEntity,
  ShopKind,
  ShopListing,
  SimEvent,
} from '../types';
import { isBlockedByActiveWall } from './active-collision';
import { hasDirectLineOfSight } from './active-targeting';
import { grantGeneratedGold } from './equipment-economy';
import { createEquipmentInstance, rebuildEquipmentStats } from './equipment-inventory';
import { clearRemovedEquipmentState } from './equipment-state';
import { clearOwnedActiveStateForReplacement } from './loadout-cleanup';
import { scavengerSaleGold } from './passive-economy';
import { normalStormSafeCircleAtTick } from './storm-zone';
import { canUseWorldResources } from './world-interaction';

export const SHOP_IDS = {
  landGodA: 'land-god-a',
  shoemakerA: 'shoemaker-a',
  taibai: 'taibai',
  heishan: 'heishan',
  landGodB: 'land-god-b',
  shoemakerB: 'shoemaker-b',
} as const;

const SHOP_INTERACTION_RADIUS_MM = 2_500;
const SHOP_PLACEMENT_PAD_RADIUS_MM = 2_500;
const TERMINAL_SHOP_CLEAR_RADIUS_MM = 6_000;
const SHOP_RELOCATION_RETRY_TICKS = 5 * TICKS_PER_SECOND;
const SHOP_PLACEMENT_SAFETY_TICKS = 120 * TICKS_PER_SECOND;
const SHOP_PLAYER_WEIGHT_RADIUS_MM = 120_000;
const SHOP_SAME_TYPE_MIN_NAV_DISTANCE_MM = 100_000;
const SHOP_PERMANENT_CLOSE_TICK = 1_200 * TICKS_PER_SECOND;
const TERMINAL_WINDOW_OPEN_TICK = 900 * TICKS_PER_SECOND;
const TAIBAI_PRICE = 1_500;
const TAIBAI_CHANNEL_TICKS = 3 * TICKS_PER_SECOND;
const TAIBAI_COOLDOWN_TICKS = 120 * TICKS_PER_SECOND;
const TAIBAI_TETHER_RADIUS_MM = 3_000;

export type ShopTransactionCode =
  | 'accepted'
  | 'match-finished'
  | 'shop-unavailable'
  | 'shop-version-mismatch'
  | 'shop-closed'
  | 'shop-too-far'
  | 'player-not-alive'
  | 'pvp-combat-lock'
  | 'insufficient-gold'
  | 'listing-not-found'
  | 'equipment-capacity'
  | 'invalid-destination'
  | 'unsupported-sale-shop'
  | 'equipment-not-found'
  | 'unsupported-service-shop'
  | 'service-cooldown'
  | 'channel-active';

export interface ShopTransactionResult {
  readonly accepted: boolean;
  readonly code: ShopTransactionCode;
}

interface ShopSpec {
  readonly shopId: string;
  readonly kind: ShopKind;
  readonly windows: readonly ShopWindow[];
}

interface ShopWindow {
  readonly openAtTick: number;
  readonly closeAtTick: number;
}

interface ShopPlacement {
  readonly anchorId: string;
  readonly macroId: string;
  readonly position: Vec2Mm;
}

interface ShopAnchor extends ShopPlacement {}

const ticks = (seconds: number): number => seconds * TICKS_PER_SECOND;
const windows = (...values: readonly [number, number][]): readonly ShopWindow[] =>
  values.map(([openSeconds, closeSeconds]) => ({
    openAtTick: ticks(openSeconds),
    closeAtTick: ticks(closeSeconds),
  }));

const SHOP_SPECS: readonly ShopSpec[] = [
  {
    shopId: SHOP_IDS.landGodA,
    kind: 'land-god',
    windows: windows([30, 210], [210, 390], [390, 570], [570, 750], [750, 900], [900, 1_200]),
  },
  {
    shopId: SHOP_IDS.shoemakerA,
    kind: 'shoemaker',
    windows: windows([45, 225], [225, 405], [405, 585], [585, 795]),
  },
  {
    shopId: SHOP_IDS.taibai,
    kind: 'taibai',
    windows: windows([60, 240], [240, 420], [420, 600], [600, 780], [780, 900], [900, 1_200]),
  },
  {
    shopId: SHOP_IDS.heishan,
    kind: 'heishan',
    windows: windows([75, 255], [255, 435], [435, 615], [615, 750]),
  },
  {
    shopId: SHOP_IDS.landGodB,
    kind: 'land-god',
    windows: windows([90, 270], [270, 450], [450, 630], [630, 885]),
  },
  {
    shopId: SHOP_IDS.shoemakerB,
    kind: 'shoemaker',
    windows: windows([105, 285], [285, 465], [465, 645], [645, 840]),
  },
];

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

const TAIBAI_MACRO_IDS = new Set(['S02', 'S03', 'S06', 'S07', 'S10', 'S11', 'S14']);

const SHOP_ANCHORS: readonly ShopAnchor[] = [...MAP_SHOPS]
  .map((anchor) => ({
    anchorId: anchor.id,
    macroId: anchor.macroId,
    position: vec2Mm(anchor.position.x, anchor.position.z),
  }))
  .sort((left, right) => left.anchorId.localeCompare(right.anchorId));

function listingId(shopId: string, version: number, slot: number): string {
  return `${shopId}:v${version}:s${slot}`;
}

function equipmentListing(
  shopId: string,
  version: number,
  slot: number,
  equipmentId: ShopListing['equipmentId'],
): ShopListing {
  if (equipmentId === null) {
    throw new Error('equipment listing must have an equipment id');
  }
  return {
    listingId: listingId(shopId, version, slot),
    kind: 'equipment',
    equipmentId,
    price: getEquipmentDefinition(equipmentId).price ?? 0,
  };
}

function gemListing(shopId: string, version: number, slot: number): ShopListing {
  return {
    listingId: listingId(shopId, version, slot),
    kind: 'gem',
    equipmentId: null,
    price: 250,
  };
}

function consumableListing(
  shopId: string,
  version: number,
  slot: number,
  consumableId: NonNullable<ShopListing['consumableId']>,
  price: number,
): ShopListing {
  return {
    listingId: listingId(shopId, version, slot),
    kind: 'consumable',
    equipmentId: null,
    consumableId,
    price,
  };
}

type EquipmentDefinition = (typeof M1_EQUIPMENT)[number];

function compareEquipmentIds(left: EquipmentDefinition, right: EquipmentDefinition): number {
  const leftMatch = /^([A-Z]+)(\d+)$/.exec(String(left.id));
  const rightMatch = /^([A-Z]+)(\d+)$/.exec(String(right.id));
  if (!leftMatch || !rightMatch || leftMatch[1] !== rightMatch[1]) {
    return String(left.id).localeCompare(String(right.id));
  }
  return Number(leftMatch[2]) - Number(rightMatch[2]);
}

function shuffledEquipment(
  state: MutableSimulationState,
  candidates: readonly EquipmentDefinition[],
): EquipmentDefinition[] {
  const result = [...candidates].sort(compareEquipmentIds);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = state.random.shop.nextInt(index + 1);
    const previous = result[index];
    result[index] = result[swapIndex] as EquipmentDefinition;
    result[swapIndex] = previous as EquipmentDefinition;
  }
  return result;
}

function heishanOpenAtTick(tick: number): boolean {
  const spec = SHOP_SPECS.find((candidate) => candidate.shopId === SHOP_IDS.heishan);
  return (
    spec?.windows.some(
      (shopWindow) => tick >= shopWindow.openAtTick && tick < shopWindow.closeAtTick,
    ) ?? false
  );
}

function buildLandGodInventory(
  state: MutableSimulationState,
  shopId: string,
  version: number,
  windowOpenTick: number,
): ShopListing[] {
  const nonShoes = M1_EQUIPMENT.filter((equipment) => !SHOE_IDS.has(equipment.id));
  const white = nonShoes
    .filter((equipment) => equipment.rarity === 'white')
    .sort(compareEquipmentIds);
  const blue = shuffledEquipment(
    state,
    nonShoes.filter((equipment) => equipment.rarity === 'blue'),
  ).slice(0, 3);
  const purpleCandidates = nonShoes.filter(
    (equipment) =>
      equipment.rarity === 'purple' &&
      (equipment.id !== EQUIPMENT_IDS.gamblingMedal || heishanOpenAtTick(windowOpenTick)),
  );
  const inventory: ShopListing[] = [];
  let slot = 0;

  for (const equipment of white) {
    inventory.push(equipmentListing(shopId, version, slot, equipment.id));
    slot += 1;
  }
  for (const equipment of blue) {
    inventory.push(equipmentListing(shopId, version, slot, equipment.id));
    slot += 1;
  }
  if (state.random.shop.nextInt(10_000) < 7_000) {
    const purple = shuffledEquipment(state, purpleCandidates)[0];
    if (purple) {
      inventory.push(equipmentListing(shopId, version, slot, purple.id));
      slot += 1;
    }
  }
  for (let index = 0; index < 3; index += 1) {
    inventory.push(gemListing(shopId, version, slot));
    slot += 1;
  }
  inventory.push(consumableListing(shopId, version, slot, 'clairvoyance-talisman', 300));
  slot += 1;
  inventory.push(consumableListing(shopId, version, slot, 'demon-revealing-mirror', 500));
  return inventory;
}

function buildShoemakerInventory(
  state: MutableSimulationState,
  shopId: string,
  version: number,
): ShopListing[] {
  const inventory: ShopListing[] = [];
  let slot = 0;
  const blueShoes = shuffledEquipment(
    state,
    M1_EQUIPMENT.filter((equipment) =>
      [
        EQUIPMENT_IDS.thousandMileBoots,
        EQUIPMENT_IDS.cloudStepShoes,
        EQUIPMENT_IDS.dormantBoots,
      ].includes(equipment.id),
    ),
  ).slice(0, 2);
  for (const equipmentId of [
    EQUIPMENT_IDS.strawSandal,
    ...blueShoes.map((equipment) => equipment.id),
  ]) {
    inventory.push(equipmentListing(shopId, version, slot, equipmentId));
    slot += 1;
  }
  if (state.random.shop.nextInt(10_000) < 4_000) {
    const purpleShoes = [
      EQUIPMENT_IDS.galeBoots,
      EQUIPMENT_IDS.comboShoes,
      EQUIPMENT_IDS.starPickingBoots,
      EQUIPMENT_IDS.bedrockBoots,
    ];
    const equipmentId = purpleShoes[state.random.shop.nextInt(purpleShoes.length)];
    if (equipmentId) {
      inventory.push(equipmentListing(shopId, version, slot, equipmentId));
      slot += 1;
    }
  }
  inventory.push(consumableListing(shopId, version, slot, 'clairvoyance-talisman', 300));
  slot += 1;
  inventory.push(consumableListing(shopId, version, slot, 'demon-revealing-mirror', 500));
  return inventory;
}

function buildInventory(
  state: MutableSimulationState,
  kind: ShopKind,
  shopId: string,
  version: number,
  windowOpenTick: number,
): ShopListing[] {
  switch (kind) {
    case 'land-god':
      return buildLandGodInventory(state, shopId, version, windowOpenTick);
    case 'shoemaker':
      return buildShoemakerInventory(state, shopId, version);
    case 'taibai':
    case 'heishan':
      return [];
  }
}

interface RouteNeighbor {
  readonly nodeId: string;
  readonly distanceMm: number;
}

const ROUTE_NODE_BY_ID = new Map<string, (typeof MAP_ROUTE_NODES)[number]>(
  MAP_ROUTE_NODES.map((node) => [node.id, node]),
);
const ROUTE_GRAPH = new Map<string, RouteNeighbor[]>();
for (const node of MAP_ROUTE_NODES) {
  ROUTE_GRAPH.set(node.id, []);
}
for (const edge of MAP_ROUTE_EDGES) {
  ROUTE_GRAPH.get(edge.a)?.push({ nodeId: edge.b, distanceMm: edge.lengthMm });
  ROUTE_GRAPH.get(edge.b)?.push({ nodeId: edge.a, distanceMm: edge.lengthMm });
}
for (const neighbors of ROUTE_GRAPH.values()) {
  neighbors.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}
const NEAREST_ROUTE_NODE_CACHE = new Map<string, (typeof MAP_ROUTE_NODES)[number] | null>();
const ROUTE_DISTANCES_BY_START = new Map<string, ReadonlyMap<string, number>>();
const NAVIGATION_DISTANCE_CACHE = new Map<string, number>();

function linearDistanceMm(left: Vec2Mm, right: Vec2Mm): number {
  return Math.trunc(Math.sqrt(distanceSquaredMm(left, right)));
}

function positionKey(position: Vec2Mm): string {
  return `${position.x},${position.z}`;
}

function nearestRouteNode(position: Vec2Mm): (typeof MAP_ROUTE_NODES)[number] | null {
  const key = positionKey(position);
  const cached = NEAREST_ROUTE_NODE_CACHE.get(key);
  if (cached !== undefined || NEAREST_ROUTE_NODE_CACHE.has(key)) {
    return cached ?? null;
  }
  let nearest: (typeof MAP_ROUTE_NODES)[number] | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const node of MAP_ROUTE_NODES) {
    const candidateDistance = distanceSquaredMm(position, node.position);
    if (
      candidateDistance < nearestDistance ||
      (candidateDistance === nearestDistance && (nearest === null || node.id < nearest.id))
    ) {
      nearest = node;
      nearestDistance = candidateDistance;
    }
  }
  NEAREST_ROUTE_NODE_CACHE.set(key, nearest);
  return nearest;
}

function routeDistancesFrom(startId: string): ReadonlyMap<string, number> {
  const cached = ROUTE_DISTANCES_BY_START.get(startId);
  if (cached) {
    return cached;
  }
  const distances = new Map<string, number>([[startId, 0]]);
  const unvisited = new Set(ROUTE_NODE_BY_ID.keys());
  while (unvisited.size > 0) {
    let currentId: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const nodeId of unvisited) {
      const distance = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (
        distance < currentDistance ||
        (distance === currentDistance && (currentId === null || nodeId < currentId))
      ) {
        currentId = nodeId;
        currentDistance = distance;
      }
    }
    if (currentId === null || !Number.isFinite(currentDistance)) {
      break;
    }
    unvisited.delete(currentId);
    for (const neighbor of ROUTE_GRAPH.get(currentId) ?? []) {
      if (!unvisited.has(neighbor.nodeId)) {
        continue;
      }
      const candidate = currentDistance + neighbor.distanceMm;
      if (candidate < (distances.get(neighbor.nodeId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbor.nodeId, candidate);
      }
    }
  }
  ROUTE_DISTANCES_BY_START.set(startId, distances);
  return distances;
}

export function shopNavigationDistanceMm(left: Vec2Mm, right: Vec2Mm): number {
  const leftKey = positionKey(left);
  const rightKey = positionKey(right);
  const cacheKey = leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`;
  const cached = NAVIGATION_DISTANCE_CACHE.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const start = nearestRouteNode(left);
  const end = nearestRouteNode(right);
  const routeDistance = start && end ? routeDistancesFrom(start.id).get(end.id) : undefined;
  const distance =
    start && end && routeDistance !== undefined
      ? linearDistanceMm(left, start.position) +
        routeDistance +
        linearDistanceMm(end.position, right)
      : linearDistanceMm(left, right);
  NAVIGATION_DISTANCE_CACHE.set(cacheKey, distance);
  return distance;
}

function pointInsideSafeCircleAtTick(
  state: MutableSimulationState,
  position: Vec2Mm,
  tick: number,
): boolean {
  const circle = normalStormSafeCircleAtTick(state, tick);
  return (
    circle.radiusMm > 0 &&
    distanceSquaredMm(position, circle.center) <= circle.radiusMm * circle.radiusMm
  );
}

function safeForPlacementWindow(
  state: MutableSimulationState,
  position: Vec2Mm,
  closeAtTick: number,
): boolean {
  const horizonTick = Math.min(closeAtTick - 1, state.tick + SHOP_PLACEMENT_SAFETY_TICKS);
  for (let checkTick = state.tick; checkTick <= horizonTick; checkTick += TICKS_PER_SECOND) {
    if (!pointInsideSafeCircleAtTick(state, position, checkTick)) {
      return false;
    }
  }
  return pointInsideSafeCircleAtTick(state, position, horizonTick);
}

function staticPadIsClear(
  state: MutableSimulationState,
  position: Vec2Mm,
  radiusMm: number,
): boolean {
  if (state.mapField?.isCircleBlocked(position, radiusMm)) {
    return false;
  }
  if (
    state.staticSolids.some(
      (solid) =>
        position.x >= solid.minimumX - radiusMm &&
        position.x <= solid.maximumX + radiusMm &&
        position.z >= solid.minimumZ - radiusMm &&
        position.z <= solid.maximumZ + radiusMm,
    )
  ) {
    return false;
  }
  return !isBlockedByActiveWall(state, position, radiusMm);
}

function isTerminalPair(shopId: string, otherShopId: string): boolean {
  return stateIsTerminalShop(shopId) && stateIsTerminalShop(otherShopId);
}

function stateIsTerminalShop(shopId: string): boolean {
  return shopId === SHOP_IDS.landGodA || shopId === SHOP_IDS.taibai;
}

function placementHasLegalSeparation(
  state: MutableSimulationState,
  spec: ShopSpec,
  placement: ShopPlacement,
): boolean {
  for (const other of state.shops.values()) {
    if (
      other.shopId === spec.shopId ||
      other.status !== 'open' ||
      state.tick < other.openAtTick ||
      state.tick >= other.closeAtTick
    ) {
      continue;
    }
    const terminalException =
      state.tick >= TERMINAL_WINDOW_OPEN_TICK && isTerminalPair(spec.shopId, other.shopId);
    if (placement.macroId === other.macroId && !terminalException) {
      return false;
    }
    if (
      spec.kind === other.kind &&
      shopNavigationDistanceMm(placement.position, other.position) <
        SHOP_SAME_TYPE_MIN_NAV_DISTANCE_MM
    ) {
      return false;
    }
  }
  return true;
}

function macroEligibleFor(spec: ShopSpec, macroId: string): boolean {
  return spec.kind !== 'taibai' || TAIBAI_MACRO_IDS.has(macroId);
}

function regularPlacementIsLegal(
  state: MutableSimulationState,
  spec: ShopSpec,
  shopWindow: ShopWindow,
  placement: ShopPlacement,
  requireSafetyHorizon: boolean,
): boolean {
  return (
    macroEligibleFor(spec, placement.macroId) &&
    pointInsideSafeCircleAtTick(state, placement.position, state.tick) &&
    (!requireSafetyHorizon ||
      safeForPlacementWindow(state, placement.position, shopWindow.closeAtTick)) &&
    staticPadIsClear(state, placement.position, SHOP_PLACEMENT_PAD_RADIUS_MM) &&
    placementHasLegalSeparation(state, spec, placement)
  );
}

function placementWeight(state: MutableSimulationState, position: Vec2Mm): number {
  const nearbyPlayers = [...state.players.values()].filter(
    (player) =>
      player.lifeState !== 'eliminated' &&
      distanceSquaredMm(player.position, position) <=
        SHOP_PLAYER_WEIGHT_RADIUS_MM * SHOP_PLAYER_WEIGHT_RADIUS_MM,
  ).length;
  return Math.min(3_000, 1_000 + nearbyPlayers * 250);
}

function weightedPlacement(
  state: MutableSimulationState,
  candidates: readonly ShopAnchor[],
): ShopPlacement | null {
  if (candidates.length === 0) {
    return null;
  }
  const weighted = candidates.map((candidate) => ({
    candidate,
    weight: placementWeight(state, candidate.position),
  }));
  const totalWeight = weighted.reduce((total, entry) => total + entry.weight, 0);
  let draw = state.random.shop.nextInt(totalWeight);
  for (const entry of weighted) {
    if (draw < entry.weight) {
      return entry.candidate;
    }
    draw -= entry.weight;
  }
  return weighted.at(-1)?.candidate ?? null;
}

function selectRegularPlacement(
  state: MutableSimulationState,
  spec: ShopSpec,
  shopWindow: ShopWindow,
  excludedAnchorId: string | null,
): ShopPlacement | null {
  const candidates = SHOP_ANCHORS.filter(
    (anchor) =>
      anchor.anchorId !== excludedAnchorId &&
      regularPlacementIsLegal(state, spec, shopWindow, anchor, true),
  );
  return weightedPlacement(state, candidates);
}

function selectedFinalCourt(state: MutableSimulationState) {
  return MAP_COURTS.find((court) => court.id === state.stormZone.selectedCourtId) ?? null;
}

function ensureTerminalAssignments(state: MutableSimulationState): void {
  if (
    state.terminalShopAssignments.has(SHOP_IDS.landGodA) &&
    state.terminalShopAssignments.has(SHOP_IDS.taibai)
  ) {
    return;
  }
  const firstIndex = state.random.shop.nextInt(2);
  state.terminalShopAssignments.set(SHOP_IDS.landGodA, firstIndex);
  state.terminalShopAssignments.set(SHOP_IDS.taibai, 1 - firstIndex);
}

function selectTerminalPlacement(
  state: MutableSimulationState,
  spec: ShopSpec,
  shopWindow: ShopWindow,
): ShopPlacement | null {
  const court = selectedFinalCourt(state);
  if (!court || !stateIsTerminalShop(spec.shopId)) {
    return null;
  }
  ensureTerminalAssignments(state);
  const pointIndex = state.terminalShopAssignments.get(spec.shopId);
  const point = pointIndex === undefined ? undefined : court.finalShops[pointIndex];
  if (!point) {
    return null;
  }
  const placement: ShopPlacement = {
    anchorId: `final:${court.id}:${pointIndex}`,
    macroId: `final:${court.id}`,
    position: vec2Mm(point.x, point.z),
  };
  if (
    linearDistanceMm(placement.position, court.center) < 25_000 ||
    !pointInsideSafeCircleAtTick(state, placement.position, state.tick) ||
    !safeForPlacementWindow(state, placement.position, shopWindow.closeAtTick) ||
    !staticPadIsClear(state, placement.position, TERMINAL_SHOP_CLEAR_RADIUS_MM) ||
    !placementHasLegalSeparation(state, spec, placement)
  ) {
    return null;
  }
  return placement;
}

function isTerminalWindow(spec: ShopSpec, shopWindow: ShopWindow): boolean {
  return stateIsTerminalShop(spec.shopId) && shopWindow.openAtTick === TERMINAL_WINDOW_OPEN_TICK;
}

function selectPlacement(
  state: MutableSimulationState,
  spec: ShopSpec,
  shopWindow: ShopWindow,
  excludedAnchorId: string | null,
): ShopPlacement | null {
  if (isTerminalWindow(spec, shopWindow) && selectedFinalCourt(state)) {
    return selectTerminalPlacement(state, spec, shopWindow);
  }
  return selectRegularPlacement(state, spec, shopWindow, excludedAnchorId);
}

function placementFromShop(shop: ShopEntity): ShopPlacement | null {
  return shop.anchorId === null || shop.macroId === null
    ? null
    : {
        anchorId: shop.anchorId,
        macroId: shop.macroId,
        position: vec2Mm(shop.position.x, shop.position.z),
      };
}

function emitShopRelocating(
  state: MutableSimulationState,
  events: SimEvent[],
  shop: ShopEntity,
): void {
  events.push({
    type: 'shop-relocating',
    tick: state.tick,
    shopId: shop.shopId,
    kind: shop.kind,
    version: shop.version,
    retryAtTick: shop.nextRelocationAttemptTick,
  });
}

function createRelocatingShop(
  state: MutableSimulationState,
  events: SimEvent[],
  spec: ShopSpec,
  shopWindow: ShopWindow,
  version: number,
  previous: ShopEntity | undefined,
): void {
  const inventory =
    previous?.version === version
      ? previous.inventory.map((listing) => ({ ...listing }))
      : buildInventory(state, spec.kind, spec.shopId, version, shopWindow.openAtTick);
  const shop: ShopEntity = {
    shopId: spec.shopId,
    kind: spec.kind,
    position: previous ? vec2Mm(previous.position.x, previous.position.z) : vec2Mm(0, 0),
    anchorId: previous?.anchorId ?? null,
    macroId: previous?.macroId ?? null,
    openAtTick: shopWindow.openAtTick,
    closeAtTick: shopWindow.closeAtTick,
    version,
    status: 'relocating',
    nextRelocationAttemptTick: state.tick + SHOP_RELOCATION_RETRY_TICKS,
    inventory,
  };
  state.shops.set(spec.shopId, shop);
  emitShopRelocating(state, events, shop);
}

function openShopAtPlacement(
  state: MutableSimulationState,
  events: SimEvent[],
  spec: ShopSpec,
  shopWindow: ShopWindow,
  version: number,
  placement: ShopPlacement,
  existingInventory: readonly ShopListing[] | null = null,
): void {
  const shop: ShopEntity = {
    shopId: spec.shopId,
    kind: spec.kind,
    position: vec2Mm(placement.position.x, placement.position.z),
    anchorId: placement.anchorId,
    macroId: placement.macroId,
    openAtTick: shopWindow.openAtTick,
    closeAtTick: shopWindow.closeAtTick,
    version,
    status: 'open',
    nextRelocationAttemptTick: 0,
    inventory:
      existingInventory === null
        ? buildInventory(state, spec.kind, spec.shopId, version, shopWindow.openAtTick)
        : existingInventory.map((listing) => ({ ...listing })),
  };
  state.shops.set(spec.shopId, shop);
  events.push({
    type: 'shop-opened',
    tick: state.tick,
    shopId: spec.shopId,
    kind: spec.kind,
    version,
  });
}

function versionForWindow(spec: ShopSpec, shopWindow: ShopWindow): number {
  return spec.windows.indexOf(shopWindow) + 1;
}

function startShopWindow(
  state: MutableSimulationState,
  events: SimEvent[],
  spec: ShopSpec,
  shopWindow: ShopWindow,
  previous: ShopEntity | undefined,
): void {
  const version = versionForWindow(spec, shopWindow);
  const placement = selectPlacement(
    state,
    spec,
    shopWindow,
    isTerminalWindow(spec, shopWindow) ? null : (previous?.anchorId ?? null),
  );
  if (placement) {
    openShopAtPlacement(state, events, spec, shopWindow, version, placement);
    return;
  }

  const oldPlacement = previous ? placementFromShop(previous) : null;
  if (
    oldPlacement &&
    !isTerminalWindow(spec, shopWindow) &&
    regularPlacementIsLegal(state, spec, shopWindow, oldPlacement, true)
  ) {
    openShopAtPlacement(state, events, spec, shopWindow, version, oldPlacement);
    return;
  }
  createRelocatingShop(state, events, spec, shopWindow, version, previous);
}

function retryShopRelocation(
  state: MutableSimulationState,
  events: SimEvent[],
  spec: ShopSpec,
  shopWindow: ShopWindow,
  shop: ShopEntity,
): void {
  const placement = selectPlacement(state, spec, shopWindow, null);
  if (!placement) {
    shop.nextRelocationAttemptTick = state.tick + SHOP_RELOCATION_RETRY_TICKS;
    emitShopRelocating(state, events, shop);
    return;
  }
  openShopAtPlacement(state, events, spec, shopWindow, shop.version, placement, shop.inventory);
}

function currentPlacementIsLegal(
  state: MutableSimulationState,
  spec: ShopSpec,
  shopWindow: ShopWindow,
  shop: ShopEntity,
): boolean {
  const placement = placementFromShop(shop);
  if (!placement) {
    return false;
  }
  if (isTerminalWindow(spec, shopWindow) && selectedFinalCourt(state)) {
    const assigned = state.terminalShopAssignments.get(spec.shopId);
    const court = selectedFinalCourt(state);
    const point = assigned === undefined ? undefined : court?.finalShops[assigned];
    return (
      point !== undefined &&
      placement.position.x === point.x &&
      placement.position.z === point.z &&
      pointInsideSafeCircleAtTick(state, placement.position, state.tick) &&
      staticPadIsClear(state, placement.position, TERMINAL_SHOP_CLEAR_RADIUS_MM) &&
      placementHasLegalSeparation(state, spec, placement)
    );
  }
  return regularPlacementIsLegal(state, spec, shopWindow, placement, false);
}

function closeShop(
  state: MutableSimulationState,
  events: SimEvent[],
  spec: ShopSpec,
  reason: 'schedule-ended' | 'unsafe-position' | 'safe-radius-zero',
): void {
  const current = state.shops.get(spec.shopId);
  if (!current) {
    return;
  }
  state.shops.delete(spec.shopId);
  events.push({
    type: 'shop-closed',
    tick: state.tick,
    shopId: current.shopId,
    kind: current.kind,
    version: current.version,
    reason,
  });
}

function windowAtTick(spec: ShopSpec, tick: number): ShopWindow | null {
  return (
    spec.windows.find(
      (shopWindow) => tick >= shopWindow.openAtTick && tick < shopWindow.closeAtTick,
    ) ?? null
  );
}

export function syncShops(state: MutableSimulationState, events: SimEvent[]): void {
  if (state.tick >= SHOP_PERMANENT_CLOSE_TICK || state.stormZone.radiusMm <= 0) {
    for (const spec of SHOP_SPECS) {
      closeShop(state, events, spec, 'safe-radius-zero');
    }
    return;
  }

  for (const spec of SHOP_SPECS) {
    const shopWindow = windowAtTick(spec, state.tick);
    const current = state.shops.get(spec.shopId);
    if (!shopWindow) {
      closeShop(state, events, spec, 'schedule-ended');
      continue;
    }
    const version = versionForWindow(spec, shopWindow);
    if (
      !current ||
      current.version !== version ||
      current.openAtTick !== shopWindow.openAtTick ||
      current.closeAtTick !== shopWindow.closeAtTick
    ) {
      if (current) {
        closeShop(state, events, spec, 'schedule-ended');
      }
      startShopWindow(state, events, spec, shopWindow, current);
      continue;
    }
    if (current.status === 'relocating') {
      if (state.tick >= current.nextRelocationAttemptTick) {
        retryShopRelocation(state, events, spec, shopWindow, current);
      }
      continue;
    }
    if (!currentPlacementIsLegal(state, spec, shopWindow, current)) {
      events.push({
        type: 'shop-closed',
        tick: state.tick,
        shopId: current.shopId,
        kind: current.kind,
        version: current.version,
        reason: 'unsafe-position',
      });
      current.status = 'relocating';
      current.nextRelocationAttemptTick = state.tick + SHOP_RELOCATION_RETRY_TICKS;
      emitShopRelocating(state, events, current);
    }
  }
}

export function advanceShops(state: MutableSimulationState, events: SimEvent[]): void {
  syncShops(state, events);
  for (const player of state.players.values()) {
    player.taibaiCooldownTicks = Math.max(0, player.taibaiCooldownTicks - 1);
  }
  advanceHeroSwapChannels(state, events);
}

function cancelHeroSwapChannel(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  reason: 'damaged' | 'left-tether' | 'shop-unavailable' | 'player-unavailable',
): void {
  const targetHeroId = player.taibaiTargetHeroId;
  if (player.taibaiChannelTicks <= 0 || targetHeroId === null) {
    return;
  }
  player.taibaiChannelTicks = 0;
  player.taibaiTargetHeroId = null;
  player.worldInteractionLockTicks = 0;
  events.push({
    type: 'hero-swap-channel',
    tick: state.tick,
    entityId: player.entityId,
    targetHeroId,
    phase: 'cancelled',
    goldSpent: 0,
    reason,
  });
}

function isWithinTaibaiTether(player: PlayerEntity, shop: ShopEntity): boolean {
  return (
    distanceSquaredMm(player.position, shop.position) <=
    TAIBAI_TETHER_RADIUS_MM * TAIBAI_TETHER_RADIUS_MM
  );
}

export function cancelHeroSwapIfOutsideTether(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
): void {
  if (player.taibaiChannelTicks <= 0) {
    return;
  }
  const shop = state.shops.get(SHOP_IDS.taibai);
  if (shop?.status !== 'open' || !isWithinTaibaiTether(player, shop)) {
    cancelHeroSwapChannel(state, events, player, 'left-tether');
  }
}

export function cancelHeroSwapOnDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
): void {
  cancelHeroSwapChannel(state, events, player, 'damaged');
}

function completeHeroSwap(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
): void {
  const targetHeroId = player.taibaiTargetHeroId;
  if (targetHeroId === null) {
    return;
  }
  const previousHeroId = player.heroId;
  const previousActiveId = player.activeAbilityId;
  const previousActiveCooldownTicks = player.activeCooldownTicks;
  const hero = getHeroDefinition(targetHeroId);
  const healthBasisPoints =
    player.maxHp <= 0 ? 10_000 : Math.trunc((player.hp * 10_000) / player.maxHp);
  player.gold -= TAIBAI_PRICE;
  player.heroId = hero.id;
  player.basicAttackKind = hero.basicAttackKind;
  player.element = hero.element;
  player.activeAbilityId = hero.active.id;
  player.activeCooldownTicks = previousHeroId === hero.id ? previousActiveCooldownTicks : 0;
  player.taibaiChannelTicks = 0;
  player.taibaiTargetHeroId = null;
  player.taibaiCooldownTicks = TAIBAI_COOLDOWN_TICKS;
  player.worldInteractionLockTicks = 0;
  clearOwnedActiveStateForReplacement(state, events, player, previousActiveId);
  rebuildEquipmentStats(player);
  player.hp = Math.max(
    1,
    Math.min(player.maxHp, Math.trunc((player.maxHp * healthBasisPoints) / 10_000)),
  );
  events.push({
    type: 'hero-swap-channel',
    tick: state.tick,
    entityId: player.entityId,
    targetHeroId,
    phase: 'completed',
    goldSpent: TAIBAI_PRICE,
  });
}

function advanceHeroSwapChannels(state: MutableSimulationState, events: SimEvent[]): void {
  const shop = state.shops.get(SHOP_IDS.taibai);
  for (const player of state.players.values()) {
    if (player.taibaiChannelTicks <= 0) {
      continue;
    }
    if (player.lifeState !== 'alive' || player.gold < TAIBAI_PRICE) {
      cancelHeroSwapChannel(state, events, player, 'player-unavailable');
      continue;
    }
    if (shop?.status !== 'open' || !isWithinTaibaiTether(player, shop)) {
      cancelHeroSwapChannel(state, events, player, 'shop-unavailable');
      continue;
    }
    player.taibaiChannelTicks -= 1;
    player.worldInteractionLockTicks = Math.max(
      player.worldInteractionLockTicks,
      player.taibaiChannelTicks,
    );
    if (player.taibaiChannelTicks === 0) {
      completeHeroSwap(state, events, player);
    }
  }
}

function getShop(state: MutableSimulationState, shopId: string): ShopEntity | undefined {
  return state.shops.get(shopId);
}

function getShopFailureCode(
  state: MutableSimulationState,
  shopId: string,
  expectedVersion: number,
): ShopTransactionCode | null {
  const shop = getShop(state, shopId);
  if (shop?.status !== 'open') {
    return 'shop-unavailable';
  }
  if (shop.version !== expectedVersion) {
    return 'shop-version-mismatch';
  }
  if (state.tick < shop.openAtTick || state.tick >= shop.closeAtTick) {
    return 'shop-closed';
  }
  return null;
}

function isAtShop(state: MutableSimulationState, player: PlayerEntity, shop: ShopEntity): boolean {
  return (
    distanceSquaredMm(player.position, shop.position) <=
      SHOP_INTERACTION_RADIUS_MM * SHOP_INTERACTION_RADIUS_MM &&
    hasDirectLineOfSight(state, player.position, shop.position)
  );
}

export function startHeroSwapResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  shopId: string,
  expectedVersion: number,
  targetHeroId: HeroId,
): ShopTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  const failure = getShopFailureCode(state, shopId, expectedVersion);
  if (failure !== null) {
    return { accepted: false, code: failure };
  }
  const shop = getShop(state, shopId);
  if (shop?.kind !== 'taibai') {
    return { accepted: false, code: 'unsupported-service-shop' };
  }
  if (!canUseWorldResources(player)) {
    return { accepted: false, code: 'player-not-alive' };
  }
  if (!isAtShop(state, player, shop)) {
    return { accepted: false, code: 'shop-too-far' };
  }
  if (player.pvpCombatTicks > 0) {
    return { accepted: false, code: 'pvp-combat-lock' };
  }
  if (player.taibaiCooldownTicks > 0) {
    return { accepted: false, code: 'service-cooldown' };
  }
  if (player.taibaiChannelTicks > 0) {
    return { accepted: false, code: 'channel-active' };
  }
  if (player.gold < TAIBAI_PRICE) {
    return { accepted: false, code: 'insufficient-gold' };
  }
  getHeroDefinition(targetHeroId);
  player.taibaiTargetHeroId = targetHeroId;
  player.taibaiChannelTicks = TAIBAI_CHANNEL_TICKS;
  player.worldInteractionLockTicks = TAIBAI_CHANNEL_TICKS;
  events.push({
    type: 'hero-swap-channel',
    tick: state.tick,
    entityId: player.entityId,
    targetHeroId,
    phase: 'started',
    goldSpent: 0,
  });
  return { accepted: true, code: 'accepted' };
}

function inventoryCapacity(player: PlayerEntity): number {
  return player.equipment.some((instance) => instance.equipmentId === EQUIPMENT_IDS.clothBag)
    ? 2
    : 1;
}

function addInventoryEquipment(
  state: MutableSimulationState,
  player: PlayerEntity,
  equipmentId: NonNullable<ShopListing['equipmentId']>,
): EquippedEquipmentInstance {
  const instance = createEquipmentInstance(state, equipmentId);
  player.inventoryEquipment.push(instance);
  return instance;
}

function addEquippedEquipment(
  state: MutableSimulationState,
  player: PlayerEntity,
  equipmentId: NonNullable<ShopListing['equipmentId']>,
): EquippedEquipmentInstance {
  const instance = createEquipmentInstance(state, equipmentId);
  player.equipment.push(instance);
  rebuildEquipmentStats(player);
  return instance;
}

export function purchaseShopListingResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  shopId: string,
  listingId: string,
  expectedVersion: number,
  destination: 'equipped' | 'inventory' = 'inventory',
): ShopTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  const shopFailureCode = getShopFailureCode(state, shopId, expectedVersion);
  if (shopFailureCode !== null) {
    return { accepted: false, code: shopFailureCode };
  }
  const shop = getShop(state, shopId);
  if (!shop) {
    return { accepted: false, code: 'shop-unavailable' };
  }
  if (!canUseWorldResources(player)) {
    return { accepted: false, code: 'player-not-alive' };
  }
  if (player.pvpCombatTicks > 0) {
    return { accepted: false, code: 'pvp-combat-lock' };
  }
  if (!isAtShop(state, player, shop)) {
    return { accepted: false, code: 'shop-too-far' };
  }
  if (destination !== 'equipped' && destination !== 'inventory') {
    return { accepted: false, code: 'invalid-destination' };
  }

  const listingIndex = shop.inventory.findIndex((listing) => listing.listingId === listingId);
  const listing = listingIndex < 0 ? undefined : shop.inventory[listingIndex];
  if (!listing) {
    return { accepted: false, code: 'listing-not-found' };
  }
  if (player.gold < listing.price) {
    return { accepted: false, code: 'insufficient-gold' };
  }
  if (
    listing.kind === 'equipment' &&
    (listing.equipmentId === null ||
      (destination === 'equipped' &&
        (player.equipment.length >= 3 ||
          player.equipment.some((instance) => instance.equipmentId === listing.equipmentId))) ||
      (destination === 'inventory' &&
        player.inventoryEquipment.length >= inventoryCapacity(player)))
  ) {
    return { accepted: false, code: 'equipment-capacity' };
  }

  player.gold -= listing.price;
  shop.inventory.splice(listingIndex, 1);
  if (listing.kind === 'gem') {
    player.gems += 1;
  } else if (listing.kind === 'consumable') {
    if (listing.consumableId === 'clairvoyance-talisman') {
      player.consumableVisionTicks = Math.max(player.consumableVisionTicks, 10 * 20);
    } else if (listing.consumableId === 'demon-revealing-mirror') {
      player.consumableRevealTicks = Math.max(player.consumableRevealTicks, 3 * 20);
    }
  } else if (listing.equipmentId !== null) {
    if (destination === 'equipped') {
      addEquippedEquipment(state, player, listing.equipmentId);
    } else {
      addInventoryEquipment(state, player, listing.equipmentId);
    }
  }
  events.push({
    type: 'shop-purchase',
    tick: state.tick,
    entityId: player.entityId,
    shopId,
    listingId,
    equipmentId: listing.equipmentId,
    goldSpent: listing.price,
    listingKind: listing.kind,
  });
  return { accepted: true, code: 'accepted' };
}

export function purchaseShopListing(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  shopId: string,
  listingId: string,
  expectedVersion: number,
  destination: 'equipped' | 'inventory' = 'inventory',
): boolean {
  return purchaseShopListingResult(
    state,
    events,
    playerEntityId,
    shopId,
    listingId,
    expectedVersion,
    destination,
  ).accepted;
}

export function sellShopEquipmentResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  shopId: string,
  instanceId: EquippedEquipmentInstance['instanceId'],
  expectedVersion: number,
): ShopTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  const shopFailureCode = getShopFailureCode(state, shopId, expectedVersion);
  if (shopFailureCode !== null) {
    return { accepted: false, code: shopFailureCode };
  }
  const shop = getShop(state, shopId);
  if (!shop) {
    return { accepted: false, code: 'shop-unavailable' };
  }
  if (shop.kind !== 'land-god' && shop.kind !== 'shoemaker') {
    return { accepted: false, code: 'unsupported-sale-shop' };
  }
  if (!canUseWorldResources(player)) {
    return { accepted: false, code: 'player-not-alive' };
  }
  if (player.pvpCombatTicks > 0) {
    return { accepted: false, code: 'pvp-combat-lock' };
  }
  if (!isAtShop(state, player, shop)) {
    return { accepted: false, code: 'shop-too-far' };
  }

  const equippedIndex = player.equipment.findIndex(
    (instance) => instance.instanceId === instanceId,
  );
  const inventoryIndex = player.inventoryEquipment.findIndex(
    (instance) => instance.instanceId === instanceId,
  );
  const source = equippedIndex >= 0 ? player.equipment : player.inventoryEquipment;
  const sourceIndex = equippedIndex >= 0 ? equippedIndex : inventoryIndex;
  const instance = sourceIndex >= 0 ? source[sourceIndex] : undefined;
  if (!instance) {
    return { accepted: false, code: 'equipment-not-found' };
  }

  source.splice(sourceIndex, 1);
  if (equippedIndex >= 0) {
    clearRemovedEquipmentState(state, player, instance.equipmentId);
    rebuildEquipmentStats(player);
  }
  const goldReceived = scavengerSaleGold(
    player,
    getEquipmentDefinition(instance.equipmentId).sellPrice,
  );
  const grantedGold = grantGeneratedGold(player, goldReceived);
  events.push({
    type: 'shop-sale',
    tick: state.tick,
    entityId: player.entityId,
    shopId,
    instanceId: instance.instanceId,
    equipmentId: instance.equipmentId,
    goldReceived: grantedGold,
  });
  return { accepted: true, code: 'accepted' };
}

export function sellShopEquipment(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  shopId: string,
  instanceId: EquippedEquipmentInstance['instanceId'],
  expectedVersion: number,
): boolean {
  return sellShopEquipmentResult(state, events, playerEntityId, shopId, instanceId, expectedVersion)
    .accepted;
}
