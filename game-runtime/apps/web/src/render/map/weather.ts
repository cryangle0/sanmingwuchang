import * as THREE from 'three';
import { AUTUMN_STORM } from './autumn-storm';
import { regionAt } from './map-regions';
import type { PrecipMode } from './weather-field';
import { precipSpawnXZ, remotePrecipPlan } from './weather-field';

/**
 * Camera-following rain, cloned from world-of-claudecraft's render-only
 * weather: one pooled Points cloud, driven by the whole-map autumn storm.
 */

const HX = 48;
const HY = 20;
const HZ = 48;
const PLAN_INTERVAL = 0.45;

interface PrecipStyle {
  readonly color: number;
  readonly size: number;
  readonly fall: number;
  readonly fallVar: number;
  readonly sway: number;
  readonly target: number;
  readonly texture: 'flake' | 'streak';
}

const STYLES: Record<PrecipMode, PrecipStyle> = {
  snow: {
    color: 0xffffff,
    size: 0.42,
    fall: 6.2,
    fallVar: 2.4,
    sway: 1.5,
    target: 0.92,
    texture: 'flake',
  },
  rain: {
    color: 0xc4d8e4,
    size: 0.16,
    fall: 42,
    fallVar: 16,
    sway: 5.5,
    target: AUTUMN_STORM.rainIntensity,
    texture: 'streak',
  },
};

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flakeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('weather flake canvas unavailable');
  }
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function streakTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('weather streak canvas unavailable');
  }
  const gradient = context.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(30, 2, 4, 60);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export class MapWeather {
  private readonly points: THREE.Points;
  private readonly material: THREE.PointsMaterial;
  private readonly positions: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly fallSpeed: Float32Array;
  private readonly phase: Float32Array;
  private readonly count: number;
  private readonly textures: { flake: THREE.CanvasTexture; streak: THREE.CanvasTexture };
  private readonly spawnRng = mulberry32(0x5eed ^ 0x9e37);
  private mode: PrecipMode = 'rain';
  private intensity = 0;
  private time = 0;
  private planMode: PrecipMode | null = null;
  private planLocal = true;
  private planTimer = 0;
  private wasLive = false;

  constructor(scene: THREE.Scene, reduced: boolean) {
    this.count = reduced ? 900 : 2200;
    this.positions = new Float32Array(this.count * 3);
    this.fallSpeed = new Float32Array(this.count);
    this.phase = new Float32Array(this.count);
    const rng = mulberry32(0x5eed);
    for (let index = 0; index < this.count; index += 1) {
      this.positions[index * 3] = (rng() * 2 - 1) * HX;
      this.positions[index * 3 + 1] = (rng() * 2 - 1) * HY;
      this.positions[index * 3 + 2] = (rng() * 2 - 1) * HZ;
      this.fallSpeed[index] = rng();
      this.phase[index] = rng() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    geometry.setAttribute('position', this.positionAttribute);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(HX, HY, HZ));
    this.textures = { flake: flakeTexture(), streak: streakTexture() };
    this.material = new THREE.PointsMaterial({
      size: STYLES.rain.size,
      map: this.textures.streak,
      color: STYLES.rain.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.18,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
    this.points.name = 'map-weather';
    scene.add(this.points);
  }

  update(focus: THREE.Vector3, dt: number): void {
    this.planTimer -= dt;
    if (this.planTimer <= 0) {
      this.planTimer = PLAN_INTERVAL;
      const plan = remotePrecipPlan(focus.x, focus.z, HX, HZ, (x, z) => regionAt(x, z).id);
      this.planMode = plan.mode;
      this.planLocal = plan.local;
    }
    const want = this.planMode;
    let target = 0;
    let maskedSwap = false;
    if (want === null) {
      target = 0;
    } else if (want !== this.mode) {
      target = 0;
      if (this.intensity <= 0.02) {
        this.mode = want;
        this.applyStyle(want);
        maskedSwap = !this.planLocal;
      }
    } else {
      target = STYLES[this.mode].target;
    }
    this.intensity += (target - this.intensity) * Math.min(1, dt * 2.4);
    this.material.opacity = this.intensity;
    const live = this.intensity > 0.01;
    this.points.visible = live;
    const masked = !this.planLocal;
    if (live && masked && (!this.wasLive || maskedSwap)) {
      for (let index = 0; index < this.count; index += 1) {
        const spawn = precipSpawnXZ(
          this.spawnRng,
          focus.x,
          focus.z,
          HX,
          HZ,
          this.mode,
          (x, z) => regionAt(x, z).id,
        );
        if (spawn) {
          this.positions[index * 3] = spawn.x;
          this.positions[index * 3 + 2] = spawn.z;
        }
      }
    }
    this.wasLive = live;
    if (!live) {
      return;
    }
    this.time += dt;
    const style = STYLES[this.mode];
    const originY = focus.y + 8;
    for (let index = 0; index < this.count; index += 1) {
      const offset = index * 3;
      const speed = this.fallSpeed[index] ?? 0;
      const phase = this.phase[index] ?? 0;
      let x = this.positions[offset] ?? 0;
      let y = this.positions[offset + 1] ?? 0;
      let z = this.positions[offset + 2] ?? 0;
      const fall = style.fall + speed * style.fallVar;
      y -= fall * dt;
      x += (Math.sin(this.time * 0.8 + phase) * style.sway + AUTUMN_STORM.rainWindX) * dt;
      z += AUTUMN_STORM.rainWindZ * dt;
      let wrapped = false;
      const rx = x - focus.x;
      if (rx > HX) {
        x -= HX * 2;
        wrapped = true;
      } else if (rx < -HX) {
        x += HX * 2;
        wrapped = true;
      }
      const rz = z - focus.z;
      if (rz > HZ) {
        z -= HZ * 2;
        wrapped = true;
      } else if (rz < -HZ) {
        z += HZ * 2;
        wrapped = true;
      }
      const ry = y - originY;
      if (ry < -HY) {
        y += HY * 2;
        wrapped = true;
      } else if (ry > HY) {
        y -= HY * 2;
        wrapped = true;
      }
      if (wrapped && masked) {
        const spawn = precipSpawnXZ(
          this.spawnRng,
          focus.x,
          focus.z,
          HX,
          HZ,
          this.mode,
          (px, pz) => regionAt(px, pz).id,
        );
        if (spawn) {
          x = spawn.x;
          z = spawn.z;
        }
      }
      this.positions[offset] = x;
      this.positions[offset + 1] = y;
      this.positions[offset + 2] = z;
    }
    this.positionAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
    this.textures.flake.dispose();
    this.textures.streak.dispose();
  }

  private applyStyle(mode: PrecipMode): void {
    const style = STYLES[mode];
    this.material.map = this.textures[style.texture];
    this.material.color.setHex(style.color);
    this.material.size = style.size;
    this.material.needsUpdate = true;
  }
}
