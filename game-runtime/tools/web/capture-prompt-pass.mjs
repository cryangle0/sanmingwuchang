// Ad-hoc capture for the scene-prompt art-direction pass.
// Mirrors tools/web/capture-map-views.mjs but takes a base URL, because port
// 5173 is occupied by another app on this machine.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const outputDir = process.argv[2] ?? 'artifacts/prompt-pass';
const base = process.argv[3] ?? 'http://127.0.0.1:5180';
mkdirSync(outputDir, { recursive: true });

const executablePath = join(
  process.env.LOCALAPPDATA,
  'ms-playwright',
  'chromium-1217',
  'chrome-win64',
  'chrome.exe',
);

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const VIEWS = [
  { name: 'desktop-santing-court', spawn: '22,109', viewport: DESKTOP },
  { name: 'desktop-duanjin', spawn: '-270,210', viewport: DESKTOP },
  { name: 'desktop-longji', spawn: '322,175', viewport: DESKTOP },
  { name: 'desktop-jinshui', spawn: '300,-145', viewport: DESKTOP },
  { name: 'desktop-mihun', spawn: '-20,-265', viewport: DESKTOP },
  { name: 'desktop-zhusi', spawn: '-10,268', viewport: DESKTOP },
  { name: 'desktop-baizu', spawn: '-282,-180', viewport: DESKTOP },
  { name: 'mobile-santing-court', spawn: '22,109', viewport: MOBILE, dpr: 3 },
];

const browser = await chromium.launch({ executablePath, headless: true });
const report = [];
for (const view of VIEWS) {
  const context = await browser.newContext({
    viewport: view.viewport,
    deviceScaleFactor: view.dpr ?? 1,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`${base}/?active=MAP&spawn=${view.spawn}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6_000);
  const pixels = await page.evaluate(() => {
    const d = window.__JWGB_DEBUG__?.getRenderPixelDiagnostics?.();
    return d ? { total: d.sampledPixels ?? 96 * 96, nonEmpty: d.nonBlackPixels } : { error: 'none' };
  });
  await page.screenshot({ path: join(outputDir, `${view.name}.png`) });
  report.push({ view: view.name, pixels, errors: consoleErrors.length });
  console.log(
    `${view.name}: pixels ${pixels.nonEmpty}/${pixels.total}, errors ${consoleErrors.length}` +
      (consoleErrors.length ? ` :: ${consoleErrors[0].slice(0, 160)}` : ''),
  );
  await context.close();
}
await browser.close();
console.log(`captured ${VIEWS.length} views to ${outputDir}`);
