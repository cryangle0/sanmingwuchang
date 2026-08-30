import type * as THREE from 'three';

/**
 * Shared wind clock for environment sway, following the world-of-claudecraft
 * onBeforeCompile approach: one uniform object shared by every swaying
 * material, phase derived from each instance's world origin so neighbouring
 * clusters never move in sync, and displacement weighted by local height so
 * roots stay planted. Render-only; simulation state is untouched.
 */

const WIND_TIME: { value: number } = { value: 0 };

/** Advances the shared wind clock; call once per rendered frame. */
export function tickWind(elapsedSeconds: number): void {
  WIND_TIME.value = elapsedSeconds;
}

/** Shared render-time uniform for custom vegetation shaders. */
export function windTimeUniform(): { value: number } {
  return WIND_TIME;
}

/**
 * Injects a vertex-stage sway into the material. Strength is baked into the
 * shader as a constant (one program per strength value, cached by key).
 */
export function applyWindSway(material: THREE.Material, strength: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = WIND_TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          'vec2 windOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);',
          '#else',
          'vec2 windOrigin = transformed.xz;',
          '#endif',
          `float windWeight = clamp(transformed.y * 0.9, 0.0, 1.0) * ${strength.toFixed(4)};`,
          'float windA = sin(uWindTime * 1.7 + windOrigin.x * 0.57 + windOrigin.y * 0.49);',
          'float windB = sin(uWindTime * 2.9 + windOrigin.x * 1.31 + windOrigin.y * 1.17 + transformed.x * 1.9);',
          'transformed.x += (windA * 0.75 + windB * 0.25) * windWeight;',
          'transformed.z += (windA * 0.4 - windB * 0.22) * windWeight;',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => `wind-sway-${strength}`;
}
