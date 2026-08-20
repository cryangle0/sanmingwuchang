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
});
