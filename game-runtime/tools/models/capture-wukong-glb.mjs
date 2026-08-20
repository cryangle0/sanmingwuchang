import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build as buildBundle } from 'esbuild';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..', '..');
const modelPath = resolve(
  process.env.JWGB_WUKONG_GLB?.trim() ||
    join(root, 'apps', 'web', 'public', 'models', 'characters', 'H009', 'model.glb'),
);
const outputDirectory = resolve(
  process.env.JWGB_WUKONG_GLB_PREVIEW_OUTPUT?.trim() ||
    join(root, 'artifacts', 'wukong-glb-previews'),
);
const browserPath =
  process.env.JWGB_BROWSER_EXECUTABLE?.trim() ||
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!browserPath) {
  throw new Error('Chrome or Edge executable not found');
}
if (!existsSync(modelPath)) {
  throw new Error(`Wukong GLB not found: ${modelPath}`);
}

const samples = [
  { clipName: 'Idle', sampleFraction: 0.55 },
  { clipName: 'Move', sampleFraction: 0.38 },
  { clipName: 'Attack', sampleFraction: 0.45 },
  { clipName: 'Spell', sampleFraction: 0.45 },
];
mkdirSync(outputDirectory, { recursive: true });
const bundlePath = join(tmpdir(), `jwgb-wukong-glb-preview-${process.pid}.bundle.js`);
await buildBundle({
  entryPoints: [join(root, 'tools', 'models', 'capture-wukong-glb-entry.js')],
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

const base64 = readFileSync(modelPath).toString('base64');
const results = [];
try {
  for (const sample of samples) {
    const metrics = await page.evaluate((input) => window.renderWukongGlbClip(input), {
      ...sample,
      base64,
    });
    const screenshot = join(outputDirectory, `${sample.clipName.toLowerCase()}.png`);
    await page.screenshot({ path: screenshot });
    const errors = [];
    if (metrics.textureCount < 2) {
      errors.push(`expected at least 2 textures, found ${metrics.textureCount}`);
    }
    const weapon = metrics.meshes.find((mesh) => mesh.name === 'H009-RuyiJinguBang');
    if (!weapon) {
      errors.push('Ruyi Jingu Bang mesh is missing');
    } else if (weapon.triangles <= 0 || weapon.triangles > 8_000) {
      errors.push(`Ruyi Jingu Bang has ${weapon.triangles} triangles`);
    }
    if (metrics.changedPixels < 5_000) {
      errors.push(`only ${metrics.changedPixels} character pixels`);
    }
    if (metrics.colorBucketCount < 24) {
      errors.push(`only ${metrics.colorBucketCount} visible color buckets`);
    }
    if (metrics.bounds.size[1] < 1.2 || metrics.bounds.size[1] > 3.96) {
      errors.push(`invalid animated height ${metrics.bounds.size[1]}`);
    }
    if (metrics.bounds.horizontalCenterOffset > 1.65) {
      errors.push(`horizontal center offset ${metrics.bounds.horizontalCenterOffset}`);
    }
    results.push({
      ...metrics,
      screenshot,
      status: errors.length === 0 ? 'passed' : 'failed',
      errors,
    });
    console.log(
      `${sample.clipName}: ${metrics.changedPixels} pixels, ` +
        `${metrics.colorBucketCount} colors, ${metrics.bounds.size[1].toFixed(3)} m high`,
    );
  }
} finally {
  await browser.close();
  rmSync(bundlePath, { force: true });
}

const report = {
  schema: 'jwgb.wukong-glb-preview.v1',
  generatedAt: new Date().toISOString(),
  modelPath,
  results,
  status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
};
writeFileSync(join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (report.status !== 'passed') {
  process.exitCode = 1;
}
