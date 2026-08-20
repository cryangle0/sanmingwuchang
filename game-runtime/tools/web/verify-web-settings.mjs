import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const targetUrl = new URL(
  process.env.JWGB_WEB_SETTINGS_URL ??
    'http://127.0.0.1:4181/?active=MAP&hero=H009&spawn=-330.7,-82',
);
targetUrl.searchParams.set('mode', 'local');
const url = targetUrl.toString();
const outputDirectory =
  process.env.JWGB_WEB_SETTINGS_REPORT_DIR ?? 'migration/reports/web/settings-controls';
const executablePath =
  process.env.JWGB_BROWSER_EXECUTABLE ??
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error('Chrome or Edge executable not found');
}

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const errors = {
  console: [],
  page: [],
  requests: [],
  responses: [],
};

function captureErrors(page) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  page.on('pageerror', (error) => errors.page.push(String(error)));
  page.on('requestfailed', (request) => {
    errors.requests.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      errors.responses.push(`${response.status()} ${response.url()}`);
    }
  });
}

async function waitForGame(page, targetUrl = url) {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const debug = window.__JWGB_DEBUG__;
      const snapshot = debug?.getSnapshot?.();
      return Boolean(snapshot && snapshot.players.length > 0 && snapshot.monsters.length > 0);
    },
    undefined,
    { timeout: 60_000 },
  );
}

const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const desktop = await desktopContext.newPage();
captureErrors(desktop);
await waitForGame(desktop);
await desktop.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(true));

const canvas = desktop.locator('.game-canvas');
const canvasBounds = await canvas.boundingBox();
if (!canvasBounds) {
  throw new Error('game canvas is not visible');
}
const centerX = canvasBounds.x + canvasBounds.width * 0.62;
const centerY = canvasBounds.y + canvasBounds.height * 0.48;

await desktop.keyboard.down('KeyE');
const eBinding = await desktop.evaluate(
  () => window.__JWGB_DEBUG__?.getInputDiagnostics?.() ?? null,
);
await desktop.keyboard.up('KeyE');
await desktop.evaluate(() => {
  window.__JWGB_DEBUG__?.setPaused?.(false);
});
await desktop.waitForTimeout(80);
await desktop.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(true));

await desktop.mouse.move(centerX, centerY);
await desktop.mouse.down({ button: 'left' });
const leftMouseBinding = await desktop.evaluate(
  () => window.__JWGB_DEBUG__?.getInputDiagnostics?.() ?? null,
);
await desktop.mouse.up({ button: 'left' });
await desktop.evaluate(() => {
  window.__JWGB_DEBUG__?.setPaused?.(false);
});
await desktop.waitForTimeout(80);
await desktop.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(true));

await desktop.mouse.click(centerX, centerY, { button: 'right' });
const rightMouseBinding = await desktop.evaluate(
  () => window.__JWGB_DEBUG__?.getInputDiagnostics?.() ?? null,
);
await desktop.evaluate(() => {
  window.__JWGB_DEBUG__?.setPaused?.(false);
});
await desktop.waitForTimeout(80);
await desktop.evaluate(() => window.__JWGB_DEBUG__?.setPaused?.(true));

await desktop.keyboard.press('Escape');
await desktop.waitForFunction(
  () => window.__JWGB_DEBUG__?.getMenuDiagnostics?.().open === true,
  undefined,
  { timeout: 10_000 },
);
const openMenu = await desktop.evaluate(() => ({
  menu: window.__JWGB_DEBUG__?.getMenuDiagnostics?.() ?? null,
  input: window.__JWGB_DEBUG__?.getInputDiagnostics?.() ?? null,
}));
await desktop.screenshot({
  path: join(outputDirectory, 'desktop-settings.png'),
  fullPage: true,
});

await desktop.locator('[data-menu-tab="controls"]').click();
const controlsText = await desktop.locator('[data-menu-panel="controls"]').innerText();
await desktop.screenshot({
  path: join(outputDirectory, 'desktop-controls.png'),
  fullPage: true,
});

await desktop.locator('[data-menu-tab="guide"]').click();
const guideText = await desktop.locator('[data-menu-panel="guide"]').innerText();
await desktop.screenshot({
  path: join(outputDirectory, 'desktop-guide.png'),
  fullPage: true,
});

await desktop.locator('[data-menu-tab="settings"]').click();
await desktop.locator('[data-graphics="performance"]').click();
await desktop.locator('[data-camera="tactical"]').click();
await desktop.locator('.performance-toggle').check();
await desktop.locator('.game-menu-close').click();
await desktop.waitForTimeout(600);

const appliedSettings = await desktop.evaluate(() => ({
  menu: window.__JWGB_DEBUG__?.getMenuDiagnostics?.() ?? null,
  camera: window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
  performance: window.__JWGB_DEBUG__?.getRenderPerformanceDiagnostics?.() ?? null,
  input: window.__JWGB_DEBUG__?.getInputDiagnostics?.() ?? null,
  performanceMeterVisible:
    document.querySelector('.performance-meter')?.hasAttribute('hidden') === false,
}));

const persistedUrl = new URL(url);
persistedUrl.searchParams.set('player', `web-settings-${Date.now()}`);
await waitForGame(desktop, persistedUrl.toString());
const persistedSettings = await desktop.evaluate(() => ({
  menu: window.__JWGB_DEBUG__?.getMenuDiagnostics?.() ?? null,
  camera: window.__JWGB_DEBUG__?.getCameraDiagnostics?.() ?? null,
  performance: window.__JWGB_DEBUG__?.getRenderPerformanceDiagnostics?.() ?? null,
}));

await desktop.evaluate(() => window.__JWGB_DEBUG__?.openMenu?.());
await desktop.locator('[data-graphics="auto"]').click();
await desktop.locator('[data-camera="standard"]').click();
await desktop.locator('.performance-toggle').uncheck();
await desktop.locator('.game-menu-close').click();

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const mobile = await mobileContext.newPage();
captureErrors(mobile);
await waitForGame(mobile);
await mobile.evaluate(() => window.__JWGB_DEBUG__?.openMenu?.());
await mobile.locator('[data-menu-tab="controls"]').click();
const mobileLayout = await mobile.evaluate(() => {
  const dialog = document.querySelector('.game-menu-dialog')?.getBoundingClientRect();
  const button = document.querySelector('.game-menu-button')?.getBoundingClientRect();
  const minimap = document.querySelector('.minimap-overlay')?.getBoundingClientRect();
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
    bodyOverflowY: document.documentElement.scrollHeight - window.innerHeight,
    dialog: dialog
      ? {
          left: dialog.left,
          top: dialog.top,
          right: dialog.right,
          bottom: dialog.bottom,
          width: dialog.width,
          height: dialog.height,
        }
      : null,
    buttonMinimapOverlap:
      button && minimap
        ? !(
            button.right <= minimap.left ||
            button.left >= minimap.right ||
            button.bottom <= minimap.top ||
            button.top >= minimap.bottom
          )
        : null,
  };
});
await mobile.screenshot({
  path: join(outputDirectory, 'mobile-controls.png'),
  fullPage: true,
});

const result = {
  schema: 'jwgb.web-settings-verification.v1',
  verifiedAt: new Date().toISOString(),
  url,
  errors,
  controls: {
    eBinding,
    leftMouseBinding,
    rightMouseBinding,
    controlsText,
    guideText,
  },
  menu: {
    openMenu,
    appliedSettings,
    persistedSettings,
  },
  mobileLayout,
};
await writeFile(join(outputDirectory, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`);

await mobileContext.close();
await desktopContext.close();
await browser.close();

const failure =
  errors.console.length > 0 ||
  errors.page.length > 0 ||
  errors.requests.length > 0 ||
  errors.responses.length > 0 ||
  eBinding?.interactQueued !== true ||
  eBinding?.activeQueued !== false ||
  leftMouseBinding?.attackPressed !== true ||
  rightMouseBinding?.activeQueued !== true ||
  openMenu.menu?.open !== true ||
  openMenu.input?.enabled !== false ||
  !controlsText.includes('鼠标左键') ||
  !controlsText.includes('右键拖动') ||
  !controlsText.includes('中键拖动') ||
  !controlsText.includes('Shift+V') ||
  !controlsText.includes('Home') ||
  !controlsText.includes('E') ||
  !guideText.includes('灭世雷暴') ||
  appliedSettings.menu?.graphicsPreference !== 'performance' ||
  appliedSettings.menu?.cameraView !== 'tactical' ||
  appliedSettings.menu?.showPerformance !== true ||
  appliedSettings.camera?.mode !== 'tactical' ||
  appliedSettings.performance?.graphicsTier !== 'reduced' ||
  appliedSettings.performance?.graphicsPreference !== 'performance' ||
  appliedSettings.input?.enabled !== true ||
  appliedSettings.performanceMeterVisible !== true ||
  persistedSettings.menu?.graphicsPreference !== 'performance' ||
  persistedSettings.menu?.cameraView !== 'tactical' ||
  persistedSettings.menu?.showPerformance !== true ||
  persistedSettings.camera?.mode !== 'tactical' ||
  mobileLayout.bodyOverflowX > 0 ||
  mobileLayout.bodyOverflowY > 0 ||
  !mobileLayout.dialog ||
  mobileLayout.dialog.left < 0 ||
  mobileLayout.dialog.top < 0 ||
  mobileLayout.dialog.right > mobileLayout.viewport.width ||
  mobileLayout.dialog.bottom > mobileLayout.viewport.height ||
  mobileLayout.buttonMinimapOverlap !== false;

if (failure) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(
  'web settings verification passed: canonical keyboard/mouse bindings, ' +
    'settings persistence, controls/guide content, desktop/mobile layout and performance mode',
);
