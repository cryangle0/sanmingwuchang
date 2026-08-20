import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  compactPrimitive,
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

const root = resolve(import.meta.dirname, '..', '..');
const sourceDirectory =
  process.env.JWGB_WUKONG_ANIMATION_SOURCE?.trim() ||
  'E:\\angsa\\angsa_data\\Games\\JourneyWestGreatBrawl\\素材';
const outputDirectory = resolve(
  process.env.JWGB_WUKONG_OUTPUT?.trim() ||
    join(root, 'apps', 'web', 'public', 'models', 'characters', 'H009'),
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

const sources = [
  ['Idle', join(sourceDirectory, '01_待机_idle.fbx')],
  ['Move', join(sourceDirectory, '02_跑步_run.fbx')],
  ['Attack', join(sourceDirectory, '03_攻击_attack.fbx')],
  ['Spell', join(sourceDirectory, '04_施法_cast.fbx')],
];
const BODY_MESH_NAME = 'H009-Body';
const WEAPON_MESH_NAME = 'H009-RuyiJinguBang';
const BODY_SIMPLIFY_RATIO = 0.46;
const WEAPON_TARGET_TRIANGLES = 6_000;
const BODY_TRIANGLE_BUDGET = 25_000;
const WEAPON_TRIANGLE_BUDGET = 8_000;
const TOTAL_TRIANGLE_BUDGET = 33_000;
for (const [, path] of sources) {
  if (!existsSync(path)) {
    throw new Error(`Wukong animation source not found: ${path}`);
  }
}

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

function nameCharacterMeshes(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    const name = meshIsSkinned(mesh) ? BODY_MESH_NAME : WEAPON_MESH_NAME;
    mesh.setName(name);
    for (const node of document.getRoot().listNodes()) {
      if (node.getMesh() === mesh) {
        node.setName(name);
      }
    }
  }
}

function simplifyWeaponPrimitive(primitive) {
  const positions = primitive.getAttribute('POSITION')?.getArray();
  const indicesAccessor = primitive.getIndices();
  const indices = indicesAccessor?.getArray();
  if (!(positions instanceof Float32Array) || !indicesAccessor || !indices) {
    throw new Error('weapon primitive is missing float positions or indices');
  }
  const targetIndexCount = Math.min(
    indices.length,
    Math.floor((WEAPON_TARGET_TRIANGLES * 3) / 3) * 3,
  );
  const [simplifiedIndices] = MeshoptSimplifier.simplifySloppy(
    new Uint32Array(indices),
    positions,
    3,
    null,
    targetIndexCount,
    1,
  );
  indicesAccessor.setArray(simplifiedIndices);
  compactPrimitive(primitive);
}

function optimizedMeshRecords(document) {
  return document
    .getRoot()
    .listMeshes()
    .map((mesh) => ({
      name: mesh.getName(),
      triangles: mesh.listPrimitives().reduce((sum, primitive) => {
        const positions = primitive.getAttribute('POSITION');
        const elementCount = primitive.getIndices()?.getCount() ?? positions?.getCount() ?? 0;
        return sum + Math.floor(elementCount / 3);
      }, 0),
    }))
    .sort((left, right) => right.triangles - left.triangles);
}

async function optimizeGlb(inputPath, outputPath) {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  const document = await io.read(inputPath);
  document.setLogger(new Logger(Logger.Verbosity.SILENT));
  nameCharacterMeshes(document);
  await document.transform(
    prune(),
    dedup(),
    resample({ tolerance: 0.000_1 }),
    weld({ overwrite: false }),
  );
  for (const mesh of document.getRoot().listMeshes()) {
    const isWeapon = !meshIsSkinned(mesh);
    for (const primitive of mesh.listPrimitives()) {
      if (isWeapon) {
        simplifyWeaponPrimitive(primitive);
      } else {
        simplifyPrimitive(primitive, {
          simplifier: MeshoptSimplifier,
          ratio: BODY_SIMPLIFY_RATIO,
          error: 0.035,
        });
      }
    }
  }
  await document.transform(
    prune(),
    dedup(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [1024, 1024],
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
  const meshRecords = optimizedMeshRecords(document);
  return {
    counts: reportCounts(report),
    animations,
    skins,
    meshRecords,
  };
}

mkdirSync(outputDirectory, { recursive: true });
const bundlePath = join(tmpdir(), `jwgb-wukong-convert-${process.pid}.bundle.js`);
const rawPath = join(tmpdir(), `jwgb-wukong-${process.pid}.raw.glb`);
const outputPath = join(outputDirectory, 'model.glb');
await buildBundle({
  entryPoints: [join(root, 'tools', 'models', 'convert-wukong-animation-entry.js')],
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
    console.warn(`Wukong converter: ${message.text()}`);
  }
});
await page.setContent(
  `<!doctype html><meta charset="utf-8"><script>${readFileSync(bundlePath, 'utf8')}</script>`,
);

let exported;
try {
  await page.evaluate(() => window.resetWukongAnimationConversion());
  for (const [name, path] of sources) {
    const metrics = await page.evaluate((input) => window.addWukongAnimationSource(input), {
      name,
      base64: readFileSync(path).toString('base64'),
    });
    console.log(
      `${name}: ${metrics.triangles} source triangles, ${metrics.bones.length} bones, ` +
        `${metrics.tracks} retained tracks`,
    );
  }
  exported = await page.evaluate(() => window.exportWukongAnimationAsset());
} finally {
  await browser.close();
  rmSync(bundlePath, { force: true });
}

writeFileSync(rawPath, Buffer.from(exported.base64, 'base64'));
const optimized = await optimizeGlb(rawPath, outputPath);
rmSync(rawPath, { force: true });
const outputStats = await stat(outputPath);
const expectedClipNames = ['Idle', 'Move', 'Attack', 'Spell'];
const actualClipNames = optimized.animations.map((animation) => animation.name);
const sourceBoneSetsMatch = exported.sourceMetrics.every(
  (metrics) =>
    JSON.stringify(metrics.bones) === JSON.stringify(exported.sourceMetrics[0]?.bones ?? []),
);
const bodyMesh = optimized.meshRecords.find((mesh) => mesh.name === BODY_MESH_NAME);
const weaponMesh = optimized.meshRecords.find((mesh) => mesh.name === WEAPON_MESH_NAME);
const errors = [];
if (!sourceBoneSetsMatch) {
  errors.push('source skeletons differ');
}
if (JSON.stringify(actualClipNames) !== JSON.stringify(expectedClipNames)) {
  errors.push(`animation names differ: ${actualClipNames.join(', ')}`);
}
if (optimized.animations.some((animation) => animation.channels === 0)) {
  errors.push('one or more animations have no channels');
}
if (optimized.skins.length !== 1 || optimized.skins[0]?.joints !== 41) {
  errors.push(`expected one 41-joint skin, found ${JSON.stringify(optimized.skins)}`);
}
if (!bodyMesh) {
  errors.push(`missing optimized body mesh ${BODY_MESH_NAME}`);
} else if (bodyMesh.triangles <= 0 || bodyMesh.triangles > BODY_TRIANGLE_BUDGET) {
  errors.push(`body triangle budget exceeded: ${bodyMesh.triangles}`);
}
if (!weaponMesh) {
  errors.push(`missing optimized weapon mesh ${WEAPON_MESH_NAME}`);
} else if (weaponMesh.triangles <= 0 || weaponMesh.triangles > WEAPON_TRIANGLE_BUDGET) {
  errors.push(`weapon triangle budget exceeded: ${weaponMesh.triangles}`);
}
if (optimized.counts.triangles <= 0 || optimized.counts.triangles > TOTAL_TRIANGLE_BUDGET) {
  errors.push(`triangle budget exceeded: ${optimized.counts.triangles}`);
}
if (outputStats.size > 8 * 1024 * 1024) {
  errors.push(`file budget exceeded: ${outputStats.size}`);
}

const manifest = {
  schema: 'jwgb.wukong-animated-model.v1',
  generatedAt: new Date().toISOString(),
  modelId: 'H009',
  deliveryPath: 'models/characters/H009/model.glb',
  targetHeight: 2.2,
  sources: sources.map(([name, path]) => ({
    name,
    fileName: path.split(/[\\/]/).at(-1),
    bytes: readFileSync(path).byteLength,
    sha256: fileSha256(path),
  })),
  conversion: {
    retainedWeaponMesh: WEAPON_MESH_NAME,
    bodySimplifyRatio: BODY_SIMPLIFY_RATIO,
    weaponTargetTriangles: WEAPON_TARGET_TRIANGLES,
    sourceMetrics: exported.sourceMetrics,
    retainedMesh: exported.outputMetrics,
    exportedClips: exported.clips,
  },
  optimized: {
    bytes: outputStats.size,
    ...optimized.counts,
    animations: optimized.animations,
    skins: optimized.skins,
    meshRecords: optimized.meshRecords,
  },
  errors,
  status: errors.length === 0 ? 'passed' : 'failed',
};
writeFileSync(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({ status: manifest.status, outputPath, optimized: manifest.optimized }, null, 2),
);
if (errors.length > 0) {
  process.exitCode = 1;
}
