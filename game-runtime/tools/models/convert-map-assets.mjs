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
  simplify,
  textureCompress,
} from '@gltf-transform/functions';
import { build as buildBundle } from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUTPUT_DIR = resolve(
  process.env.JWGB_MAP_ASSET_OUTPUT?.trim() ||
    join(ROOT, 'apps', 'web', 'public', 'models', 'map-assets'),
);
const DOWNLOAD_ROOT = process.env.JWGB_DOWNLOAD_ROOT?.trim() || 'E:\\BaiduNetdiskDownload';
const CHINA_ROOT = process.env.JWGB_CHINA_ROOT?.trim() || DOWNLOAD_ROOT;
const ROCK_ROOT = process.env.JWGB_ROCK_ROOT?.trim() || DOWNLOAD_ROOT;
const LOWPOLY_PACKAGE =
  process.env.JWGB_LOWPOLY_PACKAGE?.trim() ||
  join(DOWNLOAD_ROOT, '0072lowpoly森林岛屿沙漠', 'Lowpoly Style Ultra Pack 1.2.unitypackage');
const FOLIAGE_OUTPUT_DIR = resolve(
  process.env.JWGB_FOLIAGE_OUTPUT?.trim() ||
    join(ROOT, 'apps', 'web', 'public', 'models', 'foliage'),
);
const SOURCE_TEXTURE_DIR = resolve(
  process.env.JWGB_MAP_SOURCE_TEXTURE_DIR?.trim() ||
    join(ROOT, 'tools', 'models', 'source-textures'),
);

const CHINA_TARGETS = [
  {
    file: '45.FBX',
    output: 'wuxia-citadel.glb',
    height: 34,
    textures: ['3005_Diff_01.psd', '3005_Diff_02.psd', '3005_Diff_03.psd'],
    nodeFilter: {
      include: 'Building|Item',
      exclude: 'Terrain|Ground|Plant|Tree|Grass|Bush|Flower',
      bounds: { minZ: -55, maxZ: 32 },
    },
  },
  {
    file: '51.FBX',
    output: 'wuxia-gate-court.glb',
    height: 30,
    textures: ['JTYS_Diff_01.psd', 'JTYS_Diff_02.psd', 'JTYS_Diff_03.psd'],
    nodeFilter: {
      include: 'Building|Item',
      exclude: 'Terrain|Ground|Plant|Tree|Grass|Bush|Flower',
    },
  },
  {
    file: '54.FBX',
    output: 'wuxia-east-asia-hall.glb',
    height: 32,
    textures: [
      'ITem_dongya_d_4001.psd',
      'Item_Integration02_d.psd',
      'Item_Integration_d.psd',
      'Plant_Botany_d.psd',
    ],
    nodeFilter: {
      include: 'Building|Item',
      exclude: 'Terrain|Ground|Sky|Cloud|Mountain|Wall|Plant|Tree|Grass|Bush|Flower',
      bounds: { minZ: -36, maxZ: 36 },
    },
  },
  {
    file: '60.FBX',
    output: 'wuxia-mountain-gate.glb',
    height: 34,
    textures: ['Item_Integration02_d.psd', 'Item_Integration_d.psd', 'Plant_Botany_d.psd'],
    nodeFilter: {
      include: 'Building|Item',
      exclude:
        'Terrain|Ground|Sky|Cloud|Mountain|Wall|Plant|Tree|Grass|Bush|Flower|Stone|Bridge|Stairs|Item_Palace006',
      bounds: { minZ: -32, maxZ: 48 },
    },
  },
];

const PRECOMPOSED_MAP_ASSETS = [
  {
    output: 'lowpoly-asian-village.glb',
    source: '0072 Lowpoly Style Ultra Pack 1.2 / precomposed Asian village',
    targetHeight: 18,
    components: ['AsianHouse_Big2', 'AsianHouse_Big3', 'Torii2', 'ZenGarden', 'RockFormation1'],
  },
];

const PRECOMPOSED_FLORA_ASSETS = [
  {
    id: 'poly-nature-beech',
    output: 'beech-poly.glb',
    source: 'Poly Nature Pack 1.0.0 / tree-beech-european-generic-mature-a',
    targetHeight: 7.8,
  },
  {
    id: 'poly-nature-willow',
    output: 'willow-poly.glb',
    source: 'Poly Nature Pack 1.0.0 / tree-willow-weeping-generic-mature-a',
    targetHeight: 7.4,
  },
  {
    id: 'poly-nature-cypress',
    output: 'cypress-poly.glb',
    source: 'Poly Nature Pack 1.0.0 / tree-cypress-mediterranean-generic-mature-a',
    targetHeight: 7.2,
  },
  {
    id: 'poly-nature-dead-beech',
    output: 'dead-beech-poly.glb',
    source: 'Poly Nature Pack 1.0.0 / tree-beech-european-dry-dead-a',
    targetHeight: 6.8,
  },
  {
    id: 'poly-nature-dead-cypress',
    output: 'dead-cypress-poly.glb',
    source: 'Poly Nature Pack 1.0.0 / tree-cypress-mediterranean-dry-dead-a',
    targetHeight: 6.8,
  },
  {
    id: 'poly-nature-burdock',
    output: 'burdock-poly.glb',
    source: 'Poly Nature Pack 1.0.0 / bush-burdock-generic-mature-a',
    targetHeight: 1.05,
  },
];

const LOWPOLY_TARGETS = [
  {
    id: 'lowpoly-asia-tree',
    file: 'asia-tree.glb',
    sourcePath: 'Assets/Lowpoly Style/Shared FBX Meshes/Plants/AsiaTree1.fbx',
    source: '0072 Lowpoly Style Ultra Pack 1.2 / AsiaTree1.fbx',
    targetHeight: 8.6,
    textures: ['Main.psd', 'T_Oak.png', 'T_OakEmission.png'],
  },
  {
    id: 'lowpoly-red-maple',
    file: 'red-maple.glb',
    sourcePath: 'Assets/Lowpoly Style/Shared FBX Meshes/Plants/RedMapleTree1.fbx',
    source: '0072 Lowpoly Style Ultra Pack 1.2 / RedMapleTree1.fbx',
    targetHeight: 8.1,
    textures: ['Main.psd', 'T_MapleLeaf.png', 'T_OakEmission.png'],
  },
  {
    id: 'lowpoly-asia-bush',
    file: 'asia-bush.glb',
    sourcePath: 'Assets/Lowpoly Style/Shared FBX Meshes/Plants/Bush1.fbx',
    source: '0072 Lowpoly Style Ultra Pack 1.2 / Bush1.fbx',
    targetHeight: 2.9,
    textures: ['Main.psd', 'T_Oak.png', 'T_OakEmission.png'],
  },
  {
    id: 'lowpoly-reed-big',
    file: 'reed-big.glb',
    sourcePath: 'Assets/Lowpoly Style/Shared FBX Meshes/Plants/ReedBig.fbx',
    source: '0072 Lowpoly Style Ultra Pack 1.2 / ReedBig.fbx',
    targetHeight: 4.3,
    textures: ['Main.psd', 'T_Oak.png', 'T_OakEmission.png'],
  },
  {
    id: 'lowpoly-small-plant-1',
    file: 'small-plant-1.glb',
    sourcePath: 'Assets/Lowpoly Style/Shared FBX Meshes/Plants/SmallPlant1_LOD.fbx',
    source: '0072 Lowpoly Style Ultra Pack 1.2 / SmallPlant1_LOD.fbx',
    targetHeight: 1.7,
    textures: ['Main.psd', 'T_Oak.png', 'T_OakEmission.png'],
  },
  {
    id: 'lowpoly-small-plant-2',
    file: 'small-plant-2.glb',
    sourcePath: 'Assets/Lowpoly Style/Shared FBX Meshes/Plants/SmallPlant2_LOD.fbx',
    source: '0072 Lowpoly Style Ultra Pack 1.2 / SmallPlant2_LOD.fbx',
    targetHeight: 1.9,
    textures: ['Main.psd', 'T_Oak.png', 'T_OakEmission.png'],
  },
  {
    id: 'lowpoly-asia-house',
    file: 'asia-house.glb',
    delivery: 'map',
    sourcePath: 'Assets/Lowpoly Style/Shared FBX Meshes/Buildings and  Structures/AsianHouse_2.fbx',
    source: '0072 Lowpoly Style Ultra Pack 1.2 / AsianHouse_2.fbx',
    targetHeight: 12,
    textures: ['Main.psd', 'T_Roof_CV.png'],
  },
  {
    id: 'lowpoly-torii',
    file: 'torii-2.glb',
    delivery: 'map',
    sourcePath: 'Assets/Lowpoly Style/Shared FBX Meshes/Buildings and  Structures/Torii2.fbx',
    source: '0072 Lowpoly Style Ultra Pack 1.2 / Torii2.fbx',
    targetHeight: 10,
    textures: ['Main.psd', 'T_Roof_CV.png'],
  },
  {
    id: 'lowpoly-rock-formation',
    file: 'rock-formation-2.glb',
    delivery: 'map',
    sourcePath: 'Assets/Lowpoly Style/Shared FBX Meshes/Rocks/RockFormation2.fbx',
    source: '0072 Lowpoly Style Ultra Pack 1.2 / RockFormation2.fbx',
    targetHeight: 5.2,
    textures: ['Main.psd'],
  },
];

const ROCK_TARGET_HEIGHTS = [
  2.8, 3.4, 4.1, 2.3, 3.1, 2.6, 3.8, 2.2, 1.9, 1.6, 1.7, 1.8, 1.5, 1.4, 1.3,
];
const STYLIZED_ROCK_PARTS = [
  { index: 3, height: 3.2 },
  { index: 9, height: 2.1 },
  { index: 11, height: 2.6 },
  { index: 14, height: 3.3 },
  { index: 16, height: 3.8 },
  { index: 18, height: 4.1 },
  { index: 19, height: 4.6 },
  { index: 22, height: 4.2 },
  { index: 24, height: 4.6 },
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

async function findNamedFile(directory, fileName) {
  const matches = await findFiles(
    directory,
    (path) => basename(path).toLowerCase() === fileName.toLowerCase(),
  );
  if (matches.length === 0) {
    throw new Error(`source file not found: ${fileName} under ${directory}`);
  }
  return matches[0];
}

async function findZipBySize(directory, options) {
  const candidates = await findFiles(directory, (path) => extname(path).toLowerCase() === '.zip');
  const sized = [];
  for (const path of candidates) {
    sized.push({ path, size: (await stat(path)).size });
  }
  const preferred = sized
    .filter((item) => item.size >= options.minBytes && item.size <= options.maxBytes)
    .sort(
      (left, right) =>
        Math.abs(left.size - options.preferredBytes) -
        Math.abs(right.size - options.preferredBytes),
    )[0];
  if (preferred) {
    return preferred.path;
  }
  throw new Error(`${options.label} zip not found under ${directory}`);
}

async function loadSourceTextures(names) {
  const files = [];
  const missing = [];
  for (const name of names ?? []) {
    const outputName = `${basename(name, extname(name))}.webp`;
    const path = join(SOURCE_TEXTURE_DIR, outputName);
    if (!existsSync(path)) {
      missing.push(name);
      continue;
    }
    files.push({
      name,
      mime: 'image/webp',
      b64: (await readFile(path)).toString('base64'),
    });
  }
  if (missing.length > 0) {
    console.warn(`missing converted FBX textures: ${missing.join(', ')}`);
  }
  return files;
}

function b64(path) {
  return readFileSync(path).toString('base64');
}

async function optimizedRockTexture(path, sanitize = true) {
  const image = sharp(path).removeAlpha().resize({
    width: 1024,
    height: 1024,
    fit: 'inside',
  });
  if (!sanitize) {
    return image.webp({ quality: 88, effort: 4 }).toBuffer();
  }
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? red;
    const blue = data[index + 2] ?? red;
    const luminance = red + green + blue;
    if (luminance < 42) {
      data[index] = 104;
      data[index + 1] = 88;
      data[index + 2] = 72;
    } else if (luminance < 78) {
      data[index] = Math.max(red, 72);
      data[index + 1] = Math.max(green, 62);
      data[index + 2] = Math.max(blue, 52);
    }
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .webp({ quality: 84, effort: 4 })
    .toBuffer();
}

async function sanitizedRockTexture(path) {
  return optimizedRockTexture(path, true);
}

async function findRockZip(directory) {
  return findZipBySize(directory, {
    minBytes: 50_000_000,
    maxBytes: 70_000_000,
    preferredBytes: 57_000_000,
    label: 'C1524 Desert Rocks',
  });
}

function arrayBufferFromBase64(value) {
  return Buffer.from(value, 'base64');
}

async function extractZip(zipPath, prefix) {
  const directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
  execFileSync('tar.exe', ['-xf', zipPath, '-C', directory], { stdio: 'ignore' });
  return directory;
}

async function extractUnityPackage(packagePath, prefix) {
  const directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
  execFileSync('tar.exe', ['-xf', packagePath, '-C', directory], { stdio: 'ignore' });
  const entries = await readdir(directory, { withFileTypes: true });
  const index = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const assetDir = join(directory, entry.name);
    const pathname = join(assetDir, 'pathname');
    const asset = join(assetDir, 'asset');
    if (!existsSync(pathname) || !existsSync(asset)) {
      continue;
    }
    const sourcePath = (await readFile(pathname, 'utf8')).split(/\r?\n/, 1)[0]?.trim();
    if (sourcePath) {
      index.set(sourcePath.toLowerCase(), asset);
    }
  }
  return { directory, index };
}

async function startConverter() {
  const bundlePath = join(tmpdir(), `jwgb-map-assets-${process.pid}.bundle.js`);
  const entryPath = join(ROOT, 'tools', 'models', 'convert-map-assets-entry.js');
  await buildBundle({
    entryPoints: [entryPath],
    bundle: true,
    format: 'iife',
    outfile: bundlePath,
    logLevel: 'info',
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
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.warn(`converter browser: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => console.warn(`converter page: ${String(error)}`));
  const source = readFileSync(bundlePath, 'utf8');
  await page.setContent(`<!doctype html><meta charset="utf-8"><script>${source}</script>`, {
    waitUntil: 'load',
  });
  await page.waitForFunction(() => window.__ready === true);
  return {
    page,
    close: async () => {
      await browser.close();
      rmSync(bundlePath, { force: true });
    },
  };
}

async function runBrowserConversion(page, input) {
  const result = await page.evaluate((value) => window.convertMapAsset(value), input);
  const parts = result.parts.map((part) => ({
    name: part.name,
    bytes: arrayBufferFromBase64(part.b64),
    metrics: part.metrics,
  }));
  return {
    parts,
    metrics: result.metrics,
  };
}

async function optimizeGlb(inputPath, outputPath, profile) {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  const document = await io.read(inputPath);
  document.setLogger(new Logger(Logger.Verbosity.SILENT));
  const transforms = [prune(), dedup(), flatten(), joinMeshes({ keepNamed: false })];
  if (profile === 'rock') {
    transforms.push(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: 0.35,
        error: 0.1,
      }),
    );
  } else if (profile === 'foliage') {
    transforms.push(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: 0.5,
        error: 0.06,
      }),
    );
  } else {
    transforms.push(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: 0.38,
        error: 0.06,
      }),
    );
  }
  if (profile === 'rock' || profile === 'landmark' || profile === 'foliage') {
    transforms.push(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: [512, 512],
      }),
    );
  }
  transforms.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await document.transform(...transforms);
  await io.write(outputPath, document);
  const report = inspect(document);
  return report;
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

async function _prepareLegacyRocks(page) {
  const extracted = await extractZip(await findRockZip(ROCK_ROOT), 'jwgb-rocks');
  const objPath = (
    await findFiles(extracted, (path) => basename(path).toLowerCase() === 'desert rocks.obj')
  )[0];
  const mtlPath = (await findFiles(extracted, (path) => extname(path).toLowerCase() === '.mtl'))[0];
  const texturePaths = await findFiles(extracted, (path) => /\.(png|jpe?g|webp)$/i.test(path));
  const textures = [];
  for (const path of texturePaths) {
    if (!/diffuse/i.test(basename(path))) {
      continue;
    }
    textures.push({
      name: basename(path),
      mime: 'image/webp',
      b64: (await sanitizedRockTexture(path)).toString('base64'),
    });
  }
  const manifestEntries = [];
  const outputFiles = [];
  const result = await runBrowserConversion(page, {
    type: 'obj',
    profile: 'rock',
    obj: readFileSync(objPath, 'utf8'),
    mtl: readFileSync(mtlPath, 'utf8'),
    textures,
    partTargetHeights: ROCK_TARGET_HEIGHTS,
  });
  for (const [index, part] of result.parts.entries()) {
    const onePath = join(extracted, `rock-${index + 1}.raw.glb`);
    writeFileSync(onePath, part.bytes);
    const output = join(OUTPUT_DIR, `desert-rock-${String(index + 1).padStart(2, '0')}.glb`);
    await optimizeGlb(onePath, output, 'rock');
    const stats = await stat(output);
    outputFiles.push(output);
    manifestEntries.push({
      id: `desert-rock-${String(index + 1).padStart(2, '0')}`,
      path: `models/map-assets/${basename(output)}`,
      source: 'C1524 石头02 / Desert Rocks',
      targetHeight: ROCK_TARGET_HEIGHTS[index] ?? 2.5,
      bytes: stats.size,
      metrics: part.metrics,
    });
  }
  rmSync(extracted, { recursive: true, force: true });
  return { files: outputFiles, entries: manifestEntries };
}

async function prepareRockPack(page, config) {
  let zipPath;
  if (config.zipPath) {
    zipPath = resolve(config.zipPath);
    if (!existsSync(zipPath)) {
      throw new Error(`${config.label} zip not found: ${zipPath}`);
    }
  } else {
    zipPath = await findZipBySize(ROCK_ROOT, config.zipSearch);
  }
  const extracted = await extractZip(zipPath, config.extractPrefix);
  const objPath = (
    await findFiles(
      extracted,
      (path) => basename(path).toLowerCase() === config.objName.toLowerCase(),
    )
  )[0];
  const mtlPath = (await findFiles(extracted, (path) => extname(path).toLowerCase() === '.mtl'))[0];
  if (!objPath || !mtlPath) {
    throw new Error(`${config.label} OBJ/MTL pair not found`);
  }
  const texturePaths = await findFiles(extracted, (path) => /\.(png|jpe?g|webp)$/i.test(path));
  const textures = [];
  for (const path of texturePaths) {
    if (!config.texturePattern.test(basename(path))) {
      continue;
    }
    textures.push({
      name: basename(path),
      mime: 'image/webp',
      b64: (await optimizedRockTexture(path, config.sanitizeTextures)).toString('base64'),
    });
  }
  const partTargetHeights = Array.from({ length: config.partCount }, () => 10);
  for (const part of config.selectedParts) {
    partTargetHeights[part.index] = part.height;
  }
  const selected = new Map(config.selectedParts.map((part) => [part.index, part]));
  const result = await runBrowserConversion(page, {
    type: 'obj',
    profile: 'rock',
    obj: readFileSync(objPath, 'utf8'),
    mtl: readFileSync(mtlPath, 'utf8'),
    textures,
    partTargetHeights,
  });
  const manifestEntries = [];
  const outputFiles = [];
  let outputIndex = 0;
  for (const [index, part] of result.parts.entries()) {
    const selectedPart = selected.get(index);
    if (!selectedPart) {
      continue;
    }
    const onePath = join(extracted, `${config.extractPrefix}-${index + 1}.raw.glb`);
    writeFileSync(onePath, part.bytes);
    const output = join(
      OUTPUT_DIR,
      `${config.outputPrefix}-${String(outputIndex + 1).padStart(2, '0')}.glb`,
    );
    const report = await optimizeGlb(onePath, output, 'rock');
    const stats = await stat(output);
    outputFiles.push(output);
    manifestEntries.push({
      id: `${config.outputPrefix}-${String(outputIndex + 1).padStart(2, '0')}`,
      path: `models/map-assets/${basename(output)}`,
      source: config.source,
      targetHeight: selectedPart.height,
      bytes: stats.size,
      metrics: part.metrics,
      optimized: reportCounts(report),
    });
    outputIndex += 1;
  }
  rmSync(extracted, { recursive: true, force: true });
  return { files: outputFiles, entries: manifestEntries };
}

async function prepareRocks(page) {
  const desert = await prepareRockPack(page, {
    label: 'C1524 Desert Rocks',
    extractPrefix: 'jwgb-desert-rocks',
    outputPrefix: 'desert-rock',
    objName: 'Desert Rocks.obj',
    source: 'C1524 rock pack / stone02 / Desert Rocks',
    sanitizeTextures: true,
    texturePattern: /diffuse/i,
    partCount: ROCK_TARGET_HEIGHTS.length,
    selectedParts: ROCK_TARGET_HEIGHTS.map((height, index) => ({ index, height })),
    zipPath: process.env.JWGB_STONE02_ZIP?.trim(),
    zipSearch: {
      minBytes: 50_000_000,
      maxBytes: 70_000_000,
      preferredBytes: 57_000_000,
      label: 'C1524 Desert Rocks',
    },
  });
  const stylized = await prepareRockPack(page, {
    label: 'C1524 ST-PaCK',
    extractPrefix: 'jwgb-stylized-rocks',
    outputPrefix: 'stylized-rock',
    objName: 'ST-PaCK.obj',
    source: 'C1524 rock pack / stone01 / ST-PaCK',
    sanitizeTextures: false,
    texturePattern: /diffuse|color|clr/i,
    partCount: 26,
    selectedParts: STYLIZED_ROCK_PARTS,
    zipPath: process.env.JWGB_STONE01_ZIP?.trim(),
    zipSearch: {
      minBytes: 85_000_000,
      maxBytes: 100_000_000,
      preferredBytes: 91_000_000,
      label: 'C1524 ST-PaCK',
    },
  });
  return {
    files: [...desert.files, ...stylized.files],
    entries: [...desert.entries, ...stylized.entries],
  };
}

async function prepareChina(page) {
  const entries = [];
  const outputs = [];
  for (const target of CHINA_TARGETS) {
    const inputPath = await findNamedFile(CHINA_ROOT, target.file);
    const result = await runBrowserConversion(page, {
      type: 'fbx',
      profile: 'landmark',
      name: target.file,
      b64: b64(inputPath),
      targetHeight: target.height,
      nodeFilter: target.nodeFilter,
      textures: await loadSourceTextures(target.textures),
    });
    const part = result.parts[0];
    if (!part) {
      throw new Error(`no exported meshes for ${target.file}`);
    }
    const rawPath = join(OUTPUT_DIR, `${target.output}.raw.glb`);
    writeFileSync(rawPath, part.bytes);
    const output = join(OUTPUT_DIR, target.output);
    const report = await optimizeGlb(rawPath, output, 'landmark');
    rmSync(rawPath, { force: true });
    const stats = await stat(output);
    outputs.push(output);
    entries.push({
      id: target.output.replace(/\.glb$/i, ''),
      path: `models/map-assets/${target.output}`,
      source: `80个精品中国风武侠仙侠 MAX Unity 场景 / ${target.file}`,
      targetHeight: target.height,
      bytes: stats.size,
      metrics: part.metrics,
      optimized: reportCounts(report),
      textures: target.textures.map((name) => `${basename(name, extname(name))}.webp`),
      nodeFilter: target.nodeFilter,
    });
    console.log(
      `${target.file}: ${result.metrics.before.triangles} tris, ` +
        `${result.metrics.filtered.triangles} after node filter -> ` +
        `${entries.at(-1).optimized.triangles} tris, ${Math.round(stats.size / 1024)} KiB`,
    );
  }
  return { files: outputs, entries };
}

async function preparePrecomposedMapAssets() {
  const entries = [];
  for (const target of PRECOMPOSED_MAP_ASSETS) {
    const output = join(OUTPUT_DIR, target.output);
    if (!existsSync(output)) {
      console.warn(`precomposed map asset not found, skipping manifest entry: ${output}`);
      continue;
    }
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
    });
    const document = await io.read(output);
    document.setLogger(new Logger(Logger.Verbosity.SILENT));
    const report = inspect(document);
    const optimized = reportCounts(report);
    const scene = report.scenes?.properties?.[0] ?? {};
    const bounds = [...(scene.bboxMin ?? [0, 0, 0]), ...(scene.bboxMax ?? [0, 0, 0])];
    const stats = await stat(output);
    entries.push({
      id: target.output.replace(/\.glb$/i, ''),
      path: `models/map-assets/${target.output}`,
      source: target.source,
      targetHeight: target.targetHeight,
      bytes: stats.size,
      metrics: {
        after: optimized,
        normalized: {
          targetHeight: target.targetHeight,
          bounds,
        },
      },
      optimized,
      components: target.components,
      delivery: 'single-precomposed-glb',
    });
  }
  return entries;
}

async function preparePrecomposedFloraAssets() {
  const entries = [];
  for (const target of PRECOMPOSED_FLORA_ASSETS) {
    const output = join(FOLIAGE_OUTPUT_DIR, target.output);
    if (!existsSync(output)) {
      console.warn(`precomposed flora asset not found, skipping manifest entry: ${output}`);
      continue;
    }
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
    });
    const document = await io.read(output);
    document.setLogger(new Logger(Logger.Verbosity.SILENT));
    const report = inspect(document);
    const optimized = reportCounts(report);
    const scene = report.scenes?.properties?.[0] ?? {};
    const bounds = [...(scene.bboxMin ?? [0, 0, 0]), ...(scene.bboxMax ?? [0, 0, 0])];
    const stats = await stat(output);
    entries.push({
      id: target.id,
      path: `models/foliage/${target.output}`,
      source: target.source,
      targetHeight: target.targetHeight,
      bytes: stats.size,
      metrics: {
        after: optimized,
        normalized: {
          targetHeight: target.targetHeight,
          bounds,
        },
      },
      optimized,
      delivery: 'prebuilt-blender-glb',
    });
  }
  return entries;
}

async function prepareLowpolyAssets(page) {
  if (!existsSync(LOWPOLY_PACKAGE)) {
    console.warn(`lowpoly Unitypackage not found, skipping: ${LOWPOLY_PACKAGE}`);
    return [];
  }
  const extracted = await extractUnityPackage(LOWPOLY_PACKAGE, 'jwgb-lowpoly');
  const entries = [];
  try {
    for (const target of LOWPOLY_TARGETS) {
      const inputPath = extracted.index.get(target.sourcePath.toLowerCase());
      if (!inputPath) {
        console.warn(`lowpoly source not found in package: ${target.sourcePath}`);
        continue;
      }
      const result = await runBrowserConversion(page, {
        type: 'fbx',
        profile: 'foliage',
        name: target.sourcePath,
        b64: b64(inputPath),
        targetHeight: target.targetHeight,
        textures: await loadSourceTextures(target.textures),
      });
      const part = result.parts[0];
      if (!part) {
        console.warn(`lowpoly export has no meshes: ${target.sourcePath}`);
        continue;
      }
      const rawPath = join(extracted.directory, `${target.id}.raw.glb`);
      writeFileSync(rawPath, part.bytes);
      const outputDirectory = target.delivery === 'map' ? OUTPUT_DIR : FOLIAGE_OUTPUT_DIR;
      const output = join(outputDirectory, target.file);
      mkdirSync(outputDirectory, { recursive: true });
      if (target.delivery === 'map') {
        rmSync(join(FOLIAGE_OUTPUT_DIR, target.file), { force: true });
      }
      const report = await optimizeGlb(rawPath, output, 'foliage');
      const stats = await stat(output);
      const deliveryPath = target.delivery === 'map' ? 'models/map-assets' : 'models/foliage';
      entries.push({
        id: target.id,
        path: `${deliveryPath}/${target.file}`,
        source: target.source,
        targetHeight: target.targetHeight,
        bytes: stats.size,
        metrics: part.metrics,
        optimized: reportCounts(report),
        ...(target.delivery ? { delivery: target.delivery } : {}),
      });
      console.log(
        `${basename(target.sourcePath)}: ${part.metrics.after.triangles} tris -> ` +
          `${entries.at(-1).optimized.triangles} tris, ${Math.round(stats.size / 1024)} KiB`,
      );
    }
  } finally {
    rmSync(extracted.directory, { recursive: true, force: true });
  }
  return entries;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const converter = await startConverter();
  try {
    const rocks = await prepareRocks(converter.page);
    const china = await prepareChina(converter.page);
    const precomposed = await preparePrecomposedMapAssets();
    const precomposedFlora = await preparePrecomposedFloraAssets();
    const lowpoly = await prepareLowpolyAssets(converter.page);
    const lowpolyMapAssets = lowpoly.filter((entry) => entry.delivery === 'map');
    const lowpolyFloraAssets = lowpoly.filter((entry) => entry.delivery !== 'map');
    const manifest = {
      schema: 'jwgb.map-asset-manifest.v1',
      generatedAt: new Date().toISOString(),
      assets: [...rocks.entries, ...china.entries, ...precomposed, ...lowpolyMapAssets],
      floraAssets: [...lowpolyFloraAssets, ...precomposedFlora],
      budgets: {
        landmarkMaxTriangles: 60_000,
        rockMaxTriangles: 4_000,
        maxInitialLandmarks: 5,
        maxInitialRockInstances: 84,
        maxInitialLowpolyFloraInstances: 260,
      },
    };
    writeFileSync(join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${manifest.assets.length} optimized map assets to ${OUTPUT_DIR}`);
  } finally {
    await converter.close();
  }
}

await main();
