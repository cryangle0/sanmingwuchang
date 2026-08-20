import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAP_ROUTE_EDGES, MAP_ROUTE_NODES } from '@jwgb/content';
import { chromium } from 'playwright-core';

const baseUrl = process.env.JWGB_LOCAL_WEB_URL ?? 'http://127.0.0.1:4181/';
const outputDirectory =
  process.env.JWGB_LOCAL_WEB_SCREENSHOT_DIR ?? 'migration/reports/web/local-services';
const executablePath =
  process.env.JWGB_BROWSER_EXECUTABLE ??
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error('Chrome or Edge executable not found');
}

const MOVEMENT_KEYS = ['w', 'a', 's', 'd'];
const PLAYER_MODEL_VISUAL_SCALE = 1;
const HERO_SWAP_TARGET_ID = 'H018';
const PIG_HOME_POSITION = { x: 320_900, z: -37_300 };
const FIRST_LAND_GOD_OPEN_TICK = 600;
const HERO_SWAP_CHANNEL_TICKS = 60;
const ROUTE_NODES_BY_ID = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node]));
const ROUTE_GRAPH = new Map(MAP_ROUTE_NODES.map((node) => [node.id, []]));
for (const edge of MAP_ROUTE_EDGES) {
  ROUTE_GRAPH.get(edge.a)?.push({ nodeId: edge.b, distanceMm: edge.lengthMm });
  ROUTE_GRAPH.get(edge.b)?.push({ nodeId: edge.a, distanceMm: edge.lengthMm });
}

function localUrl(parameters) {
  const target = new URL(baseUrl);
  target.searchParams.set('mode', 'local');
  for (const [name, value] of Object.entries(parameters)) {
    target.searchParams.set(name, value);
  }
  return target.toString();
}

function distanceMm(left, right) {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function nearestRouteNode(position) {
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const node of MAP_ROUTE_NODES) {
    const candidateDistance = distanceMm(position, node.position);
    if (
      candidateDistance < nearestDistance ||
      (candidateDistance === nearestDistance && (nearest === null || node.id < nearest.id))
    ) {
      nearest = node;
      nearestDistance = candidateDistance;
    }
  }
  return nearest;
}

function authoritativeRouteWaypoints(from, to) {
  const start = nearestRouteNode(from);
  const end = nearestRouteNode(to);
  if (!start || !end) {
    return [to];
  }

  const distances = new Map([[start.id, 0]]);
  const previous = new Map();
  const unvisited = new Set(ROUTE_NODES_BY_ID.keys());
  while (unvisited.size > 0) {
    let currentId = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const nodeId of unvisited) {
      const candidateDistance = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (
        candidateDistance < currentDistance ||
        (candidateDistance === currentDistance &&
          (currentId === null || nodeId.localeCompare(currentId) < 0))
      ) {
        currentId = nodeId;
        currentDistance = candidateDistance;
      }
    }
    if (currentId === null || !Number.isFinite(currentDistance)) {
      break;
    }
    unvisited.delete(currentId);
    if (currentId === end.id) {
      break;
    }
    for (const neighbor of ROUTE_GRAPH.get(currentId) ?? []) {
      if (!unvisited.has(neighbor.nodeId)) {
        continue;
      }
      const candidateDistance = currentDistance + neighbor.distanceMm;
      if (candidateDistance < (distances.get(neighbor.nodeId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbor.nodeId, candidateDistance);
        previous.set(neighbor.nodeId, currentId);
      }
    }
  }

  const nodeIds = [];
  let cursor = end.id;
  while (cursor) {
    nodeIds.push(cursor);
    if (cursor === start.id) {
      break;
    }
    cursor = previous.get(cursor);
  }
  if (nodeIds.at(-1) !== start.id) {
    return [to];
  }
  nodeIds.reverse();
  const waypoints = nodeIds.map((nodeId) => ROUTE_NODES_BY_ID.get(nodeId).position);
  if (waypoints[0] && distanceMm(from, waypoints[0]) <= 1_200) {
    waypoints.shift();
  }
  waypoints.push(to);
  return waypoints.filter(
    (waypoint, index) => index === 0 || distanceMm(waypoint, waypoints[index - 1]) > 100,
  );
}

function routeLengthMm(from, waypoints) {
  let total = 0;
  let previous = from;
  for (const waypoint of waypoints) {
    total += distanceMm(previous, waypoint);
    previous = waypoint;
  }
  return Math.round(total);
}

function movementKeysFor(deltaX, deltaZ) {
  const absoluteX = Math.abs(deltaX);
  const absoluteZ = Math.abs(deltaZ);
  const keys = [];
  if (absoluteX > absoluteZ * 0.414) {
    keys.push(deltaX > 0 ? 'd' : 'a');
  }
  if (absoluteZ > absoluteX * 0.414) {
    keys.push(deltaZ > 0 ? 's' : 'w');
  }
  if (keys.length === 0) {
    keys.push(absoluteX >= absoluteZ ? (deltaX > 0 ? 'd' : 'a') : deltaZ > 0 ? 's' : 'w');
  }
  return keys;
}

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];

function observe(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(`${label}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(`${label}: ${String(error)}`));
  page.on('requestfailed', (request) => {
    failedRequests.push(`${label}: ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      badResponses.push(`${label}: ${response.status()} ${response.url()}`);
    }
  });
}

async function readSummary(page) {
  return page.evaluate(() => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.() ?? null;
    const localEntityId = debug?.getLocalEntityId?.() ?? null;
    const local = snapshot?.players.find((player) => player.entityId === localEntityId) ?? null;
    const models = debug?.getModelDiagnostics?.() ?? null;
    const occlusion = debug?.getOcclusionDiagnostics?.() ?? null;
    return {
      tick: snapshot?.tick ?? null,
      local,
      shops: snapshot?.shops ?? [],
      airdrops: snapshot?.airdrops ?? [],
      airdropChannels: snapshot?.airdropChannels ?? [],
      lootDrops: snapshot?.lootDrops ?? [],
      pendingEquipmentPickups: snapshot?.pendingEquipmentPickups ?? [],
      monsterCount: snapshot?.monsters.length ?? 0,
      models,
      occlusion,
      localModel: models?.playerModels.find((model) => model.entityId === localEntityId) ?? null,
    };
  });
}

async function stepTicks(page, count) {
  let remaining = count;
  while (remaining > 0) {
    const stepCount = Math.min(1_000, remaining);
    await page.evaluate((value) => window.__JWGB_DEBUG__?.stepTicks?.(value), stepCount);
    remaining -= stepCount;
  }
}

async function releaseMovementKeys(page) {
  for (const key of MOVEMENT_KEYS) {
    await page.keyboard.up(key).catch(() => {});
  }
}

async function moveToPoint(page, target, label, toleranceMm) {
  let elapsedTicks = 0;
  let stagnantTicks = 0;
  let previousPosition = null;
  while (elapsedTicks < 2_000) {
    const state = await readSummary(page);
    const player = state.local;
    if (!player) {
      throw new Error(`${label}: local player is missing`);
    }
    if (player.lifeState !== 'alive' && player.lifeState !== 'revive-protection') {
      throw new Error(`${label}: local player entered ${player.lifeState}`);
    }
    const remainingDistance = distanceMm(player.position, target);
    if (remainingDistance <= toleranceMm) {
      await releaseMovementKeys(page);
      return state;
    }

    await releaseMovementKeys(page);
    const keys = movementKeysFor(target.x - player.position.x, target.z - player.position.z);
    for (const key of keys) {
      await page.keyboard.down(key);
    }
    const movementPerTick = Math.max(1, player.moveSpeedMmPerSecond / 20);
    const safeTicks = Math.max(
      1,
      Math.floor((remainingDistance - toleranceMm * 0.65) / movementPerTick),
    );
    const stepCount = Math.min(24, safeTicks);
    await stepTicks(page, stepCount);
    elapsedTicks += stepCount;
    for (const key of keys) {
      await page.keyboard.up(key);
    }

    const after = await readSummary(page);
    if (
      previousPosition &&
      after.local?.position.x === previousPosition.x &&
      after.local?.position.z === previousPosition.z
    ) {
      stagnantTicks += stepCount;
    } else {
      stagnantTicks = 0;
    }
    previousPosition = after.local?.position ?? null;
    if (stagnantTicks >= 72) {
      throw new Error(
        `${label}: movement stalled at ${JSON.stringify(after.local?.position ?? null)}`,
      );
    }
  }
  throw new Error(`${label}: route exceeded 2,000 ticks`);
}

async function moveAlongAuthoritativeRoute(page, target, label) {
  const start = (await readSummary(page)).local?.position;
  if (!start) {
    throw new Error(`${label}: route start is missing`);
  }
  const waypoints = authoritativeRouteWaypoints(start, target);
  const plannedDistanceMm = routeLengthMm(start, waypoints);
  await page.keyboard.down('Space');
  try {
    for (let index = 0; index < waypoints.length; index += 1) {
      await moveToPoint(
        page,
        waypoints[index],
        `${label} waypoint ${index + 1}/${waypoints.length}`,
        index === waypoints.length - 1 ? 1_500 : 2_000,
      );
    }
  } finally {
    await page.keyboard.up('Space').catch(() => {});
    await releaseMovementKeys(page);
  }
  return { plannedDistanceMm, waypointCount: waypoints.length };
}

async function moveToOpenShop(page, shopId) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const before = await readSummary(page);
    const shop = before.shops.find((candidate) => candidate.shopId === shopId);
    if (shop?.status !== 'open') {
      throw new Error(`${shopId}: shop is not open`);
    }
    const route = await moveAlongAuthoritativeRoute(
      page,
      shop.position,
      `${shopId} attempt ${attempt}`,
    );
    await page.waitForTimeout(80);
    await stepTicks(page, 1);
    await page.waitForTimeout(80);
    const after = await readSummary(page);
    const currentShop = after.shops.find((candidate) => candidate.shopId === shopId);
    if (
      currentShop?.status === 'open' &&
      after.local &&
      distanceMm(after.local.position, currentShop.position) <= 2_000
    ) {
      return { shop: currentShop, route };
    }
  }
  throw new Error(`${shopId}: shop moved before the player reached it`);
}

async function waitForLocalMap(page) {
  await page.waitForFunction(
    () => {
      const snapshot = window.__JWGB_DEBUG__?.getSnapshot?.();
      return (
        window.__JWGB_DEBUG__?.scenarioId === 'MAP' &&
        snapshot?.players.length === 7 &&
        snapshot.monsters.length === 123
      );
    },
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => {
      const models = window.__JWGB_DEBUG__?.getModelDiagnostics?.();
      return Boolean(
        models &&
          models.visibleInstances > 0 &&
          models.visiblePendingInstances === 0 &&
          models.visibleLoadedInstances === models.visibleInstances,
      );
    },
    undefined,
    { timeout: 180_000 },
  );
}

const shopPage = await context.newPage();
observe(shopPage, 'shop');
await shopPage.goto(localUrl({ active: 'MAP', hero: 'H009', spawn: '-125.4,186.2' }), {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
});
await waitForLocalMap(shopPage);
await shopPage.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(true));
await shopPage.evaluate(() => window.__JWGB_DEBUG__?.stepTicks?.(600));

const shopBefore = await readSummary(shopPage);
const shopUi = await shopPage.evaluate(() => ({
  hidden: document.querySelector('.shop-panel')?.hidden ?? true,
  buyGemButtons: [
    ...document.querySelectorAll('.shop-content .mini-action[aria-label="Buy Gem"]'),
  ].filter((button) => !button.disabled).length,
}));
const buyGemButton = shopPage.locator('.shop-content .mini-action[aria-label="Buy Gem"]').first();
await buyGemButton.waitFor({ state: 'visible', timeout: 10_000 });
await buyGemButton.click();
await shopPage.evaluate(() => window.__JWGB_DEBUG__?.stepTicks?.(1));
const shopAfter = await readSummary(shopPage);
await mkdir(outputDirectory, { recursive: true });
await shopPage.screenshot({ path: join(outputDirectory, 'shop.png'), fullPage: false });
await shopPage.close();

const swapPage = await context.newPage();
observe(swapPage, 'hero-swap');
await swapPage.goto(localUrl({ active: 'MAP', hero: 'H009', spawn: '320.9,-37.3' }), {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
});
await swapPage.waitForFunction(
  () => {
    const snapshot = window.__JWGB_DEBUG__?.getSnapshot?.();
    return Boolean(snapshot?.players.length === 7 && snapshot.monsters.length === 123);
  },
  undefined,
  { timeout: 60_000 },
);
await swapPage.evaluate(() => {
  window.__JWGB_DEBUG__?.setPaused?.(true);
  window.__JWGB_DEBUG__?.restart?.();
});
await swapPage.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const localEntityId = debug?.getLocalEntityId?.();
    const model = debug
      ?.getModelDiagnostics?.()
      .playerModels.find((candidate) => candidate.entityId === localEntityId);
    return Boolean(
      snapshot?.tick === 0 &&
        snapshot.players.length === 7 &&
        snapshot.monsters.length === 123 &&
        model?.modelId === 'H009' &&
        model.loaded,
    );
  },
  undefined,
  { timeout: 180_000 },
);
const swapInitial = await readSummary(swapPage);
const pig = await swapPage.evaluate(({ x, z }) => {
  const snapshot = window.__JWGB_DEBUG__?.getSnapshot?.();
  return (
    snapshot?.monsters.find(
      (monster) =>
        monster.kind === 'pig' && monster.homePosition.x === x && monster.homePosition.z === z,
    ) ?? null
  );
}, PIG_HOME_POSITION);
if (!pig || !swapInitial.local || !swapInitial.localModel) {
  throw new Error('hero swap verification could not resolve the source player, model, or pig');
}

await swapPage.keyboard.down('Space');
let pigKilled = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  await stepTicks(swapPage, 20);
  pigKilled = await swapPage.evaluate(
    (entityId) =>
      !window.__JWGB_DEBUG__
        ?.getSnapshot?.()
        ?.monsters.some((monster) => monster.entityId === entityId),
    pig.entityId,
  );
  if (pigKilled) {
    break;
  }
}
await swapPage.keyboard.up('Space');
if (!pigKilled) {
  throw new Error('source pig was not defeated through normal attacks');
}

let afterPigPickup = await readSummary(swapPage);
for (
  let attempt = 0;
  attempt < 5 && (afterPigPickup.local?.gold ?? 0) < (swapInitial.local.gold ?? 0) + 700;
  attempt += 1
) {
  await swapPage.locator('.interact-button').click();
  await stepTicks(swapPage, 1);
  await swapPage.waitForTimeout(80);
  afterPigPickup = await readSummary(swapPage);
}

if ((afterPigPickup.tick ?? 0) < FIRST_LAND_GOD_OPEN_TICK) {
  await stepTicks(swapPage, FIRST_LAND_GOD_OPEN_TICK - afterPigPickup.tick);
}
const saleSelection = await readSummary(swapPage);
const saleCandidates = saleSelection.shops.filter(
  (shop) => shop.status === 'open' && (shop.kind === 'land-god' || shop.kind === 'shoemaker'),
);
if (!saleSelection.local || saleCandidates.length === 0) {
  throw new Error('no open sale shop was available for the hero swap route');
}
saleCandidates.sort((left, right) => {
  const leftWaypoints = authoritativeRouteWaypoints(saleSelection.local.position, left.position);
  const rightWaypoints = authoritativeRouteWaypoints(saleSelection.local.position, right.position);
  return (
    routeLengthMm(saleSelection.local.position, leftWaypoints) -
      routeLengthMm(saleSelection.local.position, rightWaypoints) ||
    left.shopId.localeCompare(right.shopId)
  );
});
const saleTarget = saleCandidates[0];
const saleArrival = await moveToOpenShop(swapPage, saleTarget.shopId);
const beforeSales = await readSummary(swapPage);
const sellButtons = swapPage.locator('.shop-content .mini-action', { hasText: /^Sell$/ });
if ((await sellButtons.count()) < 2) {
  throw new Error('sale shop did not expose both initial equipment sale actions');
}
for (let index = 0; index < 2; index += 1) {
  await sellButtons.first().click();
  await stepTicks(swapPage, 1);
  await swapPage.waitForTimeout(80);
}
const afterSales = await readSummary(swapPage);

const taibai = afterSales.shops.find((shop) => shop.shopId === 'taibai' && shop.status === 'open');
if (!taibai) {
  throw new Error('Taibai was not open after the equipment sale route');
}
const taibaiArrival = await moveToOpenShop(swapPage, taibai.shopId);
await swapPage.waitForFunction(
  () => {
    const occlusion = window.__JWGB_DEBUG__?.getOcclusionDiagnostics?.();
    return Boolean(
      occlusion &&
        occlusion.occluderCount > 1 &&
        occlusion.activeOccluderCount > 0 &&
        occlusion.activeOccluderCount < occlusion.occluderCount,
    );
  },
  undefined,
  { timeout: 10_000 },
);
const beforeSwap = await readSummary(swapPage);
const targetHeroRow = swapPage.locator('.shop-row', { hasText: HERO_SWAP_TARGET_ID });
const swapButton = targetHeroRow.locator('.mini-action').first();
await swapButton.waitFor({ state: 'visible', timeout: 10_000 });
if (await swapButton.isDisabled()) {
  throw new Error('H018 hero swap action was unexpectedly disabled');
}
await swapButton.click();
await stepTicks(swapPage, 1);
const channelStarted = await readSummary(swapPage);
await stepTicks(swapPage, HERO_SWAP_CHANNEL_TICKS);
await swapPage.waitForFunction(
  ({ entityId, previousUuid }) => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const player = snapshot?.players.find((candidate) => candidate.entityId === entityId);
    const model = debug
      ?.getModelDiagnostics?.()
      .playerModels.find((candidate) => candidate.entityId === entityId);
    return Boolean(
      player?.heroId === 'H018' &&
        model?.modelId === 'H018' &&
        model.loaded &&
        model.fallbackRenderableMeshes === 0 &&
        model.instanceUuid !== null &&
        model.instanceUuid !== previousUuid,
    );
  },
  {
    entityId: swapInitial.local.entityId,
    previousUuid: swapInitial.localModel.instanceUuid,
  },
  { timeout: 180_000 },
);
const afterSwap = await readSummary(swapPage);
await swapPage.screenshot({ path: join(outputDirectory, 'hero-swap.png'), fullPage: false });
await swapPage.close();

const airPage = await context.newPage();
observe(airPage, 'airdrop');
await airPage.goto(localUrl({ active: 'MAP', hero: 'H009', spawn: '161,-241.2' }), {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
});
await waitForLocalMap(airPage);
await airPage.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(true));
const airStart = await readSummary(airPage);
let ticksUntilAirdrop = Math.max(0, 7_200 - (airStart.tick ?? 0));
while (ticksUntilAirdrop > 0) {
  const stepCount = Math.min(1_000, ticksUntilAirdrop);
  await airPage.evaluate((count) => window.__JWGB_DEBUG__?.stepTicks?.(count), stepCount);
  ticksUntilAirdrop -= stepCount;
}
const airBefore = await readSummary(airPage);

await airPage.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(false));
await airPage.keyboard.down('d');
await airPage.waitForTimeout(650);
await airPage.keyboard.up('d');
await airPage.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(true));
const airUiBefore = await airPage.evaluate(() => ({
  hasTarget: document.querySelector('.interact-button')?.classList.contains('has-airdrop-target'),
  label: document.querySelector('.interact-button')?.getAttribute('aria-label'),
}));

await airPage.locator('.interact-button').click();
await airPage.evaluate(() => window.__JWGB_DEBUG__?.stepTicks?.(1));
const channel = await readSummary(airPage);
const remainingChannelTicks =
  channel.airdropChannels[0]?.completesAtTick === undefined
    ? 0
    : Math.max(1, channel.airdropChannels[0].completesAtTick - channel.tick);
await airPage.evaluate(
  (stepCount) => window.__JWGB_DEBUG__?.stepTicks?.(stepCount),
  remainingChannelTicks,
);
const airOpened = await readSummary(airPage);

await airPage.locator('.interact-button').click();
await airPage.evaluate(() => window.__JWGB_DEBUG__?.stepTicks?.(1));
const airCollected = await readSummary(airPage);
await airPage.screenshot({ path: join(outputDirectory, 'airdrop.png'), fullPage: false });
await airPage.close();
await context.close();
await browser.close();

const shop = {
  shopOpen: shopBefore.shops.some((shop) => shop.shopId === 'land-god-a' && shop.status === 'open'),
  panelVisible: !shopUi.hidden,
  buyGemAvailable: shopUi.buyGemButtons > 0,
  purchaseAccepted:
    (shopAfter.local?.gems ?? 0) > (shopBefore.local?.gems ?? 0) &&
    (shopAfter.local?.gold ?? 0) < (shopBefore.local?.gold ?? 0),
  goldBefore: shopBefore.local?.gold ?? null,
  goldAfter: shopAfter.local?.gold ?? null,
  gemsBefore: shopBefore.local?.gems ?? null,
  gemsAfter: shopAfter.local?.gems ?? null,
};
const airdrop = {
  available:
    (airBefore.tick ?? 0) >= 7_200 &&
    airBefore.airdrops[0]?.phase === 'available' &&
    airBefore.airdrops[0]?.position !== null,
  tick: airBefore.tick,
  uiTarget: airUiBefore.hasTarget === true,
  channelStarted: channel.airdropChannels.length === 1,
  opened:
    airOpened.airdrops[0]?.phase === 'opened' &&
    airOpened.lootDrops.length > airBefore.lootDrops.length,
  rewardGranted: (airOpened.local?.gold ?? 0) > (channel.local?.gold ?? 0),
  lootCollected:
    airCollected.lootDrops.length < airOpened.lootDrops.length ||
    (airCollected.local?.equipment.length ?? 0) !== (airOpened.local?.equipment.length ?? 0) ||
    (airCollected.local?.inventoryEquipment.length ?? 0) !==
      (airOpened.local?.inventoryEquipment.length ?? 0),
  position: airBefore.airdrops[0]?.position ?? null,
};
const heroSwap = {
  pigKilled,
  pigRewardCollected: (afterPigPickup.local?.gold ?? 0) - (swapInitial.local?.gold ?? 0) === 700,
  sourceEntityId: swapInitial.local?.entityId ?? null,
  targetEntityId: afterSwap.local?.entityId ?? null,
  sourceHeroId: swapInitial.local?.heroId ?? null,
  targetHeroId: afterSwap.local?.heroId ?? null,
  sourceModelId: swapInitial.localModel?.modelId ?? null,
  targetModelId: afterSwap.localModel?.modelId ?? null,
  sourceInstanceUuid: swapInitial.localModel?.instanceUuid ?? null,
  targetInstanceUuid: afterSwap.localModel?.instanceUuid ?? null,
  modelRebuilt:
    swapInitial.localModel?.instanceUuid !== null &&
    afterSwap.localModel?.instanceUuid !== null &&
    swapInitial.localModel?.instanceUuid !== afterSwap.localModel?.instanceUuid,
  sourceModelLoaded: swapInitial.localModel?.loaded === true,
  targetModelLoaded: afterSwap.localModel?.loaded === true,
  sourceFallbackRenderableMeshes: swapInitial.localModel?.fallbackRenderableMeshes ?? null,
  targetFallbackRenderableMeshes: afterSwap.localModel?.fallbackRenderableMeshes ?? null,
  sourceVisualScale: swapInitial.localModel?.visualScale ?? null,
  targetVisualScale: afterSwap.localModel?.visualScale ?? null,
  saleShopId: saleArrival.shop.shopId,
  saleShopPosition: saleArrival.shop.position,
  saleRoute: saleArrival.route,
  taibaiPosition: taibaiArrival.shop.position,
  taibaiRoute: taibaiArrival.route,
  taibaiOcclusion: beforeSwap.occlusion,
  equipmentBeforeSales:
    (beforeSales.local?.equipment.length ?? 0) +
    (beforeSales.local?.inventoryEquipment.length ?? 0),
  equipmentAfterSales:
    (afterSales.local?.equipment.length ?? 0) + (afterSales.local?.inventoryEquipment.length ?? 0),
  goldBeforePig: swapInitial.local?.gold ?? null,
  goldAfterPig: afterPigPickup.local?.gold ?? null,
  goldBeforeSales: beforeSales.local?.gold ?? null,
  goldAfterSales: afterSales.local?.gold ?? null,
  goldBeforeSwap: beforeSwap.local?.gold ?? null,
  goldAfterSwap: afterSwap.local?.gold ?? null,
  channelStarted:
    channelStarted.local?.taibaiTargetHeroId === HERO_SWAP_TARGET_ID &&
    (channelStarted.local?.taibaiChannelTicks ?? 0) > 0,
  completedTick: afterSwap.tick,
};

const result = {
  schema: 'jwgb.web-local-services-verification.v1',
  verifiedAt: new Date().toISOString(),
  consoleErrors,
  pageErrors,
  failedRequests,
  badResponses,
  shop,
  heroSwap,
  airdrop,
  models: airCollected.models,
};
await writeFile(join(outputDirectory, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`);

const failure =
  consoleErrors.length > 0 ||
  pageErrors.length > 0 ||
  failedRequests.length > 0 ||
  badResponses.length > 0 ||
  !shop.shopOpen ||
  !shop.panelVisible ||
  !shop.buyGemAvailable ||
  !shop.purchaseAccepted ||
  !heroSwap.pigKilled ||
  !heroSwap.pigRewardCollected ||
  heroSwap.sourceEntityId !== heroSwap.targetEntityId ||
  heroSwap.sourceHeroId !== 'H009' ||
  heroSwap.targetHeroId !== HERO_SWAP_TARGET_ID ||
  heroSwap.sourceModelId !== 'H009' ||
  heroSwap.targetModelId !== HERO_SWAP_TARGET_ID ||
  !heroSwap.modelRebuilt ||
  !heroSwap.sourceModelLoaded ||
  !heroSwap.targetModelLoaded ||
  heroSwap.sourceFallbackRenderableMeshes !== 0 ||
  heroSwap.targetFallbackRenderableMeshes !== 0 ||
  (heroSwap.taibaiOcclusion?.activeOccluderCount ?? 0) < 1 ||
  (heroSwap.taibaiOcclusion?.occluderCount ?? 0) <=
    (heroSwap.taibaiOcclusion?.activeOccluderCount ?? Number.POSITIVE_INFINITY) ||
  Math.abs((heroSwap.sourceVisualScale ?? 0) - PLAYER_MODEL_VISUAL_SCALE) > 0.001 ||
  Math.abs((heroSwap.targetVisualScale ?? 0) - PLAYER_MODEL_VISUAL_SCALE) > 0.001 ||
  heroSwap.equipmentBeforeSales !== 2 ||
  heroSwap.equipmentAfterSales !== 0 ||
  (heroSwap.goldAfterSales ?? 0) - (heroSwap.goldBeforeSales ?? 0) !== 480 ||
  (heroSwap.goldBeforeSwap ?? 0) - (heroSwap.goldAfterSwap ?? 0) !== 1_500 ||
  !heroSwap.channelStarted ||
  !airdrop.available ||
  !airdrop.uiTarget ||
  !airdrop.channelStarted ||
  !airdrop.opened ||
  !airdrop.rewardGranted ||
  !airdrop.lootCollected ||
  (result.models?.templatesFailed ?? 1) > 0 ||
  (result.models?.sceneSprites ?? 1) !== 0 ||
  (result.models?.visibleInstances ?? 0) === 0 ||
  (result.models?.visiblePendingInstances ?? 1) !== 0 ||
  (result.models?.renderableFallbackInstances ?? 1) !== 0 ||
  (result.models?.visibleRenderableFallbackInstances ?? 1) !== 0 ||
  result.models?.visibleLoadedInstances !== result.models?.visibleInstances;

if (failure) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(
  `local services verification passed: shop purchase, ` +
    `H009 -> H018 model rebuild, airdrop channel/open/reward/pickup, ` +
    `landing ${airdrop.position?.x},${airdrop.position?.z}`,
);
