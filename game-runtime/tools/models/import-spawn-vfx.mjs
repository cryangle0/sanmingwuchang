import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..', '..');
const TEXTURE_ROOT = 'E:\\BaiduNetdiskDownload\\特效贴图（PNG）';
const SEQUENCE_ROOT = 'E:\\BaiduNetdiskDownload\\265款游戏技能特效序列帧PNG图片\\各种游戏技能特效';
const OUTPUT_DIR = join(ROOT, 'apps', 'web', 'public', 'vfx', 'spawn');
const AURA_COLS = 8;
const AURA_ROWS = 3;
const FRAME_WIDTH = 256;
const FRAME_HEIGHT = 296;

async function pngs(dir) {
  const names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.png'));
  names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return names.map((name) => join(dir, name));
}

async function copyPng(source, destName, width) {
  await sharp(source)
    .resize({ width, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(join(OUTPUT_DIR, destName));
  return destName;
}

async function packAuraSheet() {
  const sources = await pngs(join(SEQUENCE_ROOT, 's升级光效2'));
  const frames = [];
  for (const source of sources) {
    frames.push(
      await sharp(source)
        .resize(FRAME_WIDTH, FRAME_HEIGHT, { fit: 'fill' })
        .ensureAlpha()
        .png()
        .toBuffer(),
    );
  }
  const composites = frames.map((input, index) => ({
    input,
    left: (index % AURA_COLS) * FRAME_WIDTH,
    top: Math.floor(index / AURA_COLS) * FRAME_HEIGHT,
  }));
  await sharp({
    create: {
      width: AURA_COLS * FRAME_WIDTH,
      height: AURA_ROWS * FRAME_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(join(OUTPUT_DIR, 'aura-sheet.png'));
  return {
    file: 'aura-sheet.png',
    frames: sources.length,
    columns: AURA_COLS,
    rows: AURA_ROWS,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    fps: 16,
    source: '265款游戏技能特效序列帧PNG图片/s升级光效2',
  };
}

await mkdir(OUTPUT_DIR, { recursive: true });
const aura = await packAuraSheet();
await copyPng(
  join(TEXTURE_ROOT, '魔法阵类', 'magic_circle_rainbow.png'),
  'circle-rainbow.png',
  256,
);
await copyPng(
  join(TEXTURE_ROOT, '魔法阵类', 'el_rainbowsummonring01.png'),
  'ring-rainbow.png',
  256,
);
await copyPng(join(TEXTURE_ROOT, '线性条状类', 'new_ray.png'), 'ray-pillar.png', 128);
await copyPng(join(TEXTURE_ROOT, '光点类', 'starflashorange.png'), 'spark-star.png', 64);

const manifest = {
  schema: 'jwgb.spawn-vfx.v1',
  option: 1,
  name: '青龙升天',
  aura,
  circle: {
    file: 'circle-rainbow.png',
    source: '特效贴图（PNG）/魔法阵类/magic_circle_rainbow.png',
  },
  ring: { file: 'ring-rainbow.png', source: '特效贴图（PNG）/魔法阵类/el_rainbowsummonring01.png' },
  ray: { file: 'ray-pillar.png', source: '特效贴图（PNG）/线性条状类/new_ray.png' },
  spark: { file: 'spark-star.png', source: '特效贴图（PNG）/光点类/starflashorange.png' },
};
await writeFile(join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`spawn vfx option 1 written to ${OUTPUT_DIR}`);
