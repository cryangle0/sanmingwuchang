import { mkdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  compactPrimitive,
  dedup,
  inspect,
  meshopt,
  prune,
  simplifyPrimitive,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..', '..');
const sourcePath = resolve(
  process.env.JWGB_LUSH_TREE_SOURCE?.trim() ||
    join(root, 'tools', 'models', 'source-assets', 'MissionGoGoPlants.glb'),
);
const outputPath = resolve(
  process.env.JWGB_LUSH_TREE_OUTPUT?.trim() ||
    join(root, 'apps', 'web', 'public', 'models', 'foliage', 'mission-lush-tree.glb'),
);

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const document = await io.read(sourcePath);
document.setLogger(new Logger(Logger.Verbosity.SILENT));
const gltfRoot = document.getRoot();
const treeNode = gltfRoot.listNodes().find((node) => node.getName().toLowerCase() === 'tree');
const leavesNode = gltfRoot.listNodes().find((node) => node.getName().toLowerCase() === 'leaves');

if (!treeNode?.getMesh() || !leavesNode?.getMesh()) {
  throw new Error(`tree and leaves nodes were not found in ${sourcePath}`);
}

for (const scene of gltfRoot.listScenes()) {
  for (const child of scene.listChildren()) {
    if (child !== treeNode) {
      scene.removeChild(child);
    }
  }
}
for (const animation of gltfRoot.listAnimations()) {
  animation.dispose();
}

treeNode.setName('Mission Lush Tree');
treeNode.getMesh()?.setName('Mission Lush Trunk');
leavesNode.setName('Mission Lush Leaves');
leavesNode.getMesh()?.setName('Mission Lush Leaves');
for (const material of gltfRoot.listMaterials()) {
  if (material.getName() === 'TreeA1') {
    material
      .setName('Mission Lush Leaves')
      .setAlphaMode('MASK')
      .setAlphaCutoff(0.38)
      .setDoubleSided(true);
  } else if (material.getName() === 'TreeA2') {
    material.setName('Mission Lush Trunk').setDoubleSided(false);
  }
}

const fillAngle = (137 * Math.PI) / 180;
const leavesFill = document
  .createNode('Mission Lush Leaves Fill')
  .setMesh(leavesNode.getMesh())
  .setTranslation([0, 0.12, 0])
  .setRotation([0, Math.sin(fillAngle / 2), 0, Math.cos(fillAngle / 2)])
  .setScale([0.94, 0.97, 0.94]);
treeNode.addChild(leavesFill);

await document.transform(prune(), dedup(), weld({ overwrite: false }));
for (const mesh of gltfRoot.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const isLeaves = /leaves/i.test(primitive.getMaterial()?.getName() ?? '');
    if (isLeaves) {
      const positions = primitive.getAttribute('POSITION')?.getArray();
      const indicesAccessor = primitive.getIndices();
      const indices = indicesAccessor?.getArray();
      if (!(positions instanceof Float32Array) || !indicesAccessor || !indices) {
        throw new Error('lush tree leaves are missing float positions or indices');
      }
      const targetIndexCount = Math.min(indices.length, 2_200 * 3);
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
    } else {
      simplifyPrimitive(primitive, {
        simplifier: MeshoptSimplifier,
        ratio: 0.03,
        error: 1,
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
    resize: [512, 512],
  }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);

await mkdir(dirname(outputPath), { recursive: true });
await io.write(outputPath, document);

const report = inspect(document);
const meshes = report.meshes?.properties ?? [];
const triangles = meshes.reduce((sum, mesh) => sum + (mesh.glPrimitives ?? 0), 0);
const vertices = meshes.reduce((sum, mesh) => sum + (mesh.vertices ?? 0), 0);
const meshTriangles = new Map(
  gltfRoot
    .listMeshes()
    .map((mesh) => [
      mesh,
      mesh
        .listPrimitives()
        .reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3, 0),
    ]),
);
const renderedTriangles = gltfRoot
  .listNodes()
  .reduce((sum, node) => sum + (node.getMesh() ? (meshTriangles.get(node.getMesh()) ?? 0) : 0), 0);
const bytes = (await stat(outputPath)).size;
console.log(
  `${basename(sourcePath)} -> ${outputPath}: ${triangles} triangles, ` +
    `${Math.round(renderedTriangles)} rendered triangles, ${vertices} vertices, ` +
    `${Math.round(bytes / 1024)} KiB`,
);
