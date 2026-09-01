import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createHeroSkillVisual,
  HERO_SKILL_VFX_PROFILES,
  updateHeroSkillVisual,
} from '../apps/web/src/render/hero-skill-vfx';

function firstProfile() {
  const profile = HERO_SKILL_VFX_PROFILES[0];
  if (!profile) {
    throw new Error('missing hero skill profile');
  }
  return profile;
}

function pointsIn(group: THREE.Group): THREE.Points[] {
  const found: THREE.Points[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Points) {
      found.push(child);
    }
  });
  return found;
}

function ringsIn(group: THREE.Group): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.shockRing === true) {
      found.push(child);
    }
  });
  return found;
}

describe('hero skill burst layers', () => {
  it('gives casts and impacts a spark burst but leaves a persistent aura alone', () => {
    const profile = firstProfile();
    expect(pointsIn(createHeroSkillVisual(profile, 'cast', false).group)).toHaveLength(1);
    expect(pointsIn(createHeroSkillVisual(profile, 'impact', false).group)).toHaveLength(1);
    // A status aura is a state, not an event: sparks there would fire for as
    // long as the buff is up and stop reading as an impact.
    expect(pointsIn(createHeroSkillVisual(profile, 'status', false).group)).toHaveLength(0);
  });

  it('pairs the shock rings on impact so the wave has a trailing edge', () => {
    const profile = firstProfile();
    expect(ringsIn(createHeroSkillVisual(profile, 'impact', false).group)).toHaveLength(3);
    expect(ringsIn(createHeroSkillVisual(profile, 'cast', false).group)).toHaveLength(2);
    expect(ringsIn(createHeroSkillVisual(profile, 'status', false).group)).toHaveLength(0);
  });

  it('throws sparks outward and fades them out', () => {
    const profile = firstProfile();
    const visual = createHeroSkillVisual(profile, 'impact', false);
    const points = pointsIn(visual.group)[0];
    if (!points) {
      throw new Error('missing spark burst');
    }
    const position = points.geometry.getAttribute('position');
    const spread = (): number => {
      let widest = 0;
      for (let index = 0; index < position.count; index += 1) {
        widest = Math.max(widest, Math.hypot(position.getX(index), position.getZ(index)));
      }
      return widest;
    };

    const start = spread();
    updateHeroSkillVisual(visual.group, 0.5, 0.25);
    const mid = spread();
    expect(mid).toBeGreaterThan(start);

    const material = points.material as THREE.PointsMaterial;
    updateHeroSkillVisual(visual.group, 1, 0.6);
    expect(material.opacity).toBeLessThan(0.05);
  });

  it('expands each ring on its own delay', () => {
    const profile = firstProfile();
    const visual = createHeroSkillVisual(profile, 'impact', false);
    const [lead, trail] = ringsIn(visual.group);
    if (!lead || !trail) {
      throw new Error('missing shock rings');
    }
    updateHeroSkillVisual(visual.group, 0.1, 0.05);
    // The trailing ring has not started yet, so it must not be drawn at full
    // size on top of the leading one.
    expect(trail.visible).toBe(false);
    expect(lead.visible).toBe(true);

    updateHeroSkillVisual(visual.group, 0.6, 0.3);
    expect(trail.visible).toBe(true);
    expect(lead.scale.x).toBeGreaterThan(trail.scale.x);
  });

  it('keeps the reduced tier cheaper', () => {
    const profile = firstProfile();
    const full = pointsIn(createHeroSkillVisual(profile, 'impact', false).group)[0];
    const reduced = pointsIn(createHeroSkillVisual(profile, 'impact', true).group)[0];
    if (!full || !reduced) {
      throw new Error('missing spark burst');
    }
    expect(reduced.geometry.getAttribute('position').count).toBeLessThan(
      full.geometry.getAttribute('position').count,
    );
  });
});
