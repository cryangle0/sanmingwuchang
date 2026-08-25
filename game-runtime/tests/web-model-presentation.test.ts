import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  characterModelRenderableBounds,
  createCharacterPresentationRoot,
} from '../apps/web/src/render/models/character-model-library';

describe('web model presentation root', () => {
  it('keeps normalization outside animated FBX root transforms', () => {
    const sourceRoot = new THREE.Group();
    sourceRoot.name = 'animated-source-root';
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 1;
    sourceRoot.add(mesh);

    const presentationRoot = createCharacterPresentationRoot(sourceRoot, 2.2);
    const initialPosition = presentationRoot.position.clone();
    const initialQuaternion = presentationRoot.quaternion.clone();
    const initialScale = presentationRoot.scale.clone();
    expect(
      characterModelRenderableBounds(presentationRoot).getSize(new THREE.Vector3()).y,
    ).toBeCloseTo(2.2, 6);

    const clip = new THREE.AnimationClip('Idle', 1, [
      new THREE.VectorKeyframeTrack(
        `${sourceRoot.name}.position`,
        [0, 1],
        [0, 0, 0, 0.5, 0.25, -0.5],
      ),
      new THREE.VectorKeyframeTrack(`${sourceRoot.name}.scale`, [0, 1], [1, 1, 1, 0.5, 0.5, 0.5]),
    ]);
    const mixer = new THREE.AnimationMixer(presentationRoot);
    mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play();
    mixer.update(0.5);

    expect(presentationRoot.position.distanceTo(initialPosition)).toBeLessThan(0.000_001);
    expect(presentationRoot.quaternion.angleTo(initialQuaternion)).toBeLessThan(0.000_001);
    expect(presentationRoot.scale.distanceTo(initialScale)).toBeLessThan(0.000_001);
    expect(sourceRoot.position.x).toBeCloseTo(0.25, 6);
    expect(sourceRoot.scale.x).toBeCloseTo(0.75, 6);

    mixer.stopAllAction();
    geometry.dispose();
    material.dispose();
  });

  it('anchors the body over the floor origin when a weapon extends to one side', () => {
    const sourceRoot = new THREE.Group();
    sourceRoot.name = 'weapon-offset-source-root';

    const bodyGeometry = new THREE.BoxGeometry(1, 2, 1);
    const vertexCount = bodyGeometry.getAttribute('position').count;
    const skinIndices = new Uint16Array(vertexCount * 4);
    const skinWeights = new Float32Array(vertexCount * 4);
    for (let index = 0; index < vertexCount; index += 1) {
      skinWeights[index * 4] = 1;
    }
    bodyGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    bodyGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    const bodyMaterial = new THREE.MeshBasicMaterial();
    const body = new THREE.SkinnedMesh(bodyGeometry, bodyMaterial);
    const bone = new THREE.Bone();
    const skeleton = new THREE.Skeleton([bone]);
    body.add(bone);
    body.bind(skeleton);
    sourceRoot.add(body);

    const weapon = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.2, 0.2),
      new THREE.MeshBasicMaterial(),
    );
    weapon.position.set(2.2, 1.5, 0);
    sourceRoot.add(weapon);

    const presentationRoot = createCharacterPresentationRoot(sourceRoot, 2.2);
    presentationRoot.updateMatrixWorld(true);
    const bodyCenter = new THREE.Box3().setFromObject(body).getCenter(new THREE.Vector3());

    expect(bodyCenter.x).toBeCloseTo(0, 6);
    expect(bodyCenter.z).toBeCloseTo(0, 6);
    expect(presentationRoot.position.x).toBeCloseTo(0, 6);
    expect(presentationRoot.position.z).toBeCloseTo(0, 6);

    bodyGeometry.dispose();
    bodyMaterial.dispose();
    weapon.geometry.dispose();
    (weapon.material as THREE.Material).dispose();
  });
});
