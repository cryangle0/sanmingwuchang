import type { FiveElement } from '@jwgb/content';
import type { MonsterKind } from '@jwgb/sim';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CORE_BOSS_ABILITY_IDS,
  coreBossAbilityVfxProfile,
  createMonsterSkillVisual,
  monsterAttackVfxProfile,
} from '../apps/web/src/render/monster-skill-vfx';

const MONSTER_KINDS: readonly MonsterKind[] = [
  'ground-melee',
  'ground-ranged',
  'flying',
  'pig',
  'elite-tank',
  'elite-ranged',
  'dragon-king',
  'core-boss',
];

const ELEMENTS: readonly FiveElement[] = ['metal', 'wood', 'water', 'fire', 'earth'];

function meshCount(group: THREE.Group): number {
  let count = 0;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      count += 1;
    }
  });
  return count;
}

function disposeVisual(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
    }
  });
}

describe('monster skill vfx', () => {
  it('gives every monster kind a signature visual', () => {
    const ids = new Set<string>();
    for (const kind of MONSTER_KINDS) {
      const profile = monsterAttackVfxProfile(kind);
      ids.add(profile.heroId);
      const visual = createMonsterSkillVisual(profile, 'cast', false);
      expect(meshCount(visual.group), kind).toBeGreaterThan(3);
      disposeVisual(visual.group);
      visual.materials.forEach((material) => {
        material.dispose();
      });
    }
    expect(ids.size).toBe(MONSTER_KINDS.length);
  });

  it('tints pig and dragon attacks by element', () => {
    const colors = new Set<number>();
    for (const element of ELEMENTS) {
      colors.add(monsterAttackVfxProfile('pig', element).primary);
      colors.add(monsterAttackVfxProfile('dragon-king', element).primary);
    }
    expect(colors.size).toBe(ELEMENTS.length);
  });

  it('gives every core-boss ability its own look', () => {
    const ids = new Set<string>();
    for (const abilityId of CORE_BOSS_ABILITY_IDS) {
      const profile = coreBossAbilityVfxProfile(abilityId);
      ids.add(profile.heroId);
      const visual = createMonsterSkillVisual(profile, 'impact', false);
      expect(meshCount(visual.group), abilityId).toBeGreaterThan(3);
      expect(visual.group.name).toContain(profile.heroId.toLowerCase());
      disposeVisual(visual.group);
      visual.materials.forEach((material) => {
        material.dispose();
      });
    }
    expect(ids.size).toBe(CORE_BOSS_ABILITY_IDS.length);
  });
});
