import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyWaterDepthFade,
  injectWaterDepthFade,
} from '../apps/web/src/render/shading/water-depth';

/**
 * The water surface used a single constant opacity, so a pond was as opaque at
 * the bank as over its deepest point: the bed never showed through and the
 * surface read as a sheet laid on the ground rather than as water filling a
 * hollow. The mesh already carried a per-vertex depth; nothing consumed it.
 *
 * The failure mode this guards is silent — a renamed three.js chunk would drop
 * the injection and leave the water flat again with no error anywhere.
 */

function physicalShader(): { vertexShader: string; fragmentShader: string } {
  return {
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
}

describe('water depth fade', () => {
  it('finds every chunk it patches in the physical shader', () => {
    const shader = physicalShader();
    expect(shader.vertexShader).toContain('#include <common>');
    expect(shader.vertexShader).toContain('#include <begin_vertex>');
    expect(shader.fragmentShader).toContain('#include <common>');
    expect(shader.fragmentShader).toContain('#include <color_fragment>');
  });

  it('carries the depth attribute through to the fragment stage', () => {
    const shader = physicalShader();
    injectWaterDepthFade(shader);
    expect(shader.vertexShader).toContain('attribute float waterDepth;');
    expect(shader.vertexShader).toContain('varying float vWaterDepth;');
    expect(shader.vertexShader).toContain('vWaterDepth = waterDepth;');
    expect(shader.fragmentShader).toContain('varying float vWaterDepth;');
  });

  it('scales alpha by depth rather than leaving it constant', () => {
    const shader = physicalShader();
    injectWaterDepthFade(shader);
    expect(shader.fragmentShader).toContain('diffuseColor.a *= mix(');
    expect(shader.fragmentShader).toContain('vWaterDepth /');
  });

  it('keeps the shallows clear and closes the water up with depth', () => {
    const shader = physicalShader();
    injectWaterDepthFade(shader);
    const mix = /diffuseColor\.a \*= mix\( ([0-9.]+), ([0-9.]+), depthMix \);/.exec(
      shader.fragmentShader,
    );
    if (!mix) {
      throw new Error('depth mix not injected');
    }
    const shallow = Number(mix[1]);
    const deep = Number(mix[2]);
    // Near the bank the bed has to show through, which is what makes the
    // surface meet the land instead of ending on a visible lip.
    expect(shallow).toBeLessThan(0.2);
    // Short of opaque on purpose: fully closing the deep end collapses the
    // gradient back into a ring at the bank.
    expect(deep).toBeGreaterThan(0.5);
    expect(deep).toBeLessThan(0.8);
    expect(deep).toBeGreaterThan(shallow);
  });

  it('gives the water its own program cache key', () => {
    // Without this the renderer can hand back an unpatched program compiled for
    // another physical material with the same settings.
    const material = new THREE.MeshPhysicalMaterial({ transparent: true });
    applyWaterDepthFade(material);
    expect(material.customProgramCacheKey()).toContain('water-depth');
    material.dispose();
  });

  it('runs an existing onBeforeCompile as well as its own', () => {
    const material = new THREE.MeshPhysicalMaterial({ transparent: true });
    let ranFirst = false;
    material.onBeforeCompile = () => {
      ranFirst = true;
    };
    applyWaterDepthFade(material);
    const shader = physicalShader();
    material.onBeforeCompile(
      shader as unknown as Parameters<THREE.Material['onBeforeCompile']>[0],
      null as unknown as THREE.WebGLRenderer,
    );
    expect(ranFirst).toBe(true);
    expect(shader.fragmentShader).toContain('vWaterDepth');
    material.dispose();
  });
});
