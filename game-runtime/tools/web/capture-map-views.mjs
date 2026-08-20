// Headless Chromium acceptance capture for the procedural map.
// Usage: node tools/web/capture-map-views.mjs <outputDir>
// Requires the vite dev server on http://localhost:5173 and the
// ms-playwright chromium cache installed by other tooling on this machine.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const outputDir = process.argv[2] ?? 'artifacts/session-0801-dressing';
mkdirSync(outputDir, { recursive: true });

const executablePath = join(
  process.env.LOCALAPPDATA,
  'ms-playwright',
  'chromium-1217',
  'chrome-win64',
  'chrome.exe',
);

const BASE = 'http://localhost:5173/?active=MAP';
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const VIEWS = [
  { name: 'desktop-duanjin', spawn: '-270,210', viewport: DESKTOP },
  { name: 'desktop-zhusi', spawn: '-10,268', viewport: DESKTOP },
  { name: 'desktop-longji', spawn: '322,175', viewport: DESKTOP },
  { name: 'desktop-baizu', spawn: '-282,-180', viewport: DESKTOP },
  { name: 'desktop-jinshui', spawn: '300,-145', viewport: DESKTOP },
  { name: 'desktop-mihun', spawn: '-20,-265', viewport: DESKTOP },
  { name: 'desktop-santing-court', spawn: '22,109', viewport: DESKTOP },
  { name: 'desktop-choke-gate', spawn: '-63,112', viewport: DESKTOP },
  { name: 'mobile-santing-court', spawn: '22,109', viewport: MOBILE, dpr: 3 },
  { name: 'mobile-mihun', spawn: '-20,-265', viewport: MOBILE, dpr: 3 },
];

function samplePixels(page) {
  return page.evaluate(() => {
    const diagnostics = window.__JWGB_DEBUG__?.getRenderPixelDiagnostics?.();
    if (!diagnostics) return { error: 'no render diagnostics' };
    return { total: diagnostics.sampledPixels ?? 96 * 96, nonEmpty: diagnostics.nonBlackPixels };
  });
}

const browser = await chromium.launch({ executablePath, headless: true });
const failures = [];
for (const view of VIEWS) {
  const context = await browser.newContext({
    viewport: view.viewport,
    deviceScaleFactor: view.dpr ?? 1,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await page.goto(`${BASE}&spawn=${view.spawn}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2_500);
  const pixels = await samplePixels(page);
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  await page.screenshot({ path: join(outputDir, `${view.name}.png`) });
  const emptyish = !pixels.nonEmpty || pixels.nonEmpty / pixels.total < 0.5;
  if (consoleErrors.length > 0 || emptyish || overflow.x || overflow.y) {
    failures.push({ view: view.name, consoleErrors, pixels, overflow });
  }
  console.log(
    `${view.name}: pixels ${pixels.nonEmpty}/${pixels.total}, ` +
      `errors ${consoleErrors.length}, overflow ${overflow.x || overflow.y}`,
  );
  await context.close();
}
await browser.close();

if (failures.length > 0) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(`captured ${VIEWS.length} views to ${outputDir}`);
