/**
 * Simplifies the heavy imported map landmarks in place.
 *
 * The wuxia/lowpoly source packs shipped 20k–57k triangles per building, one
 * hall carrying more geometry than the whole procedural 唐宋 family. They are
 * culled at 210 m and only ever seen from the gameplay camera, so the extra
 * density buys nothing on screen. This pass welds, simplifies and re-compresses
 * each target with meshopt, then rewrites the manifest entries so the catalog
 * keeps matching the delivered bytes.
 *
 * Usage:
 *   node tools/models/optimize-map-assets.mjs            # report only
 *   node tools/models/optimize-map-assets.mjs --apply    # rewrite GLBs + manifest
 *   node tools/models/optimize-map-assets.mjs --apply --only free-stone-lion
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ASSET_DIR = resolve(ROOT, 'apps', 'web', 'public', 'models', 'map-assets');
const MANIFEST_PATH = join(ASSET_DIR, 'manifest.json');
const APPLY = process.argv.includes('--apply');
const ONLY = (() => {
  const index = process.argv.indexOf('--only');
  return index >= 0 ? process.argv[index + 1] : null;
})();

/**
 * `ratio` is the target fraction of the original triangles; `error` caps the
 * geometric deviation so silhouettes and roof lines survive. Set pieces keep a
 * generous budget, small props can lose far more without being noticed.
 */
const TARGETS = [
  { id: 'wuxia-east-asia-hall', ratio: 0.42, error: 0.04, note: 'placed 24 m hall' },
  { id: 'lowpoly-asian-village', ratio: 0.42, error: 0.04, note: 'placed west village' },
  { id: 'wuxia-mountain-gate', ratio: 0.45, error: 0.04, note: 'placed north gate' },
  { id: 'wuxia-citadel', ratio: 0.4, error: 0.05, note: 'catalogued, never placed' },
  { id: 'wuxia-gate-court', ratio: 0.4, error: 0.05, note: 'catalogued, never placed' },
  { id: 'lowpoly-asia-house', ratio: 0.45, error: 0.04, note: 'placed west house' },
  { id: 'free-stone-lion', ratio: 0.14, error: 0.02, note: '3.5 m prop' },
  { id: 'free-pagoda-niko313', ratio: 0.4, error: 0.05, note: 'placed pagoda' },
];

async function countTriangles(document) {
  let triangles = 0;
  let vertices = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      vertices += position ? position.getCount() : 0;
      const indices = primitive.getIndices();
      triangles += indices ? indices.getCount() / 3 : (position?.getCount() ?? 0) / 3;
    }
  }
  return { triangles: Math.round(triangles), vertices };
}

async function main() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const targets = TARGETS.filter((target) => !ONLY || target.id === ONLY);
  let savedBytes = 0;
  let removedTriangles = 0;

  for (const target of targets) {
    const entry = manifest.assets.find((asset) => asset.id === target.id);
    if (!entry) {
      throw new Error(`optimize-map-assets: ${target.id} missing from the manifest`);
    }
    // Catalog ids do not always match the delivered file name (the catalogued
    // `lowpoly-asian-house` ships as `asia-house.glb`), so trust the manifest.
    const path = resolve(ROOT, 'apps', 'web', 'public', entry.path);
    const before = statSync(path).size;
    const document = await io.read(path);
    document.setLogger(new Logger(Logger.Verbosity.SILENT));
    const original = await countTriangles(document);
    await document.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: target.ratio, error: target.error }),
      meshopt({ encoder: MeshoptEncoder, level: 'high' }),
    );
    const after = await countTriangles(document);
    const bytes = APPLY ? null : before;
    if (APPLY) {
      await io.write(path, document);
    }
    const finalBytes = APPLY ? statSync(path).size : before;
    savedBytes += before - finalBytes;
    removedTriangles += original.triangles - after.triangles;
    console.log(
      `${target.id.padEnd(24)} ${String(Math.round(before / 1024)).padStart(5)} -> ` +
        `${String(Math.round(finalBytes / 1024)).padStart(5)} KiB   ` +
        `${String(original.triangles).padStart(6)} -> ${String(after.triangles).padStart(6)} tris   ` +
        `(${target.note})`,
    );
    if (APPLY) {
      entry.bytes = finalBytes;
      entry.optimized = {
        ...entry.optimized,
        vertices: after.vertices,
        triangles: after.triangles,
      };
      entry.optimization = {
        tool: 'tools/models/optimize-map-assets.mjs',
        ratio: target.ratio,
        error: target.error,
      };
      void bytes;
    }
  }

  if (APPLY) {
    manifest.generatedAt = new Date().toISOString();
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `applied: saved ${Math.round(savedBytes / 1024)} KiB and removed ` +
        `${removedTriangles} triangles; manifest updated`,
    );
  } else {
    console.log(
      `dry run: would save ${Math.round(savedBytes / 1024)} KiB and remove ` +
        `${removedTriangles} triangles (pass --apply to write)`,
    );
  }
}

await main();
