import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createHeroSkillVisual,
  HERO_SKILL_VFX_PROFILES,
  updateHeroSkillVisual,
} from '../apps/web/src/render/hero-skill-vfx';

function ringsIn(group: THREE.Group): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.shockRing === true) {
      found.push(child);
    }
  });
  return found;
}

function shapesIn(group: THREE.Group): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.skillShape === true) {
      found.push(child);
    }
  });
  return found;
}

describe('hero skill shapes', () => {
  it('gives every profile a bespoke silhouette with a small part count', () => {
    for (const profile of HERO_SKILL_VFX_PROFILES) {
      const cast = createHeroSkillVisual(profile, 'cast', false);
      const shapes = shapesIn(cast.group);
      expect(shapes.length, profile.heroId).toBeGreaterThan(0);
      // A shape is a few solid meshes, not a cloud of parts.
      expect(shapes.length, profile.heroId).toBeLessThanOrEqual(30);
      for (const mesh of shapes) {
        const material = mesh.material as THREE.MeshBasicMaterial;
        expect(material.blending, profile.heroId).toBe(THREE.NormalBlending);
      }
    }
  });

  it('marks the hit with one ground ring on cast and impact, none on a status aura', () => {
    const profile = HERO_SKILL_VFX_PROFILES[0];
    if (!profile) {
      throw new Error('missing profile');
    }
    expect(ringsIn(createHeroSkillVisual(profile, 'cast', false).group)).toHaveLength(1);
    expect(ringsIn(createHeroSkillVisual(profile, 'impact', false).group)).toHaveLength(1);
    expect(ringsIn(createHeroSkillVisual(profile, 'status', false).group)).toHaveLength(0);
  });

  it('expands the ring as the effect plays', () => {
    const profile = HERO_SKILL_VFX_PROFILES[0];
    if (!profile) {
      throw new Error('missing profile');
    }
    const visual = createHeroSkillVisual(profile, 'impact', false);
    const [ring] = ringsIn(visual.group);
    if (!ring) {
      throw new Error('missing ring');
    }
    updateHeroSkillVisual(visual.group, 0.15, 0.15);
    const early = ring.scale.x;
    updateHeroSkillVisual(visual.group, 0.7, 0.7);
    expect(ring.scale.x).toBeGreaterThan(early);
  });

  it('keeps distinct motifs from sharing one silhouette', () => {
    const signatures = new Set<string>();
    for (const profile of HERO_SKILL_VFX_PROFILES) {
      const cast = createHeroSkillVisual(profile, 'cast', false);
      const signature = shapesIn(cast.group)
        .map((mesh) => `${mesh.geometry.type}:${mesh.position.y.toFixed(1)}`)
        .sort()
        .join('|');
      signatures.add(signature);
    }
    expect(signatures.size).toBeGreaterThanOrEqual(HERO_SKILL_VFX_PROFILES.length - 2);
  });
});
