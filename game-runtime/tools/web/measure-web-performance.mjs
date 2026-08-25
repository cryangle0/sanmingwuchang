import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';

const url =
  process.env.JWGB_PERF_URL ??
  'http://127.0.0.1:4181/?mode=local&active=MAP&hero=H009&spawn=-330.7,-82';
const outputPath = process.env.JWGB_PERF_OUTPUT ?? 'migration/reports/web/local-performance.json';
const sampleFrames = Number(process.env.JWGB_PERF_SAMPLE_FRAMES ?? 240);
const graphicsPreference = process.env.JWGB_PERF_GRAPHICS ?? 'auto';
const executablePath =
  process.env.JWGB_BROWSER_EXECUTABLE ??
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error('Chrome or Edge executable not found');
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
if (['auto', 'quality', 'performance'].includes(graphicsPreference)) {
  await context.addInitScript((preference) => {
    window.localStorage.setItem(
      'jwgb:web-settings:v1',
      JSON.stringify({
        graphicsPreference: preference,
        cameraView: 'standard',
        showPerformance: false,
        masterVolume: 0,
        musicVolume: 0,
        sfxVolume: 0,
        uiVolume: 0,
      }),
    );
  }, graphicsPreference);
}
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
  }
});
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('requestfailed', (request) => {
  failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const debug = window.__JWGB_DEBUG__;
      const snapshot = debug?.getSnapshot?.();
      const models = debug?.getModelDiagnostics?.();
      const flora = debug?.getFloraModelDiagnostics?.();
      const assets = debug?.getMapAssetDiagnostics?.();
      return Boolean(
        snapshot?.mapGeometryHash &&
          snapshot.players.length === 7 &&
          snapshot.monsters.length === 123 &&
          models &&
          models.visibleInstances > 0 &&
          models.visiblePendingInstances === 0 &&
          flora?.status === 'ready' &&
          assets?.status === 'ready',
      );
    },
    undefined,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(1_000);
  await page.evaluate(() => window.__JWGB_DEBUG__?.resetRenderPerformanceDiagnostics?.());
  await page.waitForFunction(
    (minimumFrames) =>
      (window.__JWGB_DEBUG__?.getRenderPerformanceDiagnostics?.().sampledFrames ?? 0) >=
      minimumFrames,
    sampleFrames,
    { timeout: 30_000 },
  );

  const result = await page.evaluate(() => {
    const debug = window.__JWGB_DEBUG__;
    const snapshot = debug?.getSnapshot?.();
    const localEntityId = debug?.getLocalEntityId?.() ?? null;
    const localPlayer =
      snapshot?.players.find((player) => player.entityId === localEntityId) ?? null;
    const densityRadiiMeters = [15, 30, 45, 55, 75];
    const density = Object.fromEntries(
      densityRadiiMeters.map((radiusMeters) => {
        const radiusSquaredMm = (radiusMeters * 1_000) ** 2;
        const count = localPlayer
          ? [...snapshot.players, ...snapshot.monsters].filter((entity) => {
              if (entity.entityId === localEntityId) {
                return false;
              }
              const dx = entity.position.x - localPlayer.position.x;
              const dz = entity.position.z - localPlayer.position.z;
              return dx * dx + dz * dz <= radiusSquaredMm;
            }).length
          : 0;
        return [String(radiusMeters), count];
      }),
    );
    const densestMonster = snapshot?.monsters.reduce(
      (best, candidate) => {
        const nearby = snapshot.monsters.filter((other) => {
          const dx = other.position.x - candidate.position.x;
          const dz = other.position.z - candidate.position.z;
          return dx * dx + dz * dz <= 55_000 ** 2;
        }).length;
        return nearby > best.nearby
          ? {
              position: [candidate.position.x / 1_000, candidate.position.z / 1_000],
              nearby,
            }
          : best;
      },
      { position: [0, 0], nearby: 0 },
    );
    const modelDiagnostics = debug?.getModelDiagnostics?.() ?? null;
    return {
      url: window.location.href,
      measuredAt: new Date().toISOString(),
      snapshot: snapshot
        ? {
            tick: snapshot.tick,
            players: snapshot.players.length,
            monsters: snapshot.monsters.length,
            projectiles: snapshot.projectiles.length,
            activeProjectiles: snapshot.activeProjectiles.length,
            activeZones: snapshot.activeZones.length,
            activeTargetEffects: snapshot.activeTargetEffects?.length ?? 0,
            summons: snapshot.summons.length,
            lootDrops: snapshot.lootDrops.length,
            localPosition: localPlayer
              ? [localPlayer.position.x / 1_000, localPlayer.position.z / 1_000]
              : null,
            nearbyEntitiesByRadiusMeters: density,
            densestMonsterCluster: densestMonster,
          }
        : null,
      performance: debug?.getRenderPerformanceDiagnostics?.() ?? null,
      sceneContributors: debug?.getRenderSceneContributorDiagnostics?.() ?? null,
      renderEntities: debug?.getRenderEntityDiagnostics?.() ?? null,
      models: modelDiagnostics
        ? {
            templateRequests: modelDiagnostics.templateRequests,
            templatesLoaded: modelDiagnostics.templatesLoaded,
            templatesFailed: modelDiagnostics.templatesFailed,
            pendingTemplateLoads: modelDiagnostics.pendingTemplateLoads,
            instances: modelDiagnostics.instances,
            loadRequestedInstances: modelDiagnostics.loadRequestedInstances,
            loadedInstances: modelDiagnostics.loadedInstances,
            fallbackInstances: modelDiagnostics.fallbackInstances,
            visibleInstances: modelDiagnostics.visibleInstances,
            visibleLoadedInstances: modelDiagnostics.visibleLoadedInstances,
            visiblePendingInstances: modelDiagnostics.visiblePendingInstances,
          }
        : null,
      flora: debug?.getFloraModelDiagnostics?.() ?? null,
      mapAssets: debug?.getMapAssetDiagnostics?.() ?? null,
      combatEffects: debug?.getCombatEffectDiagnostics?.() ?? null,
    };
  });

  const report = {
    ...result,
    browserErrors: {
      consoleErrors,
      pageErrors,
      failedRequests,
    },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  if (
    !report.performance ||
    report.performance.sampledFrames < sampleFrames ||
    consoleErrors.length > 0 ||
    pageErrors.length > 0 ||
    failedRequests.length > 0
  ) {
    process.exitCode = 1;
  }
} finally {
  await context.close();
  await browser.close();
}
