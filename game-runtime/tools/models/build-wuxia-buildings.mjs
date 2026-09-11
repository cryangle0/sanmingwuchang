/**
 * Builds the 百眼迷城 architecture family into `apps/web/public/models/map-assets`.
 *
 * The geometry is authored in `build-wuxia-buildings-entry.js` and evaluated in
 * headless Chromium (three.js + GLTFExporter need a DOM), then optimized here
 * with gltf-transform + meshopt before it is written next to the imported map
 * assets. The manifest is *merged* by id: `convert-map-assets.mjs` owns the
 * imported sources and cannot be re-run without the original asset packs, so
 * this tool must never regenerate the manifest wholesale.
 *
 * Usage:
 *   node tools/models/build-wuxia-buildings.mjs
 *   node tools/models/build-wuxia-buildings.mjs --check   # verify, write nothing
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { getBounds, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  join as joinMeshes,
  meshopt,
  prune,
  weld,
} from '@gltf-transform/functions';
import { build as buildBundle } from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUTPUT_DIR = resolve(ROOT, 'apps', 'web', 'public', 'models', 'map-assets');
const MANIFEST_PATH = join(OUTPUT_DIR, 'manifest.json');
const DELIVERY_PATH = 'models/map-assets';
const CHECK_ONLY = process.argv.includes('--check');

async function startRenderer() {
  const bundlePath = join(tmpdir(), `jwgb-buildings-${process.pid}.bundle.js`);
  await buildBundle({
    entryPoints: [join(ROOT, 'tools', 'models', 'build-wuxia-buildings-entry.js')],
    bundle: true,
    format: 'iife',
    outfile: bundlePath,
    logLevel: 'warning',
  });
  // Playwright's bundled-browser revision can lag the installed cache on this
  // machine, so fall back to any cached Chromium before giving up.
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
    ...(process.env.JWGB_BROWSER_EXECUTABLE
      ? { executablePath: process.env.JWGB_BROWSER_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.warn(`buildings page error: ${String(error)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.warn(`buildings console: ${message.text()}`);
    }
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><script>${readFileSync(bundlePath, 'utf8')}</script>`,
    { waitUntil: 'load' },
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

async function optimize(rawPath, outputPath) {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  const document = await io.read(rawPath);
  document.setLogger(new Logger(Logger.Verbosity.SILENT));
  await document.transform(
    prune(),
    dedup(),
    weld(),
    flatten(),
    joinMeshes({ keepNamed: false }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await io.write(outputPath, document);
  const bounds = getBounds(document.getRoot().listScenes()[0]);
  const flatBounds = [
    bounds.min[0],
    bounds.min[1],
    bounds.min[2],
    bounds.max[0],
    bounds.max[1],
    bounds.max[2],
  ].map((value) => Number(value.toFixed(5)));
  let triangles = 0;
  let vertices = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      vertices += position ? position.getCount() : 0;
      const indices = primitive.getIndices();
      triangles += indices ? indices.getCount() / 3 : (position?.getCount() ?? 0) / 3;
    }
  }
  return {
    bounds: flatBounds,
    vertices,
    triangles: Math.round(triangles),
    meshes: document.getRoot().listMeshes().length,
    materials: document.getRoot().listMaterials().length,
  };
}

function mergeManifest(entries) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  manifest.assets = [...byId.values()];
  manifest.budgets = {
    ...manifest.budgets,
    buildingMaxTriangles: 3_000,
    maxInitialBuildingInstances: 96,
  };
  return manifest;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const renderer = await startRenderer();
  const built = [];
  try {
    const results = await renderer.page.evaluate(() => window.buildWuxiaBuildings());
    for (const result of results) {
      const rawPath = join(tmpdir(), `jwgb-${result.id}-${process.pid}.glb`);
      writeFileSync(rawPath, Buffer.from(result.b64, 'base64'));
      const outputPath = join(OUTPUT_DIR, `${result.id}.glb`);
      const optimized = await optimize(rawPath, outputPath);
      rmSync(rawPath, { force: true });
      const height = Number((optimized.bounds[4] - optimized.bounds[1]).toFixed(3));
      const bytes = readFileSync(outputPath).length;
      if (optimized.triangles > 3_000) {
        throw new Error(`${result.id}: ${optimized.triangles} triangles exceeds the 3000 budget`);
      }
      if (Math.abs(optimized.bounds[1]) > 0.002) {
        throw new Error(`${result.id}: base is not grounded (minY ${optimized.bounds[1]})`);
      }
      built.push({
        id: result.id,
        displayName: result.displayName,
        height,
        triangles: optimized.triangles,
        vertices: optimized.vertices,
        materials: optimized.materials,
        meshes: optimized.meshes,
        bytes,
        bounds: optimized.bounds,
        rawTriangles: result.metrics.triangles,
      });
      console.log(
        `${result.id.padEnd(22)} ${String(optimized.triangles).padStart(5)} tris  ` +
          `${String(Math.round(bytes / 1024)).padStart(4)} KiB  h=${height.toFixed(2)}m`,
      );
    }
  } finally {
    await renderer.close();
  }

  if (CHECK_ONLY) {
    console.log(`checked ${built.length} buildings, no files written`);
    return;
  }

  const manifest = mergeManifest(
    built.map((building) => ({
      id: building.id,
      path: `${DELIVERY_PATH}/${building.id}.glb`,
      source: `procedural:tools/models/build-wuxia-buildings-entry.js#${building.id}`,
      displayName: building.displayName,
      targetHeight: building.height,
      bytes: building.bytes,
      metrics: {
        after: {
          meshes: building.meshes,
          triangles: building.rawTriangles,
          nativeBounds: building.bounds,
        },
        normalized: { targetHeight: building.height, bounds: building.bounds },
      },
      optimized: {
        vertices: building.vertices,
        triangles: building.triangles,
        meshes: building.meshes,
        materials: building.materials,
        drawCalls: 1,
      },
      delivery: 'procedural-wuxia-building',
    })),
  );
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  const totalTriangles = built.reduce((sum, building) => sum + building.triangles, 0);
  const totalBytes = built.reduce((sum, building) => sum + building.bytes, 0);
  console.log(
    `wrote ${built.length} buildings (${totalTriangles} tris, ${Math.round(totalBytes / 1024)} KiB) ` +
      `into ${basename(OUTPUT_DIR)} and merged their manifest entries`,
  );
}

await main();
