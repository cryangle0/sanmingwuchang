import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  inspect,
  meshopt,
  prune,
  resample,
  simplifyPrimitive,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { build as buildBundle } from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const sourceRoot =
  process.env.JWGB_SHOP_SOURCE_ROOT?.trim() || resolve(repositoryRoot, '..', '素材');
const browserPath =
  process.env.JWGB_BROWSER_EXECUTABLE?.trim() ||
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!browserPath) {
  throw new Error('Chrome or Edge executable not found');
}

const shopConfigs = [
  {
    modelId: 'S001',
    shopKind: 'shoemaker',
    displayName: '鞋匠',
    sourceDirectoryName: '鞋匠2_FBX',
    sourceEnvironmentName: 'JWGB_SHOP_S001_SOURCE',
    targetHeight: 2.05,
  },
  {
    modelId: 'S002',
    shopKind: 'taibai',
    displayName: '太白金星',
    sourceDirectoryName: '太白金星_FBX',
    sourceEnvironmentName: 'JWGB_SHOP_S002_SOURCE',
    targetHeight: 2.2,
  },
  {
    modelId: 'S003',
    shopKind: 'land-god',
    displayName: '土地公',
    sourceDirectoryName: '土地_FBX',
    sourceEnvironmentName: 'JWGB_SHOP_S003_SOURCE',
    targetHeight: 1.8,
  },
  {
    modelId: 'S004',
    shopKind: 'heishan',
    displayName: '黑山老妖',
    sourceDirectoryName: '财神_FBX',
    sourceEnvironmentName: 'JWGB_SHOP_S004_SOURCE',
    targetHeight: 2.6,
  },
].map((config) => ({
  ...config,
  sourcePath:
    process.env[config.sourceEnvironmentName]?.trim() ||
    join(sourceRoot, config.sourceDirectoryName, '01_待机_idle.fbx'),
  outputDirectory: join(
    repositoryRoot,
    'apps',
    'web',
    'public',
    'models',
    'shops',
    config.modelId,
  ),
  bodyTriangleBudget: 16_000,
  accessoryTriangleBudget: 4_000,
  totalTriangleBudget: 20_000,
  fileByteBudget: 8 * 1024 * 1024,
  textureSize: 512,
  textureQuality: 80,
}));

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

function reportCounts(report) {
  const meshes = report.meshes?.properties ?? [];
  const materials = report.materials?.properties ?? [];
  const textures = report.textures?.properties ?? [];
  return {
    vertices: meshes.reduce((sum, item) => sum + (item.vertices ?? 0), 0),
    triangles: meshes.reduce((sum, item) => sum + (item.glPrimitives ?? 0), 0),
    meshes: meshes.length,
    materials: materials.length,
    textures: textures.length,
  };
}

function meshIsSkinned(mesh) {
  return mesh
    .listPrimitives()
    .some(
      (primitive) =>
        primitive.getAttribute('JOINTS_0') !== null && primitive.getAttribute('WEIGHTS_0') !== null,
    );
}

function primitiveTriangles(primitive) {
  const positions = primitive.getAttribute('POSITION');
  const elementCount = primitive.getIndices()?.getCount() ?? positions?.getCount() ?? 0;
  return Math.floor(elementCount / 3);
}

function meshTriangles(mesh) {
  return mesh.listPrimitives().reduce((sum, primitive) => sum + primitiveTriangles(primitive), 0);
}

function simplifyMeshes(meshes, budget, error) {
  const currentTriangles = meshes.reduce((sum, mesh) => sum + meshTriangles(mesh), 0);
  if (currentTriangles <= budget) {
    return currentTriangles;
  }
  const ratio = Math.max(0.01, Math.min(0.9, (budget / currentTriangles) * 0.82));
  for (const mesh of meshes) {
    for (const primitive of mesh.listPrimitives()) {
      simplifyPrimitive(primitive, {
        simplifier: MeshoptSimplifier,
        ratio,
        error,
      });
    }
  }
  return meshes.reduce((sum, mesh) => sum + meshTriangles(mesh), 0);
}

function optimizedMeshRecords(document) {
  return document
    .getRoot()
    .listMeshes()
    .map((mesh) => ({
      name: mesh.getName(),
      skinned: meshIsSkinned(mesh),
      triangles: meshTriangles(mesh),
    }))
    .sort((left, right) => right.triangles - left.triangles);
}

async function optimizeGlb(inputPath, outputPath, config) {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  const document = await io.read(inputPath);
  document.setLogger(new Logger(Logger.Verbosity.SILENT));
  await document.transform(
    prune(),
    dedup(),
    resample({ tolerance: 0.0001 }),
    weld({ overwrite: false }),
  );

  const meshes = document.getRoot().listMeshes();
  const bodyMeshes = meshes.filter(meshIsSkinned);
  const accessoryMeshes = meshes.filter((mesh) => !meshIsSkinned(mesh));
  simplifyMeshes(bodyMeshes, config.bodyTriangleBudget, 0.04);
  simplifyMeshes(accessoryMeshes, config.accessoryTriangleBudget, 0.035);

  await document.transform(
    prune(),
    dedup(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [config.textureSize, config.textureSize],
      quality: config.textureQuality,
      effort: 5,
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await io.write(outputPath, document);
  const report = inspect(document);
  const animations = document
    .getRoot()
    .listAnimations()
    .map((animation) => ({
      name: animation.getName(),
      channels: animation.listChannels().length,
      samplers: animation.listSamplers().length,
    }));
  const skins = document
    .getRoot()
    .listSkins()
    .map((skin) => ({
      name: skin.getName(),
      joints: skin.listJoints().length,
    }));
  return {
    counts: reportCounts(report),
    animations,
    skins,
    meshRecords: optimizedMeshRecords(document),
  };
}

function validateConversion(config, exported, optimized, outputBytes) {
  const errors = [];
  const animationNames = optimized.animations.map((animation) => animation.name);
  const bodyTriangles = optimized.meshRecords
    .filter((mesh) => mesh.skinned)
    .reduce((sum, mesh) => sum + mesh.triangles, 0);
  const accessoryTriangles = optimized.meshRecords
    .filter((mesh) => !mesh.skinned)
    .reduce((sum, mesh) => sum + mesh.triangles, 0);

  if (exported.sourceMetrics[0]?.skinnedMeshes <= 0) {
    errors.push('source has no skinned mesh');
  }
  if (exported.sourceMetrics[0]?.bones.length <= 0) {
    errors.push('source has no skeleton bones');
  }
  if (JSON.stringify(animationNames) !== JSON.stringify(['Idle'])) {
    errors.push(`animation names differ: ${animationNames.join(', ')}`);
  }
  if (optimized.animations.some((animation) => animation.channels === 0)) {
    errors.push('Idle animation has no channels');
  }
  if (optimized.skins.length === 0) {
    errors.push('optimized model has no skin');
  }
  if (bodyTriangles <= 0 || bodyTriangles > config.bodyTriangleBudget * 1.08) {
    errors.push(`body triangle budget exceeded: ${bodyTriangles}`);
  }
  if (accessoryTriangles > config.accessoryTriangleBudget * 1.08) {
    errors.push(`accessory triangle budget exceeded: ${accessoryTriangles}`);
  }
  if (optimized.counts.triangles <= 0 || optimized.counts.triangles > config.totalTriangleBudget) {
    errors.push(`total triangle budget exceeded: ${optimized.counts.triangles}`);
  }
  if (optimized.counts.materials <= 0) {
    errors.push('optimized model has no materials');
  }
  if (outputBytes > config.fileByteBudget) {
    errors.push(`file budget exceeded: ${outputBytes}`);
  }
  return { errors, bodyTriangles, accessoryTriangles };
}

async function convertOne(config, page) {
  if (!existsSync(config.sourcePath)) {
    throw new Error(`${config.modelId} source FBX not found: ${config.sourcePath}`);
  }

  mkdirSync(config.outputDirectory, { recursive: true });
  const rawPath = join(tmpdir(), `jwgb-${config.modelId.toLowerCase()}-${process.pid}.raw.glb`);
  const outputPath = join(config.outputDirectory, 'model.glb');
  await page.evaluate((input) => window.resetCharacterAnimationConversion(input), {
    modelId: config.modelId,
    displayName: config.displayName,
    animationStates: ['Idle'],
    requiresSeparateWeapon: false,
    staticMeshesAreWeapons: false,
  });
  const metrics = await page.evaluate((input) => window.addCharacterAnimationSource(input), {
    name: 'Idle',
    clipPattern: null,
    base64: readFileSync(config.sourcePath).toString('base64'),
  });
  console.log(
    `${config.modelId} Idle: ${metrics.triangles} source triangles, ` +
      `${metrics.bones.length} bones, selected ${metrics.selectedClip}`,
  );
  const exported = await page.evaluate(() => window.exportCharacterAnimationAsset());
  writeFileSync(rawPath, Buffer.from(exported.base64, 'base64'));

  try {
    const optimized = await optimizeGlb(rawPath, outputPath, config);
    const outputStats = await stat(outputPath);
    const validation = validateConversion(config, exported, optimized, outputStats.size);
    const manifest = {
      schema: 'jwgb.shop-npc-model.v1',
      generatedAt: new Date().toISOString(),
      modelId: config.modelId,
      shopKind: config.shopKind,
      displayName: config.displayName,
      deliveryPath: `models/shops/${config.modelId}/model.glb`,
      targetHeight: config.targetHeight,
      animationStates: ['Idle'],
      sources: [
        {
          name: 'Idle',
          fileName: config.sourcePath.split(/[\\/]/).at(-1),
          bytes: readFileSync(config.sourcePath).byteLength,
          sha256: fileSha256(config.sourcePath),
          selectedClip: metrics.selectedClip,
        },
      ],
      conversion: {
        sourceMetrics: exported.sourceMetrics,
        retainedMesh: exported.outputMetrics,
        exportedClips: exported.clips,
        bodyTriangleBudget: config.bodyTriangleBudget,
        accessoryTriangleBudget: config.accessoryTriangleBudget,
        staticMeshesAreWeapons: false,
      },
      optimized: {
        bytes: outputStats.size,
        ...optimized.counts,
        bodyTriangles: validation.bodyTriangles,
        accessoryTriangles: validation.accessoryTriangles,
        animations: optimized.animations,
        skins: optimized.skins,
        meshRecords: optimized.meshRecords,
      },
      errors: validation.errors,
      status: validation.errors.length === 0 ? 'passed' : 'failed',
    };
    writeFileSync(
      join(config.outputDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    console.log(
      JSON.stringify(
        {
          modelId: config.modelId,
          shopKind: config.shopKind,
          status: manifest.status,
          outputPath,
          optimized: manifest.optimized,
        },
        null,
        2,
      ),
    );
    if (validation.errors.length > 0) {
      throw new Error(`${config.modelId} conversion failed: ${validation.errors.join('; ')}`);
    }
  } finally {
    rmSync(rawPath, { force: true });
  }
}

const bundlePath = join(tmpdir(), `jwgb-shop-convert-${process.pid}.bundle.js`);
await buildBundle({
  entryPoints: [join(repositoryRoot, 'tools', 'models', 'convert-character-animation-entry.js')],
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
const page = await browser.newPage();
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.warn(`Shop converter: ${message.text()}`);
  }
});
await page.setContent(
  `<!doctype html><meta charset="utf-8"><script>${readFileSync(bundlePath, 'utf8')}</script>`,
);

try {
  for (const config of shopConfigs) {
    await convertOne(config, page);
  }
} finally {
  await browser.close();
  rmSync(bundlePath, { force: true });
}
