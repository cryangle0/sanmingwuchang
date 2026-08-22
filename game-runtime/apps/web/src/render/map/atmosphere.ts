import { terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { createRandomStream } from './map-sampling';
import { blendClimateAt } from './region-climate';
import { MapWeather } from './weather';

/**
 * Map-mode atmosphere: ink-wash sky, district fog, lighting, and
 * render-only rain/snow. None of this writes sim state.
 */

export interface MapAtmosphere {
  update(localXMeters: number, localZMeters: number, focus: THREE.Vector3, dt: number): void;
  dispose(): void;
}

export interface MapAtmosphereLights {
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly fill: THREE.DirectionalLight;
  readonly graphicsReduced: boolean;
}

const INK_ANCHOR = 0.22;
const INK_BASE = 0x858c7d;

export function createMapAtmosphere(
  scene: THREE.Scene,
  lights: MapAtmosphereLights,
): MapAtmosphere {
  const skyTexture = paintSkyTexture();
  scene.background = skyTexture;
  const fog = new THREE.FogExp2(INK_BASE, 0.00225);
  scene.fog = fog;
  const weather = new MapWeather(scene, lights.graphicsReduced);

  const targetColour = new THREE.Color();
  const secondaryColour = new THREE.Color();
  const inkBase = new THREE.Color(INK_BASE);
  const sunColour = new THREE.Color();
  const hemiSky = new THREE.Color();
  const hemiGround = new THREE.Color();
  let currentDensity = 0.00225;
  const baseFill = lights.fill.intensity;

  return {
    update(localXMeters: number, localZMeters: number, focus: THREE.Vector3, dt: number): void {
      const { primary, secondary, mix, climate } = blendClimateAt(localXMeters, localZMeters);
      targetColour.setHex(primary.mist);
      secondaryColour.setHex(secondary.mist);
      targetColour.lerp(secondaryColour, mix);
      targetColour.lerp(inkBase, INK_ANCHOR);
      fog.color.lerp(targetColour, 0.06);

      currentDensity += (climate.fogDensity - currentDensity) * 0.04;
      const height = terrainHeightMeters(localXMeters, localZMeters);
      const valley = height < 0 ? Math.min(0.42, -height / 3.4) : 0;
      fog.density = currentDensity * (1 + valley);

      sunColour.setHex(climate.sunColor);
      lights.sun.color.lerp(sunColour, 0.05);
      lights.sun.intensity += (climate.sunIntensity - lights.sun.intensity) * 0.05;
      hemiSky.setHex(climate.hemiSky);
      hemiGround.setHex(climate.hemiGround);
      lights.hemisphere.color.lerp(hemiSky, 0.05);
      lights.hemisphere.groundColor.lerp(hemiGround, 0.05);
      const dim = climate.weather === 'clear' ? 1 : 0.72;
      lights.fill.intensity += (baseFill * dim - lights.fill.intensity) * 0.05;
      if ('backgroundIntensity' in scene) {
        const sky = climate.weather === 'clear' ? 1.05 : 0.82;
        scene.backgroundIntensity += (sky - scene.backgroundIntensity) * 0.04;
      }
      weather.update(focus, dt);
    },
    dispose(): void {
      weather.dispose();
      skyTexture.dispose();
    },
  };
}

function paintSkyTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('map atmosphere: 2D canvas context unavailable');
  }

  const gradient = context.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, '#d0d6c5');
  gradient.addColorStop(0.42, '#aab99d');
  gradient.addColorStop(0.72, '#84967b');
  gradient.addColorStop(1, '#5e715f');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const nextRandom = createRandomStream(0x5eaf00d);
  for (let index = 0; index < 9; index += 1) {
    const y = size * (0.08 + nextRandom() * 0.5);
    const x = nextRandom() * size;
    const width = size * (0.35 + nextRandom() * 0.5);
    const height = size * (0.02 + nextRandom() * 0.035);
    const alpha = 0.045 + nextRandom() * 0.05;
    const bright = nextRandom() > 0.35;
    context.fillStyle = bright
      ? `rgba(214, 226, 218, ${alpha})`
      : `rgba(52, 66, 58, ${alpha * 0.8})`;
    context.beginPath();
    context.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.fill();
  }

  const sun = context.createRadialGradient(
    size * 0.72,
    size * 0.18,
    4,
    size * 0.72,
    size * 0.18,
    size * 0.22,
  );
  sun.addColorStop(0, 'rgba(255, 236, 196, 0.55)');
  sun.addColorStop(0.35, 'rgba(232, 214, 168, 0.16)');
  sun.addColorStop(1, 'rgba(208, 214, 197, 0)');
  context.fillStyle = sun;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
