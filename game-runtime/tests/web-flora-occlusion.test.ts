import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  FloraOcclusionController,
  type FloraTreeOccluderPart,
  floraTreeOccluderTarget,
} from '../apps/web/src/render/map/flora-occlusion';

function matrixAt(mesh: THREE.InstancedMesh, index: number): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
}

function expectMatrixClose(actual: THREE.Matrix4, expected: THREE.Matrix4): void {
  actual.elements.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.elements[index] ?? Number.NaN);
  });
}

describe('web flora occlusion', () => {
  it('shows a translucent copy of only the blocking tree and restores its source', () => {
    const parent = new THREE.Group();
    const trunkGeometry = new THREE.BoxGeometry(0.5, 4, 0.5);
    trunkGeometry.translate(0, 2, 0);
    const canopyGeometry = new THREE.BoxGeometry(3, 2, 3);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x453a30 });
    const canopyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      alphaTest: 0.4,
    });
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, 2);
    const canopies = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, 2);
    parent.add(trunks, canopies);

    const targets = [0, 20].map((x, treeIndex) => {
      const trunkMatrix = new THREE.Matrix4().makeTranslation(x, 0, 3);
      const canopyMatrix = new THREE.Matrix4().makeTranslation(x, 4, 3);
      const colour = new THREE.Color(treeIndex === 0 ? 0x668844 : 0x886644);
      trunks.setMatrixAt(treeIndex, trunkMatrix);
      canopies.setMatrixAt(treeIndex, canopyMatrix);
      canopies.setColorAt(treeIndex, colour);
      const parts: FloraTreeOccluderPart[] = [
        {
          id: 'trunk',
          mesh: trunks,
          instanceIndex: treeIndex,
          matrix: trunkMatrix,
          colour: null,
        },
        {
          id: 'canopy',
          mesh: canopies,
          instanceIndex: treeIndex,
          matrix: canopyMatrix,
          colour,
        },
      ];
      return floraTreeOccluderTarget(treeIndex === 0 ? 'near' : 'far', parts);
    });
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) {
      canopies.instanceColor.needsUpdate = true;
    }

    const nearTrunkOriginal = matrixAt(trunks, 0);
    const nearCanopyOriginal = matrixAt(canopies, 0);
    const farTrunkOriginal = matrixAt(trunks, 1);
    const farCanopyOriginal = matrixAt(canopies, 1);
    const nearCanopyColour = new THREE.Color(0x668844);
    const controller = new FloraOcclusionController(targets);

    controller.update(new THREE.Vector3(0, 10, 10), new THREE.Vector3(0, 0.9, 0));
    const blocked = controller.diagnostics();
    expect(blocked.active).toBe(true);
    expect(blocked.treeCount).toBe(2);
    expect(blocked.activeTreeIds).toEqual(['near']);
    expect(blocked.treeOpacity).toBeGreaterThan(0);
    expect(blocked.treeOpacity).toBeLessThan(1);
    expect(new THREE.Vector3().setFromMatrixScale(matrixAt(trunks, 0)).length()).toBe(0);
    expect(new THREE.Vector3().setFromMatrixScale(matrixAt(canopies, 0)).length()).toBe(0);
    expectMatrixClose(matrixAt(trunks, 1), farTrunkOriginal);
    expectMatrixClose(matrixAt(canopies, 1), farCanopyOriginal);

    const trunkGhost = parent.getObjectByName('flora-occlusion-ghost-near-trunk');
    const canopyGhost = parent.getObjectByName('flora-occlusion-ghost-near-canopy');
    expect(trunkGhost).toBeInstanceOf(THREE.Mesh);
    expect(canopyGhost).toBeInstanceOf(THREE.Mesh);
    expect(trunkGhost?.visible).toBe(true);
    expect(canopyGhost?.visible).toBe(true);
    const trunkGhostMesh = trunkGhost as THREE.InstancedMesh;
    const canopyGhostMesh = canopyGhost as THREE.InstancedMesh;
    const trunkGhostMaterial = trunkGhostMesh.material as THREE.MeshStandardMaterial;
    const canopyGhostMaterial = canopyGhostMesh.material as THREE.MeshStandardMaterial;
    expect(trunkGhostMaterial.transparent).toBe(true);
    expect(trunkGhostMaterial.depthWrite).toBe(false);
    expect(trunkGhostMaterial.opacity).toBeGreaterThan(0);
    expect(canopyGhostMaterial.opacity).toBeGreaterThan(0);
    expect(canopyGhostMaterial.alphaTest).toBeCloseTo(
      canopyMaterial.alphaTest * canopyGhostMaterial.opacity,
    );
    const actualCanopyColour = new THREE.Color();
    canopyGhostMesh.getColorAt(0, actualCanopyColour);
    expect(actualCanopyColour.getHex()).toBe(nearCanopyColour.getHex());
    expect(parent.getObjectByName('flora-occlusion-ghost-far-canopy')).toBeUndefined();

    for (let frame = 0; frame < 40; frame += 1) {
      controller.update(new THREE.Vector3(0, 10, 10), new THREE.Vector3(0, 0.9, 0));
    }
    expect(controller.diagnostics().treeOpacity).toBeCloseTo(0.3, 3);

    for (let frame = 0; frame < 60; frame += 1) {
      controller.update(new THREE.Vector3(40, 10, 10), new THREE.Vector3(40, 0.9, 0));
    }
    const clear = controller.diagnostics();
    expect(clear.active).toBe(false);
    expect(clear.treeOpacity).toBe(1);
    expect(clear.fadingTreeCount).toBe(0);
    expectMatrixClose(matrixAt(trunks, 0), nearTrunkOriginal);
    expectMatrixClose(matrixAt(canopies, 0), nearCanopyOriginal);
    expect(trunkGhost?.visible).toBe(false);
    expect(canopyGhost?.visible).toBe(false);

    controller.dispose();
    expect(parent.getObjectByName('flora-occlusion-ghost-near-trunk')).toBeUndefined();
    expect(parent.getObjectByName('flora-occlusion-ghost-near-canopy')).toBeUndefined();
    trunkGeometry.dispose();
    canopyGeometry.dispose();
    trunkMaterial.dispose();
    canopyMaterial.dispose();
  });
});
