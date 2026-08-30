import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const targetUrl = new URL(
  process.env.JWGB_LOCAL_WEB_URL ?? 'http://127.0.0.1:4181/?active=MAP&hero=H009&spawn=-330.7,-82',
);
targetUrl.searchParams.set('mode', 'local');
const url = targetUrl.toString();
const outputDirectory =
  process.env.JWGB_LOCAL_WEB_SCREENSHOT_DIR ?? 'migration/reports/web/local-map';
const screenshotPath = join(outputDirectory, 'local-map.png');
const standardScreenshotPath = join(outputDirectory, 'camera-standard.png');
const closeScreenshotPath = join(outputDirectory, 'camera-close.png');
const tacticalScreenshotPath = join(outputDirectory, 'camera-tactical.png');
const worldMapScreenshotPath = join(outputDirectory, 'world-map.png');
const mobileScreenshotPath = join(outputDirectory, 'mobile-map.png');
const mobileWorldMapScreenshotPath = join(outputDirectory, 'mobile-world-map.png');
const expectedHeroId = new URL(url).searchParams.get('hero');
const expectedSpawn = new URL(url).searchParams.get('spawn');
const expectsLocalizedTreeOcclusion = expectedHeroId === 'H018' && expectedSpawn === '-330.7,-82';
const executablePath =
  process.env.JWGB_BROWSER_EXECUTABLE ??
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error('Chrome or Edge executable not found');
}

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];
const PLAYER_MODEL_VISUAL_SCALE = 1.5;
const MONSTER_MODEL_VISUAL_SCALE = 1;
const REQUIRED_GRASSWORKS_ASSETS = [
  'models/grassworks/grass-atlas5.png',
  'models/grassworks/grassworks-trees.glb',
];
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
  const passed =
    diagnostics.playerModels.length === snapshot.players.length &&
    diagnostics.monsterModels.length === snapshot.monsters.length &&
    playerMismatches.length === 0 &&
    monsterMismatches.length === 0;
  return {
    passed,
    playerCount: diagnostics.playerModels.length,
    monsterCount: diagnostics.monsterModels.length,
    playerMismatches,
    monsterMismatches,
  };
}

page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
  }
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

const readSummary = async () =>
  page.evaluate(() => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.() ?? null;
    const localEntityId = debug?.getLocalEntityId?.() ?? null;
    const local = snapshot?.players.find((player) => player.entityId === localEntityId) ?? null;
    return {
      scenarioId: debug?.scenarioId ?? null,
      tick: snapshot?.tick ?? null,
      rootSeed: snapshot?.rootSeed ?? null,
      stateHash: snapshot?.stateHash ?? null,
      mapGeometryHash: snapshot?.mapGeometryHash ?? null,
      playerCount: snapshot?.players.length ?? 0,
      monsterCount: snapshot?.monsters.length ?? 0,
      lootCount: snapshot?.lootDrops.length ?? 0,
      pendingEquipmentPickups: snapshot?.pendingEquipmentPickups.length ?? 0,
      pendingActiveReplacements: snapshot?.pendingActiveReplacements.length ?? 0,
      local: local
        ? {
            entityId: local.entityId,
            heroId: local.heroId,
            position: local.position,
            hp: local.hp,
            gold: local.gold,
            gems: local.gems,
            experience: local.experience,
            attackCooldownTicks: local.attackCooldownTicks,
            activeCooldownTicks: local.activeCooldownTicks,
            activeBuffTicks: local.activeBuffTicks,
            lastCombatTick: local.lastCombatTick,
            lifeState: local.lifeState,
          }
        : null,
      renderEntities: debug?.getRenderEntityDiagnostics?.() ?? null,
      models: debug?.getModelDiagnostics?.() ?? null,
      flora: debug?.getFloraModelDiagnostics?.() ?? null,
      mapAssets: debug?.getMapAssetDiagnostics?.() ?? null,
      globalScenes: debug?.getGlobalSceneDiagnostics?.() ?? null,
      camera: debug?.getCameraDiagnostics?.() ?? null,
      occlusion: debug?.getOcclusionDiagnostics?.() ?? null,
      combatEffects: debug?.getCombatEffectDiagnostics?.() ?? null,
      performance: debug?.getRenderPerformanceDiagnostics?.() ?? null,
      pixels: debug?.getRenderPixelDiagnostics?.() ?? null,
    };
  });

const readMapRuntime = async () =>
  page.evaluate(() => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.() ?? null;
    const localEntityId = debug?.getLocalEntityId?.() ?? null;
    const local = snapshot?.players.find((player) => player.entityId === localEntityId) ?? null;
    return {
      map: debug?.getMapDiagnostics?.() ?? null,
      input: debug?.getInputDiagnostics?.() ?? null,
      camera: debug?.getCameraDiagnostics?.() ?? null,
      localPosition: local?.position ?? null,
      tick: snapshot?.tick ?? null,
    };
  });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const entities = debug?.getRenderEntityDiagnostics?.();
    return Boolean(
      debug?.scenarioId === 'MAP' &&
        snapshot?.mapGeometryHash !== null &&
        snapshot.players.length === 7 &&
        snapshot.monsters.length === 123 &&
        entities?.playerVisuals === 7 &&
        entities.monsterVisuals === 123,
    );
  },
  undefined,
  { timeout: 60_000 },
);

await page.evaluate(() => {
  window.__JWGB_DEBUG__?.setPaused?.(true);
  window.__JWGB_DEBUG__?.restart?.();
});
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const entities = debug?.getRenderEntityDiagnostics?.();
    return Boolean(
      snapshot?.tick === 0 &&
        snapshot.players.length === 7 &&
        snapshot.monsters.length === 123 &&
        entities?.playerVisuals === 7 &&
        entities.monsterVisuals === 123,
    );
  },
  undefined,
  { timeout: 30_000 },
);

await page.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(false));
const cameraViewButton = page.locator('.camera-view-button');
await cameraViewButton.waitFor({ state: 'visible', timeout: 10_000 });
await page.waitForFunction(
  (heroId) => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const localEntityId = debug?.getLocalEntityId?.() ?? null;
    const local = snapshot?.players.find((player) => player.entityId === localEntityId);
    const localModel = debug
      ?.getModelDiagnostics?.()
      .playerModels.find((model) => model.entityId === localEntityId);
    return Boolean(
      local &&
        (!heroId || local.heroId === heroId) &&
        localModel?.modelId === local.heroId &&
        localModel.loaded === true &&
        localModel.fallbackRenderableMeshes === 0,
    );
  },
  expectedHeroId,
  { timeout: 180_000 },
);
await page.waitForFunction(
  () => {
    const flora = window.__JWGB_DEBUG__?.getFloraModelDiagnostics?.();
    return Boolean(
      flora?.status === 'ready' &&
        flora.source === 'grassworks' &&
        flora.failedAssets.length === 0 &&
        flora.loadedAssets.length === 2 &&
        flora.grassInstances > 100_000 &&
        flora.visibleGrassInstances > 0 &&
        flora.treeInstances > 0 &&
        flora.visibleTreeInstances > 0 &&
        flora.instancedBatches > 0 &&
        flora.legacyFloraInstances === 0 &&
        flora.legacyScatterInstances === 0 &&
        flora.legacyGlobalSceneVegetationInstances === 0 &&
        flora.visible === true,
    );
  },
  undefined,
  { timeout: 180_000 },
);
await page.waitForFunction(
  () => {
    const assets = window.__JWGB_DEBUG__?.getMapAssetDiagnostics?.();
    return Boolean(
      assets?.status === 'ready' &&
        assets.failedAssets.length === 0 &&
        assets.rockInstances > 0 &&
        assets.instancedBatches > 0 &&
        assets.visible === true,
    );
  },
  undefined,
  { timeout: 180_000 },
);
await page.waitForFunction(
  () => {
    const scenes = window.__JWGB_DEBUG__?.getGlobalSceneDiagnostics?.();
    return Boolean(
      scenes?.status === 'disabled' &&
        scenes.failedAssets.length === 0 &&
        scenes.loadedAssets.length === 0 &&
        scenes.placements === 0 &&
        scenes.instancedBatches === 0 &&
        scenes.visible === false,
    );
  },
  undefined,
  { timeout: 180_000 },
);
await mkdir(outputDirectory, { recursive: true });
const cameraViews = [];
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const localEntityId = debug?.getLocalEntityId?.() ?? null;
    const local = snapshot?.players.find((player) => player.entityId === localEntityId);
    const camera = debug?.getCameraDiagnostics?.();
    if (!local || !camera || camera.mode !== 'standard') {
      return false;
    }
    return (
      Math.abs(camera.target[0] - local.position.x / 1_000) < 0.025 &&
      Math.abs(camera.target[2] - local.position.z / 1_000) < 0.025 &&
      camera.offset.every((value, index) => Math.abs(value - camera.targetOffset[index]) < 0.025) &&
      Math.abs(camera.zoom - 1.12) < 0.025 &&
      camera.presetOffset.every(
        (value, index) => Math.abs(value - [12, 10.6, 12][index]) < 0.001,
      ) &&
      camera.controlsCustomized === false
    );
  },
  undefined,
  { timeout: 10_000 },
);
cameraViews.push(
  await page.evaluate(() => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null),
);
const standardOcclusion = await page.evaluate(
  () => window.__JWGB_DEBUG__?.getOcclusionDiagnostics?.() ?? null,
);
const standardLocalModel = await page.evaluate(() => {
  const debug = window.__JWGB_DEBUG__;
  const localEntityId = debug?.getLocalEntityId?.() ?? null;
  return (
    debug?.getModelDiagnostics?.().playerModels.find((model) => model.entityId === localEntityId) ??
    null
  );
});
await page.screenshot({ path: standardScreenshotPath, fullPage: false });
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
await page.screenshot({ path: closeScreenshotPath, fullPage: false });
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
await page.screenshot({ path: tacticalScreenshotPath, fullPage: false });
await page.keyboard.press('v');
await page.waitForFunction(
  () => {
    const camera = window.__JWGB_DEBUG__?.getCameraDiagnostics?.();
    return Boolean(
      camera &&
        camera.mode === 'standard' &&
        Math.abs(camera.zoom - camera.targetZoom) < 0.025 &&
        camera.offset.every((value, index) => Math.abs(value - camera.targetOffset[index]) < 0.025),
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
await page.mouse.move(cameraControlPoint.x, cameraControlPoint.y);

const beforeWheelCamera = await page.evaluate(
  () => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
);
await page.mouse.wheel(0, -180);
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
  beforeWheelCamera?.zoomScale ?? null,
  { timeout: 10_000 },
);
const afterWheelCamera = await page.evaluate(
  () => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
);

const beforeTiltCamera = afterWheelCamera;
await page.keyboard.down('Shift');
try {
  await page.mouse.wheel(0, 120);
} finally {
  await page.keyboard.up('Shift');
}
await page.waitForFunction(
  (beforePitch) => {
    const camera = window.__JWGB_DEBUG__?.getCameraDiagnostics?.();
    return Boolean(
      camera &&
        beforePitch !== null &&
        camera.pitchDegrees > beforePitch &&
        Math.abs(camera.offset[1] - camera.targetOffset[1]) < 0.025,
    );
  },
  beforeTiltCamera?.pitchDegrees ?? null,
  { timeout: 10_000 },
);
const afterTiltCamera = await page.evaluate(
  () => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
);

await page.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(true));
const beforeRightDragCamera = await page.evaluate(
  () => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
);
await page.mouse.move(cameraControlPoint.x, cameraControlPoint.y);
await page.mouse.down({ button: 'right' });
await page.mouse.move(cameraControlPoint.x + 120, cameraControlPoint.y - 56, { steps: 8 });
await page.mouse.up({ button: 'right' });
const afterRightDrag = await page.evaluate(() => ({
  camera: window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
  input: window.__JWGB_DEBUG__?.getInputDiagnostics?.() ?? null,
  canvasClass: document.querySelector('.game-canvas')?.className ?? '',
}));

await page.mouse.click(cameraControlPoint.x, cameraControlPoint.y, { button: 'right' });
const afterRightClick = await page.evaluate(
  () => window.__JWGB_DEBUG__?.getInputDiagnostics?.() ?? null,
);
await page.evaluate(() => window.__JWGB_DEBUG__?.stepTicks?.(1));

await page.mouse.move(cameraControlPoint.x, cameraControlPoint.y);
await page.mouse.down({ button: 'middle' });
await page.mouse.move(cameraControlPoint.x + 96, cameraControlPoint.y + 64, { steps: 8 });
await page.mouse.up({ button: 'middle' });
const afterMiddleDrag = await page.evaluate(() => ({
  camera: window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
  input: window.__JWGB_DEBUG__?.getInputDiagnostics?.() ?? null,
}));
await page.mouse.click(cameraControlPoint.x, cameraControlPoint.y, { button: 'middle' });
const afterMiddleClick = await page.evaluate(
  () => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
);

const beforeAlternateOrbit = afterMiddleClick;
await page.keyboard.down('Alt');
try {
  await page.mouse.move(cameraControlPoint.x, cameraControlPoint.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(cameraControlPoint.x - 88, cameraControlPoint.y + 32, { steps: 8 });
  await page.mouse.up({ button: 'left' });
} finally {
  await page.keyboard.up('Alt');
}
const afterAlternateOrbit = await page.evaluate(() => ({
  camera: window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
  input: window.__JWGB_DEBUG__?.getInputDiagnostics?.() ?? null,
}));

const beforeKeyboardCamera = afterAlternateOrbit.camera;
await page.evaluate(() => {
  for (const code of ['KeyC', 'KeyL', 'Equal']) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  }
});
const afterKeyboardCamera = await page.evaluate(
  () => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
);

await page.keyboard.press('Home');
const afterCameraReset = await page.evaluate(
  () => window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
);
await page.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(false));
await page.waitForFunction(
  () => {
    const camera = window.__JWGB_DEBUG__?.getCameraDiagnostics?.();
    return Boolean(
      camera &&
        camera.controlsCustomized === false &&
        Math.abs(camera.zoom - camera.targetZoom) < 0.025 &&
        camera.offset.every((value, index) => Math.abs(value - camera.targetOffset[index]) < 0.025),
    );
  },
  undefined,
  { timeout: 10_000 },
);

const cameraControls = {
  initialViewLowerAndCloser:
    cameraViews[0]?.presetOffset?.join(',') === '12,10.6,12' &&
    Math.abs((cameraViews[0]?.presetZoom ?? 0) - 1.12) < 0.001,
  wheelZoomed:
    beforeWheelCamera !== null &&
    afterWheelCamera !== null &&
    afterWheelCamera.zoomScale > beforeWheelCamera.zoomScale &&
    afterWheelCamera.zoom > beforeWheelCamera.zoom,
  shiftWheelTilted:
    beforeTiltCamera !== null &&
    afterTiltCamera !== null &&
    afterTiltCamera.pitchDegrees > beforeTiltCamera.pitchDegrees,
  rightDragOrbit:
    beforeRightDragCamera !== null &&
    afterRightDrag.camera !== null &&
    Math.abs(afterRightDrag.camera.yawDegrees - beforeRightDragCamera.yawDegrees) > 1 &&
    afterRightDrag.input?.activeQueued === false &&
    !afterRightDrag.canvasClass.includes('is-camera-orbiting'),
  rightClickSkill: afterRightClick?.activeQueued === true,
  middleDragPan:
    Math.hypot(
      afterMiddleDrag.camera?.panOffset?.[0] ?? 0,
      afterMiddleDrag.camera?.panOffset?.[1] ?? 0,
    ) > 0.25 && afterMiddleDrag.input?.activeQueued === false,
  middleClickFocus:
    Math.hypot(afterMiddleClick?.panOffset?.[0] ?? 1, afterMiddleClick?.panOffset?.[1] ?? 1) <
    0.001,
  alternateOrbit:
    beforeAlternateOrbit !== null &&
    afterAlternateOrbit.camera !== null &&
    Math.abs(afterAlternateOrbit.camera.yawDegrees - beforeAlternateOrbit.yawDegrees) > 1 &&
    afterAlternateOrbit.input?.attackPressed === false &&
    afterAlternateOrbit.input?.attackQueued === false,
  keyboardControls:
    beforeKeyboardCamera !== null &&
    afterKeyboardCamera !== null &&
    afterKeyboardCamera.yawDegrees !== beforeKeyboardCamera.yawDegrees &&
    afterKeyboardCamera.zoomScale > beforeKeyboardCamera.zoomScale &&
    Math.hypot(
      afterKeyboardCamera.panOffset[0] - beforeKeyboardCamera.panOffset[0],
      afterKeyboardCamera.panOffset[1] - beforeKeyboardCamera.panOffset[1],
    ) > 0.1,
  reset:
    afterCameraReset?.controlsCustomized === false &&
    afterCameraReset?.zoomScale === 1 &&
    Math.hypot(afterCameraReset?.panOffset?.[0] ?? 1, afterCameraReset?.panOffset?.[1] ?? 1) <
      0.001,
};

await gameCanvas.click({ position: { x: 720, y: 450 } });
let cameraMotionSamples = [];
await page.keyboard.down('d');
try {
  cameraMotionSamples = await page.evaluate(async () => {
    const samples = [];
    for (let frame = 0; frame < 180; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const camera = window.__JWGB_DEBUG__?.getCameraDiagnostics?.();
      if (camera) {
        samples.push(camera);
      }
    }
    return samples;
  });
} finally {
  await page.keyboard.up('d');
}
const vectorDistance = (left, right) =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
const cameraRelativeOffsets = cameraMotionSamples.map((camera) => [
  camera.position[0] - camera.target[0],
  camera.position[1] - camera.target[1],
  camera.position[2] - camera.target[2],
]);
const cameraStability = {
  sampleCount: cameraMotionSamples.length,
  desiredMovement:
    cameraMotionSamples.length > 1
      ? vectorDistance(
          cameraMotionSamples[0].desiredTarget,
          cameraMotionSamples.at(-1).desiredTarget,
        )
      : 0,
  maximumRelativeOffsetError: cameraMotionSamples.reduce(
    (maximum, camera, index) =>
      Math.max(maximum, vectorDistance(cameraRelativeOffsets[index], camera.offset)),
    0,
  ),
  maximumFramePositionStep: cameraMotionSamples.reduce(
    (maximum, camera, index) =>
      index === 0
        ? maximum
        : Math.max(
            maximum,
            vectorDistance(camera.position, cameraMotionSamples[index - 1].position),
          ),
    0,
  ),
};

await page.evaluate(() => {
  window.__JWGB_DEBUG__?.setPaused?.(true);
  window.__JWGB_DEBUG__?.restart?.();
});
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    return debug?.getSnapshot?.()?.tick === 0 && debug?.getMapDiagnostics?.() !== null;
  },
  undefined,
  { timeout: 30_000 },
);

const minimapOpenButton = page.locator('.minimap-open-button');
await minimapOpenButton.click();
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    return (
      debug?.getMapDiagnostics?.().open === true && debug?.getInputDiagnostics?.().enabled === false
    );
  },
  undefined,
  { timeout: 5_000 },
);
const mapOpened = await readMapRuntime();

await page.evaluate(() => {
  for (const code of ['KeyW', 'Space', 'KeyE', 'KeyR']) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  }

  const attackButton = document.querySelector('.attack-button');
  attackButton?.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 91 }),
  );
  attackButton?.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 91 }),
  );
  document.querySelector('.active-skill')?.click();
  document.querySelector('.interact-button')?.click();

  const joystick = document.querySelector('.joystick');
  const bounds = joystick?.getBoundingClientRect();
  if (joystick && bounds) {
    const startX = bounds.left + bounds.width / 2;
    const startY = bounds.top + bounds.height / 2;
    joystick.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: startX,
        clientY: startY,
        pointerId: 92,
      }),
    );
    joystick.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: startX + bounds.width * 0.25,
        clientY: startY,
        pointerId: 92,
      }),
    );
    joystick.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        clientX: startX + bounds.width * 0.25,
        clientY: startY,
        pointerId: 92,
      }),
    );
  }
});
const mapAfterBlockedInput = await readMapRuntime();
const mapSteppedSnapshot = await page.evaluate(() => window.__JWGB_DEBUG__?.stepTicks?.(3) ?? null);
const mapAfterStep = await readMapRuntime();
const mapInputBlocked =
  mapOpened.localPosition !== null &&
  mapAfterStep.localPosition !== null &&
  mapOpened.localPosition.x === mapAfterStep.localPosition.x &&
  mapOpened.localPosition.z === mapAfterStep.localPosition.z &&
  mapAfterBlockedInput.input?.enabled === false &&
  mapAfterBlockedInput.input.pressedKeys.length === 0 &&
  mapAfterBlockedInput.input.attackPressed === false &&
  mapAfterBlockedInput.input.attackQueued === false &&
  mapAfterBlockedInput.input.activeQueued === false &&
  mapAfterBlockedInput.input.alternateActiveQueued === false &&
  mapAfterBlockedInput.input.interactQueued === false &&
  mapAfterBlockedInput.input.joystick?.[2] === false &&
  mapSteppedSnapshot?.tick === 3;

await page.locator('.world-map-zoom-in').click();
await page.waitForFunction(
  () => window.__JWGB_DEBUG__?.getMapDiagnostics?.().worldMapZoom === 1.5,
  undefined,
  { timeout: 5_000 },
);
const zoomAfterButton = (await readMapRuntime()).map?.worldMapZoom ?? null;
const worldMapCanvas = page.locator('.world-map-canvas');
const worldMapBounds = await worldMapCanvas.boundingBox();
if (!worldMapBounds) {
  throw new Error('world map canvas did not expose bounds');
}
await worldMapCanvas.hover({
  position: { x: worldMapBounds.width / 2, y: worldMapBounds.height / 2 },
});
await page.mouse.wheel(0, -120);
await page.waitForFunction(
  () => window.__JWGB_DEBUG__?.getMapDiagnostics?.().worldMapZoom === 2.25,
  undefined,
  { timeout: 5_000 },
);
const zoomAfterWheel = (await readMapRuntime()).map?.worldMapZoom ?? null;

await worldMapCanvas.click({
  position: { x: worldMapBounds.width / 2, y: worldMapBounds.height / 2 },
});
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    return Boolean(
      debug?.getMapDiagnostics?.().waypoint &&
        debug?.getCameraDiagnostics?.().navigationWaypointVisible,
    );
  },
  undefined,
  { timeout: 5_000 },
);
const waypointSet = await readMapRuntime();
const waypointCoordinatesMatch =
  waypointSet.map?.waypoint !== null &&
  waypointSet.map?.waypoint !== undefined &&
  waypointSet.camera?.navigationWaypointVisible === true &&
  Math.abs(waypointSet.camera.navigationWaypointPosition[0] - waypointSet.map.waypoint.x / 1_000) <
    0.001 &&
  Math.abs(waypointSet.camera.navigationWaypointPosition[2] - waypointSet.map.waypoint.z / 1_000) <
    0.001;

await page.locator('.world-map-clear').click();
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    return (
      debug?.getMapDiagnostics?.().waypoint === null &&
      debug?.getCameraDiagnostics?.().navigationWaypointVisible === false
    );
  },
  undefined,
  { timeout: 5_000 },
);
const waypointCleared = await readMapRuntime();

const centerBeforeDrag = (await readMapRuntime()).map?.worldMapCenter ?? null;
await page.mouse.move(
  worldMapBounds.x + worldMapBounds.width / 2,
  worldMapBounds.y + worldMapBounds.height / 2,
);
await page.mouse.down();
await page.mouse.move(
  worldMapBounds.x + worldMapBounds.width / 2 + 96,
  worldMapBounds.y + worldMapBounds.height / 2 + 64,
  { steps: 8 },
);
await page.mouse.up();
await page.waitForFunction(
  (before) => {
    const center = window.__JWGB_DEBUG__?.getMapDiagnostics?.().worldMapCenter;
    return Boolean(before && center && (center.x !== before.x || center.z !== before.z));
  },
  centerBeforeDrag,
  { timeout: 5_000 },
);
const centerAfterDrag = (await readMapRuntime()).map?.worldMapCenter ?? null;
const mapDragged =
  centerBeforeDrag !== null &&
  centerAfterDrag !== null &&
  (centerBeforeDrag.x !== centerAfterDrag.x || centerBeforeDrag.z !== centerAfterDrag.z);

await page.screenshot({ path: worldMapScreenshotPath, fullPage: false });
await page.keyboard.press('m');
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    return (
      debug?.getMapDiagnostics?.().open === false && debug?.getInputDiagnostics?.().enabled === true
    );
  },
  undefined,
  { timeout: 5_000 },
);
const closedByM = (await readMapRuntime()).map?.open === false;
await page.keyboard.press('m');
await page.waitForFunction(
  () => window.__JWGB_DEBUG__?.getMapDiagnostics?.().open === true,
  undefined,
  { timeout: 5_000 },
);
const reopenedByM = (await readMapRuntime()).map?.open === true;
await page.keyboard.press('Escape');
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    return (
      debug?.getMapDiagnostics?.().open === false && debug?.getInputDiagnostics?.().enabled === true
    );
  },
  undefined,
  { timeout: 5_000 },
);
const closedByEscape = (await readMapRuntime()).map?.open === false;
await page.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(false));

const desktopLayout = await page.evaluate(() => {
  const rectangle = (selector) => {
    const bounds = document.querySelector(selector)?.getBoundingClientRect();
    return bounds
      ? {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        }
      : null;
  };
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyScrollWidth: document.body.scrollWidth,
    bodyScrollHeight: document.body.scrollHeight,
    minimap: rectangle('.minimap-overlay'),
    cameraButton: rectangle('.camera-view-button'),
    menuButton: rectangle('.game-menu-button'),
    actionCluster: rectangle('.action-cluster'),
    playerStatus: rectangle('.player-status'),
  };
});
const overlaps = (left, right) =>
  Boolean(
    left &&
      right &&
      left.left < right.right &&
      left.right > right.left &&
      left.top < right.bottom &&
      left.bottom > right.top,
  );
const insideViewport = (rectangle, viewport) =>
  Boolean(
    rectangle &&
      rectangle.left >= 0 &&
      rectangle.top >= 0 &&
      rectangle.right <= viewport.width &&
      rectangle.bottom <= viewport.height,
  );
const desktopHudLayoutPassed =
  desktopLayout.bodyScrollWidth <= desktopLayout.viewport.width &&
  desktopLayout.bodyScrollHeight <= desktopLayout.viewport.height &&
  insideViewport(desktopLayout.minimap, desktopLayout.viewport) &&
  insideViewport(desktopLayout.cameraButton, desktopLayout.viewport) &&
  insideViewport(desktopLayout.menuButton, desktopLayout.viewport) &&
  !overlaps(desktopLayout.minimap, desktopLayout.cameraButton) &&
  !overlaps(desktopLayout.minimap, desktopLayout.menuButton) &&
  !overlaps(desktopLayout.cameraButton, desktopLayout.menuButton) &&
  !overlaps(desktopLayout.minimap, desktopLayout.actionCluster) &&
  !overlaps(desktopLayout.minimap, desktopLayout.playerStatus);
const mapInteraction = {
  openedByClick: mapOpened.map?.open === true && mapOpened.input?.enabled === false,
  inputBlocked: mapInputBlocked,
  zoomButtonWorked: zoomAfterButton === 1.5,
  wheelZoomWorked: zoomAfterWheel === 2.25,
  waypointSet: waypointCoordinatesMatch,
  waypointCleared:
    waypointCleared.map?.waypoint === null &&
    waypointCleared.camera?.navigationWaypointVisible === false,
  dragged: mapDragged,
  closedByM,
  reopenedByM,
  closedByEscape,
};

await page.evaluate(() => {
  window.__JWGB_DEBUG__?.setPaused?.(true);
  window.__JWGB_DEBUG__?.restart?.();
});
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    return Boolean(
      snapshot &&
        snapshot.tick === 0 &&
        snapshot.players.length === 7 &&
        snapshot.monsters.length === 123,
    );
  },
  undefined,
  { timeout: 30_000 },
);
const initial = await readSummary();
const initialHash = initial.stateHash;
const initialLocal = initial.local;
if (!initialLocal || initialHash === null) {
  throw new Error('local MAP did not expose an initial local player and state hash');
}
await page.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(false));

let moved = false;
for (const key of ['d', 'w', 'a', 's']) {
  const before = await readSummary();
  await page.keyboard.down(key);
  await page.waitForTimeout(450);
  await page.keyboard.up(key);
  await page.waitForTimeout(150);
  const after = await readSummary();
  if (
    before.local &&
    after.local &&
    (before.local.position.x !== after.local.position.x ||
      before.local.position.z !== after.local.position.z)
  ) {
    moved = true;
    break;
  }
}

const attackButton = page.locator('.attack-button');
await attackButton.waitFor({ state: 'visible', timeout: 10_000 });
const beforeAttack = await readSummary();
await attackButton.hover();
await page.mouse.down();
try {
  await page.waitForFunction(
    ({ beforeEffectCount, heroId }) => {
      const debug = window.__JWGB_DEBUG__;
      const snapshot = debug?.getSnapshot?.();
      const localEntityId = debug?.getLocalEntityId?.() ?? null;
      const local = snapshot?.players.find((player) => player.entityId === localEntityId);
      const effects = debug?.getCombatEffectDiagnostics?.();
      return Boolean(
        local &&
          local.heroId === heroId &&
          local.attackCooldownTicks > 0 &&
          effects &&
          effects.basicAttackEffectsSpawned > beforeEffectCount &&
          effects.lastAttackHeroId === heroId,
      );
    },
    {
      beforeEffectCount: beforeAttack.combatEffects?.basicAttackEffectsSpawned ?? 0,
      heroId: expectedHeroId,
    },
    { timeout: 10_000 },
  );
} finally {
  await page.mouse.up();
}
const attackAfter = await readSummary();
const attackTriggered = Boolean(
  attackAfter.local &&
    (attackAfter.local.attackCooldownTicks > 0 ||
      attackAfter.local.lastCombatTick > (beforeAttack.local?.lastCombatTick ?? -1) ||
      attackAfter.local.lastCombatTick > (beforeAttack.tick ?? -1)),
);
const attackEffectRendered =
  (attackAfter.combatEffects?.basicAttackEffectsSpawned ?? 0) >
  (beforeAttack.combatEffects?.basicAttackEffectsSpawned ?? 0);

const activeButton = page.locator('.active-skill');
const beforeActive = await readSummary();
await activeButton.click();
await page.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const localEntityId = debug?.getLocalEntityId?.() ?? null;
    const local = snapshot?.players.find((player) => player.entityId === localEntityId);
    return Boolean(local && (local.activeCooldownTicks > 0 || local.activeBuffTicks > 0));
  },
  { timeout: 5_000 },
);
const activeAfter = await readSummary();
const activeTriggered = Boolean(
  activeAfter.local &&
    (activeAfter.local.activeCooldownTicks > 0 || activeAfter.local.activeBuffTicks > 0),
);
const activeEffectRendered =
  (activeAfter.combatEffects?.activeCastEffectsSpawned ?? 0) >
  (beforeActive.combatEffects?.activeCastEffectsSpawned ?? 0);

const beforeLoot = await readSummary();
await page.keyboard.down('Space');
await page.waitForTimeout(2_500);
await page.keyboard.up('Space');
await page.waitForTimeout(250);
const combatAfter = await readSummary();
const lootDropped = combatAfter.lootCount > beforeLoot.lootCount;
const impactEffectRendered =
  (combatAfter.combatEffects?.impactEffectsSpawned ?? 0) >
  (beforeAttack.combatEffects?.impactEffectsSpawned ?? 0);
const combatEffectBudgetRespected = Boolean(
  combatAfter.combatEffects &&
    combatAfter.combatEffects.transientEffects <= combatAfter.combatEffects.transientLimit,
);
let lootCollected = false;
if (combatAfter.lootCount > 0 || combatAfter.pendingEquipmentPickups > 0) {
  const beforePickup = await readSummary();
  await page.locator('.interact-button').click();
  await page.waitForTimeout(300);
  const afterPickup = await readSummary();
  lootCollected =
    afterPickup.lootCount < beforePickup.lootCount ||
    (afterPickup.local?.gold ?? 0) > (beforePickup.local?.gold ?? 0) ||
    (afterPickup.local?.experience ?? 0) > (beforePickup.local?.experience ?? 0) ||
    afterPickup.pendingEquipmentPickups < beforePickup.pendingEquipmentPickups;
}

const beforeRestart = await readSummary();
await page.evaluate(() => {
  window.__JWGB_DEBUG__?.setPaused?.(true);
  window.__JWGB_DEBUG__?.restart?.();
});
await page.waitForFunction(
  (expectedHash) => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    return Boolean(
      snapshot &&
        snapshot.tick === 0 &&
        snapshot.stateHash === expectedHash &&
        snapshot.players.length === 7 &&
        snapshot.monsters.length === 123,
    );
  },
  initialHash,
  { timeout: 30_000 },
);
const restarted = await readSummary();
await page.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(false));

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
await page.waitForTimeout(1_000);
await page.evaluate(() => window.__JWGB_DEBUG__?.resetRenderPerformanceDiagnostics?.());
await page.waitForFunction(
  () => (window.__JWGB_DEBUG__?.getRenderPerformanceDiagnostics?.().sampledFrames ?? 0) >= 240,
  undefined,
  { timeout: 20_000 },
);

const final = await readSummary();
const identitySource = await page.evaluate(() => ({
  snapshot: window.__JWGB_DEBUG__?.getSnapshot?.() ?? null,
  models: window.__JWGB_DEBUG__?.getModelDiagnostics?.() ?? null,
}));
const modelIdentity = auditModelIdentity(identitySource.snapshot, identitySource.models);
await page.screenshot({ path: screenshotPath, fullPage: false });

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
const mobilePage = await mobileContext.newPage();
mobilePage.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(`mobile: ${message.text()}`);
  }
});
mobilePage.on('pageerror', (error) => pageErrors.push(`mobile: ${String(error)}`));
mobilePage.on('requestfailed', (request) => {
  failedRequests.push(`mobile: ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
});
mobilePage.on('response', (response) => {
  if (response.status() >= 400) {
    badResponses.push(`mobile: ${response.status()} ${response.url()}`);
  }
});
await mobilePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await mobilePage.waitForFunction(
  (heroId) => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const localEntityId = debug?.getLocalEntityId?.() ?? null;
    const local = snapshot?.players.find((player) => player.entityId === localEntityId);
    const models = debug?.getModelDiagnostics?.();
    const localModel = models?.playerModels.find((model) => model.entityId === localEntityId);
    return Boolean(
      local &&
        (!heroId || local.heroId === heroId) &&
        localModel?.modelId === local.heroId &&
        localModel.loaded === true &&
        localModel.fallbackRenderableMeshes === 0,
    );
  },
  expectedHeroId,
  { timeout: 180_000 },
);
await mobilePage.waitForFunction(
  () => {
    const flora = window.__JWGB_DEBUG__?.getFloraModelDiagnostics?.();
    const globalScenes = window.__JWGB_DEBUG__?.getGlobalSceneDiagnostics?.();
    const performance = window.__JWGB_DEBUG__?.getRenderPerformanceDiagnostics?.();
    return Boolean(
      flora?.status === 'ready' &&
        flora.source === 'grassworks' &&
        flora.failedAssets.length === 0 &&
        flora.loadedAssets.length === 2 &&
        flora.maxGrassDistanceMeters === 96 &&
        flora.grassInstances > 100_000 &&
        flora.visibleGrassInstances > 0 &&
        flora.treeInstances > 0 &&
        flora.visibleTreeInstances > 0 &&
        flora.instancedBatches > 0 &&
        flora.legacyFloraInstances === 0 &&
        flora.legacyScatterInstances === 0 &&
        flora.legacyGlobalSceneVegetationInstances === 0 &&
        flora.visible === true &&
        globalScenes?.status === 'disabled' &&
        globalScenes.failedAssets.length === 0 &&
        globalScenes.loadedAssets.length === 0 &&
        globalScenes.placements === 0 &&
        globalScenes.instancedBatches === 0 &&
        globalScenes.visible === false &&
        performance?.graphicsTier === 'reduced',
    );
  },
  undefined,
  { timeout: 180_000 },
);
const mobileRuntime = await mobilePage.evaluate(() => ({
  performance: window.__JWGB_DEBUG__?.getRenderPerformanceDiagnostics?.() ?? null,
  flora: window.__JWGB_DEBUG__?.getFloraModelDiagnostics?.() ?? null,
  globalScenes: window.__JWGB_DEBUG__?.getGlobalSceneDiagnostics?.() ?? null,
}));
await mobilePage.waitForTimeout(500);
const mobileLayout = await mobilePage.evaluate(() => ({
  viewport: { width: window.innerWidth, height: window.innerHeight },
  bodyScrollWidth: document.body.scrollWidth,
  bodyScrollHeight: document.body.scrollHeight,
  ...(() => {
    const rectangle = (selector) => {
      const bounds = document.querySelector(selector)?.getBoundingClientRect();
      return bounds
        ? {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            width: bounds.width,
            height: bounds.height,
          }
        : null;
    };
    return {
      canvas: rectangle('.game-canvas'),
      minimap: rectangle('.minimap-overlay'),
      cameraButton: rectangle('.camera-view-button'),
      menuButton: rectangle('.game-menu-button'),
      actionCluster: rectangle('.action-cluster'),
      playerStatus: rectangle('.player-status'),
    };
  })(),
}));
await mobilePage.screenshot({ path: mobileScreenshotPath, fullPage: false });
await mobilePage.locator('.minimap-open-button').click();
await mobilePage.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    return (
      debug?.getMapDiagnostics?.().open === true && debug?.getInputDiagnostics?.().enabled === false
    );
  },
  undefined,
  { timeout: 5_000 },
);
const mobileWorldMapLayout = await mobilePage.evaluate(() => {
  const rectangle = (selector) => {
    const bounds = document.querySelector(selector)?.getBoundingClientRect();
    return bounds
      ? {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        }
      : null;
  };
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    panel: rectangle('.world-map-panel'),
    header: rectangle('.world-map-header'),
    title: rectangle('.world-map-title'),
    tools: rectangle('.world-map-tools'),
    canvas: rectangle('.world-map-canvas'),
  };
});
await mobilePage.screenshot({ path: mobileWorldMapScreenshotPath, fullPage: false });
await mobilePage.keyboard.press('Escape');
await mobilePage.waitForFunction(
  () => {
    const debug = window.__JWGB_DEBUG__;
    return (
      debug?.getMapDiagnostics?.().open === false && debug?.getInputDiagnostics?.().enabled === true
    );
  },
  undefined,
  { timeout: 5_000 },
);
const mobileMapClosed = await mobilePage.evaluate(
  () => window.__JWGB_DEBUG__?.getMapDiagnostics?.().open === false,
);
await mobileContext.close();

const pixelCoverage =
  final.pixels && final.pixels.sampledPixels > 0
    ? final.pixels.nonBlackPixels / final.pixels.sampledPixels
    : 0;
const grassworksVegetationReady = Boolean(
  final.flora?.status === 'ready' &&
    final.flora.source === 'grassworks' &&
    final.flora.failedAssets.length === 0 &&
    final.flora.grassInstances > 100_000 &&
    final.flora.visibleGrassInstances > 0 &&
    final.flora.treeInstances > 0 &&
    final.flora.visibleTreeInstances > 0 &&
    final.flora.instancedBatches > 0 &&
    final.flora.legacyFloraInstances === 0 &&
    final.flora.legacyScatterInstances === 0 &&
    final.flora.legacyGlobalSceneVegetationInstances === 0 &&
    final.flora.visible === true,
);
const requiredGrassworksAssetsLoaded = Boolean(
  final.flora?.loadedAssets.length === REQUIRED_GRASSWORKS_ASSETS.length &&
    REQUIRED_GRASSWORKS_ASSETS.every((asset) => final.flora?.loadedAssets.includes(asset)),
);
const mapAssetLayerReady = Boolean(
  final.mapAssets?.status === 'ready' &&
    final.mapAssets.failedAssets.length === 0 &&
    final.mapAssets.rockInstances > 0 &&
    final.mapAssets.instancedBatches > 0 &&
    final.mapAssets.visible === true,
);
const legacyGlobalSceneLayerDisabled = Boolean(
  final.globalScenes?.status === 'disabled' &&
    final.globalScenes.failedAssets.length === 0 &&
    final.globalScenes.loadedAssets.length === 0 &&
    final.globalScenes.placements === 0 &&
    final.globalScenes.instancedBatches === 0 &&
    final.globalScenes.visible === false,
);
const result = {
  schema: 'jwgb.web-local-map-verification.v1',
  verifiedAt: new Date().toISOString(),
  url,
  screenshotPath,
  consoleErrors,
  pageErrors,
  failedRequests,
  badResponses,
  checks: {
    authoritativePopulation:
      initial.playerCount === 7 &&
      initial.monsterCount === 123 &&
      initial.scenarioId === 'MAP' &&
      initial.mapGeometryHash !== null,
    renderPopulation:
      initial.renderEntities?.playerVisuals === 7 && initial.renderEntities?.monsterVisuals === 123,
    moved,
    attackTriggered,
    attackEffectRendered,
    activeTriggered,
    activeEffectRendered,
    impactEffectRendered,
    combatEffectBudgetRespected,
    lootDropped,
    lootCollected,
    deterministicRestart: restarted.stateHash === initialHash && restarted.tick === 0,
    cameraSwitching:
      cameraViews.map((camera) => camera?.mode).join(',') === 'standard,close,tactical,standard',
    cameraControls: Object.values(cameraControls).every(Boolean),
    cameraMovementStable:
      cameraStability.sampleCount >= 120 &&
      cameraStability.desiredMovement > 0.5 &&
      cameraStability.maximumRelativeOffsetError < 0.000_01 &&
      cameraStability.maximumFramePositionStep < 0.5,
    mapInteraction: Object.values(mapInteraction).every(Boolean),
    desktopHudLayout: desktopHudLayoutPassed,
    modelIdentity: modelIdentity.passed,
    grassworksVegetationReady,
    requiredGrassworksAssetsLoaded,
    mapAssetLayerReady,
    legacyGlobalSceneLayerDisabled,
    requestedHero:
      expectedHeroId === null ||
      (initial.local?.heroId === expectedHeroId &&
        final.models?.playerModels.some(
          (model) =>
            model.entityId === final.local?.entityId &&
            model.modelId === expectedHeroId &&
            model.loaded === true &&
            model.fallbackRenderableMeshes === 0,
        ) === true),
    localizedTreeOcclusion:
      !expectsLocalizedTreeOcclusion ||
      (standardLocalModel?.modelId === expectedHeroId &&
        standardLocalModel.loaded === true &&
        standardLocalModel.fallbackRenderableMeshes === 0 &&
        standardOcclusion !== null &&
        standardOcclusion.treeCount >= 240 &&
        standardOcclusion.activeTreeCount >= 0 &&
        standardOcclusion.activeTreeCount <= standardOcclusion.treeCount &&
        standardOcclusion.fadingTreeCount === 0 &&
        (standardOcclusion.activeTreeCount === 0
          ? standardOcclusion.treeOpacity === 1
          : standardOcclusion.treeOpacity >= 0.28 && standardOcclusion.treeOpacity < 1)),
    mobileLayout:
      mobileLayout.bodyScrollWidth <= mobileLayout.viewport.width &&
      mobileLayout.bodyScrollHeight <= mobileLayout.viewport.height &&
      mobileLayout.canvas !== null &&
      mobileLayout.canvas.left >= 0 &&
      mobileLayout.canvas.top >= 0 &&
      mobileLayout.canvas.right <= mobileLayout.viewport.width &&
      mobileLayout.canvas.bottom <= mobileLayout.viewport.height &&
      insideViewport(mobileLayout.minimap, mobileLayout.viewport) &&
      insideViewport(mobileLayout.cameraButton, mobileLayout.viewport) &&
      insideViewport(mobileLayout.menuButton, mobileLayout.viewport) &&
      !overlaps(mobileLayout.minimap, mobileLayout.cameraButton) &&
      !overlaps(mobileLayout.minimap, mobileLayout.menuButton) &&
      !overlaps(mobileLayout.cameraButton, mobileLayout.menuButton) &&
      !overlaps(mobileLayout.minimap, mobileLayout.actionCluster) &&
      !overlaps(mobileLayout.minimap, mobileLayout.playerStatus),
    mobilePerformanceTier:
      mobileRuntime.performance?.graphicsTier === 'reduced' &&
      mobileRuntime.flora?.source === 'grassworks' &&
      mobileRuntime.flora?.failedAssets.length === 0 &&
      mobileRuntime.flora.loadedAssets.length === REQUIRED_GRASSWORKS_ASSETS.length &&
      REQUIRED_GRASSWORKS_ASSETS.every((asset) =>
        mobileRuntime.flora.loadedAssets.includes(asset),
      ) &&
      mobileRuntime.flora.maxGrassDistanceMeters === 96 &&
      mobileRuntime.flora.legacyFloraInstances === 0 &&
      mobileRuntime.flora.legacyScatterInstances === 0 &&
      mobileRuntime.flora.legacyGlobalSceneVegetationInstances === 0 &&
      mobileRuntime.globalScenes?.status === 'disabled' &&
      mobileRuntime.globalScenes.failedAssets.length === 0 &&
      mobileRuntime.globalScenes.loadedAssets.length === 0 &&
      mobileRuntime.globalScenes.placements === 0 &&
      mobileRuntime.globalScenes.instancedBatches === 0 &&
      mobileRuntime.globalScenes.visible === false,
    mobileWorldMap:
      mobileMapClosed &&
      insideViewport(mobileWorldMapLayout.panel, mobileWorldMapLayout.viewport) &&
      insideViewport(mobileWorldMapLayout.header, mobileWorldMapLayout.viewport) &&
      insideViewport(mobileWorldMapLayout.canvas, mobileWorldMapLayout.viewport) &&
      !overlaps(mobileWorldMapLayout.title, mobileWorldMapLayout.tools),
  },
  mapInteraction,
  desktopLayout,
  cameraViews,
  cameraControls,
  cameraStability,
  standardOcclusion,
  standardLocalModel,
  flora: final.flora,
  mapAssets: final.mapAssets,
  globalScenes: final.globalScenes,
  screenshots: {
    standard: standardScreenshotPath,
    close: closeScreenshotPath,
    tactical: tacticalScreenshotPath,
    worldMap: worldMapScreenshotPath,
    final: screenshotPath,
    mobile: mobileScreenshotPath,
    mobileWorldMap: mobileWorldMapScreenshotPath,
  },
  expectedHeroId,
  mobileLayout,
  mobileRuntime,
  mobileWorldMapLayout,
  initial,
  combatVerification: {
    beforeAttack: beforeAttack.combatEffects,
    afterAttack: attackAfter.combatEffects,
    beforeActive: beforeActive.combatEffects,
    afterActive: activeAfter.combatEffects,
    afterCombat: combatAfter.combatEffects,
  },
  beforeRestart,
  restarted,
  final,
  modelIdentity,
  pixelCoverage,
};
await writeFile(join(outputDirectory, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`);
await context.close();
await browser.close();

const performance = final.performance;
const failure =
  consoleErrors.length > 0 ||
  pageErrors.length > 0 ||
  failedRequests.length > 0 ||
  badResponses.length > 0 ||
  !result.checks.authoritativePopulation ||
  !result.checks.renderPopulation ||
  !moved ||
  !attackTriggered ||
  !result.checks.attackEffectRendered ||
  !activeTriggered ||
  !result.checks.activeEffectRendered ||
  !result.checks.impactEffectRendered ||
  !result.checks.combatEffectBudgetRespected ||
  !lootDropped ||
  !lootCollected ||
  !result.checks.deterministicRestart ||
  !result.checks.cameraSwitching ||
  !result.checks.cameraControls ||
  !result.checks.cameraMovementStable ||
  !result.checks.mapInteraction ||
  !result.checks.desktopHudLayout ||
  !result.checks.modelIdentity ||
  !result.checks.grassworksVegetationReady ||
  !result.checks.requiredGrassworksAssetsLoaded ||
  !result.checks.mapAssetLayerReady ||
  !result.checks.legacyGlobalSceneLayerDisabled ||
  !result.checks.requestedHero ||
  !result.checks.localizedTreeOcclusion ||
  !result.checks.mobileLayout ||
  !result.checks.mobilePerformanceTier ||
  !result.checks.mobileWorldMap ||
  pixelCoverage < 0.2 ||
  !performance ||
  performance.sampledFrames < 240 ||
  performance.averageFps < 45 ||
  performance.p95FrameMs > 35 ||
  (final.models?.templatesFailed ?? 1) > 0 ||
  (final.models?.templatesLoaded ?? 0) === 0 ||
  (final.models?.sceneSprites ?? 1) !== 0 ||
  (final.models?.visibleInstances ?? 0) === 0 ||
  (final.models?.visiblePendingInstances ?? 1) !== 0 ||
  final.models?.visibleLoadedInstances !== final.models?.visibleInstances ||
  (final.models?.renderableFallbackInstances ?? 1) !== 0 ||
  (final.models?.visibleRenderableFallbackInstances ?? 1) !== 0 ||
  final.models?.visibleInstances !==
    (final.renderEntities?.visiblePlayerVisuals ?? 0) +
      (final.renderEntities?.visibleMonsterVisuals ?? 0);

if (failure) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(
  `local MAP verification passed: ${initial.playerCount} players, ` +
    `${initial.monsterCount} monsters, visuals ${initial.renderEntities?.playerVisuals}/` +
    `${initial.renderEntities?.monsterVisuals}, movement/attack/active/loot/restart/view/camera/map passed, ` +
    `effects ${attackAfter.combatEffects?.basicAttackEffectsSpawned ?? 0}/` +
    `${activeAfter.combatEffects?.activeCastEffectsSpawned ?? 0}/` +
    `${combatAfter.combatEffects?.impactEffectsSpawned ?? 0}, ` +
    `${final.models?.visibleLoadedInstances}/${final.models?.visibleInstances} visible 3D models, ` +
    `${final.flora?.grassInstances ?? 0} Grassworks grass/${final.flora?.treeInstances ?? 0} trees, ` +
    `${final.flora?.drawCalls ?? 0} visible vegetation draw calls, ` +
    `${final.globalScenes?.placements ?? 0} legacy global scene instances, ` +
    `${performance.averageFps.toFixed(1)} FPS, ` +
    `pixels ${(pixelCoverage * 100).toFixed(1)}%`,
);
