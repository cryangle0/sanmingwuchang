import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build as buildBundle } from 'esbuild';
import { chromium } from 'playwright-core';
import { repositoryRoot, selectedAnimatedCharacterConfigs } from './animated-character-config.mjs';

const browserPath =
  process.env.JWGB_BROWSER_EXECUTABLE?.trim() ||
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!browserPath) {
  throw new Error('Chrome or Edge executable not found');
}

const samples = [
  { clipName: 'Idle', sampleFraction: 0.55 },
  { clipName: 'Move', sampleFraction: 0.38 },
  { clipName: 'Attack', sampleFraction: 0.45 },
  { clipName: 'Spell', sampleFraction: 0.45 },
];
const bundlePath = join(tmpdir(), `jwgb-character-preview-${process.pid}.bundle.js`);
await buildBundle({
  entryPoints: [join(repositoryRoot, 'tools', 'models', 'capture-wukong-glb-entry.js')],
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

let failed = false;
try {
  for (const config of selectedAnimatedCharacterConfigs()) {
    const modelPath = join(config.outputDirectory, 'model.glb');
    if (!existsSync(modelPath)) {
      throw new Error(`${config.modelId} GLB not found: ${modelPath}`);
    }
    const outputDirectory = join(
      repositoryRoot,
      'artifacts',
      'character-glb-previews',
      config.modelId,
    );
    mkdirSync(outputDirectory, { recursive: true });
    const base64 = readFileSync(modelPath).toString('base64');
    const results = [];
    for (const sample of samples) {
      const metrics = await page.evaluate((input) => window.renderWukongGlbClip(input), {
        ...sample,
        base64,
      });
      const screenshot = join(outputDirectory, `${sample.clipName.toLowerCase()}.png`);
      await page.screenshot({ path: screenshot });
      const errors = [];
      if (metrics.textureCount < 1) {
        errors.push(`expected at least 1 texture, found ${metrics.textureCount}`);
      }
      if (!metrics.meshes.some((mesh) => mesh.skinned)) {
        errors.push('skinned character meshes are missing');
      }
      if (config.requiresSeparateWeapon && !metrics.meshes.some((mesh) => !mesh.skinned)) {
        errors.push('retained weapon mesh is missing');
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
        `${config.modelId} ${sample.clipName}: ${metrics.changedPixels} pixels, ` +
          `${metrics.colorBucketCount} colors, ${metrics.bounds.size[1].toFixed(3)} m high`,
      );
    }
    const report = {
      schema: 'jwgb.animated-character-glb-preview.v1',
      generatedAt: new Date().toISOString(),
      modelId: config.modelId,
      displayName: config.displayName,
      modelPath,
      results,
      status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    };
    writeFileSync(join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'passed') {
      failed = true;
    }
  }
} finally {
  await browser.close();
  rmSync(bundlePath, { force: true });
}

if (failed) {
  process.exitCode = 1;
}
