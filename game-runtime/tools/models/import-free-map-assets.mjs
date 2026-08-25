import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  inspect,
  join as joinMeshes,
  meshopt,
  prune,
  simplify,
  textureCompress,
} from '@gltf-transform/functions';
import { build as buildBundle } from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SOURCE_DIR = resolve(
  process.env.JWGB_FREE_MAP_ASSET_SOURCE?.trim() ||
    'E:\\angsa\\angsa_data\\crack\\ox-test\\free-assets-3d\\_converted',
);
const OUTPUT_DIR = resolve(
  process.env.JWGB_FREE_MAP_ASSET_OUTPUT?.trim() ||
    join(ROOT, 'apps', 'web', 'public', 'models', 'map-assets'),
);

const TARGETS = [
  {
    id: 'free-pagoda-niko313',
    sourceFile: 'sketchfab-pagoda-niko313.glb',
    outputFile: 'free-pagoda-niko313.glb',
    targetHeight: 16,
    source: 'free-assets-3d/_converted/sketchfab-pagoda-niko313.glb',
  },
  {
    id: 'free-stone-cart',
    sourceFile: 'stone-cart-daydev.glb',
    outputFile: 'free-stone-cart.glb',
    targetHeight: 2.4,
    source: 'free-assets-3d/_converted/stone-cart-daydev.glb',
  },
  {
    id: 'free-stone-lion',
    sourceFile: 'stone-lion-fpan.glb',
    outputFile: 'free-stone-lion.glb',
    targetHeight: 1.8,
    source: 'free-assets-3d/_converted/stone-lion-fpan.glb',
  },
  {
    id: 'free-pagoda-ruin',
    sourceFile: 'stone-pagoda-ruin-daydev.glb',
    outputFile: 'free-pagoda-ruin.glb',
    targetHeight: 14,
    source: 'free-assets-3d/_converted/stone-pagoda-ruin-daydev.glb',
  },
];

function executablePath() {
  const candidates = [
    process.env.JWGB_BROWSER_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Chrome or Edge executable not found');
  }
  return found;
}

function reportCounts(report) {
  const scene = report.scenes?.properties?.[0] ?? {};
  const meshes = report.meshes?.properties ?? [];
  const materials = report.materials?.properties ?? [];
  return {
    vertices: meshes.reduce((sum, item) => sum + (item.vertices ?? 0), 0),
    triangles: meshes.reduce((sum, item) => sum + (item.glPrimitives ?? 0), 0),
    meshes: meshes.length,
    materials: materials.length,
    drawCalls:
      meshes.reduce((sum, item) => sum + (item.meshPrimitives ?? 0), 0) || scene.renderVertexCount
        ? 1
        : 0,
  };
}

async function optimizeGlb(inputPath, outputPath) {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  const document = await io.read(inputPath);
  document.setLogger(new Logger(Logger.Verbosity.SILENT));
  await document.transform(
    prune(),
    dedup(),
    flatten(),
    joinMeshes({ keepNamed: false }),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.56,
      error: 0.06,
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [512, 512],
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const report = inspect(document);
  await io.write(outputPath, document);
  return reportCounts(report);
}

async function startConverter() {
  const bundlePath = join(tmpdir(), `jwgb-free-map-assets-${process.pid}.bundle.js`);
  await buildBundle({
    entryPoints: [join(ROOT, 'tools', 'models', 'convert-map-assets-entry.js')],
    bundle: true,
    format: 'iife',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const browser = await chromium.launch({
    executablePath: executablePath(),
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--use-gl=angle',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--enable-webgl',
    ],
  });
  const page = await browser.newPage();
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><script>${readFileSync(bundlePath, 'utf8')}</script>`,
  );
  await page.waitForFunction(() => window.__ready === true);
  return {
    page,
    close: async () => {
      await browser.close();
      rmSync(bundlePath, { force: true });
    },
  };
}

function base64File(path) {
  return readFileSync(path).toString('base64');
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const available = new Set(
    (await readdir(SOURCE_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name.toLowerCase()),
  );
  for (const target of TARGETS) {
    if (!available.has(target.sourceFile.toLowerCase())) {
      throw new Error(`free map asset not found: ${join(SOURCE_DIR, target.sourceFile)}`);
    }
  }

  const converter = await startConverter();
  try {
    for (const target of TARGETS) {
      const sourcePath = join(SOURCE_DIR, target.sourceFile);
      const rawPath = join(tmpdir(), `jwgb-${target.id}-${process.pid}.raw.glb`);
      const outputPath = join(OUTPUT_DIR, target.outputFile);
      const result = await converter.page.evaluate((input) => window.convertMapAsset(input), {
        type: 'glb',
        name: target.sourceFile,
        b64: base64File(sourcePath),
        targetHeight: target.targetHeight,
        profile: 'landmark',
      });
      const part = result.parts[0];
      if (!part) {
        throw new Error(`free map asset exported no renderable meshes: ${target.sourceFile}`);
      }
      writeFileSync(rawPath, Buffer.from(part.b64, 'base64'));
      const optimized = await optimizeGlb(rawPath, outputPath);
      rmSync(rawPath, { force: true });
      const bytes = (await stat(outputPath)).size;
      console.log(
        `${target.sourceFile}: ${part.metrics.before.triangles} tris -> ` +
          `${optimized.triangles} tris, ${Math.round(bytes / 1024)} KiB, ` +
          `height ${target.targetHeight}m`,
      );
    }
  } finally {
    await converter.close();
  }
}

await main();
