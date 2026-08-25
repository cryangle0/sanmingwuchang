import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const url = process.env.JWGB_WEB_URL ?? 'https://fanavatar.org/';
const outputDirectory = process.env.JWGB_WEB_SCREENSHOT_DIR ?? 'migration/reports/web';
const lobbyScreenshotPath = join(outputDirectory, 'fanavatar-lobby-desktop.png');
const selectionScreenshotPath = join(outputDirectory, 'fanavatar-selection-desktop.png');
const loadingScreenshotPath = join(outputDirectory, 'fanavatar-loading-desktop.png');
const screenshotPath = join(outputDirectory, 'fanavatar-online.png');
const landscapeScreenshotPath = join(outputDirectory, 'fanavatar-battle-landscape.png');
const portraitScreenshotPath = join(outputDirectory, 'fanavatar-battle-portrait.png');
const rangePreviewScreenshotPath = join(outputDirectory, 'fanavatar-range-preview.png');
const executablePath =
  process.env.JWGB_BROWSER_EXECUTABLE ??
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => {
    return existsSync(candidate);
  });

if (!executablePath) {
  throw new Error('Chrome or Edge executable not found');
}

const PLAYER_MODEL_VISUAL_SCALE = 1;
const MONSTER_MODEL_VISUAL_SCALE = 1;
const MODELS_BY_KIND = {
  'ground-melee': ['M001', 'M004', 'M008', 'M010', 'M017', 'M023', 'M024', 'M026', 'M033'],
  'ground-ranged': ['M002', 'M005', 'M025'],
  flying: ['M006', 'M009', 'M011', 'M012', 'M016'],
  'elite-tank': ['M003', 'M013'],
  'elite-ranged': ['M007', 'M014'],
};
const PIG_MODELS_BY_ELEMENT = {
  earth: 'M018',
  wood: 'M019',
  water: 'M020',
  fire: 'M021',
  metal: 'M022',
};
const DRAGON_MODELS_BY_ELEMENT = {
  earth: 'M034',
  wood: 'M035',
  water: 'M036',
  fire: 'M037',
  metal: 'M038',
};

function expectedMonsterModelId(monster, rootSeed) {
  const numericId = Math.abs(Number(monster.entityId));
  if (monster.kind === 'pig' && monster.element) {
    return numericId % 6 === 0 ? 'M015' : PIG_MODELS_BY_ELEMENT[monster.element];
  }
  if (monster.kind === 'dragon-king' && monster.element) {
    return DRAGON_MODELS_BY_ELEMENT[monster.element];
  }
  if (monster.kind === 'core-boss') {
    return `M${(27 + ((rootSeed >>> 0) % 6)).toString().padStart(3, '0')}`;
  }
  const candidates = MODELS_BY_KIND[monster.kind];
  return candidates?.[numericId % candidates.length] ?? null;
}

function auditModelIdentity(snapshot, diagnostics) {
  if (!snapshot || !diagnostics) {
    return {
      passed: false,
      playerCount: 0,
      monsterCount: 0,
      playerMismatches: ['snapshot or diagnostics missing'],
      monsterMismatches: ['snapshot or diagnostics missing'],
    };
  }
  const playerModels = new Map(
    diagnostics.playerModels.map((model) => [Number(model.entityId), model]),
  );
  const monsterModels = new Map(
    diagnostics.monsterModels.map((model) => [Number(model.entityId), model]),
  );
  const playerMismatches = [];
  for (const player of snapshot.players) {
    const model = playerModels.get(Number(player.entityId));
    if (
      !model ||
      model.modelId !== player.heroId ||
      model.instanceUuid === null ||
      Math.abs(model.visualScale - PLAYER_MODEL_VISUAL_SCALE) > 0.001
    ) {
      playerMismatches.push({
        entityId: player.entityId,
        expectedModelId: player.heroId,
        actual: model ?? null,
      });
    }
  }
  const monsterMismatches = [];
  for (const monster of snapshot.monsters) {
    const expectedModelId = expectedMonsterModelId(monster, snapshot.rootSeed);
    const model = monsterModels.get(Number(monster.entityId));
    if (
      !model ||
      model.modelId !== expectedModelId ||
      model.instanceUuid === null ||
      Math.abs(model.visualScale - MONSTER_MODEL_VISUAL_SCALE) > 0.001
    ) {
      monsterMismatches.push({
        entityId: monster.entityId,
        kind: monster.kind,
        element: monster.element,
        expectedModelId,
        actual: model ?? null,
      });
    }
  }
  return {
    passed:
      diagnostics.playerModels.length === snapshot.players.length &&
      diagnostics.monsterModels.length === snapshot.monsters.length &&
      playerMismatches.length === 0 &&
      monsterMismatches.length === 0,
    playerCount: diagnostics.playerModels.length,
    monsterCount: diagnostics.monsterModels.length,
    playerMismatches,
    monsterMismatches,
  };
}

async function gotoWithRetry(page, targetUrl) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await page.waitForTimeout(attempt * 1_000);
      }
    }
  }
  throw lastError;
}

async function readHealth(targetUrl) {
  const healthUrl = process.env.JWGB_HEALTH_URL?.trim() || new URL('/health', targetUrl).toString();
  const healthResponse = await fetch(healthUrl, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!healthResponse.ok) {
    throw new Error(`health returned HTTP ${healthResponse.status}`);
  }
  return healthResponse.json();
}

async function waitForFullPopulationRoom(targetUrl, timeoutMs = 15_000) {
  const startedAt = Date.now();
  let health = null;
  while (Date.now() - startedAt < timeoutMs) {
    health = await readHealth(targetUrl);
    const room = health?.diagnostics?.rooms?.find(
      (candidate) =>
        candidate.connectionCount > 0 &&
        candidate.matchStatus === 'running' &&
        candidate.authoritativePlayerCount === 30 &&
        candidate.authoritativeMonsterCount > 0 &&
        candidate.maximumAuthoritativeMonsterCount === 123,
    );
    if (room) {
      return { health, room };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`timed out waiting for full authoritative population: ${JSON.stringify(health)}`);
}

async function waitForFlowScreen(page, expectedScreen, timeoutMs = 20_000) {
  await page.waitForFunction(
    (screen) => document.querySelector('.application-shell')?.dataset.flowScreen === screen,
    expectedScreen,
    { timeout: timeoutMs },
  );
}

async function readFlowEntryState(page) {
  return page.evaluate(() => ({
    screen: window.__JWGB_FLOW__?.getState?.().screen ?? null,
    runtimeCreationCount: window.__JWGB_FLOW__?.getRuntimeCreationCount?.() ?? null,
    runtimeHeroId: window.__JWGB_FLOW__?.getRuntimeHeroId?.() ?? null,
    battleDebugPresent: Boolean(window.__JWGB_DEBUG__),
  }));
}

async function verifyExplicitOnlineMode(context, targetUrl) {
  const modePage = await context.newPage();
  try {
    const explicitUrl = new URL(targetUrl);
    explicitUrl.searchParams.set('mode', 'online');
    await gotoWithRetry(modePage, explicitUrl.toString());
    await waitForFlowScreen(modePage, 'lobby');
    const state = await readFlowEntryState(modePage);
    if (
      state.screen !== 'lobby' ||
      state.runtimeCreationCount !== 0 ||
      state.runtimeHeroId !== null ||
      state.battleDebugPresent
    ) {
      throw new Error(`explicit online mode did not open the lobby: ${JSON.stringify(state)}`);
    }
    return state;
  } finally {
    await modePage.close().catch(() => {});
  }
}

async function verifyFlowAndEnterBattle(page) {
  await waitForFlowScreen(page, 'lobby');
  const lobbyState = await readFlowEntryState(page);
  await mkdir(outputDirectory, { recursive: true });
  await page.screenshot({ path: lobbyScreenshotPath, fullPage: false });

  if (
    lobbyState.screen !== 'lobby' ||
    lobbyState.runtimeCreationCount !== 0 ||
    lobbyState.runtimeHeroId !== null ||
    lobbyState.battleDebugPresent
  ) {
    throw new Error(`default URL did not open a clean online lobby: ${JSON.stringify(lobbyState)}`);
  }

  await page.evaluate(() => window.__JWGB_FLOW__?.startMatch?.());
  await waitForFlowScreen(page, 'select');
  const selectionState = await page.evaluate(() => {
    const state = window.__JWGB_FLOW__?.getState?.();
    const selectedHeroId = state?.recommendedHeroId ?? state?.offers?.[0] ?? null;
    if (selectedHeroId) {
      window.__JWGB_FLOW__?.selectHero?.(selectedHeroId);
    }
    return {
      screen: window.__JWGB_FLOW__?.getState?.().screen ?? null,
      offers: state?.offers ?? [],
      selectedHeroId,
      runtimeCreationCount: window.__JWGB_FLOW__?.getRuntimeCreationCount?.() ?? null,
      battleDebugPresent: Boolean(window.__JWGB_DEBUG__),
    };
  });
  await page.screenshot({ path: selectionScreenshotPath, fullPage: false });
  if (
    selectionState.screen !== 'select' ||
    selectionState.selectedHeroId === null ||
    selectionState.offers.length !== 3 ||
    selectionState.runtimeCreationCount !== 0 ||
    selectionState.battleDebugPresent
  ) {
    throw new Error(`hero selection did not render correctly: ${JSON.stringify(selectionState)}`);
  }

  await page.evaluate(() => window.__JWGB_FLOW__?.confirmHero?.());
  await waitForFlowScreen(page, 'loading');
  const loadingState = await readFlowEntryState(page);
  await page.screenshot({ path: loadingScreenshotPath, fullPage: false });
  if (
    loadingState.screen !== 'loading' ||
    (loadingState.runtimeCreationCount !== 0 && loadingState.runtimeCreationCount !== 1) ||
    (loadingState.runtimeCreationCount === 0 && loadingState.runtimeHeroId !== null)
  ) {
    throw new Error(`loading screen state is inconsistent: ${JSON.stringify(loadingState)}`);
  }

  await page.waitForFunction(
    () => window.__JWGB_FLOW__?.getRuntimeCreationCount?.() === 1,
    undefined,
    { timeout: 45_000 },
  );
  await page.waitForFunction(
    () => {
      const debug = window.__JWGB_DEBUG__;
      const snapshot = debug?.getSnapshot?.();
      const localEntityId = debug?.getLocalEntityId?.();
      return Boolean(
        snapshot &&
          localEntityId !== null &&
          localEntityId !== undefined &&
          snapshot.players.some((player) => player.entityId === localEntityId) &&
          snapshot.match.status === 'running',
      );
    },
    undefined,
    { timeout: 45_000 },
  );
  await waitForFlowScreen(page, 'battle', 45_000);
  return {
    lobbyState,
    selectionState,
    loadingState,
    battleState: await readFlowEntryState(page),
  };
}

async function readResponsiveHudState(page) {
  return page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const selectors = [
      '.storm-hud',
      '.resource-hud',
      '.population-hud',
      '.connection-chip',
      '.camera-view-button',
      '.target-frame',
      '.player-status',
      '.motion-hud',
      '.build-strip',
      '.progress-panel',
      '.shop-panel',
      '.minimap-overlay',
      '.action-cluster',
      '.game-menu-button',
    ];
    const rects = selectors
      .map((selector) => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        if (!element || !rect || rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        return {
          selector,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        };
      })
      .filter(Boolean);
    const outOfViewport = rects.filter(
      (rect) =>
        rect.x < -1 ||
        rect.y < -1 ||
        rect.right > viewport.width + 1 ||
        rect.bottom > viewport.height + 1,
    );
    const overlapping = [];
    for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
      const left = rects[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
        const right = rects[rightIndex];
        const overlapWidth = Math.min(left.right, right.right) - Math.max(left.x, right.x);
        const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.y, right.y);
        if (overlapWidth > 2 && overlapHeight > 2) {
          overlapping.push({
            left: left.selector,
            right: right.selector,
            overlapWidth,
            overlapHeight,
          });
        }
      }
    }
    const overflowingText = Array.from(document.querySelectorAll('.hud *'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && element.textContent?.trim();
      })
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .slice(0, 20)
      .map((element) => element.className || element.tagName);
    return { viewport, rects, outOfViewport, overlapping, overflowingText };
  });
}

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
try {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await gotoWithRetry(page, url);
  const explicitOnlineModeState = await verifyExplicitOnlineMode(context, url);
  const flowVerification = await verifyFlowAndEnterBattle(page);
  const initialPopulation = await waitForFullPopulationRoom(url);
  const beforeInput = await page.evaluate(() => {
    const snapshot = window.__JWGB_DEBUG__?.getSnapshot?.();
    if (!snapshot) return null;
    const localEntityId = window.__JWGB_DEBUG__?.getLocalEntityId?.() ?? null;
    const localPlayer =
      snapshot.players.find((player) => player.entityId === localEntityId) ??
      snapshot.players[0] ??
      null;
    return localPlayer
      ? {
          entityId: localPlayer.entityId,
          position: localPlayer.position,
        }
      : null;
  });
  await page.locator('.game-canvas').click({ position: { x: 720, y: 450 } });
  let movedDuringInput = false;
  for (const key of ['d', 'w', 'a', 's']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(600);
    await page.keyboard.up(key);
    await page.waitForTimeout(200);
    const currentPosition = await page.evaluate((entityId) => {
      const snapshot = window.__JWGB_DEBUG__?.getSnapshot?.();
      const player = snapshot?.players.find((candidate) => candidate.entityId === entityId);
      return player?.position ?? null;
    }, beforeInput?.entityId ?? null);
    movedDuringInput ||= Boolean(
      beforeInput &&
        currentPosition &&
        (currentPosition.x !== beforeInput.position.x ||
          currentPosition.z !== beforeInput.position.z),
    );
    if (movedDuringInput) {
      break;
    }
  }
  await page.keyboard.press('Space');
  await page.waitForTimeout(1_000);
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
  const cameraViewButton = page.locator('.camera-view-button');
  await cameraViewButton.waitFor({ state: 'visible', timeout: 10_000 });
  const cameraViews = [];
  cameraViews.push(
    await page.evaluate(() => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null),
  );
  await cameraViewButton.click();
  await page.waitForFunction(
    () => {
      const camera = window.__JWGB_DEBUG__?.getCameraDiagnostics?.();
      return Boolean(
        camera && camera.mode === 'close' && Math.abs(camera.zoom - camera.targetZoom) < 0.025,
      );
    },
    undefined,
    { timeout: 10_000 },
  );
  cameraViews.push(
    await page.evaluate(() => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null),
  );
  await page.keyboard.press('v');
  await page.waitForFunction(
    () => {
      const camera = window.__JWGB_DEBUG__?.getCameraDiagnostics?.();
      return Boolean(
        camera && camera.mode === 'tactical' && Math.abs(camera.zoom - camera.targetZoom) < 0.025,
      );
    },
    undefined,
    { timeout: 10_000 },
  );
  cameraViews.push(
    await page.evaluate(() => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null),
  );
  await page.keyboard.press('v');
  await page.waitForFunction(
    () => {
      const camera = window.__JWGB_DEBUG__?.getCameraDiagnostics?.();
      return Boolean(
        camera && camera.mode === 'standard' && Math.abs(camera.zoom - camera.targetZoom) < 0.025,
      );
    },
    undefined,
    { timeout: 10_000 },
  );
  cameraViews.push(
    await page.evaluate(() => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null),
  );
  const gameCanvas = page.locator('.game-canvas');
  const gameCanvasBounds = await gameCanvas.boundingBox();
  if (!gameCanvasBounds) {
    throw new Error('game canvas did not expose bounds');
  }
  const cameraControlPoint = {
    x: gameCanvasBounds.x + gameCanvasBounds.width * 0.56,
    y: gameCanvasBounds.y + gameCanvasBounds.height * 0.52,
  };
  const beforeCameraWheel = cameraViews.at(-1) ?? null;
  await page.mouse.move(cameraControlPoint.x, cameraControlPoint.y);
  await page.mouse.wheel(0, -160);
  await page.waitForFunction(
    (beforeScale) => {
      const camera = window.__JWGB_DEBUG__?.getCameraDiagnostics?.();
      return Boolean(
        camera &&
          beforeScale !== null &&
          camera.zoomScale > beforeScale &&
          Math.abs(camera.zoom - camera.targetZoom) < 0.025,
      );
    },
    beforeCameraWheel?.zoomScale ?? null,
    { timeout: 10_000 },
  );
  const afterCameraWheel = await page.evaluate(
    () => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
  );
  const beforeCameraDrag = afterCameraWheel;
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cameraControlPoint.x + 104, cameraControlPoint.y - 48, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(
    (beforeYaw) => {
      const camera = window.__JWGB_DEBUG__?.getCameraDiagnostics?.();
      return Boolean(
        camera &&
          beforeYaw !== null &&
          Math.abs(camera.yawDegrees - beforeYaw) > 1 &&
          Math.abs(camera.offset[0] - camera.targetOffset[0]) < 0.025,
      );
    },
    beforeCameraDrag?.yawDegrees ?? null,
    { timeout: 10_000 },
  );
  const afterCameraDrag = await page.evaluate(
    () => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
  );
  await page.keyboard.press('Home');
  await page.waitForFunction(
    () => {
      const camera = window.__JWGB_DEBUG__?.getCameraDiagnostics?.();
      return Boolean(
        camera &&
          camera.controlsCustomized === false &&
          Math.abs(camera.zoom - camera.targetZoom) < 0.025 &&
          camera.offset.every(
            (value, index) => Math.abs(value - camera.targetOffset[index]) < 0.025,
          ),
      );
    },
    undefined,
    { timeout: 10_000 },
  );
  const afterCameraReset = await page.evaluate(
    () => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
  );
  const cameraControls = {
    initialViewLowerAndCloser:
      cameraViews[0]?.presetOffset?.join(',') === '12,10.6,12' &&
      Math.abs((cameraViews[0]?.presetZoom ?? 0) - 1.12) < 0.001,
    wheelZoomed:
      beforeCameraWheel !== null &&
      afterCameraWheel !== null &&
      afterCameraWheel.zoomScale > beforeCameraWheel.zoomScale,
    rightDragOrbit:
      beforeCameraDrag !== null &&
      afterCameraDrag !== null &&
      Math.abs(afterCameraDrag.yawDegrees - beforeCameraDrag.yawDegrees) > 1,
    reset:
      afterCameraReset?.controlsCustomized === false &&
      afterCameraReset?.zoomScale === 1 &&
      Math.hypot(afterCameraReset?.panOffset?.[0] ?? 1, afterCameraReset?.panOffset?.[1] ?? 1) <
        0.001,
  };
  await page.waitForTimeout(2_000);
  await page.evaluate(() => window.__JWGB_DEBUG__?.resetRenderPerformanceDiagnostics?.());
  await page.waitForFunction(
    () => (window.__JWGB_DEBUG__?.getRenderPerformanceDiagnostics?.().sampledFrames ?? 0) >= 240,
    undefined,
    { timeout: 20_000 },
  );

  const diagnostics = await page.evaluate(() => ({
    pixels: window.__JWGB_DEBUG__?.getRenderPixelDiagnostics?.() ?? null,
    performance: window.__JWGB_DEBUG__?.getRenderPerformanceDiagnostics?.() ?? null,
    sceneContributors: window.__JWGB_DEBUG__?.getRenderSceneContributorDiagnostics?.() ?? null,
    renderEntities: window.__JWGB_DEBUG__?.getRenderEntityDiagnostics?.() ?? null,
    models: window.__JWGB_DEBUG__?.getModelDiagnostics?.() ?? null,
    connectionState: window.__JWGB_DEBUG__?.getConnectionState?.() ?? null,
    snapshot: window.__JWGB_DEBUG__?.getSnapshot?.() ?? null,
    attackControl: (() => {
      const button = document.querySelector('.attack-button');
      return button instanceof HTMLButtonElement
        ? { visible: button.getClientRects().length > 0, disabled: button.disabled }
        : null;
    })(),
  }));
  const health = await readHealth(url);
  await mkdir(outputDirectory, { recursive: true });
  const attackButton = page.locator('.attack-button');
  if ((await attackButton.count()) !== 1) {
    throw new Error('attack button was not uniquely rendered');
  }
  await attackButton.hover();
  await page.waitForTimeout(250);
  const rangePreview = await page.evaluate(
    () => window.__JWGB_DEBUG__?.getCombatRangePreviewDiagnostics?.() ?? null,
  );
  await page.screenshot({ path: rangePreviewScreenshotPath, fullPage: false });
  await page.mouse.move(12, 12);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(350);
  const landscapeHud = await readResponsiveHudState(page);
  await page.screenshot({ path: landscapeScreenshotPath, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  const portraitHud = await readResponsiveHudState(page);
  await page.screenshot({ path: portraitScreenshotPath, fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(350);
  const beforeRestartStateHash = diagnostics.snapshot?.stateHash ?? null;
  await page.evaluate(() => window.__JWGB_DEBUG__?.restart?.());
  await page.waitForFunction(
    (previousStateHash) => {
      const debug = window.__JWGB_DEBUG__;
      const snapshot = debug?.getSnapshot?.();
      const localEntityId = debug?.getLocalEntityId?.();
      return Boolean(
        snapshot &&
          localEntityId !== null &&
          localEntityId !== undefined &&
          snapshot.players.some((player) => player.entityId === localEntityId) &&
          snapshot.match.status === 'running' &&
          snapshot.stateHash !== previousStateHash,
      );
    },
    beforeRestartStateHash,
    { timeout: 45_000 },
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
  const afterRestartSnapshot = await page.evaluate(
    () => window.__JWGB_DEBUG__?.getSnapshot?.() ?? null,
  );
  await page.waitForTimeout(1_000);
  const afterRestartScreenshotPath = join(outputDirectory, 'fanavatar-online-after-restart.png');
  await page.screenshot({ path: afterRestartScreenshotPath, fullPage: false });

  const modelFailures = failedRequests.filter((value) => value.includes('/models/'));
  const navigationRetryFailures = failedRequests.filter((value) =>
    value.startsWith(`${url}: net::ERR_ABORTED`),
  );
  const unexpectedFailedRequests = failedRequests.filter(
    (value) => !navigationRetryFailures.includes(value),
  );
  const recoverableConsoleErrors = consoleErrors.filter(
    (value) => value.includes('WebSocket connection') && value.includes('ERR_CONNECTION_TIMED_OUT'),
  );
  const unexpectedConsoleErrors = consoleErrors.filter(
    (value) => !recoverableConsoleErrors.includes(value),
  );
  const snapshot = diagnostics.snapshot;
  const modelIdentity = auditModelIdentity(snapshot, diagnostics.models);
  const afterInputPlayer =
    beforeInput && snapshot
      ? snapshot.players.find((player) => player.entityId === beforeInput.entityId)
      : null;
  const moved =
    movedDuringInput ||
    (beforeInput !== null &&
      afterInputPlayer !== null &&
      (afterInputPlayer.position.x !== beforeInput.position.x ||
        afterInputPlayer.position.z !== beforeInput.position.z));
  const pixelRatio =
    diagnostics.pixels && diagnostics.pixels.sampledPixels > 0
      ? diagnostics.pixels.nonBlackPixels / diagnostics.pixels.sampledPixels
      : 0;
  const result = {
    schema: 'jwgb.web-browser-verification.v1',
    verifiedAt: new Date().toISOString(),
    url,
    flowScreenshots: {
      lobby: lobbyScreenshotPath,
      selection: selectionScreenshotPath,
      loading: loadingScreenshotPath,
    },
    screenshotPath,
    rangePreviewScreenshotPath,
    landscapeScreenshotPath,
    portraitScreenshotPath,
    afterRestartScreenshotPath,
    consoleErrors,
    pageErrors,
    failedRequests,
    badResponses,
    diagnostics: {
      pixels: diagnostics.pixels,
      performance: diagnostics.performance,
      sceneContributors: diagnostics.sceneContributors,
      renderEntities: diagnostics.renderEntities,
      models: diagnostics.models,
      modelIdentity,
      connectionState: diagnostics.connectionState,
      initialHealth: initialPopulation.health,
      initialPopulationRoom: initialPopulation.room,
      health,
      flow: {
        explicitOnlineModeState,
        ...flowVerification,
      },
      rangePreview,
      responsive: {
        landscape: landscapeHud,
        portrait: portraitHud,
      },
      navigationRetryFailures,
      unexpectedFailedRequests,
      recoverableConsoleErrors,
      unexpectedConsoleErrors,
      playability: {
        moved,
        cameraSwitching:
          cameraViews.map((camera) => camera?.mode).join(',') ===
          'standard,close,tactical,standard',
        cameraViews,
        cameraControls,
        attackControl: diagnostics.attackControl,
        restartedIntoFreshMatch:
          beforeRestartStateHash !== null &&
          afterRestartSnapshot !== null &&
          afterRestartSnapshot.stateHash !== beforeRestartStateHash,
        beforeRestartStateHash,
        afterRestartStateHash: afterRestartSnapshot?.stateHash ?? null,
      },
      snapshot: snapshot
        ? {
            tick: snapshot.tick,
            stateHash: snapshot.stateHash,
            playerCount: snapshot.players.length,
            monsterCount: snapshot.monsters.length,
          }
        : null,
    },
  };
  await writeFile(
    join(outputDirectory, 'browser-verification.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );

  if (
    unexpectedConsoleErrors.length > 0 ||
    (recoverableConsoleErrors.length > 0 && diagnostics.connectionState !== 'online') ||
    pageErrors.length > 0 ||
    unexpectedFailedRequests.length > 0 ||
    modelFailures.length > 0 ||
    !snapshot ||
    !snapshot.stateHash ||
    flowVerification.battleState.screen !== 'battle' ||
    flowVerification.battleState.runtimeCreationCount !== 1 ||
    flowVerification.battleState.runtimeHeroId !== flowVerification.selectionState.selectedHeroId ||
    !rangePreview ||
    rangePreview.mode !== 'attack' ||
    !rangePreview.attackVisible ||
    landscapeHud.outOfViewport.length > 0 ||
    landscapeHud.overlapping.length > 0 ||
    landscapeHud.overflowingText.length > 0 ||
    portraitHud.outOfViewport.length > 0 ||
    portraitHud.overlapping.length > 0 ||
    portraitHud.overflowingText.length > 0 ||
    !moved ||
    !result.diagnostics.playability.cameraSwitching ||
    !Object.values(result.diagnostics.playability.cameraControls).every(Boolean) ||
    !afterRestartSnapshot ||
    afterRestartSnapshot.stateHash === beforeRestartStateHash ||
    !diagnostics.attackControl?.visible ||
    diagnostics.attackControl.disabled ||
    pixelRatio < 0.2 ||
    !diagnostics.performance ||
    diagnostics.performance.sampledFrames < 120 ||
    diagnostics.performance.averageFps < 45 ||
    diagnostics.performance.averageFps > 70 ||
    diagnostics.performance.p95FrameMs > 35 ||
    !diagnostics.models ||
    diagnostics.models.templatesFailed > 0 ||
    diagnostics.models.templatesLoaded === 0 ||
    diagnostics.models.sceneSprites !== 0 ||
    diagnostics.models.visibleInstances === 0 ||
    diagnostics.models.visiblePendingInstances !== 0 ||
    diagnostics.models.visibleLoadedInstances !== diagnostics.models.visibleInstances ||
    !modelIdentity.passed ||
    !diagnostics.renderEntities ||
    diagnostics.models.visibleInstances !==
      diagnostics.renderEntities.visiblePlayerVisuals +
        diagnostics.renderEntities.visibleMonsterVisuals ||
    !health?.ok ||
    (health?.diagnostics?.authoritativePlayerCount ?? 0) < 1 ||
    initialPopulation.room.authoritativePlayerCount !== 30 ||
    initialPopulation.room.authoritativeMonsterCount <= 0 ||
    initialPopulation.room.maximumAuthoritativeMonsterCount !== 123
  ) {
    console.error(JSON.stringify(result, null, 2));
    throw new Error('browser verification failed');
  }
  console.log(
    `browser verification passed: ${snapshot.players.length} visible players, ` +
      `${snapshot.monsters.length} visible monsters, ` +
      `${initialPopulation.room.authoritativePlayerCount} initial authoritative players, ` +
      `${initialPopulation.room.maximumAuthoritativeMonsterCount} peak authoritative monsters, ` +
      `${initialPopulation.room.authoritativeMonsterCount} current authoritative monsters, ` +
      `model templates ${diagnostics.models.templatesLoaded}, ` +
      `${diagnostics.models.visibleLoadedInstances}/${diagnostics.models.visibleInstances} visible 3D models, ` +
      `identity ${modelIdentity.playerCount} players/${modelIdentity.monsterCount} monsters, ` +
      `movement/view ${moved ? 'passed' : 'failed'}, restart passed, ` +
      `${diagnostics.performance.averageFps.toFixed(1)} FPS, ` +
      `${diagnostics.performance.drawCalls} draw calls, pixels ${(pixelRatio * 100).toFixed(1)}%`,
  );
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
