import * as THREE from 'three';
import { type RegionId, regionBlendAt } from './map-regions';
import { createRandomStream } from './map-sampling';

/**
 * Map-mode atmosphere: a painted ink-wash sky gradient plus district-aware
 * fog, replacing the flat olive backdrop that made every frame read murky.
 *
 * The fog colour drifts toward the local district's `mist` tone as the player
 * crosses borders (the BIOME_FOG idea from world-of-claudecraft), so 蛛丝峡
 * reads cold and dense while 万劫三庭 stays golden and open — without touching
 * any material or triggering a single shader recompile.
 */

export interface MapAtmosphere {
  /** Drifts fog toward the district under the local player. */
  update(localXMeters: number, localZMeters: number): void;
  dispose(): void;
}

/** Per-district fog density; unlisted districts use the base value. */
const FOG_DENSITY_BY_REGION: Partial<Record<RegionId, number>> = {
  zhusi: 0.0034,
  mihun: 0.0032,
  longji: 0.0028,
  santing: 0.0025,
};
const BASE_FOG_DENSITY = 0.00225;

/** How strongly district mist tones are pulled back toward the ink base. */
const INK_ANCHOR = 0.34;
const INK_BASE = 0x858c7d;

export function createMapAtmosphere(scene: THREE.Scene): MapAtmosphere {
  const skyTexture = paintSkyTexture();
  scene.background = skyTexture;

  const fog = new THREE.FogExp2(INK_BASE, BASE_FOG_DENSITY);
  scene.fog = fog;

  const targetColour = new THREE.Color();
  const secondaryColour = new THREE.Color();
  const inkBase = new THREE.Color(INK_BASE);
  let currentDensity = BASE_FOG_DENSITY;

  return {
    update(localXMeters: number, localZMeters: number): void {
      const blend = regionBlendAt(localXMeters, localZMeters);
      targetColour.setHex(blend.primary.mist);
      secondaryColour.setHex(blend.secondary.mist);
      targetColour.lerp(secondaryColour, blend.mix);
      targetColour.lerp(inkBase, INK_ANCHOR);
      fog.color.lerp(targetColour, 0.045);

      const primaryDensity = FOG_DENSITY_BY_REGION[blend.primary.id] ?? BASE_FOG_DENSITY;
      const secondaryDensity = FOG_DENSITY_BY_REGION[blend.secondary.id] ?? BASE_FOG_DENSITY;
      const targetDensity = primaryDensity + (secondaryDensity - primaryDensity) * blend.mix;
      currentDensity += (targetDensity - currentDensity) * 0.03;
      fog.density = currentDensity;
    },
    dispose(): void {
      skyTexture.dispose();
    },
  };
}

/**
 * A 256² vertical wash from pale mist into deep pine ink, with a few soft
 * horizontal cloud strokes so the empty half of the frame is not a flat fill.
 */
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

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
