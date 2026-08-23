import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createHeroSkillVisual,
  HERO_SKILL_VFX_PROFILES,
  type HeroSkillMotion,
  updateHeroSkillVisual,
} from '../apps/web/src/render/hero-skill-vfx';

const MOTIONS: readonly HeroSkillMotion[] = [
  'burst',
  'forward',
  'spiral',
  'rise',
  'aura',
  'collapse',
];

function profileFor(motion: HeroSkillMotion) {
  const found = HERO_SKILL_VFX_PROFILES.find((entry) => entry.motion === motion);
  if (!found) {
    throw new Error(`no profile uses motion ${motion}`);
  }
  return found;
}

/**
 * The whole transform over a cast, sampled evenly.
 *
 * Scale alone is not the signature: forward and rise grow at nearly the same
 * rate and differ in where they move — the recoil-then-lunge versus the
 * crouch-then-erupt. Comparing only scale would call those two identical.
 */
function castCurve(motion: HeroSkillMotion): number[][] {
  const visual = createHeroSkillVisual(profileFor(motion), 'cast', false);
  const peak = Math.max(0.001, visual.group.userData.baseScale as number);
  const samples: number[][] = [];
  let previousRotation = 0;
  for (let step = 0; step <= 20; step += 1) {
    const progress = step / 20;
    updateHeroSkillVisual(visual.group, progress, progress * 0.72);
    const rotation = visual.group.rotation.y;
    samples.push([
      visual.group.scale.x / peak,
      visual.group.position.y,
      visual.group.position.z,
      rotation - previousRotation,
    ]);
    previousRotation = rotation;
  }
  return samples;
}

describe('hero skill envelope', () => {
  it('covers every motion family in the roster', () => {
    // The envelope is keyed on motion because that is the axis the roster
    // actually spreads across; if a family ever emptied, its curve would be
    // dead code claiming to differentiate heroes.
    for (const motion of MOTIONS) {
      expect(HERO_SKILL_VFX_PROFILES.some((entry) => entry.motion === motion)).toBe(true);
    }
  });

  it('gives each family a distinguishable rhythm', () => {
    const curves = new Map(MOTIONS.map((motion) => [motion, castCurve(motion)]));
    for (const left of MOTIONS) {
      for (const right of MOTIONS) {
        if (left >= right) {
          continue;
        }
        const a = curves.get(left) ?? [];
        const b = curves.get(right) ?? [];
        let apart = 0;
        for (let index = 0; index < a.length; index += 1) {
          const rowA = a[index] ?? [];
          const rowB = b[index] ?? [];
          for (let axis = 0; axis < rowA.length; axis += 1) {
            apart = Math.max(apart, Math.abs((rowA[axis] ?? 0) - (rowB[axis] ?? 0)));
          }
        }
        // Two families that move identically are two families the player cannot
        // tell apart, whatever geometry each happens to draw.
        expect(apart, `${left} vs ${right}`).toBeGreaterThan(0.05);
      }
    }
  });

  it('loads a forward cast by recoiling before it lunges', () => {
    const visual = createHeroSkillVisual(profileFor('forward'), 'cast', false);
    updateHeroSkillVisual(visual.group, 0.12, 0.09);
    const windup = visual.group.position.z;
    updateHeroSkillVisual(visual.group, 0.85, 0.61);
    const lunge = visual.group.position.z;
    // The pull-back is what sells the thrust: without it the motif simply
    // slides forward from rest.
    expect(windup).toBeLessThan(0);
    expect(lunge).toBeGreaterThan(0.5);
  });

  it('crouches a rising cast before it erupts', () => {
    const visual = createHeroSkillVisual(profileFor('rise'), 'cast', false);
    updateHeroSkillVisual(visual.group, 0.1, 0.07);
    const crouch = visual.group.position.y;
    updateHeroSkillVisual(visual.group, 0.9, 0.65);
    expect(crouch).toBeLessThan(0);
    expect(visual.group.position.y).toBeGreaterThan(0.4);
  });

  it('gathers a collapsing cast wide before it crushes inward', () => {
    const visual = createHeroSkillVisual(profileFor('collapse'), 'cast', false);
    updateHeroSkillVisual(visual.group, 0.25, 0.18);
    const gathered = visual.group.scale.x;
    updateHeroSkillVisual(visual.group, 0.95, 0.68);
    expect(visual.group.scale.x).toBeLessThan(gathered);
  });

  it('spends a spiral cast down from a wound-up spin', () => {
    const visual = createHeroSkillVisual(profileFor('spiral'), 'cast', false);
    // Equal elapsed time either side, so any difference is the envelope's spin
    // multiplier rather than the clock.
    updateHeroSkillVisual(visual.group, 0.2, 0.4);
    const wound = visual.group.rotation.y;
    updateHeroSkillVisual(visual.group, 0.95, 0.4);
    expect(visual.group.rotation.y).toBeLessThan(wound);
  });

  it('does not wind up an impact, which has already landed', () => {
    const visual = createHeroSkillVisual(profileFor('burst'), 'impact', false);
    updateHeroSkillVisual(visual.group, 0.02, 0.01);
    const opening = visual.group.scale.x;
    updateHeroSkillVisual(visual.group, 0.2, 0.12);
    expect(visual.group.scale.x).toBeGreaterThan(opening);
    expect(visual.group.position.z).toBe(0);
  });

  it('fades the motif materials out by the end of a cast', () => {
    const profile = profileFor('burst');
    const visual = createHeroSkillVisual(profile, 'cast', false);
    updateHeroSkillVisual(visual.group, 0.5, 0.36);
    const mid = (visual.materials[0] as THREE.MeshBasicMaterial).opacity;
    updateHeroSkillVisual(visual.group, 1, 0.72);
    expect((visual.materials[0] as THREE.MeshBasicMaterial).opacity).toBeLessThan(mid);
  });
});
