import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build as buildBundle } from 'esbuild';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..', '..');
const assetDirectory = resolve(
  process.env.JWGB_MAP_ASSET_OUTPUT?.trim() ||
    join(root, 'apps', 'web', 'public', 'models', 'map-assets'),
);
const outputDirectory = resolve(
  process.env.JWGB_MAP_ASSET_PREVIEW_OUTPUT?.trim() ||
    join(root, 'artifacts', 'map-asset-previews'),
);
const browserPath =
  process.env.JWGB_BROWSER_EXECUTABLE?.trim() ||
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!browserPath) {
  throw new Error('Chrome or Edge executable not found');
}

mkdirSync(outputDirectory, { recursive: true });
const bundlePath = join(tmpdir(), `jwgb-map-asset-preview-${process.pid}.bundle.js`);
await buildBundle({
  entryPoints: [join(root, 'tools', 'models', 'capture-map-assets-entry.js')],
  bundle: true,
  format: 'iife',
  outfile: bundlePath,
  logLevel: 'silent',
});

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 760, height: 760 } });
await page.setContent(
  `<!doctype html><meta charset="utf-8"><script>${readFileSync(bundlePath, 'utf8')}</script>`,
);

const files = (await readdir(assetDirectory)).filter((name) => name.endsWith('.glb')).sort();
const report = [];
for (const file of files) {
  const path = join(assetDirectory, file);
  const bytes = readFileSync(path).toString('base64');
  const metrics = await page.evaluate((value) => window.renderMapAsset(value), bytes);
  const stats = await stat(path);
  const outputPath = join(outputDirectory, `${file.replace(/\.glb$/i, '')}.png`);
  await page.screenshot({ path: outputPath });
  report.push({ file, bytes: stats.size, metrics, screenshot: outputPath });
  console.log(`${file}: ${Math.round(stats.size / 1024)} KiB, ${JSON.stringify(metrics)}`);
}
await browser.close();
rmSync(bundlePath, { force: true });
console.log(`captured ${report.length} previews to ${outputDirectory}`);
