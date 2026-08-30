import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = new URL(process.env.JWGB_LOCAL_WEB_URL ?? 'http://127.0.0.1:4194/');
const outputDirectory =
  process.env.JWGB_GLOBAL_SCENE_SCREENSHOT_DIR ?? 'migration/reports/web/global-scenes';
const executablePath =
  process.env.JWGB_BROWSER_EXECUTABLE ??
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error('Chrome or Edge executable not found');
}

const regions = [
  { id: 'duanjin', spawn: '-270,210' },
  { id: 'zhusi', spawn: '-10,268' },
  { id: 'longji', spawn: '322,175' },
  { id: 'baizu', spawn: '-282,-180' },
  { id: 'jinshui', spawn: '300,-145' },
  { id: 'mihun', spawn: '-20,-265' },
  { id: 'santing', spawn: '53,-3' },
];

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--ignore-gpu-blocklist'],
});
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
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];

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

const captures = [];
for (const region of regions) {
  const url = new URL(baseUrl);
  url.searchParams.set('mode', 'local');
  url.searchParams.set('active', 'MAP');
  url.searchParams.set('hero', 'H009');
  url.searchParams.set('spawn', region.spawn);
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const scenes = window.__JWGB_DEBUG__?.getGlobalSceneDiagnostics?.();
      return Boolean(
        scenes?.status === 'ready' &&
          scenes.failedAssets.length === 0 &&
          scenes.loadedAssets.length === 11 &&
          scenes.placements === 79 &&
          scenes.placementsBySource.overgrown === 21 &&
          scenes.placementsBySource['forest-road-night'] === 21 &&
          scenes.placementsBySource['forest-mountains'] === 37 &&
          scenes.visiblePlacementsBySource.overgrown > 0 &&
          scenes.visiblePlacementsBySource['forest-road-night'] > 0 &&
          scenes.visiblePlacementsBySource['forest-mountains'] > 0 &&
          scenes.instancedBatches > 0 &&
          scenes.visible === true,
      );
    },
    undefined,
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
  const runtime = await page.evaluate(() => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const localEntityId = debug?.getLocalEntityId?.() ?? null;
    const local = snapshot?.players.find((player) => player.entityId === localEntityId) ?? null;
    return {
      localPosition: local?.position ?? null,
      globalScenes: debug?.getGlobalSceneDiagnostics?.() ?? null,
      performance: debug?.getRenderPerformanceDiagnostics?.() ?? null,
      pixels: debug?.getRenderPixelDiagnostics?.() ?? null,
    };
  });
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
const mobileUrl = new URL(baseUrl);
mobileUrl.searchParams.set('mode', 'local');
mobileUrl.searchParams.set('active', 'MAP');
mobileUrl.searchParams.set('hero', 'H009');
mobileUrl.searchParams.set('spawn', '-20,-265');
await mobilePage.goto(mobileUrl.toString(), {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
});
await mobilePage.waitForFunction(
  () => {
    const scenes = window.__JWGB_DEBUG__?.getGlobalSceneDiagnostics?.();
    return Boolean(
      scenes?.status === 'ready' &&
        scenes.failedAssets.length === 0 &&
        scenes.placements === 29 &&
        scenes.placementsBySource.overgrown === 7 &&
        scenes.placementsBySource['forest-road-night'] === 7 &&
        scenes.placementsBySource['forest-mountains'] === 15 &&
        scenes.visiblePlacementsBySource.overgrown > 0 &&
        scenes.visiblePlacementsBySource['forest-road-night'] > 0 &&
        scenes.visiblePlacementsBySource['forest-mountains'] > 0,
    );
  },
  undefined,
  { timeout: 180_000 },
);
await mobilePage.waitForTimeout(500);
const mobileRuntime = await mobilePage.evaluate(
  () => window.__JWGB_DEBUG__?.getGlobalSceneDiagnostics?.() ?? null,
);
const mobileScreenshotPath = join(outputDirectory, 'mobile-mihun.png');
await mobilePage.screenshot({ path: mobileScreenshotPath, fullPage: false });

const result = {
  schema: 'jwgb.web-global-scene-verification.v1',
  verifiedAt: new Date().toISOString(),
  baseUrl: baseUrl.toString(),
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

if (
  consoleErrors.length > 0 ||
  pageErrors.length > 0 ||
  failedRequests.length > 0 ||
  badResponses.length > 0 ||
  captures.length !== regions.length ||
  captures.some(
    (capture) =>
      capture.runtime.globalScenes?.status !== 'ready' ||
      capture.runtime.globalScenes.visiblePlacements <= 0 ||
      capture.runtime.globalScenes.visiblePlacementsBySource.overgrown <= 0 ||
      capture.runtime.globalScenes.visiblePlacementsBySource['forest-road-night'] <= 0 ||
      capture.runtime.globalScenes.visiblePlacementsBySource['forest-mountains'] <= 0 ||
      capture.runtime.globalScenes.visibleInstancedBatches <= 0,
  ) ||
  mobileRuntime?.status !== 'ready' ||
  mobileRuntime.placements !== 29
) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(
  `global scene verification passed: ${captures.length} regions, ` +
    `${captures[0]?.runtime.globalScenes?.placements ?? 0} balanced placements, ` +
    `${mobileRuntime.placements} reduced placements`,
);
