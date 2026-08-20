import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build as buildBundle } from 'esbuild';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..', '..');
const sourceDirectory =
  process.env.JWGB_WUKONG_ANIMATION_SOURCE?.trim() ||
  'E:\\angsa\\angsa_data\\Games\\JourneyWestGreatBrawl\\素材';
const existingModel =
  process.env.JWGB_WUKONG_EXISTING_MODEL?.trim() ||
  join(root, 'unity', 'Assets', 'ProceduralHeroes', 'Characters', '孙悟空', '孙悟空.fbx');
const outputDirectory = resolve(
  process.env.JWGB_WUKONG_AUDIT_OUTPUT?.trim() || join(root, 'artifacts', 'wukong-animation-audit'),
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

const inputs = [
  ['Idle', join(sourceDirectory, '01_待机_idle.fbx')],
  ['Move', join(sourceDirectory, '02_跑步_run.fbx')],
  ['Attack', join(sourceDirectory, '03_攻击_attack.fbx')],
  ['Spell', join(sourceDirectory, '04_施法_cast.fbx')],
  ['Existing-H009', existingModel],
];
for (const [, path] of inputs) {
  if (!existsSync(path)) {
    throw new Error(`FBX not found: ${path}`);
  }
}

mkdirSync(outputDirectory, { recursive: true });
const bundlePath = join(tmpdir(), `jwgb-wukong-audit-${process.pid}.bundle.js`);
await buildBundle({
  entryPoints: [join(root, 'tools', 'models', 'inspect-character-animation-entry.js')],
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
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
await page.setContent(
  `<!doctype html><meta charset="utf-8"><script>${readFileSync(bundlePath, 'utf8')}</script>`,
);

const records = [];
try {
  for (const [name, path] of inputs) {
    const fileStats = await stat(path);
    const record = await page.evaluate((input) => window.inspectCharacterAnimation(input), {
      name,
      base64: readFileSync(path).toString('base64'),
      sampleRatio: name === 'Idle' ? 0.55 : 0.38,
    });
    const screenshot = join(outputDirectory, `${name.toLowerCase()}.png`);
    await page.screenshot({ path: screenshot });
    records.push({
      ...record,
      sourcePath: path,
      bytes: fileStats.size,
      screenshot,
    });
    console.log(
      `${name}: ${record.metrics.skinnedMeshes} skinned meshes, ` +
        `${record.metrics.bones.length} bones, ${record.metrics.triangles} triangles, ` +
        `${record.animations.length} clips`,
    );
  }
} finally {
  await browser.close();
  rmSync(bundlePath, { force: true });
}

const sourceRecords = records.filter((record) => record.name !== 'Existing-H009');
const sourceBoneSetsMatch = sourceRecords.every(
  (record) =>
    JSON.stringify(record.metrics.skeletonBones) ===
    JSON.stringify(sourceRecords[0]?.metrics.skeletonBones),
);
const sourceTrackTargetsMatch = sourceRecords.every(
  (record) =>
    JSON.stringify(record.animations[0]?.targetNames ?? []) ===
    JSON.stringify(sourceRecords[0]?.animations[0]?.targetNames ?? []),
);
const existing = records.find((record) => record.name === 'Existing-H009');
const sourceBones = sourceRecords[0]?.metrics.skeletonBones ?? [];
const existingBones = existing?.metrics.skeletonBones ?? [];
const existingBoneCompatibility =
  sourceBones.length > 0 && JSON.stringify(sourceBones) === JSON.stringify(existingBones);
const report = {
  schema: 'jwgb.wukong-animation-audit.v1',
  generatedAt: new Date().toISOString(),
  sourceDirectory,
  existingModel,
  compatibility: {
    sourceBoneSetsMatch,
    sourceTrackTargetsMatch,
    existingBoneCompatibility,
    sourceBoneCount: sourceBones.length,
    existingBoneCount: existingBones.length,
  },
  records,
};
writeFileSync(join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.compatibility, null, 2));
