/**
 * Scripted map viewpoints for art review.
 *
 * `capture-map-views.mjs` runs a fixed acceptance sweep of the seven districts.
 * This companion tool takes an arbitrary JSON list of viewpoints so a specific
 * defect (a nest, the rim, the sea, the tree line) can be inspected from the
 * exact angle that shows it: it can orbit the camera with a mouse drag, zoom
 * with the wheel and walk with W before the shot.
 *
 * Usage:
 *   node tools/web/capture-map-viewpoints.mjs --views views.json --out artifacts/review
 *
 * View fields:
 *   name      file name without extension
 *   spawn     "x,z" metres, passed to ?spawn=
 *   drag      [dx, dy] pixels of mouse drag to orbit (optional)
 *   wheel     wheel clicks, positive zooms out (optional)
 *   moveMs    hold W for this long first (optional)
 *   pitchDrag [dx, dy] second drag after the first (optional)
 *   settleMs  extra settle wait, default 2500
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const baseUrl = flag('url', 'http://127.0.0.1:4181/?mode=local&active=MAP&hero=H009');
const outputDirectory = resolve(ROOT, flag('out', 'artifacts/map-viewpoints'));
const viewsFile = flag('views', null);
if (!viewsFile) {
  throw new Error('capture-map-viewpoints: --views <json> is required');
}
const views = JSON.parse(readFileSync(resolve(ROOT, viewsFile), 'utf8'));
mkdirSync(outputDirectory, { recursive: true });

async function drag(page, dx, dy) {
  await page.mouse.move(720, 450);
  await page.mouse.down();
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(720 + (dx * step) / steps, 450 + (dy * step) / steps);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
}

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
  ...(process.env.JWGB_BROWSER_EXECUTABLE
    ? { executablePath: process.env.JWGB_BROWSER_EXECUTABLE }
    : {}),
});
const report = [];

try {
  for (const view of views) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text().slice(0, 200));
      }
    });
    const extra = view.hideLayers ? `&hideLayers=${view.hideLayers}` : '';
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}spawn=${view.spawn}${extra}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(
      () => window.__JWGB_DEBUG__?.getMapAssetDiagnostics?.()?.status === 'ready',
      undefined,
      { timeout: 180_000 },
    );
    await page.waitForTimeout(3000);
    for (const press of view.keys ?? []) {
      await page.keyboard.press(press);
      await page.waitForTimeout(900);
    }
    if (view.moveMs) {
      await page.keyboard.down('w');
      await page.waitForTimeout(view.moveMs);
      await page.keyboard.up('w');
      await page.waitForTimeout(1200);
    }
    if (view.drag) {
      await drag(page, view.drag[0], view.drag[1]);
    }
    if (view.pitchDrag) {
      await drag(page, view.pitchDrag[0], view.pitchDrag[1]);
    }
    if (view.wheel) {
      await page.mouse.move(720, 450);
      for (let click = 0; click < Math.abs(view.wheel); click += 1) {
        await page.mouse.wheel(0, view.wheel > 0 ? 200 : -200);
        await page.waitForTimeout(200);
      }
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(view.settleMs ?? 2500);
    const camera = await page.evaluate(() => {
      const debug = window.__JWGB_DEBUG__;
      return {
        camera: debug.getCameraDiagnostics?.() ?? null,
        scene: debug.getRenderSceneContributorDiagnostics?.() ?? null,
        globalScenes: debug.getGlobalSceneDiagnostics?.() ?? null,
        flora: debug.getFloraModelDiagnostics?.() ?? null,
      };
    });
    const file = join(outputDirectory, `${view.name}.png`);
    await page.screenshot({ path: file });
    report.push({
      name: view.name,
      spawn: view.spawn,
      yaw: camera.camera?.yawDegrees ?? null,
      pitch: camera.camera?.pitchDegrees ?? null,
      zoom: camera.camera?.zoom ?? null,
      scene: camera.scene,
      globalScenes: camera.globalScenes,
      flora: camera.flora,
      errors,
    });
    console.log(
      `${view.name.padEnd(24)} yaw=${String(camera.camera?.yawDegrees ?? '?').padStart(7)} ` +
        `pitch=${String(camera.camera?.pitchDegrees ?? '?').padStart(7)} ` +
        `zoom=${String(camera.camera?.zoom ?? '?').padStart(5)} errors=${errors.length}`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${report.length} viewpoints to ${outputDirectory}`);
