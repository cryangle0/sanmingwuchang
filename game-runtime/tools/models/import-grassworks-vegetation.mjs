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
const GRASS_ATLAS_OUTPUT_PATH = resolve(
  process.env.JWGB_GRASSWORKS_GRASS_ATLAS_OUTPUT?.trim() ||
    join(ROOT, 'apps', 'web', 'public', 'models', 'grassworks', 'grass-atlas5.png'),
);
const MANIFEST_PATH = join(dirname(OUTPUT_PATH), 'manifest.json');
const TREE_VARIANTS = Array.from({ length: 9 }, (_, index) => index + 1);
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

function lockSourceFoliageMaterials(document) {
  let leafMaterials = 0;
  let billboardMaterials = 0;
  for (const material of document.getRoot().listMaterials()) {
    const name = material.getName() ?? '';
    if (/^leaves/i.test(name)) {
      material.setAlphaMode('MASK');
      material.setAlphaCutoff(0.5);
      material.setDoubleSided(true);
      leafMaterials += 1;
    }
    if (/billboard/i.test(name)) {
      material.setAlphaMode('MASK');
      material.setAlphaCutoff(0.35);
      material.setDoubleSided(true);
      billboardMaterials += 1;
    }
  }
  if (leafMaterials === 0) {
    throw new Error('Grassworks tree import found no source leaf materials');
  }
  if (billboardMaterials === 0) {
    throw new Error('Grassworks tree import found no source billboard materials');
  }
  return { leafMaterials, billboardMaterials };
}

function assertFoliageTexturesKeepAlpha(document) {
  for (const material of document.getRoot().listMaterials()) {
    const name = material.getName() ?? '';
    if (!/^leaves/i.test(name) && !/billboard/i.test(name)) {
      continue;
    }
    const texture = material.getBaseColorTexture();
    const mime = texture?.getMimeType() ?? '';
    if (!texture || (mime !== 'image/png' && mime !== 'image/webp')) {
      throw new Error(`${name} lost its alpha foliage texture (${mime || 'missing'})`);
    }
  }
}

async function buildGrassAtlas() {
  const sourceAtlasBytes = await readFile(SOURCE_GRASS_ATLAS_PATH);
  const metadata = await sharp(sourceAtlasBytes).metadata();
  await mkdir(dirname(GRASS_ATLAS_OUTPUT_PATH), { recursive: true });
  await writeFile(GRASS_ATLAS_OUTPUT_PATH, sourceAtlasBytes);
  return {
    outputBytes: sourceAtlasBytes,
    sourceAtlasBytes,
    width: metadata.width ?? 1_000,
    height: metadata.height ?? 1_000,
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

  const foliage = lockSourceFoliageMaterials(document);
  await document.transform(prune(), dedup());
  await document.transform(
    prune(),
    dedup(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [1024, 1024],
      pattern: /^(?!Image_3|TreeLOD)/,
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  assertFoliageTexturesKeepAlpha(document);

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
        included: true,
        reason:
          'Demo 2x2 clump atlas. Runtime UV rectangles are inset from cell corners to avoid pngtree marks.',
      },
    },
    runtime: {
      treeAsset: 'models/grassworks/grassworks-trees.glb',
      treeBytes: outputStats.size,
      treeSha256: sha256(outputBytes),
      grassAtlas: 'models/grassworks/grass-atlas5.png',
      grassAtlasBytes: atlas.outputBytes.length,
      grassAtlasSha256: sha256(atlas.outputBytes),
      grassAtlasWidth: atlas.width,
      grassAtlasHeight: atlas.height,
      grassAtlasSource: 'grass-webgpu/Assets/grass-atlas5.png',
      grassAtlasSourceSha256: sha256(atlas.sourceAtlasBytes),
      grassAtlasLicense: 'No license file was present in the user-provided source directory.',
      grassAtlasPolicy:
        'Demo 2x2 photographic clumps; UV rectangles inset from cell corners to avoid pngtree marks.',
      lodPolicy:
        'near source high-detail branch-cluster leaf cards; medium-distance source canopy billboards; chunk culling',
      grassPolicy:
        '25 m tiles, source four-band LOD density, instanced clumps with GPU wind and interaction bending',
      leafPolicy:
        'Keep the terrain2.glb photographic leaf-cluster cards and tree billboards. MASK cutouts match the demo (0.5 near, 0.35 far). Do not replace them with the demo falling-leaf teardrop sprites.',
      billboardSprites: foliage.billboardMaterials,
      leafSprites: {
        source: 'terrain2.glb leaves/* and Tree*_Billboard materials',
        leafMaterials: foliage.leafMaterials,
        billboardMaterials: foliage.billboardMaterials,
        highAlphaCutoff: 0.5,
        lowAlphaCutoff: 0.35,
      },
    },
    variants,
    optimized: reportCounts(report),
    exclusions: [
      'source terrain',
      'source character and animations',
      'source fences, stones, lanterns, water, sky, audio, and UI',
      'demo falling-leaf teardrop sprites (leaf-green/yellow/whites)',
    ],
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${basename(SOURCE_PATH)} -> ${OUTPUT_PATH}: ${manifest.optimized.triangles} triangles, ` +
      `${Math.round(outputStats.size / 1024)} KiB, ` +
      `leaves=${foliage.leafMaterials}, billboards=${foliage.billboardMaterials}`,
  );
}

await main();
