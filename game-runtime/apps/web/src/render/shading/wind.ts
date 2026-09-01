import * as THREE from 'three';

/**
 * Shared wind clock for environment sway. Storm-scale gusts lean vegetation
 * in +X/+Z and pulse so canopies read as being in a gale, not a breeze.
 * Render-only; simulation state is untouched.
 */

const WIND_TIME: { value: number } = { value: 0 };
const WIND_CAMERA_POSITION: { value: THREE.Vector3 } = {
  value: new THREE.Vector3(),
};

/** Advances the shared wind clock; call once per rendered frame. */
export function tickWind(elapsedSeconds: number): void {
  WIND_TIME.value = elapsedSeconds;
}

/** Shared render-time uniform for custom vegetation shaders. */
export function windTimeUniform(): { value: number } {
  return WIND_TIME;
}

/** Keeps camera-facing foliage on the same render-time camera position. */
export function setWindCameraPosition(position: THREE.Vector3): void {
  WIND_CAMERA_POSITION.value.copy(position);
}

export interface WindSwayOptions {
  /**
   * Low tree LODs are crossed source billboards. Rotate the crossed planes
   * toward the camera before applying the instance transform.
   */
  readonly billboard?: boolean;
}

/**
 * Injects a vertex-stage sway into the material. Strength is baked into the
 * shader as a constant (one program per strength value, cached by key).
 */
export function applyWindSway(
  material: THREE.Material,
  strength: number,
  options: WindSwayOptions = {},
): void {
  const billboard = options.billboard === true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = WIND_TIME;
    if (billboard) {
      shader.uniforms.uWindCameraPosition = WIND_CAMERA_POSITION;
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uWindTime;',
          billboard ? 'uniform vec3 uWindCameraPosition;' : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .replace(
        '#include <beginnormal_vertex>',
        [
          '#include <beginnormal_vertex>',
          ...(billboard
            ? [
                '#ifdef USE_INSTANCING',
                'vec2 windNormalOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);',
                'vec2 windNormalToCamera = uWindCameraPosition.xz - windNormalOrigin;',
                'float windNormalCameraDistance = length(windNormalToCamera);',
                'if (windNormalCameraDistance > 0.001) {',
                '  float windNormalCameraYaw = atan(windNormalToCamera.x, windNormalToCamera.y);',
                '  float windNormalInstanceYaw = atan(instanceMatrix[2][0], instanceMatrix[0][0]);',
                '  float windNormalBillboardDelta = windNormalCameraYaw - windNormalInstanceYaw;',
                '  float windNormalBillboardCos = cos(windNormalBillboardDelta);',
                '  float windNormalBillboardSin = sin(windNormalBillboardDelta);',
                '  objectNormal.xz = mat2(windNormalBillboardCos, -windNormalBillboardSin, windNormalBillboardSin, windNormalBillboardCos) * objectNormal.xz;',
                '}',
                '#endif',
              ]
            : []),
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          'vec2 windOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);',
          'float windInstanceYaw = atan(instanceMatrix[2][0], instanceMatrix[0][0]);',
          '#else',
          'vec2 windOrigin = transformed.xz;',
          'float windInstanceYaw = 0.0;',
          '#endif',
          ...(billboard
            ? [
                '#ifdef USE_INSTANCING',
                'vec2 windToCamera = uWindCameraPosition.xz - windOrigin;',
                'float windCameraDistance = length(windToCamera);',
                'if (windCameraDistance > 0.001) {',
                '  float windBillboardYaw = atan(windToCamera.x, windToCamera.y);',
                '  float windBillboardDelta = windBillboardYaw - windInstanceYaw;',
                '  float windBillboardCos = cos(windBillboardDelta);',
                '  float windBillboardSin = sin(windBillboardDelta);',
                '  transformed.xz = mat2(windBillboardCos, -windBillboardSin, windBillboardSin, windBillboardCos) * transformed.xz;',
                '}',
                '#endif',
              ]
            : []),
          'vec2 windSample = windOrigin + transformed.xz * 0.35;',
          'float windPhase = uWindTime * 3.0;',
          'float windBroad = sin(windSample.x * 0.18 + windSample.y * 0.14 + windPhase);',
          'float windCross = cos(windSample.x * 0.08 + windSample.y * 0.22 + windPhase * 0.72);',
          'float windDetail = sin(windSample.x * 0.55 + windSample.y * 0.42 + windPhase * 0.35);',
          'float windMicro = sin(windSample.x * 0.50 - windSample.y * 0.31 + windPhase * 0.50);',
          'vec2 windDirection = normalize(vec2(0.93, 0.36));',
          'vec2 windSide = vec2(-windDirection.y, windDirection.x);',
          'float windGust = 0.70 + windBroad * 0.20 + windDetail * 0.10;',
          'float windCrossAmount = windCross * 0.06 + windMicro * 0.035;',
          `float windWeight = smoothstep(0.02, 0.96, transformed.y) * ${strength.toFixed(4)};`,
          'vec2 windDisplacement = windDirection * windGust + windSide * windCrossAmount;',
          'transformed.xz += windDisplacement * windWeight;',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () =>
    `wind-sway-storm-${strength}-${billboard ? 'billboard' : 'world'}-v4`;
}
