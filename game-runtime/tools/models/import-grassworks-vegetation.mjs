import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { getBounds, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, inspect, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SOURCE_ROOT =
  process.env.JWGB_GRASSWORKS_SOURCE_ROOT?.trim() ||
  'E:\\angsa\\angsa_data\\crack\\grassworks-webgpu-demo-webrip-main\\grass-webgpu';
const SOURCE_PATH = resolve(
  process.env.JWGB_GRASSWORKS_TERRAIN_SOURCE?.trim() || join(SOURCE_ROOT, 'Assets', 'terrain2.glb'),
);
const OUTPUT_PATH = resolve(
  process.env.JWGB_GRASSWORKS_TREE_OUTPUT?.trim() ||
    join(ROOT, 'apps', 'web', 'public', 'models', 'grassworks', 'grassworks-trees.glb'),
);
const SOURCE_GRASS_ATLAS_PATH = resolve(
  process.env.JWGB_GRASSWORKS_GRASS_ATLAS_SOURCE?.trim() ||
    join(SOURCE_ROOT, 'Assets', 'grass-atlas5.png'),
);
const GRASS_TEXTURE_SOURCE_PATH = resolve(
  process.env.JWGB_GRASSWORKS_GRASS_TEXTURE_SOURCE?.trim() ||
    join(ROOT, 'apps', 'web', 'public', 'assets', 'terrain', 'Grass001_Stylized.jpg'),
);
const GRASS_ATLAS_OUTPUT_PATH = resolve(
  process.env.JWGB_GRASSWORKS_GRASS_ATLAS_OUTPUT?.trim() ||
    join(ROOT, 'apps', 'web', 'public', 'models', 'grassworks', 'grass-atlas5.png'),
);
const MANIFEST_PATH = join(dirname(OUTPUT_PATH), 'manifest.json');
const TREE_VARIANTS = Array.from({ length: 9 }, (_, index) => index + 1);
const GRASS_ATLAS_SIZE = 1_024;
const GRASS_ATLAS_CELL_SIZE = GRASS_ATLAS_SIZE / 2;
const TARGET_NODE_NAMES = new Set(
  TREE_VARIANTS.flatMap((variant) => [`Tree${variant}_High`, `Tree${variant}_Low`]),
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function triangleCount(node) {
  const visited = new Set();
  let triangles = 0;
  node.traverse((child) => {
    const mesh = child.getMesh();
    if (!mesh || visited.has(mesh)) {
      return;
    }
    visited.add(mesh);
    for (const primitive of mesh.listPrimitives()) {
      triangles +=
        (primitive.getIndices()?.getCount() ??
          primitive.getAttribute('POSITION')?.getCount() ??
          0) / 3;
    }
  });
  return Math.round(triangles);
}

function normalizeTreeRoot(node, variant, lod) {
  node.setTranslation([0, 0, 0]);
  node.setRotation([0, 0, 0, 1]);
  node.setScale([1, 1, 1]);
  const bounds = getBounds(node);
  const height = bounds.max[1] - bounds.min[1];
  if (!Number.isFinite(height) || height <= 0.001) {
    throw new Error(`${node.getName()} has invalid bounds`);
  }
  const scale = 1 / height;
  const centerX = (bounds.min[0] + bounds.max[0]) / 2;
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
  node
    .setName(`grassworks-tree-${variant}-${lod}`)
    .setScale([scale, scale, scale])
    .setTranslation([-centerX * scale, -bounds.min[1] * scale, -centerZ * scale])
    .setExtras({
      source: basename(SOURCE_PATH),
      system: 'grassworks',
      variant,
      lod,
      normalizedHeightMeters: 1,
    });
}

function reportCounts(report) {
  const meshes = report.meshes?.properties ?? [];
  return {
    meshes: meshes.length,
    vertices: meshes.reduce((sum, mesh) => sum + (mesh.vertices ?? 0), 0),
    triangles: meshes.reduce((sum, mesh) => sum + (mesh.glPrimitives ?? 0), 0),
    drawCalls: meshes.reduce((sum, mesh) => sum + (mesh.meshPrimitives ?? 0), 0),
  };
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function grassMaskSvg(variant) {
  const nextRandom = createRandom(0x51f15e + variant * 0x9e3779b9);
  const size = GRASS_ATLAS_CELL_SIZE;
  const blades = [];
  const profiles = [
    { center: 0.46, spread: 0.16, bladeCount: 86, minHeight: 0.28, heightRange: 0.58 },
    { center: 0.54, spread: 0.2, bladeCount: 102, minHeight: 0.22, heightRange: 0.54 },
    { center: 0.48, spread: 0.23, bladeCount: 78, minHeight: 0.34, heightRange: 0.55 },
    { center: 0.51, spread: 0.14, bladeCount: 92, minHeight: 0.26, heightRange: 0.48 },
  ];
  const profile = profiles[variant] ?? profiles[0];
  const bladeCount = profile.bladeCount;
  for (let index = 0; index < bladeCount; index += 1) {
    const clustered = (nextRandom() + nextRandom() + nextRandom()) / 3 - 0.5;
    const secondaryLobe = variant === 1 && index % 3 === 0 ? -0.11 : variant === 2 ? 0.06 : 0;
    const baseX =
      size *
      Math.max(
        0.08,
        Math.min(0.92, profile.center + secondaryLobe + clustered * profile.spread * 2),
      );
    const baseY = size * (0.93 + nextRandom() * 0.065);
    const height = size * (profile.minHeight + nextRandom() * profile.heightRange);
    const width = 1.4 + nextRandom() * (variant === 3 ? 4.2 : 3.5);
    const lean = (nextRandom() - 0.5) * (34 + variant * 8);
    const tipX = Math.max(4, Math.min(size - 4, baseX + lean));
    const shoulderY = baseY - height * (0.48 + nextRandom() * 0.18);
    const opacity = 0.76 + nextRandom() * 0.24;
    blades.push(
      `<path d="M ${baseX - width / 2} ${baseY} ` +
        `C ${baseX - width * 0.34} ${shoulderY}, ${tipX - width * 0.18} ${
          baseY - height * 0.86
        }, ${tipX} ${baseY - height} ` +
        `C ${tipX + width * 0.22} ${baseY - height * 0.82}, ${
          baseX + width * 0.4
        } ${shoulderY}, ${baseX + width / 2} ${baseY} Z" opacity="${opacity.toFixed(3)}"/>`,
    );
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      '<rect width="100%" height="100%" fill="none"/>' +
      `<g fill="#fff">${blades.join('')}</g>` +
      '</svg>',
  );
}

async function buildGrassAtlas() {
  const grassTextureBytes = await readFile(GRASS_TEXTURE_SOURCE_PATH);
  const sourceAtlasBytes = await readFile(SOURCE_GRASS_ATLAS_PATH);
  const composites = [];
  const variants = [
    { brightness: 1.03, saturation: 1.18, hue: -4 },
    { brightness: 0.92, saturation: 1.08, hue: 8 },
    { brightness: 0.98, saturation: 0.94, hue: -10 },
    { brightness: 1.08, saturation: 1.25, hue: 4 },
  ];
  for (const [variant, colour] of variants.entries()) {
    const tile = await sharp(grassTextureBytes)
      .resize(GRASS_ATLAS_CELL_SIZE, GRASS_ATLAS_CELL_SIZE, { fit: 'cover' })
      .modulate(colour)
      .ensureAlpha()
      .composite([{ input: grassMaskSvg(variant), blend: 'dest-in' }])
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    composites.push({
      input: tile,
      left: (variant % 2) * GRASS_ATLAS_CELL_SIZE,
      top: Math.floor(variant / 2) * GRASS_ATLAS_CELL_SIZE,
    });
  }
  const outputBytes = await sharp({
    create: {
      width: GRASS_ATLAS_SIZE,
      height: GRASS_ATLAS_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  await mkdir(dirname(GRASS_ATLAS_OUTPUT_PATH), { recursive: true });
  await writeFile(GRASS_ATLAS_OUTPUT_PATH, outputBytes);
  return {
    outputBytes,
    grassTextureBytes,
    sourceAtlasBytes,
  };
}

async function main() {
  const sourceBytes = await readFile(SOURCE_PATH);
  const [decoder] = await Promise.all([
    draco3d.createDecoderModule(),
    MeshoptDecoder.ready,
    MeshoptEncoder.ready,
  ]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': decoder,
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  const document = await io.read(SOURCE_PATH);
  document.setLogger(new Logger(Logger.Verbosity.SILENT));
  const root = document.getRoot();
  for (const extension of root.listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_draco_mesh_compression') {
      extension.dispose();
    }
  }
  const scene = root.listScenes()[0];
  if (!scene) {
    throw new Error(`${SOURCE_PATH} has no scene`);
  }

  const sourceNodes = new Map(root.listNodes().map((node) => [node.getName(), node]));
  for (const child of scene.listChildren()) {
    if (!TARGET_NODE_NAMES.has(child.getName())) {
      scene.removeChild(child);
    }
  }
  for (const animation of root.listAnimations()) {
    animation.dispose();
  }

  const variants = [];
  for (const variant of TREE_VARIANTS) {
    const high = sourceNodes.get(`Tree${variant}_High`);
    const low = sourceNodes.get(`Tree${variant}_Low`);
    if (!high || !low) {
      throw new Error(`Grassworks tree ${variant} is missing a high or low LOD`);
    }
    const sourceHighTriangles = triangleCount(high);
    const sourceLowTriangles = triangleCount(low);
    normalizeTreeRoot(high, variant, 'high');
    normalizeTreeRoot(low, variant, 'low');
    variants.push({
      variant,
      highNode: high.getName(),
      lowNode: low.getName(),
      sourceHighTriangles,
      sourceLowTriangles,
    });
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

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await io.write(OUTPUT_PATH, document);
  const atlas = await buildGrassAtlas();
  const outputBytes = await readFile(OUTPUT_PATH);
  const outputStats = await stat(OUTPUT_PATH);
  const report = inspect(document);
  const manifest = {
    schema: 'jwgb.grassworks-vegetation.v1',
    generatedAt: new Date().toISOString(),
    source: {
      project: 'grassworks-webgpu-demo-webrip-main',
      treeFile: 'grass-webgpu/Assets/terrain2.glb',
      sha256: sha256(sourceBytes),
      renderer: 'three.js r185 WebGPU/TSL source adapted to the game WebGL renderer',
      license: 'No license file was present in the user-provided source directory.',
      excludedGrassAtlas: {
        file: 'grass-webgpu/Assets/grass-atlas5.png',
        sha256: sha256(atlas.sourceAtlasBytes),
        included: false,
        reason:
          'The supplied image contains visible pngtree watermarks and has no bundled license.',
      },
    },
    runtime: {
      treeAsset: 'models/grassworks/grassworks-trees.glb',
      treeBytes: outputStats.size,
      treeSha256: sha256(outputBytes),
      grassAtlas: 'models/grassworks/grass-atlas5.png',
      grassAtlasBytes: atlas.outputBytes.length,
      grassAtlasSha256: sha256(atlas.outputBytes),
      grassAtlasWidth: GRASS_ATLAS_SIZE,
      grassAtlasHeight: GRASS_ATLAS_SIZE,
      grassAtlasSource: 'assets/terrain/Grass001_Stylized.jpg',
      grassAtlasSourceSha256: sha256(atlas.grassTextureBytes),
      grassAtlasLicense: 'Creative Commons CC0 1.0 Universal (ambientCG derivative).',
      grassAtlasPolicy:
        'Four deterministic transparent clump variants; no source watermark pixels.',
      lodPolicy: 'near high-detail meshes; medium-distance source billboards; chunk culling',
      grassPolicy: 'chunked instanced blades with GPU vertex wind and interaction bending',
    },
    variants,
    optimized: reportCounts(report),
    exclusions: [
      'source terrain',
      'source character and animations',
      'source fences, stones, lanterns, water, sky, audio, and UI',
    ],
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${basename(SOURCE_PATH)} -> ${OUTPUT_PATH}: ${manifest.optimized.triangles} triangles, ` +
      `${Math.round(outputStats.size / 1024)} KiB`,
  );
}

await main();
