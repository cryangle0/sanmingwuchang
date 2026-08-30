import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = new URL(process.env.JWGB_LOCAL_WEB_URL ?? 'http://127.0.0.1:4194/');
const outputDirectory =
  process.env.JWGB_GRASSWORKS_SCREENSHOT_DIR ?? 'migration/reports/web/grassworks';
const executablePath =
  process.env.JWGB_BROWSER_EXECUTABLE ??
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));
const requiredAssets = [
  'models/grassworks/grass-atlas5.png',
  'models/grassworks/grassworks-trees.glb',
];
const performanceSampleFrames = Number(process.env.JWGB_GRASSWORKS_SAMPLE_FRAMES ?? 120);
const regions = [
  { id: 'duanjin', spawn: '-270,210' },
  { id: 'zhusi', spawn: '-10,268' },
  { id: 'longji', spawn: '322,175' },
  { id: 'baizu', spawn: '-282,-180' },
  { id: 'jinshui', spawn: '300,-145' },
  { id: 'mihun', spawn: '-20,-265' },
  { id: 'santing', spawn: '53,-3' },
];

if (!executablePath) {
  throw new Error('Chrome or Edge executable not found');
}

function isGrassworksReady(vegetation, expectedDistance) {
  return Boolean(
    vegetation?.status === 'ready' &&
      vegetation.source === 'grassworks' &&
      vegetation.failedAssets.length === 0 &&
      vegetation.loadedAssets.length === requiredAssets.length &&
      requiredAssets.every((asset) => vegetation.loadedAssets.includes(asset)) &&
      vegetation.tileSizeMeters === 25 &&
      vegetation.renderBatchSizeMeters === 50 &&
      vegetation.maxGrassDistanceMeters === expectedDistance &&
      vegetation.influenceResolution === 256 &&
      vegetation.grassInstances > 250_000 &&
      vegetation.visibleGrassInstances > 0 &&
      vegetation.grassTiles > vegetation.grassRenderBatches &&
      vegetation.grassRenderBatches === vegetation.grassChunks &&
      vegetation.visibleGrassChunks > 0 &&
      vegetation.treeInstances > 0 &&
      vegetation.visibleTreeInstances > 0 &&
      vegetation.visibleTreeChunks > 0 &&
      vegetation.instancedBatches > 0 &&
      vegetation.visibleInstancedBatches > 0 &&
      vegetation.legacyFloraInstances === 0 &&
      vegetation.legacyScatterInstances === 0 &&
      vegetation.legacyGlobalSceneVegetationInstances === 0 &&
      vegetation.visible === true,
  );
}

function isLegacyLayerDisabled(globalScenes) {
  return Boolean(
    globalScenes?.status === 'disabled' &&
      globalScenes.loadedAssets.length === 0 &&
      globalScenes.failedAssets.length === 0 &&
      globalScenes.placements === 0 &&
      globalScenes.visiblePlacements === 0 &&
      globalScenes.instancedBatches === 0 &&
      globalScenes.visibleInstancedBatches === 0 &&
      globalScenes.visible === false,
  );
}

function pixelCoverage(pixels) {
  return pixels && pixels.sampledPixels > 0 ? pixels.nonBlackPixels / pixels.sampledPixels : 0;
}

async function waitForRuntime(page, expectedDistance) {
  await page.waitForFunction(
    ({ assets, distance }) => {
      const vegetation = window.__JWGB_DEBUG__?.getFloraModelDiagnostics?.();
      const globalScenes = window.__JWGB_DEBUG__?.getGlobalSceneDiagnostics?.();
      return Boolean(
        vegetation?.status === 'ready' &&
          vegetation.source === 'grassworks' &&
          vegetation.failedAssets.length === 0 &&
          vegetation.loadedAssets.length === assets.length &&
          assets.every((asset) => vegetation.loadedAssets.includes(asset)) &&
          vegetation.maxGrassDistanceMeters === distance &&
          vegetation.grassInstances > 250_000 &&
          vegetation.visibleGrassInstances > 0 &&
          vegetation.treeInstances > 0 &&
          vegetation.visibleTreeInstances > 0 &&
          vegetation.legacyFloraInstances === 0 &&
          vegetation.legacyScatterInstances === 0 &&
          vegetation.legacyGlobalSceneVegetationInstances === 0 &&
          globalScenes?.status === 'disabled' &&
          globalScenes.placements === 0 &&
          globalScenes.visible === false,
      );
    },
    { assets: requiredAssets, distance: expectedDistance },
    { timeout: 180_000 },
  );
  await page.waitForFunction(
    () => {
      const debug = window.__JWGB_DEBUG__;
      const snapshot = debug?.getSnapshot?.();
      const localEntityId = debug?.getLocalEntityId?.() ?? null;
      const local = snapshot?.players.find((player) => player.entityId === localEntityId);
      const camera = debug?.getCameraDiagnostics?.();
      return Boolean(
        local &&
          camera &&
          Math.abs(camera.target[0] - local.position.x / 1_000) < 0.05 &&
          Math.abs(camera.target[2] - local.position.z / 1_000) < 0.05,
      );
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__JWGB_DEBUG__?.resetRenderPerformanceDiagnostics?.());
  await page.waitForFunction(
    (minimumFrames) =>
      (window.__JWGB_DEBUG__?.getRenderPerformanceDiagnostics?.().sampledFrames ?? 0) >=
      minimumFrames,
    performanceSampleFrames,
    { timeout: 30_000 },
  );
}

async function readRuntime(page) {
  return page.evaluate(() => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const localEntityId = debug?.getLocalEntityId?.() ?? null;
    const local = snapshot?.players.find((player) => player.entityId === localEntityId) ?? null;
    return {
      localPosition: local?.position ?? null,
      vegetation: debug?.getFloraModelDiagnostics?.() ?? null,
      globalScenes: debug?.getGlobalSceneDiagnostics?.() ?? null,
      performance: debug?.getRenderPerformanceDiagnostics?.() ?? null,
      pixels: debug?.getRenderPixelDiagnostics?.() ?? null,
    };
  });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--disable-background-timer-throttling'],
});
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];

function watchPage(page, prefix = '') {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(`${prefix}${message.text()}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(`${prefix}${String(error)}`));
  page.on('requestfailed', (request) => {
    failedRequests.push(`${prefix}${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      badResponses.push(`${prefix}${response.status()} ${response.url()}`);
    }
  });
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  localStorage.setItem(
    'jwgb:web-settings:v1',
    JSON.stringify({
      graphicsPreference: 'quality',
      cameraView: 'standard',
      showPerformance: false,
      masterVolume: 0,
      musicVolume: 0,
      sfxVolume: 0,
      uiVolume: 0,
    }),
  );
});
const page = await context.newPage();
watchPage(page);
const captures = [];

for (const region of regions) {
  const url = new URL(baseUrl);
  url.searchParams.set('mode', 'local');
  url.searchParams.set('active', 'MAP');
  url.searchParams.set('hero', 'H009');
  url.searchParams.set('spawn', region.spawn);
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitForRuntime(page, 180);
  const runtime = await readRuntime(page);
  const screenshotPath = join(outputDirectory, `${region.id}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  captures.push({
    regionId: region.id,
    requestedSpawn: region.spawn,
    screenshotPath,
    runtime,
  });
}

const mobileContext = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
await mobileContext.addInitScript(() => {
  localStorage.setItem(
    'jwgb:web-settings:v1',
    JSON.stringify({
      graphicsPreference: 'performance',
      cameraView: 'standard',
      showPerformance: false,
      masterVolume: 0,
      musicVolume: 0,
      sfxVolume: 0,
      uiVolume: 0,
    }),
  );
});
const mobilePage = await mobileContext.newPage();
watchPage(mobilePage, 'mobile: ');
const mobileUrl = new URL(baseUrl);
mobileUrl.searchParams.set('mode', 'local');
mobileUrl.searchParams.set('active', 'MAP');
mobileUrl.searchParams.set('hero', 'H009');
mobileUrl.searchParams.set('spawn', '-20,-265');
await mobilePage.goto(mobileUrl.toString(), {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
});
await waitForRuntime(mobilePage, 108);
const mobileRuntime = await readRuntime(mobilePage);
const mobileScreenshotPath = join(outputDirectory, 'mobile-mihun.png');
await mobilePage.screenshot({ path: mobileScreenshotPath, fullPage: false });

const result = {
  schema: 'jwgb.web-grassworks-verification.v1',
  verifiedAt: new Date().toISOString(),
  baseUrl: baseUrl.toString(),
  performanceSampleFrames,
  consoleErrors,
  pageErrors,
  failedRequests,
  badResponses,
  captures,
  mobile: {
    screenshotPath: mobileScreenshotPath,
    runtime: mobileRuntime,
  },
};
await writeFile(join(outputDirectory, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`);
await mobileContext.close();
await context.close();
await browser.close();

const failed =
  consoleErrors.length > 0 ||
  pageErrors.length > 0 ||
  failedRequests.length > 0 ||
  badResponses.length > 0 ||
  captures.length !== regions.length ||
  captures.some(
    (capture) =>
      !isGrassworksReady(capture.runtime.vegetation, 180) ||
      !isLegacyLayerDisabled(capture.runtime.globalScenes) ||
      (capture.runtime.performance?.sampledFrames ?? 0) < performanceSampleFrames ||
      pixelCoverage(capture.runtime.pixels) < 0.2,
  ) ||
  !isGrassworksReady(mobileRuntime.vegetation, 108) ||
  !isLegacyLayerDisabled(mobileRuntime.globalScenes) ||
  (mobileRuntime.performance?.sampledFrames ?? 0) < performanceSampleFrames ||
  mobileRuntime.performance?.graphicsTier !== 'reduced' ||
  pixelCoverage(mobileRuntime.pixels) < 0.2;

if (failed) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(
  `Grassworks verification passed: ${captures.length} regions, ` +
    `${captures[0]?.runtime.vegetation?.grassInstances ?? 0} grass instances, ` +
    `${captures[0]?.runtime.vegetation?.treeInstances ?? 0} trees, ` +
    `${mobileRuntime.vegetation?.visibleGrassInstances ?? 0} reduced-tier visible grass`,
);
