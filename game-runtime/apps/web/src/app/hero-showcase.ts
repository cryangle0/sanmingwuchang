import * as THREE from 'three';
import {
  CharacterModelLibrary,
  cloneCharacterTemplate,
} from '../render/models/character-model-library';
import { heroModelDefinition } from '../render/models/web-model-catalog';
import { modelAssetBaseUrl } from '../runtime/asset-url';

/**
 * Animated hero preview for the codex dialog.
 *
 * One small WebGL canvas, one hero: the model loads through the same library
 * the arena uses, plays Idle, and runs its Attack and Spell clips once each so
 * the reader sees what the hero does, then settles back to Idle. The renderer
 * is created per dialog and torn down on close so the lobby never keeps a GL
 * context alive while no dialog is open.
 */
export interface HeroShowcase {
  dispose(): void;
}

const SHOWCASE_SEQUENCE: readonly ('Attack' | 'Spell')[] = ['Attack', 'Spell'];

export function mountHeroShowcase(host: HTMLElement, heroId: string): HeroShowcase | null {
  const definition = heroModelDefinition(heroId);
  if (!definition) {
    return null;
  }
  const canvas = document.createElement('canvas');
  host.append(canvas);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    canvas.remove();
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  scene.add(new THREE.HemisphereLight(0xdfeee8, 0x2a3a3a, 1.6));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fc3d8, 1.1);
  rim.position.set(-4, 3, -3);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 40),
    new THREE.MeshStandardMaterial({ color: 0x143f3b, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const library = new CharacterModelLibrary(modelAssetBaseUrl());
  let mixer: THREE.AnimationMixer | null = null;
  let actions = new Map<string, THREE.AnimationAction>();
  let disposed = false;
  let sequenceIndex = 0;
  let nextTriggerAt = 1.2;
  const clock = new THREE.Clock();
  let elapsed = 0;

  const resize = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  const frameModel = (root: THREE.Object3D): void => {
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.62;
    camera.position.set(centre.x + radius * 0.9, centre.y + radius * 0.55, centre.z + radius * 1.9);
    camera.lookAt(centre.x, centre.y - size.y * 0.05, centre.z);
  };

  void library
    .load(definition, true)
    .then((template) => {
      if (disposed) {
        return;
      }
      const instance = cloneCharacterTemplate(template.root);
      scene.add(instance);
      frameModel(instance);
      mixer = new THREE.AnimationMixer(instance);
      actions = new Map(
        [...template.clips.entries()].map(([state, clip]) => {
          const action = mixer?.clipAction(clip);
          if (!action) {
            throw new Error(`mixer did not create ${state}`);
          }
          if (state === 'Idle' || state === 'Move') {
            action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
          } else {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          }
          return [state, action] as const;
        }),
      );
      actions.get('Idle')?.reset().play();
    })
    .catch((error: unknown) => {
      console.warn(`codex showcase ${heroId} failed to load`, error);
    });

  const playTrigger = (): void => {
    const state = SHOWCASE_SEQUENCE[sequenceIndex % SHOWCASE_SEQUENCE.length];
    sequenceIndex += 1;
    const action = state ? actions.get(state) : undefined;
    const idle = actions.get('Idle');
    if (!action || !idle) {
      nextTriggerAt = elapsed + 2;
      return;
    }
    idle.fadeOut(0.15);
    action.reset().fadeIn(0.1).play();
    const duration = Math.max(0.4, action.getClip().duration);
    nextTriggerAt = elapsed + duration + 1.6;
    window.setTimeout(() => {
      if (disposed) {
        return;
      }
      action.fadeOut(0.2);
      idle.reset().fadeIn(0.2).play();
    }, duration * 1000);
  };

  let frame = 0;
  const tick = (): void => {
    if (disposed) {
      return;
    }
    const delta = Math.min(0.1, clock.getDelta());
    elapsed += delta;
    mixer?.update(delta);
    if (mixer && elapsed >= nextTriggerAt) {
      playTrigger();
    }
    // Slow turntable so the whole model gets seen.
    scene.rotation.y = elapsed * 0.35;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      mixer?.stopAllAction();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            material.dispose();
          }
        }
      });
      renderer.dispose();
      canvas.remove();
    },
  };
}
