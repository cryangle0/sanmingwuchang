import type { FiveElement } from '@jwgb/content';
import type { CoreBossAbilityId, MonsterKind } from '@jwgb/sim';
import * as THREE from 'three';
import {
  createHeroSkillVisual,
  type HeroSkillMotion,
  type HeroSkillStage,
  type HeroSkillVisual,
  type HeroSkillVfxProfile,
  updateHeroSkillVisual,
} from './hero-skill-vfx';

export const CORE_BOSS_ABILITY_IDS = [
  'ring-shockwave',
  'meteor',
  'earthbreak',
  'firelane',
  'poisonpool',
  'windcharge',
  'thunderchain',
  'mirrorshadow',
] as const satisfies readonly CoreBossAbilityId[];

const ELEMENT_COLORS: Readonly<Record<FiveElement, readonly [number, number, number]>> = {
  metal: [0xffe08a, 0xc9a24a, 0xfff6d2],
  wood: [0x6ee08a, 0x2f8a4c, 0xd7ffd8],
  water: [0x5ad4ff, 0x2a7ad4, 0xe4f7ff],
  fire: [0xff5a2c, 0xffb040, 0xfff0a8],
  earth: [0xd9a15c, 0x8a5a2c, 0xffe3b0],
};

interface MonsterSkillLook {
  readonly id: string;
  readonly motif: HeroSkillVfxProfile['motif'];
  readonly primary: number;
  readonly secondary: number;
  readonly core: number;
  readonly motion: HeroSkillMotion;
  readonly scale: number;
}

const KIND_LOOKS: Readonly<Record<MonsterKind, MonsterSkillLook>> = {
  'ground-melee': {
    id: 'M-MELEE',
    motif: 'golden-staff',
    primary: 0xff7a3a,
    secondary: 0xffd27a,
    core: 0xfff4d0,
    motion: 'forward',
    scale: 0.95,
  },
  'ground-ranged': {
    id: 'M-RANGED',
    motif: 'venom-stinger',
    primary: 0x9be24a,
    secondary: 0x5a2a88,
    core: 0xf5ff9a,
    motion: 'forward',
    scale: 0.9,
  },
  flying: {
    id: 'M-FLY',
    motif: 'golden-wings',
    primary: 0x7ad4ff,
    secondary: 0xe8f7ff,
    core: 0xffffff,
    motion: 'forward',
    scale: 1.12,
  },
  pig: {
    id: 'M-PIG',
    motif: 'coin-storm',
    primary: 0xf0b45a,
    secondary: 0xffe0a0,
    core: 0xfff6d8,
    motion: 'burst',
    scale: 1.05,
  },
  'elite-tank': {
    id: 'M-ELITE-TANK',
    motif: 'stone-arhat',
    primary: 0xc48a48,
    secondary: 0xffd48a,
    core: 0xfff0c8,
    motion: 'rise',
    scale: 1.28,
  },
  'elite-ranged': {
    id: 'M-ELITE-RANGED',
    motif: 'tiger-arrow',
    primary: 0xff8a3a,
    secondary: 0x7ad0ff,
    core: 0xfff2c4,
    motion: 'forward',
    scale: 1.18,
  },
  'dragon-king': {
    id: 'M-DRAGON',
    motif: 'white-dragon',
    primary: 0x3ad0ff,
    secondary: 0xffd46a,
    core: 0xf5ffff,
    motion: 'forward',
    scale: 1.45,
  },
  'core-boss': {
    id: 'M-BOSS',
    motif: 'heavenly-pagoda',
    primary: 0xff4a5a,
    secondary: 0xffd36a,
    core: 0xfff4d8,
    motion: 'burst',
    scale: 1.55,
  },
};

const BOSS_LOOKS: Readonly<Record<CoreBossAbilityId, MonsterSkillLook>> = {
  'ring-shockwave': {
    id: 'BOSS-RING',
    motif: 'lion-roar',
    primary: 0xffd56a,
    secondary: 0xff7a3a,
    core: 0xfff6d0,
    motion: 'burst',
    scale: 1.7,
  },
  meteor: {
    id: 'BOSS-METEOR',
    motif: 'samadhi-flame',
    primary: 0xff3a18,
    secondary: 0xffb02a,
    core: 0xfff0a0,
    motion: 'rise',
    scale: 1.62,
  },
  earthbreak: {
    id: 'BOSS-EARTH',
    motif: 'five-element-mountain',
    primary: 0xc47a38,
    secondary: 0xffd27a,
    core: 0xffe8b8,
    motion: 'rise',
    scale: 1.68,
  },
  firelane: {
    id: 'BOSS-FIRELANE',
    motif: 'fire-wheels',
    primary: 0xff4a1a,
    secondary: 0xffd040,
    core: 0xfff3b8,
    motion: 'forward',
    scale: 1.5,
  },
  poisonpool: {
    id: 'BOSS-POISON',
    motif: 'spider-web',
    primary: 0x6ad43a,
    secondary: 0x3a8848,
    core: 0xe8ff9a,
    motion: 'collapse',
    scale: 1.48,
  },
  windcharge: {
    id: 'BOSS-WIND',
    motif: 'divine-gale',
    primary: 0x9ae8ff,
    secondary: 0xffffff,
    core: 0xd8f8ff,
    motion: 'forward',
    scale: 1.42,
  },
  thunderchain: {
    id: 'BOSS-THUNDER',
    motif: 'celestial-eye',
    primary: 0x8ac8ff,
    secondary: 0xfff27a,
    core: 0xffffff,
    motion: 'burst',
    scale: 1.55,
  },
  mirrorshadow: {
    id: 'BOSS-MIRROR',
    motif: 'mirror-clones',
    primary: 0xc8a8ff,
    secondary: 0x6ad8ff,
    core: 0xffffff,
    motion: 'burst',
    scale: 1.4,
  },
};

function tintLook(look: MonsterSkillLook, element: FiveElement | null): MonsterSkillLook {
  if (!element) {
    return look;
  }
  const [primary, secondary, core] = ELEMENT_COLORS[element];
  return { ...look, primary, secondary, core };
}

function toProfile(look: MonsterSkillLook): HeroSkillVfxProfile {
  return {
    heroId: look.id,
    textureKey: look.id,
    motif: look.motif,
    primary: look.primary,
    secondary: look.secondary,
    core: look.core,
    motion: look.motion,
    scale: look.scale,
    castDurationSeconds: 0.62,
    impactDurationSeconds: 0.7,
    statusDurationSeconds: 1.4,
    targetPreview: false,
    persistentAura: false,
    audioPhases: ['cast', 'impact'],
  };
}

export function monsterAttackVfxProfile(
  kind: MonsterKind,
  element: FiveElement | null = null,
): HeroSkillVfxProfile {
  return toProfile(tintLook(KIND_LOOKS[kind], element));
}

export function coreBossAbilityVfxProfile(abilityId: CoreBossAbilityId): HeroSkillVfxProfile {
  return toProfile(BOSS_LOOKS[abilityId]);
}

export function createMonsterSkillVisual(
  profile: HeroSkillVfxProfile,
  stage: HeroSkillStage,
  reduced: boolean,
): HeroSkillVisual {
  const visual = createHeroSkillVisual(profile, stage, reduced);
  visual.group.name = `monster-skill-${profile.heroId.toLowerCase()}-${stage}`;
  decorateMonsterSignature(visual.group, profile, stage, reduced);
  const meshes: THREE.Mesh[] = [];
  visual.group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      meshes.push(child);
    }
  });
  visual.group.userData.animatedMeshes = meshes;
  return visual;
}

export { updateHeroSkillVisual as updateMonsterSkillVisual };

function glow(color: number, opacity: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.userData.baseOpacity = opacity;
  return material;
}

function decorateMonsterSignature(
  group: THREE.Group,
  profile: HeroSkillVfxProfile,
  stage: HeroSkillStage,
  reduced: boolean,
): void {
  const accent = glow(profile.primary, stage === 'status' ? 0.42 : 0.88);
  const flare = glow(profile.core, 0.95);
  (group.userData.heroSkillMaterials as THREE.MeshBasicMaterial[]).push(accent, flare);

  if (profile.heroId.startsWith('BOSS-')) {
    decorateBossSignature(group, profile, accent, flare, reduced);
    return;
  }

  switch (profile.heroId) {
    case 'M-MELEE':
      for (const offset of [-0.28, 0, 0.28]) {
        const slash = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 6, 28, Math.PI * 0.9), accent);
        slash.rotation.set(-0.55, offset, offset * 1.4);
        slash.position.set(offset * 0.4, 0.7, 0.35);
        slash.userData.spinZ = offset === 0 ? 8 : -8;
        slash.userData.baseRotation = slash.rotation.clone();
        slash.userData.basePosition = slash.position.clone();
        slash.userData.baseScale = slash.scale.clone();
        group.add(slash);
      }
      break;
    case 'M-RANGED': {
      const spit = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), flare);
      spit.position.set(0, 0.85, 1.15);
      spit.userData.pulse = 0.22;
      spit.userData.baseScale = spit.scale.clone();
      spit.userData.basePosition = spit.position.clone();
      spit.userData.baseRotation = spit.rotation.clone();
      group.add(spit);
      break;
    }
    case 'M-FLY':
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.CircleGeometry(0.72, 18, 0, Math.PI), accent);
        wing.position.set(side * 0.85, 1.05, 0);
        wing.rotation.set(0.2, side * 0.4, side * 0.7);
        wing.userData.pulse = 0.16;
        wing.userData.spinZ = side * 2.4;
        wing.userData.baseScale = wing.scale.clone();
        wing.userData.basePosition = wing.position.clone();
        wing.userData.baseRotation = wing.rotation.clone();
        group.add(wing);
      }
      break;
    case 'M-PIG': {
      const snout = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.12, 8, 20), accent);
      snout.position.y = 0.55;
      snout.rotation.x = Math.PI / 2;
      snout.userData.pulse = 0.18;
      snout.userData.spinZ = 5;
      snout.userData.baseScale = snout.scale.clone();
      snout.userData.basePosition = snout.position.clone();
      snout.userData.baseRotation = snout.rotation.clone();
      group.add(snout);
      break;
    }
    case 'M-ELITE-TANK': {
      const hammer = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.28, 0.55), flare);
      hammer.position.y = 1.35;
      hammer.userData.pulse = 0.1;
      hammer.userData.baseScale = hammer.scale.clone();
      hammer.userData.basePosition = hammer.position.clone();
      hammer.userData.baseRotation = hammer.rotation.clone();
      group.add(hammer);
      break;
    }
    case 'M-ELITE-RANGED': {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 6, 28, Math.PI), accent);
      bow.position.set(0, 0.9, 0.2);
      bow.rotation.y = Math.PI / 2;
      bow.userData.spinY = 2.2;
      bow.userData.baseScale = bow.scale.clone();
      bow.userData.basePosition = bow.position.clone();
      bow.userData.baseRotation = bow.rotation.clone();
      group.add(bow);
      break;
    }
    case 'M-DRAGON':
      for (let index = 0; index < (reduced ? 4 : 7); index += 1) {
        const jaw = new THREE.Mesh(
          new THREE.ConeGeometry(0.18 + index * 0.04, 0.7, 6),
          index % 2 === 0 ? accent : flare,
        );
        jaw.position.set(0, 0.7, 0.4 + index * 0.32);
        jaw.rotation.x = Math.PI / 2;
        jaw.userData.pulse = 0.08;
        jaw.userData.baseScale = jaw.scale.clone();
        jaw.userData.basePosition = jaw.position.clone();
        jaw.userData.baseRotation = jaw.rotation.clone();
        group.add(jaw);
      }
      break;
    default:
      break;
  }
}

function decorateBossSignature(
  group: THREE.Group,
  profile: HeroSkillVfxProfile,
  accent: THREE.MeshBasicMaterial,
  flare: THREE.MeshBasicMaterial,
  reduced: boolean,
): void {
  switch (profile.heroId) {
    case 'BOSS-RING':
      for (let index = 0; index < (reduced ? 3 : 5); index += 1) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1 + index * 0.45, 0.06, 6, 40), accent);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.08;
        ring.userData.shockRing = true;
        ring.userData.ringDelay = index * 0.12;
        ring.userData.ringReach = 2.8 - index * 0.2;
        group.add(ring);
      }
      break;
    case 'BOSS-METEOR':
      for (let index = 0; index < (reduced ? 3 : 5); index += 1) {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + index * 0.08, 0), flare);
        rock.position.set((index - 2) * 0.42, 2.2 - index * 0.18, -0.4);
        rock.userData.pulse = 0.14;
        rock.userData.baseScale = rock.scale.clone();
        rock.userData.basePosition = rock.position.clone();
        rock.userData.baseRotation = rock.rotation.clone();
        group.add(rock);
      }
      break;
    case 'BOSS-EARTH':
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.6, 5), accent);
        spike.position.set(Math.sin(angle) * 1.05, 0.7, Math.cos(angle) * 1.05);
        spike.userData.pulse = 0.08;
        spike.userData.baseScale = spike.scale.clone();
        spike.userData.basePosition = spike.position.clone();
        spike.userData.baseRotation = spike.rotation.clone();
        group.add(spike);
      }
      break;
    case 'BOSS-FIRELANE': {
      const lane = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 6.4), accent);
      lane.position.set(0, 0.12, 2.4);
      lane.userData.pulse = 0.12;
      lane.userData.baseScale = lane.scale.clone();
      lane.userData.basePosition = lane.position.clone();
      lane.userData.baseRotation = lane.rotation.clone();
      group.add(lane);
      break;
    }
    case 'BOSS-POISON':
      for (let index = 0; index < (reduced ? 5 : 8); index += 1) {
        const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.16 + (index % 3) * 0.06, 8, 6), flare);
        const angle = (index / 8) * Math.PI * 2;
        bubble.position.set(Math.sin(angle) * 0.9, 0.28 + (index % 3) * 0.2, Math.cos(angle) * 0.9);
        bubble.userData.pulse = 0.22;
        bubble.userData.orbitRadius = 0.2;
        bubble.userData.orbitSpeed = 2 + index * 0.2;
        bubble.userData.orbitPhase = angle;
        bubble.userData.baseScale = bubble.scale.clone();
        bubble.userData.basePosition = bubble.position.clone();
        bubble.userData.baseRotation = bubble.rotation.clone();
        group.add(bubble);
      }
      break;
    case 'BOSS-WIND': {
      const rush = new THREE.Mesh(new THREE.ConeGeometry(1.15, 3.4, 16, 1, true), accent);
      rush.position.set(0, 0.7, 1.4);
      rush.rotation.x = Math.PI / 2;
      rush.userData.spinZ = 9;
      rush.userData.baseScale = rush.scale.clone();
      rush.userData.basePosition = rush.position.clone();
      rush.userData.baseRotation = rush.rotation.clone();
      group.add(rush);
      break;
    }
    case 'BOSS-THUNDER':
      for (let index = 0; index < (reduced ? 4 : 7); index += 1) {
        const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), flare);
        bolt.position.set((index - 3) * 0.22, 1.1, index % 2 === 0 ? 0.2 : -0.15);
        bolt.rotation.z = (index - 3) * 0.18;
        bolt.userData.pulse = 0.28;
        bolt.userData.baseScale = bolt.scale.clone();
        bolt.userData.basePosition = bolt.position.clone();
        bolt.userData.baseRotation = bolt.rotation.clone();
        group.add(bolt);
      }
      break;
    case 'BOSS-MIRROR':
      for (const x of [-1.05, 1.05]) {
        const twin = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 8), accent);
        twin.position.set(x, 0.9, 0.15);
        twin.userData.pulse = 0.12;
        twin.userData.spinY = x > 0 ? 2 : -2;
        twin.userData.baseScale = twin.scale.clone();
        twin.userData.basePosition = twin.position.clone();
        twin.userData.baseRotation = twin.rotation.clone();
        group.add(twin);
      }
      break;
    default:
      break;
  }
}
