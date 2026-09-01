import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import sharp from 'sharp';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const sourceParent = resolve(
  process.env.JWGB_VFX_SOURCE_PARENT?.trim() || 'E:/BaiduNetdiskDownload',
);
const outputDirectory = resolve(repositoryRoot, 'apps', 'web', 'public', 'vfx', 'skills');
const tileSize = 256;
const atlasColumns = 4;
const atlasRows = 2;
const maximumFrames = atlasColumns * atlasRows;
const framesPerSecond = 18;
const staticColumns = 7;
const staticRows = 2;

const effectSelections = [
  ['H001', 195],
  ['H002', 275],
  ['H003', 420],
  ['H004', 386],
  ['H005', 170],
  ['H006', 69],
  ['H007', 203],
  ['H008', 344],
  ['H009', 57],
  ['H010', 290],
  ['H011', 429],
  ['H012', 249],
  ['H013', 230],
  ['H014', 183],
  ['H015', 25],
  ['H016', 309],
  ['H017', 425],
  ['H018', 200],
  ['H019', 160],
  ['H020', 99],
  ['H021', 51],
  ['H022', 164],
  ['H023', 407],
  ['H024', 114],
  ['H025', 45],
  ['H026', 80],
  ['H027', 382],
  ['H028', 390],
  ['H029', 54],
  ['H030', 263],
  ['H031', 338],
  ['H032', 163],
  ['H033', 310],
  ['H034', 108],
  ['H035', 223],
  ['H036', 306],
  ['H037', 422],
  ['H038', 427],
  ['M-MELEE', 207],
  ['M-RANGED', 135],
  ['M-FLY', 81],
  ['M-PIG', 397],
  ['M-ELITE-TANK', 202],
  ['M-ELITE-RANGED', 103],
  ['M-DRAGON', 186],
  ['M-BOSS', 218],
  ['BOSS-RING', 36],
  ['BOSS-METEOR', 50],
  ['BOSS-EARTH', 415],
  ['BOSS-FIRELANE', 334],
  ['BOSS-POISON', 378],
  ['BOSS-WIND', 317],
  ['BOSS-THUNDER', 439],
  ['BOSS-MIRROR', 133],
];

async function directoryEntries(directory) {
  return readdir(directory, { withFileTypes: true });
}

async function findSourceRoots() {
  const candidates = (await directoryEntries(sourceParent))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(sourceParent, entry.name));

  let staticRoot = null;
  let sequenceRoot = null;
  for (const candidate of candidates) {
    const children = await directoryEntries(candidate);
    const childDirectories = children.filter((entry) => entry.isDirectory());
    if (childDirectories.length >= 10 && childDirectories.length <= 20) {
      staticRoot ??= candidate;
    }
    if (childDirectories.length === 1) {
      const nested = join(candidate, childDirectories[0].name);
      const nestedChildren = await directoryEntries(nested);
      if (nestedChildren.filter((entry) => entry.isDirectory()).length > 200) {
        sequenceRoot ??= candidate;
      }
    }
  }

  if (!staticRoot || !sequenceRoot) {
    throw new Error(
      `could not identify effect roots below ${sourceParent}; static=${staticRoot ?? 'missing'} sequence=${sequenceRoot ?? 'missing'}`,
    );
  }
  return { staticRoot, sequenceRoot };
}

async function collectPngFiles(directory) {
  const files = [];
  for (const entry of await directoryEntries(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectPngFiles(path)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      files.push(path);
    }
  }
  return files;
}

async function collectSequenceDirectories(root) {
  const byDirectory = new Map();
  const files = await collectPngFiles(root);
  for (const file of files) {
    const directory = resolve(file, '..');
    const current = byDirectory.get(directory) ?? [];
    current.push(file);
    byDirectory.set(directory, current);
  }

  return [...byDirectory.entries()]
    .map(([directory, directoryFiles]) => ({
      directory,
      files: directoryFiles.sort((left, right) => left.localeCompare(right, 'en')),
      count: directoryFiles.length,
    }))
    .filter((entry) => entry.count >= 4)
    .sort((left, right) => {
      const directoryOrder = left.directory.localeCompare(right.directory, 'zh-CN');
      return directoryOrder !== 0 ? directoryOrder : left.directory.localeCompare(right.directory);
    });
}

function sampleFrames(files) {
  const count = Math.min(maximumFrames, files.length);
  if (count <= 1) {
    return files.slice(0, 1);
  }
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index * (files.length - 1)) / (count - 1));
    return files[sourceIndex] ?? files[files.length - 1];
  });
}

async function imageTile(file, width = tileSize, height = tileSize) {
  return sharp(file)
    .resize({
      width: width - 10,
      height: height - 10,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function writeAtlas(files, destination, columns, rows) {
  const composites = [];
  for (const [index, file] of files.entries()) {
    const tile = await imageTile(file);
    composites.push({
      input: tile,
      left: (index % columns) * tileSize + 5,
      top: Math.floor(index / columns) * tileSize + 5,
    });
  }
  await sharp({
    create: {
      width: columns * tileSize,
      height: rows * tileSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality: 92, alphaQuality: 100, effort: 4 })
    .toFile(destination);
}

function overlaySlotFor(index, count) {
  return (index * 5 + 3) % count;
}

async function buildStaticOverlayAtlas(staticRoot) {
  const categories = (await directoryEntries(staticRoot))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(staticRoot, entry.name))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  if (categories.length !== staticColumns * staticRows) {
    throw new Error(
      `expected ${staticColumns * staticRows} static effect categories, found ${categories.length}`,
    );
  }

  const files = [];
  for (const [index, category] of categories.entries()) {
    const categoryFiles = (await collectPngFiles(category)).sort((left, right) =>
      left.localeCompare(right, 'en'),
    );
    if (categoryFiles.length === 0) {
      throw new Error(`static effect category is empty: ${category}`);
    }
    const sampleIndex = Math.min(
      categoryFiles.length - 1,
      Math.floor(categoryFiles.length * (0.22 + (index % 4) * 0.17)),
    );
    files.push(categoryFiles[sampleIndex] ?? categoryFiles[0]);
  }

  const destination = join(outputDirectory, 'static-overlays.webp');
  await writeAtlas(files, destination, staticColumns, staticRows);
  return {
    path: 'vfx/skills/static-overlays.webp',
    columns: staticColumns,
    rows: staticRows,
    slots: files.length,
    sources: files.map((file) => relative(staticRoot, file).replaceAll('\\', '/')),
  };
}

async function main() {
  const { staticRoot, sequenceRoot } = await findSourceRoots();
  const sequenceDirectories = await collectSequenceDirectories(sequenceRoot);
  const selectedRows = effectSelections.map(([key, sequenceId], index) => {
    const row = sequenceDirectories[sequenceId - 1];
    if (!row) {
      throw new Error(`missing sequence ${sequenceId} for ${key}`);
    }
    return { key, sequenceId, row, index };
  });

  await mkdir(outputDirectory, { recursive: true });
  const staticOverlay = await buildStaticOverlayAtlas(staticRoot);
  const effects = {};

  for (const selected of selectedRows) {
    const frames = sampleFrames(selected.row.files);
    const atlasName = `${selected.key.toLowerCase().replaceAll('-', '_')}.webp`;
    const destination = join(outputDirectory, atlasName);
    await writeAtlas(frames, destination, atlasColumns, atlasRows);
    const sourceBytes = (await Promise.all(
      selected.row.files.map(async (file) => (await stat(file)).size),
    )).reduce((total, size) => total + size, 0);
    effects[selected.key] = {
      atlasPath: `vfx/skills/${atlasName}`,
      columns: atlasColumns,
      rows: atlasRows,
      frames: frames.length,
      fps: framesPerSecond,
      tileWidth: tileSize,
      tileHeight: tileSize,
      sourceCollection: relative(sequenceRoot, selected.row.directory).replaceAll('\\', '/'),
      sourceFrames: frames.map((file) => relative(sequenceRoot, file).replaceAll('\\', '/')),
      sourceBytes,
      overlaySlot: overlaySlotFor(selected.index, staticOverlay.slots),
    };
    console.log(
      `${selected.key}\t${frames.length} frames\t${selected.row.directory}\t${destination}`,
    );
  }

  const manifest = {
    schema: 'jwgb.skill-vfx-atlas.v1',
    generatedAt: new Date().toISOString(),
    sourceCollections: [
      'E:/BaiduNetdiskDownload/265款游戏技能特效序列帧PNG图片',
      'E:/BaiduNetdiskDownload/特效贴图（PNG）',
    ],
    atlas: {
      columns: atlasColumns,
      rows: atlasRows,
      tileWidth: tileSize,
      tileHeight: tileSize,
      framesPerSecond,
    },
    staticOverlay,
    effects,
  };
  await writeFile(
    join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `wrote ${Object.keys(effects).length} effect atlases and ${staticOverlay.slots} static overlays to ${outputDirectory}`,
  );
}

await main();
