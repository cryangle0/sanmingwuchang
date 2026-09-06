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

/**
 * Runtime grass atlas layout.
 *
 * The demo atlas is a 2x2 grid of photographic clumps, but only the top row
 * holds whole tufts: the bottom-left clump is cut off by the image edge on
 * its left and top, and the bottom-right clump is a handful of broad blades
 * that read as flat painted slats once tinted and lit. Sampling any cell with
 * a UV rectangle also slices the blades that reach the cell border, leaving
 * straight cut edges on the grass cards. The runtime atlas therefore holds the
 * two complete clumps only, each in its own slot with a transparent margin all
 * round, so every card shows a whole tuft and no rectangle edge ever crosses
 * a blade.
 */
const GRASS_ATLAS_SOURCE_CELL = 500;
const GRASS_ATLAS_SOURCE_TUFTS = [
  { id: 'dense-seeded', cellX: 0, cellY: 0 },
  { id: 'wide-fine', cellX: 1, cellY: 0 },
];
const GRASS_ATLAS_SLOT_WIDTH = 512;
const GRASS_ATLAS_OUTPUT_HEIGHT = 512;
const GRASS_ATLAS_MIN_SIDE_MARGIN = 6;
const GRASS_ATLAS_TOP_MARGIN = 16;
/** Alpha at or above this counts as foliage when boxing a tuft. */
const GRASS_ATLAS_TUFT_ALPHA = 8;

function tuftBounds(pixels, width, cellX, cellY) {
  const x0 = cellX * GRASS_ATLAS_SOURCE_CELL;
  const y0 = cellY * GRASS_ATLAS_SOURCE_CELL;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let y = y0; y < y0 + GRASS_ATLAS_SOURCE_CELL; y += 1) {
    for (let x = x0; x < x0 + GRASS_ATLAS_SOURCE_CELL; x += 1) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) < GRASS_ATLAS_TUFT_ALPHA) {
        continue;
      }
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) {
    throw new Error(`grass atlas cell ${cellX},${cellY} is empty`);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Copies each whole clump into its slot, centred horizontally and anchored to
 * the bottom row so the cut stems sit exactly where the grass card meets the
 * ground. Returns the sampling rectangles in the runtime convention: pixel
 * units with y measured from the bottom, matching THREE's flipY upload.
 */
function composeRuntimeAtlas(sourcePixels, sourceWidth) {
  const outputWidth = GRASS_ATLAS_SLOT_WIDTH * GRASS_ATLAS_SOURCE_TUFTS.length;
  const outputHeight = GRASS_ATLAS_OUTPUT_HEIGHT;
  const output = Buffer.alloc(outputWidth * outputHeight * 4);
  const rects = [];
  const tufts = [];
  GRASS_ATLAS_SOURCE_TUFTS.forEach((tuft, slot) => {
    const bounds = tuftBounds(sourcePixels, sourceWidth, tuft.cellX, tuft.cellY);
    const maxWidth = GRASS_ATLAS_SLOT_WIDTH - GRASS_ATLAS_MIN_SIDE_MARGIN * 2;
    const maxHeight = outputHeight - GRASS_ATLAS_TOP_MARGIN;
    if (bounds.width > maxWidth || bounds.height > maxHeight) {
      throw new Error(
        `grass tuft ${tuft.id} (${bounds.width}x${bounds.height}) does not fit its atlas slot`,
      );
    }
    const slotX = slot * GRASS_ATLAS_SLOT_WIDTH;
    const destX = slotX + Math.floor((GRASS_ATLAS_SLOT_WIDTH - bounds.width) / 2);
    const destY = outputHeight - bounds.height;
    for (let y = 0; y < bounds.height; y += 1) {
      const sourceOffset = ((bounds.minY + y) * sourceWidth + bounds.minX) * 4;
      const destOffset = ((destY + y) * outputWidth + destX) * 4;
      sourcePixels.copy(output, destOffset, sourceOffset, sourceOffset + bounds.width * 4);
    }
    rects.push({
      x: slotX,
      y: 0,
      width: GRASS_ATLAS_SLOT_WIDTH,
      height: bounds.height + GRASS_ATLAS_TOP_MARGIN,
    });
    tufts.push({
      id: tuft.id,
      sourceCell: { column: tuft.cellX, row: tuft.cellY },
      sourceBox: { x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height },
      slot,
    });
  });
  return { output, outputWidth, outputHeight, rects, tufts };
}

async function buildGrassAtlas() {
  const sourceAtlasBytes = await readFile(SOURCE_GRASS_ATLAS_PATH);
  const { data: sourcePixels, info } = await sharp(sourceAtlasBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== GRASS_ATLAS_SOURCE_CELL * 2 || info.height !== GRASS_ATLAS_SOURCE_CELL * 2) {
    throw new Error(
      `grass atlas source is ${info.width}x${info.height}; expected a 2x2 grid of ${GRASS_ATLAS_SOURCE_CELL} px cells`,
    );
  }
  const pixelCount = info.width * info.height;
  const watermarkMask = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const alpha = sourcePixels[offset + 3] ?? 0;
    if (alpha === 0) {
      continue;
    }
    const red = sourcePixels[offset] ?? 0;
    const green = sourcePixels[offset + 1] ?? 0;
    const blue = sourcePixels[offset + 2] ?? 0;
    const brightest = Math.max(red, green, blue);
    const darkest = Math.min(red, green, blue);
    const saturation = brightest === 0 ? 0 : (brightest - darkest) / brightest;
    // The supplied atlas contains a white pngtree watermark over the grass.
    // Grass highlights are green/yellow and therefore remain above this
    // low-saturation threshold.
    if (brightest >= 150 && saturation <= 0.2) {
      watermarkMask[index] = 1;
    }
  }
  // Remove the antialiased fringe around the detected lettering and diagonal
  // marks. Those pixels otherwise survive alpha testing and become dark
  // branch-shaped artifacts after the atlas is tinted by the scene lighting.
  const watermarkDilationRadius = 2;
  const expandedWatermarkMask = new Uint8Array(watermarkMask);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (watermarkMask[y * info.width + x] === 0) {
        continue;
      }
      for (
        let offsetY = -watermarkDilationRadius;
        offsetY <= watermarkDilationRadius;
        offsetY += 1
      ) {
        const neighbourY = y + offsetY;
        if (neighbourY < 0 || neighbourY >= info.height) {
          continue;
        }
        for (
          let offsetX = -watermarkDilationRadius;
          offsetX <= watermarkDilationRadius;
          offsetX += 1
        ) {
          const neighbourX = x + offsetX;
          if (neighbourX < 0 || neighbourX >= info.width) {
            continue;
          }
          expandedWatermarkMask[neighbourY * info.width + neighbourX] = 1;
        }
      }
    }
  }
  const cleanedPixels = Buffer.from(sourcePixels);
  let removedWatermarkPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (expandedWatermarkMask[index] === 0) {
      continue;
    }
    const offset = index * 4;
    if ((cleanedPixels[offset + 3] ?? 0) === 0) {
      continue;
    }
    cleanedPixels[offset] = 0;
    cleanedPixels[offset + 1] = 0;
    cleanedPixels[offset + 2] = 0;
    cleanedPixels[offset + 3] = 0;
    removedWatermarkPixels += 1;
  }

  const composed = composeRuntimeAtlas(cleanedPixels, info.width);
  const atlasPixels = composed.output;
  const atlasWidth = composed.outputWidth;
  const atlasHeight = composed.outputHeight;
  const atlasPixelCount = atlasWidth * atlasHeight;

  const nearestOpaque = new Int32Array(atlasPixelCount);
  nearestOpaque.fill(-1);
  const distance = new Uint8Array(atlasPixelCount);
  const queue = new Int32Array(atlasPixelCount);
  let queueStart = 0;
  let queueEnd = 0;
  for (let index = 0; index < atlasPixelCount; index += 1) {
    if ((atlasPixels[index * 4 + 3] ?? 0) < 32) {
      continue;
    }
    nearestOpaque[index] = index;
    queue[queueEnd] = index;
    queueEnd += 1;
  }
  // Extend nearby foliage RGB into transparent texels. The alpha mask stays
  // unchanged; only the filtering colour is repaired so minification cannot
  // turn a green blade edge into a black fringe.
  const edgeBleedRadius = 12;
  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    const nextDistance = (distance[index] ?? 0) + 1;
    if (nextDistance > edgeBleedRadius) {
      continue;
    }
    const x = index % atlasWidth;
    const y = Math.floor(index / atlasWidth);
    const neighbours = x > 0 ? [index - 1] : [];
    if (x + 1 < atlasWidth) {
      neighbours.push(index + 1);
    }
    if (y > 0) {
      neighbours.push(index - atlasWidth);
    }
    if (y + 1 < atlasHeight) {
      neighbours.push(index + atlasWidth);
    }
    for (const neighbour of neighbours) {
      if (nearestOpaque[neighbour] !== -1) {
        continue;
      }
      nearestOpaque[neighbour] = nearestOpaque[index];
      distance[neighbour] = nextDistance;
      queue[queueEnd] = neighbour;
      queueEnd += 1;
    }
  }
  for (let index = 0; index < atlasPixelCount; index += 1) {
    if ((atlasPixels[index * 4 + 3] ?? 0) !== 0) {
      continue;
    }
    const sourceIndex = nearestOpaque[index];
    if (sourceIndex < 0) {
      continue;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      atlasPixels[index * 4 + channel] = atlasPixels[sourceIndex * 4 + channel] ?? 255;
    }
  }
  assertRectMarginsTransparent(atlasPixels, atlasWidth, atlasHeight, composed.rects);
  const cleanedAtlasBytes = await sharp(atlasPixels, {
    raw: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
  await mkdir(dirname(GRASS_ATLAS_OUTPUT_PATH), { recursive: true });
  await writeFile(GRASS_ATLAS_OUTPUT_PATH, cleanedAtlasBytes);
  return {
    outputBytes: cleanedAtlasBytes,
    sourceAtlasBytes,
    sourceWidth: info.width,
    sourceHeight: info.height,
    width: atlasWidth,
    height: atlasHeight,
    rects: composed.rects,
    tufts: composed.tufts,
    edgeBleedRadius,
    watermarkDilationRadius,
    removedWatermarkPixels,
  };
}

/**
 * The whole point of the rebuilt atlas is that no sampling rectangle edge
 * crosses foliage. Check the left, right and top border of every rect (the
 * bottom is the ground line, where cut stems are expected).
 */
function assertRectMarginsTransparent(pixels, width, height, rects) {
  for (const rect of rects) {
    const top = height - rect.y - rect.height;
    const bottom = height - rect.y - 1;
    const left = rect.x;
    const right = rect.x + rect.width - 1;
    const check = (x, y, edge) => {
      const alpha = pixels[(y * width + x) * 4 + 3] ?? 0;
      if (alpha >= GRASS_ATLAS_TUFT_ALPHA) {
        throw new Error(
          `grass atlas rect at x=${rect.x} has foliage on its ${edge} edge (${x},${y})`,
        );
      }
    };
    for (let x = left; x <= right; x += 1) {
      check(x, top, 'top');
    }
    for (let y = top; y <= bottom; y += 1) {
      check(left, y, 'left');
      check(right, y, 'right');
    }
  }
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
          'Demo 2x2 clump atlas. Only the two whole top-row clumps are repacked for runtime; pngtree marks are removed and the clipped bottom-row cells are dropped.',
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
      grassAtlasSourceWidth: atlas.sourceWidth,
      grassAtlasSourceHeight: atlas.sourceHeight,
      grassAtlasSource: 'grass-webgpu/Assets/grass-atlas5.png',
      grassAtlasSourceSha256: sha256(atlas.sourceAtlasBytes),
      grassAtlasLicense: 'No license file was present in the user-provided source directory.',
      grassAtlasEdgeBleedRadiusPixels: atlas.edgeBleedRadius,
      grassAtlasWatermarkDilationRadiusPixels: atlas.watermarkDilationRadius,
      grassAtlasRemovedWatermarkPixels: atlas.removedWatermarkPixels,
      grassAtlasRects: atlas.rects,
      grassAtlasRectOrigin: 'bottom-left pixel units (THREE flipY)',
      grassAtlasTufts: atlas.tufts,
      grassAtlasPolicy:
        'Two whole photographic clumps from the demo atlas, each repacked into its own slot with transparent margins so no sampling rectangle edge crosses a blade. The clipped bottom-left clump and the broad-blade bottom-right clump are excluded; watermark and antialiased fringe removed; transparent RGB edge bleed prevents black filtering fringes.',
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
