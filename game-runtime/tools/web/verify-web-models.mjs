import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const webRoot = resolve(repositoryRoot, 'apps', 'web');
const outputDirectory = resolve(
  repositoryRoot,
  process.env.JWGB_MODEL_AUDIT_OUTPUT ?? 'migration/reports/web/model-audit',
);
const modelBase =
  process.env.JWGB_MODEL_BASE ??
  'https://vibe-files.aigcresearch.com/AIGame/JourneyWestGreatBrawl/models/v1/';
const requestedModelIds = process.env.JWGB_MODEL_AUDIT_IDS?.trim() ?? '';
const expectedModelCount = Number(process.env.JWGB_MODEL_AUDIT_EXPECTED_TOTAL ?? 76);
const executablePath =
  process.env.JWGB_BROWSER_EXECUTABLE ??
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error('Chrome or Edge executable not found');
}

const server = await createServer({
  root: webRoot,
  configFile: resolve(webRoot, 'vite.config.ts'),
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.JWGB_MODEL_AUDIT_PORT ?? 4192),
    strictPort: false,
  },
});

let browser;
try {
  await server.listen();
  const localUrl = server.resolvedUrls?.local[0];
  if (!localUrl) {
    throw new Error('Vite model audit URL was not resolved');
  }
  const auditUrl = new URL('model-audit.html', localUrl);
  auditUrl.searchParams.set('modelBase', modelBase);
  if (requestedModelIds) {
    auditUrl.searchParams.set('ids', requestedModelIds);
  }

  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
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
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('/models/')) {
      failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText ?? 'unknown request failure',
      });
    }
  });
  page.on('response', (response) => {
    if (response.url().includes('/models/') && response.status() >= 400) {
      badResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto(auditUrl.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => {
      const audit = window.__JWGB_MODEL_AUDIT__;
      return audit?.status === 'complete' || audit?.status === 'failed';
    },
    undefined,
    { timeout: Number(process.env.JWGB_MODEL_AUDIT_TIMEOUT_MS ?? 1_800_000) },
  );

  const browserAudit = await page.evaluate(() => window.__JWGB_MODEL_AUDIT__ ?? null);
  await mkdir(outputDirectory, { recursive: true });
  const desktopScreenshot = resolve(outputDirectory, 'model-audit-desktop.png');
  await page.screenshot({ path: desktopScreenshot, fullPage: true });
  await page.setViewportSize({ width: 412, height: 915 });
  const mobileScreenshot = resolve(outputDirectory, 'model-audit-mobile.png');
  await page.screenshot({ path: mobileScreenshot, fullPage: true });

  const report = {
    schema: 'jwgb.web-model-browser-verification.v1',
    verifiedAt: new Date().toISOString(),
    auditUrl: auditUrl.toString(),
    modelBase,
    desktopScreenshot,
    mobileScreenshot,
    consoleErrors,
    pageErrors,
    failedRequests,
    badResponses,
    audit: browserAudit,
  };
  const reportPath = resolve(outputDirectory, 'model-audit.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const failedModels = browserAudit?.report?.results?.filter(
    (result) => result.status !== 'passed',
  );
  const passed =
    browserAudit?.status === 'complete' &&
    browserAudit.report?.total === expectedModelCount &&
    browserAudit.report?.passed === expectedModelCount &&
    browserAudit.report?.failed === 0 &&
    failedModels?.length === 0 &&
    consoleErrors.length === 0 &&
    pageErrors.length === 0 &&
    failedRequests.length === 0 &&
    badResponses.length === 0;
  console.log(
    JSON.stringify(
      {
        passed,
        reportPath,
        models: browserAudit?.report
          ? {
              total: browserAudit.report.total,
              passed: browserAudit.report.passed,
              failed: browserAudit.report.failed,
            }
          : null,
        consoleErrors: consoleErrors.length,
        pageErrors: pageErrors.length,
        failedRequests: failedRequests.length,
        badResponses: badResponses.length,
      },
      null,
      2,
    ),
  );
  if (!passed) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  await server.close();
}
