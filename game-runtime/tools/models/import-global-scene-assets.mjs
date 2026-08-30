import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  inspect,
  join as joinMeshes,
  meshopt,
  prune,
  textureCompress,
} from '@gltf-transform/functions';
import { build as buildBundle } from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUTPUT_DIR = resolve(
  process.env.JWGB_GLOBAL_SCENE_OUTPUT?.trim() ||
    join(ROOT, 'apps', 'web', 'public', 'models', 'global-scenes'),
);
const DOWNLOAD_ROOT =
  process.env.JWGB_GLOBAL_SCENE_SOURCE_ROOT?.trim() || 'C:\\Users\\xinzh\\Downloads';

const SOURCES = {
  overgrown: {
    zipPath:
      process.env.JWGB_OVERGROWN_SCENE_ZIP?.trim() ||
      join(DOWNLOAD_ROOT, 'an-overgrown-japanese-style-location.zip'),
    source: 'an-overgrown-japanese-style-location.zip',
  },
  forestRoad: {
    zipPath:
      process.env.JWGB_FOREST_ROAD_SCENE_ZIP?.trim() ||
      join(DOWNLOAD_ROOT, 'a-forest-3-with-a-road-at-night-for-game.zip'),
    source: 'a-forest-3-with-a-road-at-night-for-game.zip',
  },
  forestMountains: {
    zipPath:
      process.env.JWGB_FOREST_MOUNTAINS_SCENE_ZIP?.trim() ||
      join(DOWNLOAD_ROOT, 'landscape-forest-mountains.zip'),
    source: 'landscape-forest-mountains.zip',
  },
};

const TARGETS = [
  {
    id: 'overgrown-grove',
    sourceId: 'overgrown',
    targetHeight: 12,
    nodes: ['node_0005', 'node_0006', 'Cube', 'Cube001', 'Cube002', 'Cube003'],
    role: 'grove',
  },
  {
    id: 'overgrown-card-a',
    sourceId: 'overgrown',
    targetHeight: 7.5,
    nodes: ['Plane|Plane001|Dupli|369'],
    role: 'foliage',
  },
  {
    id: 'overgrown-card-b',
    sourceId: 'overgrown',
    targetHeight: 10,
    nodes: ['Plane|Plane002|Dupli|711'],
    role: 'foliage',
  },
  {
    id: 'forest-road-tree-a',
    sourceId: 'forestRoad',
    targetHeight: 9.4,
    nodes: ['Cylinder060'],
    role: 'tree',
  },
  {
    id: 'forest-road-tree-b',
    sourceId: 'forestRoad',
    targetHeight: 7.2,
    nodes: ['Plane061'],
    role: 'tree',
  },
  {
    id: 'forest-road-understory',
    sourceId: 'forestRoad',
    targetHeight: 2.2,
    nodes: ['Plane599'],
    role: 'foliage',
  },
  {
    id: 'forest-mountains-card-a',
    sourceId: 'forestMountains',
    targetHeight: 8.4,
    nodes: ['Plane2373'],
    role: 'tree',
  },
  {
    id: 'forest-mountains-card-b',
    sourceId: 'forestMountains',
    targetHeight: 7.4,
    nodes: ['Plane728'],
    role: 'tree',
  },
  {
    id: 'forest-mountains-card-c',
    sourceId: 'forestMountains',
    targetHeight: 10,
    nodes: ['Plane3463'],
    role: 'tree',
  },
  {
    id: 'forest-mountains-ridge-a',
    sourceId: 'forestMountains',
    targetHeight: 36,
    nodes: ['Plane007'],
    role: 'backdrop',
  },
  {
    id: 'forest-mountains-ridge-b',
    sourceId: 'forestMountains',
    targetHeight: 42,
    nodes: ['Plane009'],
    role: 'backdrop',
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

async function findFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findFiles(path, predicate)));
    } else if (predicate(path)) {
      files.push(path);
    }
  }
  return files;
}

async function extractSource(sourceId, source) {
  if (!existsSync(source.zipPath)) {
    throw new Error(`${sourceId} source ZIP not found: ${source.zipPath}`);
  }
  const directory = await mkdtemp(join(tmpdir(), `jwgb-global-${sourceId}-`));
  execFileSync('tar.exe', ['-xf', source.zipPath, '-C', directory], { stdio: 'ignore' });
  const fbxFiles = await findFiles(directory, (path) => extname(path).toLowerCase() === '.fbx');
  if (fbxFiles.length !== 1) {
    throw new Error(`${sourceId} expected one FBX, found ${fbxFiles.length}`);
  }
  const texturePaths = await findFiles(directory, (path) => /\.(png|jpe?g|webp)$/i.test(path));
  return {
    directory,
    fbxPath: fbxFiles[0],
    texturePaths: texturePaths.filter((path) => !/normal/i.test(basename(path))),
  };
}

async function loadTextures(paths) {
  const textures = [];
  for (const path of paths) {
    const bytes = await sharp(path)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86, effort: 4 })
      .toBuffer();
    textures.push({
      name: basename(path),
      mime: 'image/webp',
      b64: bytes.toString('base64'),
    });
  }
  return textures;
}

async function startConverter() {
  const bundlePath = join(tmpdir(), `jwgb-global-scenes-${process.pid}.bundle.js`);
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
  page.on('pageerror', (error) => console.warn(`global scene converter: ${String(error)}`));
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
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [512, 512],
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await io.write(outputPath, document);
  return inspect(document);
}

function reportCounts(report) {
  const meshes = report.meshes?.properties ?? [];
  const materials = report.materials?.properties ?? [];
  return {
    vertices: meshes.reduce((sum, item) => sum + (item.vertices ?? 0), 0),
    triangles: meshes.reduce((sum, item) => sum + (item.glPrimitives ?? 0), 0),
    meshes: meshes.length,
    materials: materials.length,
    drawCalls: meshes.reduce((sum, item) => sum + (item.meshPrimitives ?? 0), 0),
  };
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const extracted = new Map();
  const sourceInputs = new Map();
  const converter = await startConverter();
  try {
    for (const [sourceId, source] of Object.entries(SOURCES)) {
      const sourceDirectory = await extractSource(sourceId, source);
      extracted.set(sourceId, sourceDirectory.directory);
      sourceInputs.set(sourceId, {
        ...sourceDirectory,
        fbx: (await readFile(sourceDirectory.fbxPath)).toString('base64'),
        textures: await loadTextures(sourceDirectory.texturePaths),
      });
    }

    const assets = [];
    for (const target of TARGETS) {
      const input = sourceInputs.get(target.sourceId);
      if (!input) {
        throw new Error(`missing extracted source ${target.sourceId}`);
      }
      const result = await converter.page.evaluate((value) => window.convertMapAsset(value), {
        type: 'fbx',
        profile: 'landmark',
        name: target.id,
        b64: input.fbx,
        textures: input.textures,
        targetHeight: target.targetHeight,
        selectedNodes: target.nodes,
      });
      const part = result.parts[0];
      if (!part) {
        throw new Error(`${target.id} exported no renderable meshes`);
      }
      if (result.metrics.filtered.meshes !== target.nodes.length) {
        throw new Error(
          `${target.id} expected ${target.nodes.length} selected meshes, ` +
            `found ${result.metrics.filtered.meshes}`,
        );
      }
      const rawPath = join(input.directory, `${target.id}.raw.glb`);
      const outputPath = join(OUTPUT_DIR, `${target.id}.glb`);
      writeFileSync(rawPath, Buffer.from(part.b64, 'base64'));
      const report = await optimizeGlb(rawPath, outputPath);
      const stats = await stat(outputPath);
      const source = SOURCES[target.sourceId];
      const entry = {
        id: target.id,
        path: `models/global-scenes/${target.id}.glb`,
        source: source.source,
        role: target.role,
        targetHeight: target.targetHeight,
        bytes: stats.size,
        nodes: target.nodes,
        metrics: part.metrics,
        optimized: reportCounts(report),
      };
      assets.push(entry);
      console.log(
        `${target.id}: ${entry.optimized.triangles} triangles, ` +
          `${Math.round(entry.bytes / 1024)} KiB`,
      );
    }

    const manifest = {
      schema: 'jwgb.global-scene-manifest.v1',
      generatedAt: new Date().toISOString(),
      sources: Object.values(SOURCES).map((source) => source.source),
      assets,
      exclusions: [
        'source road and terrain base meshes',
        'source sky and HDRI spheres',
        'source full-scene ground planes',
      ],
    };
    writeFileSync(join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    await converter.close();
    for (const directory of extracted.values()) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

await main();
