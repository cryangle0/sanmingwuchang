import * as THREE from 'three';
import { AUTUMN_STORM } from './autumn-storm';

/**
 * Camera-following autumn leaves. Render-only tumbling cards that share the
 * storm wind with rain; they never write sim state.
 */

const HX = 52;
const HY = 18;
const HZ = 52;

export const FALLING_LEAF_PROFILE = {
  countBalanced: 90,
  countReduced: 40,
  fall: 2.8,
  fallVar: 2.2,
  windX: AUTUMN_STORM.rainWindX * 0.9,
  windZ: AUTUMN_STORM.rainWindZ * 0.95,
  flutter: 3.2,
  sizeMin: 0.22,
  sizeMax: 0.44,
} as const;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function teardropTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('falling leaf canvas unavailable');
  }
  const gradient = context.createRadialGradient(32, 28, 4, 32, 36, 28);
  gradient.addColorStop(0, 'rgba(255, 214, 96, 1)');
  gradient.addColorStop(0.45, 'rgba(214, 138, 42, 0.96)');
  gradient.addColorStop(1, 'rgba(122, 58, 18, 0)');
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(32, 6);
  context.bezierCurveTo(46, 14, 56, 30, 48, 48);
  context.bezierCurveTo(42, 58, 22, 58, 16, 48);
  context.bezierCurveTo(8, 30, 18, 14, 32, 6);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

interface LeafState {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  fall: number;
  size: number;
  phase: number;
}

export class MapFallingLeaves {
  private readonly mesh: THREE.InstancedMesh;
  private readonly texture: THREE.CanvasTexture;
  private readonly states: LeafState[];
  private readonly dummy = new THREE.Object3D();
  private time = 0;

  constructor(scene: THREE.Scene, reduced: boolean) {
    const count = reduced ? FALLING_LEAF_PROFILE.countReduced : FALLING_LEAF_PROFILE.countBalanced;
    this.texture = teardropTexture();
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
    this.mesh.name = 'map-falling-leaves';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const rng = mulberry32(0xa17eaf);
    this.states = Array.from({ length: count }, (_, index) => {
      const amber = rng() > 0.22;
      this.mesh.setColorAt(
        index,
        new THREE.Color(amber ? 0xe2a24a : 0xb45a22).multiplyScalar(0.78 + rng() * 0.28),
      );
      return {
        x: (rng() * 2 - 1) * HX,
        y: (rng() * 2 - 1) * HY,
        z: (rng() * 2 - 1) * HZ,
        rx: rng() * Math.PI * 2,
        ry: rng() * Math.PI * 2,
        rz: rng() * Math.PI * 2,
        spinX: (rng() * 2 - 1) * 1.8,
        spinY: (rng() * 2 - 1) * 2.6,
        spinZ: (rng() * 2 - 1) * 1.4,
        fall: FALLING_LEAF_PROFILE.fall + rng() * FALLING_LEAF_PROFILE.fallVar,
        size:
          FALLING_LEAF_PROFILE.sizeMin +
          rng() * (FALLING_LEAF_PROFILE.sizeMax - FALLING_LEAF_PROFILE.sizeMin),
        phase: rng() * Math.PI * 2,
      };
    });
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
    scene.add(this.mesh);
  }

  update(focus: THREE.Vector3, dt: number): void {
    this.time += dt;
    const originY = focus.y + 7;
    for (let index = 0; index < this.states.length; index += 1) {
      const leaf = this.states[index];
      if (!leaf) {
        continue;
      }
      const flutter = Math.sin(this.time * FALLING_LEAF_PROFILE.flutter + leaf.phase);
      leaf.x += (FALLING_LEAF_PROFILE.windX + flutter * 1.8) * dt;
      leaf.y -= leaf.fall * dt;
      leaf.z += (FALLING_LEAF_PROFILE.windZ + Math.cos(this.time * 1.3 + leaf.phase) * 1.1) * dt;
      leaf.rx += leaf.spinX * dt;
      leaf.ry += leaf.spinY * dt;
      leaf.rz += leaf.spinZ * dt;
      let x = leaf.x;
      let y = leaf.y;
      let z = leaf.z;
      if (x - focus.x > HX) {
        x -= HX * 2;
      } else if (x - focus.x < -HX) {
        x += HX * 2;
      }
      if (z - focus.z > HZ) {
        z -= HZ * 2;
      } else if (z - focus.z < -HZ) {
        z += HZ * 2;
      }
      if (y - originY < -HY) {
        y += HY * 2;
      } else if (y - originY > HY) {
        y -= HY * 2;
      }
      leaf.x = x;
      leaf.y = y;
      leaf.z = z;
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(leaf.rx, leaf.ry, leaf.rz);
      this.dummy.scale.setScalar(leaf.size);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(index, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        entry.dispose();
      }
    } else {
      material.dispose();
    }
    this.texture.dispose();
  }
}
