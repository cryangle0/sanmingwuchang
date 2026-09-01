import { terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { AUTUMN_STORM } from './autumn-storm';
import { MapFallingLeaves } from './falling-leaves';
import { createRandomStream } from './map-sampling';
import { blendClimateAt } from './region-climate';
import { MapWeather } from './weather';

/**
 * Map-mode atmosphere: storm sky, district fog, dim lighting, rain and
 * falling leaves. None of this writes sim state.
 *
 * The whole playfield is one autumn storm — slate sky, umber horizon, rain
 * and wind — while district climate only tints the ambient and wetness.
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

const AERIAL_ANCHOR = 0.42;
const AERIAL_BASE = AUTUMN_STORM.fogColor;
const BASE_FOG_DENSITY = AUTUMN_STORM.fogDensity;

export function createMapAtmosphere(
  scene: THREE.Scene,
  lights: MapAtmosphereLights,
): MapAtmosphere {
  const skyTexture = paintSkyTexture();
  scene.background = skyTexture;
  scene.backgroundIntensity = AUTUMN_STORM.backgroundIntensity;
  const fog = new THREE.FogExp2(AERIAL_BASE, BASE_FOG_DENSITY);
  scene.fog = fog;
  const weather = new MapWeather(scene, lights.graphicsReduced);
  const leaves = new MapFallingLeaves(scene, lights.graphicsReduced);

  const targetColour = new THREE.Color();
  const secondaryColour = new THREE.Color();
  const aerialBase = new THREE.Color(AERIAL_BASE);
  const sunColour = new THREE.Color();
  const hemiSky = new THREE.Color();
  const hemiGround = new THREE.Color();
  let currentDensity = BASE_FOG_DENSITY;
  const baseFill = AUTUMN_STORM.fillIntensity;

  return {
    update(localXMeters: number, localZMeters: number, focus: THREE.Vector3, dt: number): void {
      const { primary, secondary, mix, climate } = blendClimateAt(localXMeters, localZMeters);
      targetColour.setHex(primary.mist);
      secondaryColour.setHex(secondary.mist);
      targetColour.lerp(secondaryColour, mix);
      targetColour.lerp(aerialBase, AERIAL_ANCHOR);
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
      lights.hemisphere.intensity +=
        (AUTUMN_STORM.hemiIntensity - lights.hemisphere.intensity) * 0.05;
      lights.fill.intensity += (baseFill - lights.fill.intensity) * 0.05;
      scene.backgroundIntensity +=
        (AUTUMN_STORM.backgroundIntensity - scene.backgroundIntensity) * 0.08;
      weather.update(focus, dt);
      leaves.update(focus, dt);
    },
    dispose(): void {
      weather.dispose();
      leaves.dispose();
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
    gradient.addColorStop(0, '#344650');
    gradient.addColorStop(0.32, '#4a5e67');
    gradient.addColorStop(0.62, '#707b76');
    gradient.addColorStop(0.86, '#7c6e5d');
    gradient.addColorStop(1, '#5e5045');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const nextRandom = createRandomStream(0x5eaf00d);
  for (let index = 0; index < 18; index += 1) {
    const y = size * (0.04 + nextRandom() * 0.62);
    const x = nextRandom() * size;
    const width = size * (0.42 + nextRandom() * 0.55);
    const height = size * (0.035 + nextRandom() * 0.06);
    const alpha = 0.08 + nextRandom() * 0.12;
    const bright = nextRandom() > 0.72;
    context.fillStyle = bright
      ? `rgba(168, 156, 138, ${alpha * 0.45})`
      : `rgba(28, 34, 40, ${alpha})`;
    context.beginPath();
    context.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
