import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const sourceFiles = [
  ['Idle', '01_待机_idle.fbx'],
  ['Move', '02_跑步_run.fbx'],
  ['Attack', '03_攻击_attack.fbx'],
  ['Spell', '04_施法_cast.fbx'],
];

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
    resample({ tolerance: 0.000_1 }),
    weld({ overwrite: false }),
  );

  const meshes = document.getRoot().listMeshes();
  const sourceBodyTriangles = meshes
    .filter(meshIsSkinned)
    .reduce((sum, mesh) => sum + meshTriangles(mesh), 0);
  const sourceWeaponTriangles = meshes
    .filter((mesh) => !meshIsSkinned(mesh))
    .reduce((sum, mesh) => sum + meshTriangles(mesh), 0);
  const bodyRatio = Math.min(1, config.bodyTriangleBudget / Math.max(sourceBodyTriangles, 1));
  const weaponRatio = Math.min(1, config.weaponTriangleBudget / Math.max(sourceWeaponTriangles, 1));

  for (const mesh of meshes) {
    const ratio = meshIsSkinned(mesh) ? bodyRatio : weaponRatio;
    if (ratio >= 0.999) {
      continue;
    }
    for (const primitive of mesh.listPrimitives()) {
      simplifyPrimitive(primitive, {
        simplifier: MeshoptSimplifier,
        ratio,
        error: meshIsSkinned(mesh) ? 0.045 : 0.035,
      });
    }
  }

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
    sourceBodyTriangles,
    sourceWeaponTriangles,
    bodyRatio,
    weaponRatio,
  };
}

function validateConversion(config, exported, optimized, outputBytes) {
  const expectedClipNames = ['Idle', 'Move', 'Attack', 'Spell'];
  const actualClipNames = optimized.animations.map((animation) => animation.name);
  const sourceBoneSetsMatch = exported.sourceMetrics.every(
    (metrics) =>
      JSON.stringify(metrics.bones) === JSON.stringify(exported.sourceMetrics[0]?.bones ?? []),
  );
  const bodyTriangles = optimized.meshRecords
    .filter((mesh) => mesh.skinned)
    .reduce((sum, mesh) => sum + mesh.triangles, 0);
  const weaponTriangles = optimized.meshRecords
    .filter((mesh) => !mesh.skinned)
    .reduce((sum, mesh) => sum + mesh.triangles, 0);
  const errors = [];
  if (!sourceBoneSetsMatch) {
    errors.push('source skeletons differ');
  }
  if (exported.sourceMetrics[0]?.bones.length !== config.expectedBones) {
    errors.push(
      `expected ${config.expectedBones} source bones, ` +
        `found ${exported.sourceMetrics[0]?.bones.length ?? 0}`,
    );
  }
  if (JSON.stringify(actualClipNames) !== JSON.stringify(expectedClipNames)) {
    errors.push(`animation names differ: ${actualClipNames.join(', ')}`);
  }
  if (optimized.animations.some((animation) => animation.channels === 0)) {
    errors.push('one or more animations have no channels');
  }
  if (
    optimized.skins.length === 0 ||
    optimized.skins.some((skin) => skin.joints !== config.expectedBones)
  ) {
    errors.push(
      `expected skins with ${config.expectedBones} joints, found ${JSON.stringify(optimized.skins)}`,
    );
  }
  if (bodyTriangles <= 0 || bodyTriangles > config.bodyTriangleBudget * 1.08) {
    errors.push(`body triangle budget exceeded: ${bodyTriangles}`);
  }
  if (
    config.requiresSeparateWeapon &&
    (weaponTriangles <= 0 || weaponTriangles > config.weaponTriangleBudget * 1.08)
  ) {
    errors.push(`weapon triangle budget exceeded: ${weaponTriangles}`);
  }
  if (optimized.counts.triangles <= 0 || optimized.counts.triangles > config.totalTriangleBudget) {
    errors.push(`total triangle budget exceeded: ${optimized.counts.triangles}`);
  }
  if (optimized.counts.textures === 0) {
    errors.push('optimized model has no textures');
  }
  if (outputBytes > config.fileByteBudget) {
    errors.push(`file budget exceeded: ${outputBytes}`);
  }
  return { errors, bodyTriangles, weaponTriangles };
}

async function convertOne(config, page) {
  const sources = sourceFiles.map(([name, fileName]) => [
    name,
    join(config.sourceDirectory, fileName),
  ]);
  for (const [, path] of sources) {
    if (!existsSync(path)) {
      throw new Error(`${config.modelId} animation source not found: ${path}`);
    }
  }

  mkdirSync(config.outputDirectory, { recursive: true });
  const rawPath = join(tmpdir(), `jwgb-${config.modelId.toLowerCase()}-${process.pid}.raw.glb`);
  const outputPath = join(config.outputDirectory, 'model.glb');
  await page.evaluate((input) => window.resetCharacterAnimationConversion(input), {
    modelId: config.modelId,
    displayName: config.displayName,
  });
  for (const [name, path] of sources) {
    const metrics = await page.evaluate((input) => window.addCharacterAnimationSource(input), {
      name,
      clipPattern: config.clipPatterns[name],
      base64: readFileSync(path).toString('base64'),
    });
    console.log(
      `${config.modelId} ${name}: ${metrics.triangles} source triangles, ` +
        `${metrics.bones.length} bones, selected ${metrics.selectedClip}`,
    );
  }
  const exported = await page.evaluate(() => window.exportCharacterAnimationAsset());
  writeFileSync(rawPath, Buffer.from(exported.base64, 'base64'));
  try {
    const optimized = await optimizeGlb(rawPath, outputPath, config);
    const outputStats = await stat(outputPath);
    const validation = validateConversion(config, exported, optimized, outputStats.size);
    const manifest = {
      schema: 'jwgb.animated-character-model.v1',
      generatedAt: new Date().toISOString(),
      modelId: config.modelId,
      displayName: config.displayName,
      deliveryPath: `models/characters/${config.modelId}/model.glb`,
      targetHeight: config.targetHeight,
      sources: sources.map(([name, path]) => ({
        name,
        selectedClip: exported.sourceMetrics.find((metrics) => metrics.name === name)?.selectedClip,
        fileName: path.split(/[\\/]/).at(-1),
        bytes: readFileSync(path).byteLength,
        sha256: fileSha256(path),
      })),
      conversion: {
        clipPatterns: config.clipPatterns,
        requiresSeparateWeapon: config.requiresSeparateWeapon,
        sourceMetrics: exported.sourceMetrics,
        retainedMesh: exported.outputMetrics,
        exportedClips: exported.clips,
        bodyTriangleBudget: config.bodyTriangleBudget,
        weaponTriangleBudget: config.weaponTriangleBudget,
        bodySimplifyRatio: optimized.bodyRatio,
        weaponSimplifyRatio: optimized.weaponRatio,
      },
      optimized: {
        bytes: outputStats.size,
        ...optimized.counts,
        bodyTriangles: validation.bodyTriangles,
        weaponTriangles: validation.weaponTriangles,
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

const configs = selectedAnimatedCharacterConfigs();
const bundlePath = join(tmpdir(), `jwgb-character-convert-${process.pid}.bundle.js`);
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
    console.warn(`Character converter: ${message.text()}`);
  }
});
await page.setContent(
  `<!doctype html><meta charset="utf-8"><script>${readFileSync(bundlePath, 'utf8')}</script>`,
);

try {
  for (const config of configs) {
    await convertOne(config, page);
  }
} finally {
  await browser.close();
  rmSync(bundlePath, { force: true });
}
