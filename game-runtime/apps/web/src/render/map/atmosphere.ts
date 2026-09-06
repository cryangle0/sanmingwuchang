import { terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { AUTUMN_STORM } from './autumn-storm';
import { MapFallingLeaves } from './falling-leaves';
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
  update(
    localXMeters: number,
    localZMeters: number,
    focus: THREE.Vector3,
    dt: number,
    cameraPosition: THREE.Vector3,
  ): void;
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

/**
 * Sky dome radius. The dome is re-centred on the camera every frame, so every
 * dome vertex sits exactly this far from the eye. Keep it well inside the
 * camera far plane (600 m) or the GPU clips the whole sky away.
 */
export const SKY_DOME_RADIUS_METERS = 420;

/**
 * World-space cloud drift in cloud-plane units per second. The clouds are a
 * function of view DIRECTION only, so orbiting the camera with the mouse
 * looks through the same fixed cloud field; only the storm wind moves it.
 */
export const SKY_CLOUD_DRIFT_PER_SECOND = 0.0032;

export const SKY_PALETTE = {
  zenith: 0x33434d,
  mid: 0x51646c,
  horizon: 0x7f8781,
  nadir: 0x5c5147,
  cloudDark: 0x3b464d,
  cloudLight: 0x9ea59e,
} as const;

const SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vDirection;
void main() {
  // The dome is centred on the camera, so the object-space vertex position
  // is the world-space view direction of that sky sample.
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uIntensity;
uniform vec2 uWind;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uNadir;
uniform vec3 uCloudDark;
uniform vec3 uCloudLight;
varying vec3 vDirection;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(0.8, 0.6, -0.6, 0.8);
  for (int octave = 0; octave < 5; octave += 1) {
    total += amplitude * valueNoise(p);
    p = rotate * p * 2.03 + vec2(7.3, 1.7);
    amplitude *= 0.5;
  }
  return total;
}

void main() {
  vec3 direction = normalize(vDirection);
  float elevation = direction.y;

  vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.22, elevation));
  sky = mix(sky, uZenith, smoothstep(0.2, 0.75, elevation));
  sky = mix(uNadir, sky, smoothstep(-0.28, 0.0, elevation));

  // Project the view ray onto a cloud deck so the field reads as a flat
  // overcast layer rather than a texture wrapped around a ball.
  float deck = max(elevation, 0.045);
  vec2 plane = direction.xz / deck;
  vec2 drift = uWind * uTime;
  vec2 p = plane * 0.55 + drift;
  float base = fbm(p);
  float detail = fbm(p * 2.7 + vec2(31.0, 11.0) + drift * 0.6);
  float shape = base * 0.72 + detail * 0.28;
  float coverage = smoothstep(0.40, 0.68, shape);
  coverage *= smoothstep(0.0, 0.16, elevation);
  float lit = smoothstep(0.30, 0.80, detail);
  vec3 cloud = mix(uCloudDark, uCloudLight, lit);

  vec3 colour = mix(sky, cloud, coverage * 0.88) * uIntensity;
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSkyDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const windLength = Math.hypot(AUTUMN_STORM.rainWindX, AUTUMN_STORM.rainWindZ) || 1;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: AUTUMN_STORM.backgroundIntensity },
      uWind: {
        value: new THREE.Vector2(
          (AUTUMN_STORM.rainWindX / windLength) * SKY_CLOUD_DRIFT_PER_SECOND,
          (AUTUMN_STORM.rainWindZ / windLength) * SKY_CLOUD_DRIFT_PER_SECOND,
        ),
      },
      uZenith: { value: new THREE.Color(SKY_PALETTE.zenith) },
      uMid: { value: new THREE.Color(SKY_PALETTE.mid) },
      uHorizon: { value: new THREE.Color(SKY_PALETTE.horizon) },
      uNadir: { value: new THREE.Color(SKY_PALETTE.nadir) },
      uCloudDark: { value: new THREE.Color(SKY_PALETTE.cloudDark) },
      uCloudLight: { value: new THREE.Color(SKY_PALETTE.cloudLight) },
    },
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_DOME_RADIUS_METERS, 32, 18), material);
  dome.name = 'map-sky-dome';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  // Nothing in the scene should ever pick the sky.
  dome.raycast = () => {};
  return dome;
}

export function createMapAtmosphere(
  scene: THREE.Scene,
  lights: MapAtmosphereLights,
): MapAtmosphere {
  // A 2D scene background is drawn in screen space, so its clouds ride along
  // with every mouse orbit. The sky is a camera-centred dome instead: the
  // clouds are a function of world view direction, so they stay put while
  // the camera turns and only the storm wind moves them.
  const skyDome = createSkyDome();
  const skyTime = skyDome.material.uniforms.uTime ?? { value: 0 };
  scene.background = new THREE.Color(AUTUMN_STORM.fogColor);
  scene.add(skyDome);
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
  let skySeconds = 0;
  const baseFill = AUTUMN_STORM.fillIntensity;

  return {
    update(
      localXMeters: number,
      localZMeters: number,
      focus: THREE.Vector3,
      dt: number,
      cameraPosition: THREE.Vector3,
    ): void {
      skySeconds += dt;
      skyDome.position.copy(cameraPosition);
      skyTime.value = skySeconds;

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
      weather.update(focus, dt);
      leaves.update(focus, dt);
    },
    dispose(): void {
      weather.dispose();
      leaves.dispose();
      skyDome.removeFromParent();
      skyDome.geometry.dispose();
      skyDome.material.dispose();
    },
  };
}
