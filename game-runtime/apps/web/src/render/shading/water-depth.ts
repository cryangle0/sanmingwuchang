import type * as THREE from 'three';

/**
 * Depth-driven transparency for standing water.
 *
 * The water mesh already carries a per-vertex `waterDepth` attribute — metres
 * of water above the terrain at that vertex — but nothing consumed it, and the
 * material used a single constant opacity. A pond was therefore just as opaque
 * a centimetre from the bank as it was over its deepest point, so the bottom
 * never showed through and the surface read as a flat sheet laid on the
 * ground rather than as water filling a hollow.
 *
 * Seeing the bed through the shallows is what sells both halves of what the
 * scene prompt asks for in section 8 — 浅滩过渡 and a bank that meets the land
 * instead of ending on a hard edge. At the waterline the surface is nearly
 * clear, so the shore grades continuously into the submerged ground; by a
 * metre or so of depth it has closed up into solid water.
 *
 * Render-only: this touches a material, never the height field the simulation
 * collides against.
 */

/** Opacity where the water meets the bank. Low enough to read as wet ground. */
const SHALLOW_ALPHA = 0.06;
/**
 * Opacity over the deepest water a pond reaches.
 *
 * Deliberately short of opaque: if the deep end closes up completely the pond
 * reads as a painted shape again, because the only visible gradient is then a
 * narrow ring at the bank.
 */
const DEEP_ALPHA = 0.66;
/**
 * Depth the ramp spans, which has to match the depth ponds actually reach
 * (POND_DEPTH_METERS in water.ts). The first version faded out over 1.6 m
 * while ponds filled deeper than that, so most of every pond sat clamped at the deep
 * value and the whole surface came out one flat tone — the exact "sheet laid
 * on the ground" this was meant to fix.
 */
const FADE_METERS = 2.2;

export interface WaterDepthFadeShader {
  vertexShader: string;
  fragmentShader: string;
}

/**
 * Applies the injection to an already-built shader object.
 *
 * Split out from `applyWaterDepthFade` so the substitution can be tested
 * without a WebGL context: `onBeforeCompile` only ever runs inside a real
 * renderer, and the failure mode worth catching is a chunk name that no longer
 * matches, which silently leaves the water opaque again.
 */
export function injectWaterDepthFade(shader: WaterDepthFadeShader): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute float waterDepth;\nvarying float vWaterDepth;',
    )
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterDepth = waterDepth;');

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vWaterDepth;')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  // Linear across the full depth: squaring pushed almost all of the change
  // into the last half metre, which is not a gradient a player can see.
  float depthMix = clamp( vWaterDepth / ${FADE_METERS.toFixed(2)}, 0.0, 1.0 );
  diffuseColor.a *= mix( ${SHALLOW_ALPHA.toFixed(2)}, ${DEEP_ALPHA.toFixed(2)}, depthMix );
}`,
    );
}

/** Wires the injection into a material's compile step. */
export function applyWaterDepthFade(material: THREE.Material): void {
  const previous = material.onBeforeCompile?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    injectWaterDepthFade(shader);
  };
  // Materials that share a program key would otherwise reuse the unpatched
  // build; this keeps the water's program distinct from other physical
  // materials with the same settings.
  material.customProgramCacheKey = () => 'jwgb-water-depth-fade';
}
