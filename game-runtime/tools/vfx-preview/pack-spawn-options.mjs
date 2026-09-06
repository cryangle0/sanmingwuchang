import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const TEXTURE_ROOT = 'E:\\BaiduNetdiskDownload\\特效贴图（PNG）';
const SEQUENCE_ROOT =
  'E:\\BaiduNetdiskDownload\\265款游戏技能特效序列帧PNG图片\\各种游戏技能特效';
const OUT = resolve(import.meta.dirname, 'spawn-options', 'assets');

async function pngs(dir) {
  const names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.png'));
  names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return names.map((name) => join(dir, name));
}

async function copyStill(source, destName, width) {
  await sharp(source)
    .resize({ width, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, 'stills', destName));
}

async function packSheet(id, sources, frameWidth, frameHeight) {
  const cols = Math.ceil(Math.sqrt(sources.length));
  const rows = Math.ceil(sources.length / cols);
  const frames = [];
  for (const source of sources) {
    frames.push(
      await sharp(source)
        .resize(frameWidth, frameHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha()
        .png()
        .toBuffer(),
    );
  }
  const composites = frames.map((input, index) => ({
    input,
    left: (index % cols) * frameWidth,
    top: Math.floor(index / cols) * frameHeight,
  }));
  await sharp({
    create: {
      width: cols * frameWidth,
      height: rows * frameHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, 'sheets', `${id}.png`));
  return {
    file: `sheets/${id}.png`,
    frames: sources.length,
    columns: cols,
    rows,
    frameWidth,
    frameHeight,
  };
}

function everyNth(list, step) {
  if (step <= 1) {
    return list;
  }
  const picked = list.filter((_, index) => index % step === 0);
  if (picked[picked.length - 1] !== list[list.length - 1]) {
    picked.push(list[list.length - 1]);
  }
  return picked;
}

await mkdir(join(OUT, 'sheets'), { recursive: true });
await mkdir(join(OUT, 'stills'), { recursive: true });

const sheets = {
  upgrade2: await packSheet('upgrade2', await pngs(join(SEQUENCE_ROOT, 's升级光效2')), 192, 224),
  upgrade3: await packSheet('upgrade3', await pngs(join(SEQUENCE_ROOT, 's升级光效3')), 160, 256),
  teleport: await packSheet(
    'teleport',
    everyNth(await pngs(join(SEQUENCE_ROOT, 'c传送')), 2),
    256,
    256,
  ),
  jump: await packSheet('jump', await pngs(join(SEQUENCE_ROOT, '跳跃点3')), 256, 160),
  array: await packSheet('array', await pngs(join(SEQUENCE_ROOT, '阵法9')), 256, 256),
  pillar: await packSheet(
    'pillar',
    await pngs(join(SEQUENCE_ROOT, '魔法柱输出', '魔法柱输出', '技能施法')),
    256,
    256,
  ),
  charge: await packSheet('charge', await pngs(join(SEQUENCE_ROOT, '通用释放')), 256, 160),
  burst: await packSheet('burst', await pngs(join(SEQUENCE_ROOT, 'f放射光线2')), 256, 256),
  rise: await packSheet(
    'rise',
    everyNth(await pngs(join(SEQUENCE_ROOT, 'l上升粒子')), 2),
    96,
    256,
  ),
  stars: await packSheet(
    'stars',
    everyNth(await pngs(join(SEQUENCE_ROOT, 'l星光粒子')), 2),
    160,
    160,
  ),
};

await copyStill(join(TEXTURE_ROOT, '魔法阵类', 'magic_circle_rainbow.png'), 'circle-rainbow.png', 256);
await copyStill(
  join(TEXTURE_ROOT, '魔法阵类', 'el_rainbowsummonring01.png'),
  'ring-rainbow.png',
  256,
);
await copyStill(join(TEXTURE_ROOT, '线性条状类', 'new_ray.png'), 'new-ray.png', 128);
await copyStill(join(TEXTURE_ROOT, '线性条状类', '黄色束光.png'), 'gold-beam.png', 96);
await copyStill(join(TEXTURE_ROOT, '线性条状类', 'upBeamW.png'), 'up-beam.png', 64);
await copyStill(join(TEXTURE_ROOT, '线性条状类', 'rays2.png'), 'rays2.png', 64);
await copyStill(join(TEXTURE_ROOT, '光点类', 'starflashorange.png'), 'spark.png', 64);

await writeFile(
  join(OUT, 'manifest.json'),
  `${JSON.stringify({ schema: 'jwgb.spawn-options.v1', sheets }, null, 2)}\n`,
);
console.log(`packed spawn options into ${OUT}`);
