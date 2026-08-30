import { terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { createRandomStream } from './map-sampling';
import { blendClimateAt } from './region-climate';
import { MapWeather } from './weather';

/**
 * Map-mode atmosphere: sky, district fog, lighting, and render-only
 * rain/snow. None of this writes sim state.
 *
 * Direction follows JourneyWestGreatBrawl_AI游戏场景提示词 sections 7 and 13:
 * a bright morning-to-afternoon key, 浅青 sky light, and fog that layers
 * distance without turning the playfield into 灰蒙/低对比.
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

/**
 * Distance anchor for aerial perspective. Every district mist is pulled a
 * little toward pale sky blue so 远景 separates from 中景 (section 4), which
 * is what the old grey-olive ink anchor was doing structurally — but pulling
 * toward a hue instead of toward grey keeps district colour alive at range
 * rather than draining it, which section 15 forbids.
 */
const AERIAL_ANCHOR = 0.16;
const AERIAL_BASE = 0x91adbd;
/**
 * Base extinction. Districts override this; the value only has to be low
 * enough that foreground and mid-ground stay sharp before a district's own
 * climate speaks.
 */
const BASE_FOG_DENSITY = 0.0017;

export function createMapAtmosphere(
  scene: THREE.Scene,
  lights: MapAtmosphereLights,
): MapAtmosphere {
  const skyTexture = paintSkyTexture();
  scene.background = skyTexture;
  scene.backgroundIntensity = 0.82;
  const fog = new THREE.FogExp2(AERIAL_BASE, BASE_FOG_DENSITY);
  scene.fog = fog;
  const weather = new MapWeather(scene, lights.graphicsReduced);

  const targetColour = new THREE.Color();
  const secondaryColour = new THREE.Color();
  const aerialBase = new THREE.Color(AERIAL_BASE);
  const sunColour = new THREE.Color();
  const hemiSky = new THREE.Color();
  const hemiGround = new THREE.Color();
  let currentDensity = BASE_FOG_DENSITY;
  const baseFill = lights.fill.intensity;

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
      const dim = climate.weather === 'clear' ? 1 : 0.72;
      lights.fill.intensity += (baseFill * dim - lights.fill.intensity) * 0.05;
      const sky = climate.weather === 'clear' ? 0.82 : 0.66;
      scene.backgroundIntensity += (sky - scene.backgroundIntensity) * 0.04;
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

  // Bright morning-to-afternoon key (section 7): 浅青 zenith grading down to a
  // warm gold horizon, so the frame carries a cool/warm split before any
  // district colour lands on it.
  const gradient = context.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, '#587fa3');
  gradient.addColorStop(0.38, '#7fa7c2');
  gradient.addColorStop(0.68, '#b6c5c2');
  gradient.addColorStop(0.88, '#cfbea4');
  gradient.addColorStop(1, '#aaa78f');
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
    // Lit cloud faces take the warm key, shadowed ones the cool sky bounce.
    context.fillStyle = bright
      ? `rgba(246, 244, 235, ${alpha})`
      : `rgba(96, 122, 142, ${alpha * 0.8})`;
    context.beginPath();
    context.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.fill();
  }

  // Section 7 puts the key light upper-left or upper-side.
  const sun = context.createRadialGradient(
    size * 0.28,
    size * 0.18,
    4,
    size * 0.28,
    size * 0.18,
    size * 0.24,
  );
  sun.addColorStop(0, 'rgba(255, 240, 206, 0.42)');
  sun.addColorStop(0.35, 'rgba(246, 224, 176, 0.14)');
  sun.addColorStop(1, 'rgba(214, 230, 240, 0)');
  context.fillStyle = sun;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
