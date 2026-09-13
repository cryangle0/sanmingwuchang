import { type FiveElement, getHeroDefinition } from '@jwgb/content';
import type { EntityId, HeroId } from '@jwgb/core';
import type {
  ActiveProjectileSnapshot,
  ActiveTargetEffectSnapshot,
  ActiveZoneSnapshot,
  CoreBossHazardSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  SimEvent,
  WorldSnapshot,
} from '@jwgb/sim';
import * as THREE from 'three';
import {
  createHeroSkillVisual,
  createHeroSkillZoneSigil,
  type HeroSkillVfxProfile,
  heroSkillSigilMaterials,
  heroSkillVfxProfile,
  placeHeroSkillVisual,
  softDisc,
  softRing,
  updateHeroSkillVisual,
} from './hero-skill-vfx';
import {
  coreBossAbilityVfxProfile,
  createMonsterSkillVisual,
  monsterAttackVfxProfile,
  updateMonsterSkillVisual,
} from './monster-skill-vfx';

type GraphicsTier = 'balanced' | 'reduced';
type TransientEffectKind =
  | 'melee-sweep'
  | 'muzzle'
  | 'impact'
  | 'critical'
  | 'cast'
  | 'heal'
  | 'hero-skill'
  | 'monster-skill';
type ActiveZoneKind = ActiveZoneSnapshot['kind'];

interface ActiveProjectileVisual {
  readonly kind: ActiveProjectileSnapshot['kind'];
  readonly activeId: string;
  readonly group: THREE.Group;
  readonly materials: readonly THREE.MeshBasicMaterial[];
  readonly motif: THREE.Group | null;
}

interface ActiveZoneVisual {
  readonly kind: ActiveZoneKind;
  readonly activeId: string;
  readonly shape: 'area' | 'wall' | 'ring';
  readonly group: THREE.Group;
  readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly border: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly marker: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
  readonly sigil: THREE.Group | null;
  readonly sigilMaterials: readonly THREE.MeshBasicMaterial[];
  readonly baseSurfaceOpacity: number;
  readonly baseBorderOpacity: number;
  readonly baseMarkerOpacity: number;
}

interface ActiveTargetEffectVisual {
  readonly activeId: string;
  readonly kind: ActiveTargetEffectSnapshot['kind'];
  readonly group: THREE.Group;
  readonly materials: readonly THREE.MeshBasicMaterial[];
}

interface HeroAuraVisual {
  readonly activeId: string;
  readonly group: THREE.Group;
  readonly materials: readonly THREE.MeshBasicMaterial[];
}

interface CoreBossHazardVisual {
  readonly abilityId: string;
  readonly warning: boolean;
  readonly group: THREE.Group;
  readonly materials: readonly THREE.MeshBasicMaterial[];
}

interface TransientCombatEffect {
  readonly kind: TransientEffectKind;
  readonly group: THREE.Group;
  readonly materials: readonly THREE.MeshBasicMaterial[];
  readonly startedAtSeconds: number;
  readonly durationSeconds: number;
}

interface EffectPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly surfaceY: number;
}

export type CombatSurfaceHeightAt = (xMeters: number, zMeters: number) => number;

export interface CombatEffectDiagnostics {
  readonly activeProjectiles: number;
  readonly activeZones: number;
  readonly activeZoneKinds: Readonly<Record<string, number>>;
  readonly activeTargetEffects: number;
  readonly activeHeroAuras: number;
  readonly transientEffects: number;
  readonly transientLimit: number;
  readonly basicAttackEffectsSpawned: number;
  readonly activeCastEffectsSpawned: number;
  readonly heroSkillCastsSpawned: number;
  readonly heroSkillImpactsSpawned: number;
  readonly monsterSkillCastsSpawned: number;
  readonly coreBossHazards: number;
  readonly impactEffectsSpawned: number;
  readonly lastAttackHeroId: string | null;
  readonly lastSkillHeroId: string | null;
  readonly lastMonsterKind: string | null;
}

interface ZoneStyle {
  readonly color: number;
  readonly accent: number;
  readonly surfaceOpacity: number;
  readonly borderOpacity: number;
  readonly markerOpacity: number;
}

const ELEMENT_EFFECT_COLORS: Readonly<Record<FiveElement, number>> = {
  metal: 0xf1cb72,
  wood: 0x72d58e,
  water: 0x63cbe8,
  fire: 0xff754f,
  earth: 0xd7a75d,
};
const BALANCED_EFFECT_CULL_DISTANCE_METERS = 60;
const REDUCED_EFFECT_CULL_DISTANCE_METERS = 45;
const BALANCED_TRANSIENT_EFFECT_LIMIT = 72;
const REDUCED_TRANSIENT_EFFECT_LIMIT = 36;

const ACTIVE_PROJECTILE_COLORS: Readonly<
  Record<ActiveProjectileSnapshot['kind'], readonly [number, number]>
> = {
  'line-damage': [0xffb14f, 0xffe09a],
  root: [0x54c982, 0xb9f4c9],
  hook: [0xd8b36c, 0xffe1a0],
  polymorph: [0xd98ce7, 0xf8c9ff],
};

const ACTIVE_ZONE_STYLES: Readonly<Record<ActiveZoneKind, ZoneStyle>> = {
  'fire-wall': {
    color: 0xf24e2e,
    accent: 0xffc15a,
    surfaceOpacity: 0.36,
    borderOpacity: 0.88,
    markerOpacity: 0.2,
  },
  'damage-slow': {
    color: 0x4a8cc7,
    accent: 0x9cd9ff,
    surfaceOpacity: 0.18,
    borderOpacity: 0.75,
    markerOpacity: 0.1,
  },
  'spreading-poison': {
    color: 0x6ca93c,
    accent: 0xc2e86f,
    surfaceOpacity: 0.2,
    borderOpacity: 0.72,
    markerOpacity: 0.12,
  },
  'delayed-strike': {
    color: 0xd95940,
    accent: 0xffd374,
    surfaceOpacity: 0.16,
    borderOpacity: 0.94,
    markerOpacity: 0.2,
  },
  'delayed-target-strike': {
    color: 0xc94855,
    accent: 0xffb66f,
    surfaceOpacity: 0.17,
    borderOpacity: 0.94,
    markerOpacity: 0.22,
  },
  'area-pull': {
    color: 0x7656bd,
    accent: 0xc6a6ff,
    surfaceOpacity: 0.2,
    borderOpacity: 0.82,
    markerOpacity: 0.18,
  },
  'decoy-bomb': {
    color: 0xd16c34,
    accent: 0xffd56a,
    surfaceOpacity: 0.18,
    borderOpacity: 0.84,
    markerOpacity: 0.22,
  },
  silence: {
    color: 0x655a82,
    accent: 0xcab9ec,
    surfaceOpacity: 0.2,
    borderOpacity: 0.82,
    markerOpacity: 0.14,
  },
  'lifesteal-aura': {
    color: 0x9a3149,
    accent: 0xf38aa2,
    surfaceOpacity: 0.18,
    borderOpacity: 0.76,
    markerOpacity: 0.12,
  },
  healing: {
    color: 0x3da66c,
    accent: 0xa7f0bd,
    surfaceOpacity: 0.18,
    borderOpacity: 0.82,
    markerOpacity: 0.15,
  },
  'ring-wall': {
    color: 0xc99842,
    accent: 0xffdfa0,
    surfaceOpacity: 0.28,
    borderOpacity: 0.9,
    markerOpacity: 0.2,
  },
  'displacement-lock': {
    color: 0x8a6a55,
    accent: 0xf0b88e,
    surfaceOpacity: 0.2,
    borderOpacity: 0.82,
    markerOpacity: 0.16,
  },
  'ice-wall': {
    color: 0x58b7dc,
    accent: 0xc8f4ff,
    surfaceOpacity: 0.32,
    borderOpacity: 0.9,
    markerOpacity: 0.2,
  },
  smoke: {
    color: 0x697270,
    accent: 0xc2ccca,
    surfaceOpacity: 0.14,
    borderOpacity: 0.5,
    markerOpacity: 0.1,
  },
  trap: {
    color: 0xad7041,
    accent: 0xf0c27a,
    surfaceOpacity: 0.18,
    borderOpacity: 0.88,
    markerOpacity: 0.16,
  },
};

function worldMeters(millimeters: number): number {
  return millimeters / 1_000;
}

export function effectColorForElement(element: FiveElement): number {
  return ELEMENT_EFFECT_COLORS[element];
}

/**
 * Basic-attack silhouettes. Thirty-eight heroes on two swing shapes read as
 * one hero; the skill motif each hero already owns picks a weapon family, and
 * that family changes the geometry of the strike, not just its tint:
 *
 * - `blade`  a single long crescent (staffs, glaives, fans)
 * - `claw`   three short parallel rakes (beasts, spiders, demons)
 * - `heavy`  a ground slam with a shock ring and debris (hammers, rakes, stone)
 * - `mystic` a rotating sigil ring with a sparkle (monks, sages, spirits)
 * - `bolt`   a straight bright dart (arrows, needles)
 * - `orb`    a swelling sphere that bursts into motes (spells, gourds, seals)
 * - `wave`   a wide fan/crescent that fans out (fans, gales, water)
 * - `flame`  a rising flicker of tongues (fire, furnaces)
 */
export type BasicAttackStyle =
  | 'blade'
  | 'claw'
  | 'heavy'
  | 'mystic'
  | 'bolt'
  | 'orb'
  | 'wave'
  | 'flame';

const MELEE_STYLE_BY_MOTIF: Readonly<Record<string, BasicAttackStyle>> = {
  'golden-staff': 'blade',
  'nine-tooth-rake': 'heavy',
  'fire-wheels': 'blade',
  'demon-cyclone': 'claw',
  'spider-web': 'claw',
  'venom-stinger': 'claw',
  'nine-head-miasma': 'claw',
  'lion-roar': 'claw',
  'black-wind': 'claw',
  'ram-spirit': 'heavy',
  'stone-arhat': 'heavy',
  'five-element-mountain': 'heavy',
  'elephant-bind': 'heavy',
  'vajra-ring': 'mystic',
  'golden-kasaya': 'mystic',
  'wisdom-seal': 'mystic',
  'vow-lotus': 'mystic',
  'bone-soul': 'mystic',
  'mirror-clones': 'blade',
  'golden-wings': 'blade',
  'white-dragon': 'blade',
  'tiger-arrow': 'blade',
  'deer-blood': 'claw',
  'heavenly-pagoda': 'heavy',
  'moon-chains': 'mystic',
};

const RANGED_STYLE_BY_MOTIF: Readonly<Record<string, BasicAttackStyle>> = {
  'fan-gale': 'wave',
  'divine-gale': 'wave',
  'frozen-river': 'wave',
  'willow-dew': 'wave',
  'samadhi-flame': 'flame',
  'trigram-furnace': 'flame',
  'purple-smoke': 'flame',
  'thousand-eyes': 'orb',
  'celestial-eye': 'orb',
  'purple-gourd': 'orb',
  'coin-storm': 'orb',
  'universe-sleeve': 'orb',
  quicksand: 'orb',
  'mirror-clones': 'orb',
  'tiger-arrow': 'bolt',
  'moon-chains': 'bolt',
  'venom-stinger': 'bolt',
  'white-dragon': 'bolt',
};

export function basicAttackStyleForHero(heroId: HeroId): BasicAttackStyle {
  const hero = getHeroDefinition(heroId);
  const motif = heroSkillVfxProfile(heroId)?.motif ?? '';
  if (hero.basicAttackKind === 'melee') {
    return MELEE_STYLE_BY_MOTIF[motif] ?? 'blade';
  }
  return RANGED_STYLE_BY_MOTIF[motif] ?? 'bolt';
}

export function combatEffectProfileForHero(heroId: HeroId): {
  readonly heroId: HeroId;
  readonly attackKind: 'melee' | 'ranged-projectile';
  readonly color: number;
  readonly secondary: number;
  readonly style: BasicAttackStyle;
} {
  const hero = getHeroDefinition(heroId);
  const skill = heroSkillVfxProfile(heroId);
  return {
    heroId,
    attackKind: hero.basicAttackKind,
    // The hero's own skill palette carries over to the basic strike so the
    // whole kit reads as one character; element colour is the fallback.
    color: skill?.primary ?? effectColorForElement(hero.element),
    secondary: skill?.secondary ?? 0xfff6dc,
    style: basicAttackStyleForHero(heroId),
  };
}

function createGlowMaterial(
  color: number,
  opacity: number,
  map: THREE.Texture | null = null,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    // See hero-skill-vfx: additive light must skip filmic tone mapping.
    toneMapped: false,
    ...(map ? { map } : {}),
  });
  material.userData.baseOpacity = opacity;
  return material;
}

function disposeGroup(group: THREE.Group): void {
  group.userData.disposeRequested = true;
  group.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((child) => {
    // Points and Lines own a geometry and a material exactly as a Mesh does.
    // Testing only for Mesh leaked both for every particle system in a visual.
    const drawable = child as Partial<THREE.Mesh>;
    if (!drawable.geometry || !drawable.material) {
      return;
    }
    geometries.add(drawable.geometry);
    const childMaterials = Array.isArray(drawable.material)
      ? drawable.material
      : [drawable.material];
    for (const material of childMaterials) {
      materials.add(material);
    }
  });
  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
}

function entityPositions(
  snapshot: WorldSnapshot,
  surfaceHeightAt: CombatSurfaceHeightAt,
): ReadonlyMap<EntityId, EffectPosition> {
  const positions = new Map<EntityId, EffectPosition>();
  for (const player of snapshot.players) {
    const x = worldMeters(player.position.x);
    const z = worldMeters(player.position.z);
    const surfaceY = surfaceHeightAt(x, z);
    positions.set(player.entityId, {
      x,
      y: surfaceY + (player.lifeState === 'soul-flight' ? 3.2 : 1.05),
      z,
      surfaceY,
    });
  }
  for (const monster of snapshot.monsters) {
    const x = worldMeters(monster.position.x);
    const z = worldMeters(monster.position.z);
    const surfaceY = surfaceHeightAt(x, z);
    positions.set(monster.entityId, {
      x,
      y: surfaceY + Math.max(0.7, worldMeters(monster.collisionRadiusMm) * 1.25),
      z,
      surfaceY,
    });
  }
  for (const summon of snapshot.summons) {
    const x = worldMeters(summon.position.x);
    const z = worldMeters(summon.position.z);
    const surfaceY = surfaceHeightAt(x, z);
    positions.set(summon.entityId, {
      x,
      y: surfaceY + (summon.kind === 'stone-statue' ? 1.2 : 0.8),
      z,
      surfaceY,
    });
  }
  for (const zone of snapshot.activeZones) {
    const x = worldMeters(zone.center.x);
    const z = worldMeters(zone.center.z);
    const surfaceY = surfaceHeightAt(x, z);
    positions.set(zone.entityId, {
      x,
      y: surfaceY + 0.3,
      z,
      surfaceY,
    });
  }
  return positions;
}

function zoneShape(kind: ActiveZoneKind): ActiveZoneVisual['shape'] {
  if (kind === 'fire-wall' || kind === 'ice-wall') {
    return 'wall';
  }
  return kind === 'ring-wall' ? 'ring' : 'area';
}

export class CombatEffectsLayer {
  private readonly root = new THREE.Group();
  private readonly activeProjectileVisuals = new Map<EntityId, ActiveProjectileVisual>();
  private readonly activeZoneVisuals = new Map<EntityId, ActiveZoneVisual>();
  private readonly activeTargetEffectVisuals = new Map<string, ActiveTargetEffectVisual>();
  private readonly heroAuraVisuals = new Map<EntityId, HeroAuraVisual>();
  private readonly coreBossHazardVisuals = new Map<EntityId, CoreBossHazardVisual>();
  private readonly transientEffects: TransientCombatEffect[] = [];
  private graphicsTier: GraphicsTier;
  private basicAttackEffectsSpawned = 0;
  private activeCastEffectsSpawned = 0;
  private heroSkillCastsSpawned = 0;
  private heroSkillImpactsSpawned = 0;
  private monsterSkillCastsSpawned = 0;
  private impactEffectsSpawned = 0;
  private lastAttackHeroId: string | null = null;
  private lastSkillHeroId: string | null = null;
  private lastMonsterKind: string | null = null;
  private readonly focusPosition = new THREE.Vector2();
  private hasFocusPosition = false;

  constructor(
    private readonly scene: THREE.Scene,
    graphicsTier: GraphicsTier,
    private readonly surfaceHeightAt: CombatSurfaceHeightAt = () => 0,
  ) {
    this.graphicsTier = graphicsTier;
    this.root.name = 'combat-effects';
    scene.add(this.root);
  }

  setGraphicsTier(tier: GraphicsTier): void {
    this.graphicsTier = tier;
    this.trimTransientEffects();
  }

  update(
    snapshot: WorldSnapshot,
    events: readonly SimEvent[],
    elapsedSeconds: number,
    focusPositionMm: PlayerSnapshot['position'] | null = null,
  ): void {
    this.hasFocusPosition = focusPositionMm !== null;
    if (focusPositionMm) {
      this.focusPosition.set(worldMeters(focusPositionMm.x), worldMeters(focusPositionMm.z));
    }
    const positions = entityPositions(snapshot, this.surfaceHeightAt);
    this.syncActiveProjectiles(snapshot.activeProjectiles, elapsedSeconds);
    this.syncActiveZones(snapshot.activeZones, snapshot.tick, elapsedSeconds);
    this.syncActiveTargetEffects(snapshot, positions, elapsedSeconds);
    this.syncHeroAuras(snapshot.players, elapsedSeconds);
    this.syncCoreBossHazards(snapshot.coreBossHazards ?? [], snapshot.tick, elapsedSeconds);
    this.processEvents(snapshot, positions, events, elapsedSeconds);
    this.updateTransientEffects(elapsedSeconds);
  }

  getDiagnostics(): CombatEffectDiagnostics {
    const activeZoneKinds: Record<string, number> = {};
    for (const visual of this.activeZoneVisuals.values()) {
      activeZoneKinds[visual.kind] = (activeZoneKinds[visual.kind] ?? 0) + 1;
    }
    return {
      activeProjectiles: this.activeProjectileVisuals.size,
      activeZones: this.activeZoneVisuals.size,
      activeZoneKinds,
      activeTargetEffects: this.activeTargetEffectVisuals.size,
      activeHeroAuras: this.heroAuraVisuals.size,
      transientEffects: this.transientEffects.length,
      transientLimit: this.transientLimit,
      basicAttackEffectsSpawned: this.basicAttackEffectsSpawned,
      activeCastEffectsSpawned: this.activeCastEffectsSpawned,
      heroSkillCastsSpawned: this.heroSkillCastsSpawned,
      heroSkillImpactsSpawned: this.heroSkillImpactsSpawned,
      monsterSkillCastsSpawned: this.monsterSkillCastsSpawned,
      coreBossHazards: this.coreBossHazardVisuals.size,
      impactEffectsSpawned: this.impactEffectsSpawned,
      lastAttackHeroId: this.lastAttackHeroId,
      lastSkillHeroId: this.lastSkillHeroId,
      lastMonsterKind: this.lastMonsterKind,
    };
  }

  dispose(): void {
    for (const visual of this.activeProjectileVisuals.values()) {
      disposeGroup(visual.group);
    }
    for (const visual of this.activeZoneVisuals.values()) {
      disposeGroup(visual.group);
    }
    for (const visual of this.activeTargetEffectVisuals.values()) {
      disposeGroup(visual.group);
    }
    for (const visual of this.heroAuraVisuals.values()) {
      disposeGroup(visual.group);
    }
    for (const visual of this.coreBossHazardVisuals.values()) {
      disposeGroup(visual.group);
    }
    for (const effect of this.transientEffects) {
      disposeGroup(effect.group);
    }
    this.activeProjectileVisuals.clear();
    this.activeZoneVisuals.clear();
    this.activeTargetEffectVisuals.clear();
    this.heroAuraVisuals.clear();
    this.coreBossHazardVisuals.clear();
    this.transientEffects.length = 0;
    this.scene.remove(this.root);
  }

  private get transientLimit(): number {
    return this.graphicsTier === 'reduced'
      ? REDUCED_TRANSIENT_EFFECT_LIMIT
      : BALANCED_TRANSIENT_EFFECT_LIMIT;
  }

  private isWithinEffectRange(
    position: { readonly x: number; readonly z: number },
    padding = 0,
  ): boolean {
    if (!this.hasFocusPosition) {
      return true;
    }
    const distance =
      (this.graphicsTier === 'reduced'
        ? REDUCED_EFFECT_CULL_DISTANCE_METERS
        : BALANCED_EFFECT_CULL_DISTANCE_METERS) + padding;
    const dx = position.x - this.focusPosition.x;
    const dz = position.z - this.focusPosition.y;
    return dx * dx + dz * dz <= distance * distance;
  }

  private isWithinEffectRangeMm(
    position: { readonly x: number; readonly z: number },
    paddingMm = 0,
  ): boolean {
    return this.isWithinEffectRange(
      { x: worldMeters(position.x), z: worldMeters(position.z) },
      worldMeters(paddingMm),
    );
  }

  private syncActiveProjectiles(
    projectiles: readonly ActiveProjectileSnapshot[],
    elapsedSeconds: number,
  ): void {
    const visibleProjectiles = projectiles.filter((projectile) =>
      this.isWithinEffectRangeMm(projectile.position),
    );
    const currentIds = new Set(visibleProjectiles.map((projectile) => projectile.entityId));
    for (const [entityId, visual] of this.activeProjectileVisuals) {
      if (!currentIds.has(entityId)) {
        disposeGroup(visual.group);
        this.activeProjectileVisuals.delete(entityId);
      }
    }
    for (const projectile of visibleProjectiles) {
      let visual = this.activeProjectileVisuals.get(projectile.entityId);
      if (
        visual &&
        (visual.kind !== projectile.kind || visual.activeId !== String(projectile.activeId))
      ) {
        disposeGroup(visual.group);
        this.activeProjectileVisuals.delete(projectile.entityId);
        visual = undefined;
      }
      visual ??= this.createActiveProjectileVisual(projectile);
      this.updateActiveProjectileVisual(visual, projectile, elapsedSeconds);
    }
  }

  private createActiveProjectileVisual(
    projectile: ActiveProjectileSnapshot,
  ): ActiveProjectileVisual {
    const group = new THREE.Group();
    const activeId = String(projectile.activeId);
    const profile = heroSkillVfxProfile(activeId);
    group.name = `active-projectile-${activeId.toLowerCase()}-${projectile.kind}`;
    const fallbackColors = ACTIVE_PROJECTILE_COLORS[projectile.kind];
    const color = profile?.primary ?? fallbackColors[0];
    const accent = profile?.secondary ?? fallbackColors[1];
    const coreMaterial = createGlowMaterial(color, 0.92);
    const trailMaterial = createGlowMaterial(accent, 0.34);
    const haloMaterial = createGlowMaterial(profile?.core ?? accent, 0.72);
    const radius = Math.max(0.14, worldMeters(projectile.collisionRadiusMm));

    const coreGeometry =
      profile?.motif === 'tiger-arrow'
        ? new THREE.ConeGeometry(radius * 1.35, 1.25, 6)
        : profile?.motif === 'elephant-bind'
          ? new THREE.TorusGeometry(radius * 1.2, radius * 0.28, 6, 18, Math.PI * 1.5)
          : projectile.kind === 'line-damage'
            ? new THREE.CapsuleGeometry(radius * 0.72, 0.85, 4, 8)
            : projectile.kind === 'hook'
              ? new THREE.ConeGeometry(radius * 1.45, 0.78, 10)
              : projectile.kind === 'root'
                ? new THREE.OctahedronGeometry(radius * 1.45, 0)
                : new THREE.IcosahedronGeometry(radius * 1.35, 1);
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.rotation.x = Math.PI / 2;
    group.add(core);

    const trail = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.18, radius * 0.68, 1.25, 8, 1, true),
      trailMaterial,
    );
    trail.rotation.x = Math.PI / 2;
    trail.position.z = -0.72;
    group.add(trail);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.25, radius * 1.85, 20),
      haloMaterial,
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.24;
    group.add(halo);

    let motif: THREE.Group | null = null;
    let motifMaterials: readonly THREE.MeshBasicMaterial[] = [];
    if (profile) {
      const motifVisual = createHeroSkillVisual(profile, 'impact', this.graphicsTier === 'reduced');
      motif = motifVisual.group;
      motif.name = `projectile-signature-${activeId.toLowerCase()}`;
      motif.scale.setScalar(0.24);
      motif.position.z = -0.2;
      motifMaterials = motifVisual.materials;
      group.add(motif);
    }

    this.root.add(group);
    const visual: ActiveProjectileVisual = {
      kind: projectile.kind,
      activeId,
      group,
      materials: [coreMaterial, trailMaterial, haloMaterial, ...motifMaterials],
      motif,
    };
    this.activeProjectileVisuals.set(projectile.entityId, visual);
    return visual;
  }

  private updateActiveProjectileVisual(
    visual: ActiveProjectileVisual,
    projectile: ActiveProjectileSnapshot,
    elapsedSeconds: number,
  ): void {
    const x = worldMeters(projectile.position.x);
    const z = worldMeters(projectile.position.z);
    visual.group.position.set(x, this.surfaceHeightAt(x, z) + 1.05, z);
    visual.group.rotation.y = Math.atan2(projectile.direction.x, projectile.direction.z);
    const pulse = 0.94 + Math.sin(elapsedSeconds * 18 + Number(projectile.entityId)) * 0.08;
    visual.group.scale.setScalar(pulse);
    if (visual.motif) {
      visual.motif.rotation.y = elapsedSeconds * 4.5;
      visual.motif.rotation.z = elapsedSeconds * 2.2;
    }
  }

  private syncActiveZones(
    zones: readonly ActiveZoneSnapshot[],
    currentTick: number,
    elapsedSeconds: number,
  ): void {
    const visibleZones = zones.filter((zone) =>
      this.isWithinEffectRangeMm(zone.center, Math.max(zone.radiusMm, zone.lengthMm / 2)),
    );
    const currentIds = new Set(visibleZones.map((zone) => zone.entityId));
    for (const [entityId, visual] of this.activeZoneVisuals) {
      if (!currentIds.has(entityId)) {
        disposeGroup(visual.group);
        this.activeZoneVisuals.delete(entityId);
      }
    }
    for (const zone of visibleZones) {
      let visual = this.activeZoneVisuals.get(zone.entityId);
      if (visual && (visual.kind !== zone.kind || visual.activeId !== String(zone.activeId))) {
        disposeGroup(visual.group);
        this.activeZoneVisuals.delete(zone.entityId);
        visual = undefined;
      }
      visual ??= this.createActiveZoneVisual(zone);
      this.updateActiveZoneVisual(visual, zone, currentTick, elapsedSeconds);
    }
  }

  private createActiveZoneVisual(zone: ActiveZoneSnapshot): ActiveZoneVisual {
    const activeId = String(zone.activeId);
    const profile = heroSkillVfxProfile(activeId);
    const baseStyle = ACTIVE_ZONE_STYLES[zone.kind];
    const style: ZoneStyle = profile
      ? {
          ...baseStyle,
          color: profile.primary,
          accent: profile.secondary,
          markerOpacity: Math.max(baseStyle.markerOpacity, 0.18),
        }
      : baseStyle;
    const shape = zoneShape(zone.kind);
    const group = new THREE.Group();
    group.name = `active-zone-${activeId.toLowerCase()}-${zone.kind}`;
    const surfaceMaterial = createGlowMaterial(style.color, style.surfaceOpacity);
    const borderMaterial = createGlowMaterial(style.accent, style.borderOpacity);
    const markerMaterial = createGlowMaterial(profile?.core ?? style.accent, style.markerOpacity);

    let surface: ActiveZoneVisual['surface'];
    let border: ActiveZoneVisual['border'];
    let marker: ActiveZoneVisual['marker'];
    if (shape === 'wall') {
      surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), surfaceMaterial);
      surface.position.y = 1.2;
      border = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 1), borderMaterial);
      border.position.y = 0.11;
      marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), markerMaterial);
      marker.position.y = 1.2;
      marker.position.z = -0.04;
    } else if (shape === 'ring') {
      surface = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 48), surfaceMaterial);
      surface.rotation.x = -Math.PI / 2;
      surface.position.y = 0.11;
      border = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.04, 48), borderMaterial);
      border.rotation.x = -Math.PI / 2;
      border.position.y = 0.13;
      marker = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.9, 48, 1, true), markerMaterial);
      marker.position.y = 0.48;
    } else {
      surface = new THREE.Mesh(new THREE.CircleGeometry(1, 40), surfaceMaterial);
      surface.rotation.x = -Math.PI / 2;
      surface.position.y = 0.1;
      border = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), borderMaterial);
      border.rotation.x = -Math.PI / 2;
      border.position.y = 0.125;
      marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.72, 0.92, 0.8, 32, 1, true),
        markerMaterial,
      );
      marker.position.y = 0.45;
    }
    group.add(surface, border);
    if (marker) {
      group.add(marker);
    }
    const sigil = profile
      ? createHeroSkillZoneSigil(profile, this.graphicsTier === 'reduced')
      : null;
    const sigilMaterials = sigil ? heroSkillSigilMaterials(sigil) : [];
    if (sigil) {
      sigil.position.y = 0.14;
      group.add(sigil);
    }
    this.root.add(group);
    const visual: ActiveZoneVisual = {
      kind: zone.kind,
      activeId,
      shape,
      group,
      surface,
      border,
      marker,
      sigil,
      sigilMaterials,
      baseSurfaceOpacity: style.surfaceOpacity,
      baseBorderOpacity: style.borderOpacity,
      baseMarkerOpacity: style.markerOpacity,
    };
    this.activeZoneVisuals.set(zone.entityId, visual);
    return visual;
  }

  private updateActiveZoneVisual(
    visual: ActiveZoneVisual,
    zone: ActiveZoneSnapshot,
    currentTick: number,
    elapsedSeconds: number,
  ): void {
    const x = worldMeters(zone.center.x);
    const z = worldMeters(zone.center.z);
    visual.group.position.set(x, this.surfaceHeightAt(x, z), z);
    visual.group.rotation.y = Math.atan2(zone.direction.x, zone.direction.z);
    const warning = currentTick < zone.activatesAtTick;
    const warningFactor = warning ? 0.48 : 1;
    const pulse =
      1 + Math.sin(elapsedSeconds * (warning ? 7 : 3.5) + Number(zone.entityId)) * 0.045;
    visual.surface.material.opacity = visual.baseSurfaceOpacity * warningFactor;
    visual.border.material.opacity =
      visual.baseBorderOpacity * (warning ? 0.72 + Math.sin(elapsedSeconds * 8) * 0.18 : 1);
    if (visual.marker) {
      visual.marker.material.opacity = visual.baseMarkerOpacity * warningFactor;
    }
    for (const material of visual.sigilMaterials) {
      const baseOpacity =
        typeof material.userData.baseOpacity === 'number' ? material.userData.baseOpacity : 0.35;
      material.opacity = baseOpacity * warningFactor;
    }
    if (visual.sigil) {
      visual.sigil.rotation.y = elapsedSeconds * (warning ? 1.8 : 0.75);
    }

    if (visual.shape === 'wall') {
      const length = Math.max(1.5, worldMeters(zone.lengthMm || zone.radiusMm * 2));
      const height = zone.kind === 'ice-wall' ? 2.7 : 2.35;
      visual.surface.scale.set(length, height * pulse, 1);
      visual.border.scale.set(length, 1, Math.max(0.55, worldMeters(zone.radiusMm) * 0.22));
      if (visual.marker) {
        visual.marker.scale.set(length * 0.96, height * 0.78 * pulse, 1);
      }
      if (visual.sigil) {
        visual.sigil.scale.set(length * 0.24, 1, Math.max(1.2, worldMeters(zone.radiusMm) * 0.5));
      }
      visual.group.scale.setScalar(1);
      return;
    }

    const radius = Math.max(
      0.9,
      worldMeters(zone.radiusMm > 0 ? zone.radiusMm : zone.triggerRadiusMm),
    );
    visual.surface.scale.setScalar(radius);
    visual.border.scale.setScalar(radius);
    if (visual.marker) {
      const markerScale =
        zone.kind === 'delayed-strike' || zone.kind === 'delayed-target-strike'
          ? radius * 0.32
          : radius * 0.76;
      visual.marker.scale.set(markerScale, zone.kind === 'smoke' ? 2.1 : 1, markerScale);
    }
    if (visual.sigil) {
      visual.sigil.scale.setScalar(radius * 0.68);
    }
    visual.group.scale.setScalar(pulse);
    visual.group.rotation.z = 0;
    if (zone.kind === 'area-pull' || zone.kind === 'spreading-poison') {
      visual.group.rotation.y += elapsedSeconds * 0.08;
    }
  }

  private syncActiveTargetEffects(
    snapshot: WorldSnapshot,
    positions: ReadonlyMap<EntityId, EffectPosition>,
    elapsedSeconds: number,
  ): void {
    const visibleEffects = (snapshot.activeTargetEffects ?? []).filter((effect) => {
      const position = positions.get(effect.targetEntityId);
      return (
        heroSkillVfxProfile(String(effect.activeId)) !== null &&
        position !== undefined &&
        this.isWithinEffectRange(position)
      );
    });
    const currentKeys = new Set(visibleEffects.map((effect) => effect.key));
    for (const [key, visual] of this.activeTargetEffectVisuals) {
      if (!currentKeys.has(key)) {
        disposeGroup(visual.group);
        this.activeTargetEffectVisuals.delete(key);
      }
    }

    for (const effect of visibleEffects) {
      const activeId = String(effect.activeId);
      const profile = heroSkillVfxProfile(activeId);
      const position = positions.get(effect.targetEntityId);
      if (!profile || !position) {
        continue;
      }
      let visual = this.activeTargetEffectVisuals.get(effect.key);
      if (visual && (visual.activeId !== activeId || visual.kind !== effect.kind)) {
        disposeGroup(visual.group);
        this.activeTargetEffectVisuals.delete(effect.key);
        visual = undefined;
      }
      if (!visual) {
        const created = createHeroSkillVisual(profile, 'status', this.graphicsTier === 'reduced');
        created.group.name = `active-target-${activeId.toLowerCase()}-${effect.kind}`;
        created.group.userData.baseScale = profile.scale * 0.72;
        this.root.add(created.group);
        visual = {
          activeId,
          kind: effect.kind,
          group: created.group,
          materials: created.materials,
        };
        this.activeTargetEffectVisuals.set(effect.key, visual);
      }

      placeHeroSkillVisual(visual.group, position.x, position.surfaceY + 0.06, position.z);
      visual.group.userData.baseScale = profile.scale * (0.68 + Math.min(effect.stacks, 6) * 0.045);
      updateHeroSkillVisual(visual.group, 0.5, elapsedSeconds);
      const remainingRatio =
        effect.expiresAtTick > snapshot.tick
          ? Math.min(1, Math.max(0.28, (effect.expiresAtTick - snapshot.tick) / 40))
          : 0.28;
      for (const material of visual.materials) {
        const baseOpacity =
          typeof material.userData.baseOpacity === 'number' ? material.userData.baseOpacity : 0.5;
        material.opacity =
          baseOpacity *
          remainingRatio *
          (0.86 + Math.sin(elapsedSeconds * 7 + effect.stacks) * 0.14);
      }
    }
  }

  private syncHeroAuras(players: readonly PlayerSnapshot[], elapsedSeconds: number): void {
    const activePlayers = players.filter(
      (player) => this.hasPersistentHeroAura(player) && this.isWithinEffectRangeMm(player.position),
    );
    const currentIds = new Set(activePlayers.map((player) => player.entityId));
    for (const [entityId, visual] of this.heroAuraVisuals) {
      if (!currentIds.has(entityId)) {
        disposeGroup(visual.group);
        this.heroAuraVisuals.delete(entityId);
      }
    }

    for (const player of activePlayers) {
      const activeId =
        String(player.armedActiveId ?? player.activeAbilityId) === 'H010'
          ? 'H010'
          : String(player.activeAbilityId);
      const profile = heroSkillVfxProfile(activeId);
      if (!profile) {
        continue;
      }
      let visual = this.heroAuraVisuals.get(player.entityId);
      if (visual && visual.activeId !== activeId) {
        disposeGroup(visual.group);
        this.heroAuraVisuals.delete(player.entityId);
        visual = undefined;
      }
      if (!visual) {
        const created = createHeroSkillVisual(profile, 'status', this.graphicsTier === 'reduced');
        created.group.name = `hero-aura-${activeId.toLowerCase()}`;
        created.group.userData.baseScale = profile.scale * 0.7;
        this.root.add(created.group);
        visual = {
          activeId,
          group: created.group,
          materials: created.materials,
        };
        this.heroAuraVisuals.set(player.entityId, visual);
      }
      const x = worldMeters(player.position.x);
      const z = worldMeters(player.position.z);
      placeHeroSkillVisual(visual.group, x, this.surfaceHeightAt(x, z) + 0.055, z);
      updateHeroSkillVisual(visual.group, 0.5, elapsedSeconds);
    }
  }

  private hasPersistentHeroAura(player: PlayerSnapshot): boolean {
    const activeId = String(player.activeAbilityId);
    if (player.armedActiveId === 'H010' && player.armedCriticalTicks > 0) {
      return true;
    }
    switch (activeId) {
      case 'H009':
        return player.activeBuffTicks > 0;
      case 'H018':
        return player.whirlwindTicks > 0;
      case 'H025':
        return player.activeLifestealTicks > 0;
      case 'H032':
        return player.invulnerableTicks > 0;
      case 'H034':
        return player.activeDamageReductionTicks > 0 || player.activeSpeedBonusTicks > 0;
      default:
        return false;
    }
  }

  private syncCoreBossHazards(
    hazards: readonly CoreBossHazardSnapshot[],
    tick: number,
    elapsedSeconds: number,
  ): void {
    const visible = hazards.filter((hazard) => this.isWithinEffectRangeMm(hazard.center, 8_000));
    const currentIds = new Set(visible.map((hazard) => hazard.entityId));
    for (const [entityId, visual] of this.coreBossHazardVisuals) {
      if (!currentIds.has(entityId)) {
        disposeGroup(visual.group);
        this.coreBossHazardVisuals.delete(entityId);
      }
    }
    for (const hazard of visible) {
      const warning = tick < hazard.activatesAtTick;
      let visual = this.coreBossHazardVisuals.get(hazard.entityId);
      if (visual && (visual.abilityId !== hazard.abilityId || visual.warning !== warning)) {
        disposeGroup(visual.group);
        this.coreBossHazardVisuals.delete(hazard.entityId);
        visual = undefined;
      }
      if (!visual) {
        const profile = coreBossAbilityVfxProfile(hazard.abilityId);
        const created = createMonsterSkillVisual(
          profile,
          warning ? 'cast' : 'impact',
          this.graphicsTier === 'reduced',
        );
        created.group.name = `core-boss-hazard-${hazard.abilityId}`;
        const radius = Math.max(1.2, worldMeters(Math.max(hazard.radiusMm, hazard.widthMm)) / 3.2);
        created.group.userData.baseScale = profile.scale * radius;
        this.root.add(created.group);
        visual = {
          abilityId: hazard.abilityId,
          warning,
          group: created.group,
          materials: created.materials,
        };
        this.coreBossHazardVisuals.set(hazard.entityId, visual);
      }
      const x = worldMeters(hazard.center.x);
      const z = worldMeters(hazard.center.z);
      placeHeroSkillVisual(visual.group, x, this.surfaceHeightAt(x, z) + 0.06, z);
      visual.group.userData.baseRotationY = Math.atan2(hazard.direction.x, hazard.direction.z);
      const span = Math.max(0.08, hazard.expiresAtTick - hazard.createdAtTick);
      const progress = Math.max(0, Math.min(1, (tick - hazard.createdAtTick) / span));
      updateMonsterSkillVisual(
        visual.group,
        warning ? 0.35 + progress * 0.3 : 0.55,
        elapsedSeconds,
      );
    }
  }

  private processEvents(
    snapshot: WorldSnapshot,
    positions: ReadonlyMap<EntityId, EffectPosition>,
    events: readonly SimEvent[],
    elapsedSeconds: number,
  ): void {
    const criticalTargets = new Set(
      events
        .filter(
          (event): event is Extract<SimEvent, { readonly type: 'critical-hit' }> =>
            event.type === 'critical-hit',
        )
        .map((event) => `${event.tick}:${event.targetEntityId}`),
    );
    const damagedTargets = new Set<string>();
    const skillDamagedTargets = new Set<string>();
    const playersById = new Map(snapshot.players.map((player) => [player.entityId, player]));

    for (const event of events) {
      if (event.type === 'basic-attack') {
        const source = playersById.get(event.sourceEntityId);
        if (source && this.isWithinEffectRangeMm(source.position)) {
          this.spawnBasicAttackEffect(source, elapsedSeconds);
        }
      } else if (event.type === 'active-cast') {
        const source = playersById.get(event.entityId);
        const activeId = String(event.activeAbilityId);
        const profile = heroSkillVfxProfile(activeId);
        if (source && profile && this.isWithinEffectRangeMm(source.position)) {
          this.spawnHeroSkillCastEffect(source, profile, elapsedSeconds);
        } else {
          const position = positions.get(event.entityId);
          if (!position || !this.isWithinEffectRange(position)) {
            continue;
          }
          const color = combatEffectProfileForHero(event.heroId).color;
          this.spawnCastEffect(position, color, elapsedSeconds);
        }
      } else if (event.type === 'damage' && event.hpDamage + event.shieldDamage > 0) {
        const position = positions.get(event.targetEntityId);
        if (position && this.isWithinEffectRange(position)) {
          const critical =
            event.isCritical || criticalTargets.has(`${event.tick}:${event.targetEntityId}`);
          const sourceProfile =
            event.activeAbilityId !== undefined
              ? heroSkillVfxProfile(String(event.activeAbilityId))
              : null;
          if (sourceProfile) {
            const skillKey = `${sourceProfile.heroId}:${event.tick}:${event.targetEntityId}`;
            if (!skillDamagedTargets.has(skillKey)) {
              this.spawnHeroSkillImpactEffect(sourceProfile, position, elapsedSeconds);
              skillDamagedTargets.add(skillKey);
            }
            if (critical) {
              this.spawnImpactEffect(position, true, elapsedSeconds);
            }
          } else if (event.cause === 'monster' && event.sourceEntityId) {
            const monster = snapshot.monsters.find(
              (candidate) => candidate.entityId === event.sourceEntityId,
            );
            if (monster) {
              this.spawnMonsterAttackEffect(monster, position, elapsedSeconds);
            } else {
              this.spawnImpactEffect(position, critical, elapsedSeconds);
            }
          } else {
            this.spawnImpactEffect(position, critical, elapsedSeconds);
          }
          damagedTargets.add(`${event.tick}:${event.targetEntityId}`);
        }
      } else if (event.type === 'monster-damaged') {
        const key = `${event.tick}:${event.targetEntityId}`;
        const position = positions.get(event.targetEntityId);
        if (position && this.isWithinEffectRange(position) && !damagedTargets.has(key)) {
          const sourceProfile =
            event.activeAbilityId !== undefined
              ? heroSkillVfxProfile(String(event.activeAbilityId))
              : null;
          if (sourceProfile) {
            this.spawnHeroSkillImpactEffect(sourceProfile, position, elapsedSeconds);
          } else {
            this.spawnImpactEffect(position, criticalTargets.has(key), elapsedSeconds);
          }
          damagedTargets.add(key);
        }
      } else if (event.type === 'active-world-damaged') {
        const key = `${event.tick}:${event.targetEntityId}`;
        const position = positions.get(event.targetEntityId);
        if (position && this.isWithinEffectRange(position) && !damagedTargets.has(key)) {
          const profile = heroSkillVfxProfile(String(event.activeAbilityId));
          if (profile) {
            this.spawnHeroSkillImpactEffect(profile, position, elapsedSeconds);
          } else {
            this.spawnImpactEffect(position, false, elapsedSeconds);
          }
          damagedTargets.add(key);
        }
      } else if (event.type === 'active-heal') {
        const position = positions.get(event.targetEntityId);
        if (position && this.isWithinEffectRange(position)) {
          const profile = heroSkillVfxProfile(String(event.activeAbilityId));
          if (profile) {
            this.spawnHeroSkillImpactEffect(profile, position, elapsedSeconds);
          } else {
            this.spawnHealEffect(position, elapsedSeconds);
          }
        }
      } else if (event.type === 'active-status-applied') {
        const position = positions.get(event.targetEntityId);
        const profile = heroSkillVfxProfile(String(event.activeAbilityId));
        const key = `${event.activeAbilityId}:${event.tick}:${event.targetEntityId}`;
        if (
          position &&
          this.isWithinEffectRange(position) &&
          profile &&
          !skillDamagedTargets.has(key)
        ) {
          this.spawnHeroSkillImpactEffect(profile, position, elapsedSeconds, 0.82);
          skillDamagedTargets.add(key);
        }
      } else if (
        event.type === 'passive-proc' &&
        event.activeAbilityId !== undefined &&
        event.targetEntityId !== null
      ) {
        const position = positions.get(event.targetEntityId);
        const profile = heroSkillVfxProfile(String(event.activeAbilityId));
        const key = `${event.activeAbilityId}:${event.tick}:${event.targetEntityId}`;
        if (
          position &&
          this.isWithinEffectRange(position) &&
          profile &&
          !skillDamagedTargets.has(key)
        ) {
          this.spawnHeroSkillImpactEffect(profile, position, elapsedSeconds);
          skillDamagedTargets.add(key);
        }
      } else if (event.type === 'summon-spawned' && event.activeAbilityId !== undefined) {
        const position = positions.get(event.entityId);
        const profile = heroSkillVfxProfile(String(event.activeAbilityId));
        if (position && this.isWithinEffectRange(position) && profile) {
          this.spawnHeroSkillImpactEffect(profile, position, elapsedSeconds, 0.9);
        }
      } else if (event.type === 'core-boss-cast') {
        const x = worldMeters(event.center.x);
        const z = worldMeters(event.center.z);
        const position = {
          x,
          y: this.surfaceHeightAt(x, z) + 0.08,
          z,
          surfaceY: this.surfaceHeightAt(x, z),
        };
        if (this.isWithinEffectRange(position)) {
          const profile = coreBossAbilityVfxProfile(event.abilityId);
          const visual = createMonsterSkillVisual(
            profile,
            event.phase === 'warning' ? 'cast' : 'impact',
            this.graphicsTier === 'reduced',
          );
          placeHeroSkillVisual(visual.group, position.x, position.y, position.z);
          this.monsterSkillCastsSpawned += 1;
          this.lastMonsterKind = 'core-boss';
          this.addTransientEffect(
            'monster-skill',
            visual.group,
            visual.materials,
            elapsedSeconds,
            visual.durationSeconds,
          );
        }
      }
    }
  }

  private spawnBasicAttackEffect(player: PlayerSnapshot, elapsedSeconds: number): void {
    const profile = combatEffectProfileForHero(player.heroId);
    this.basicAttackEffectsSpawned += 1;
    this.lastAttackHeroId = player.heroId;
    if (profile.attackKind === 'ranged-projectile') {
      this.spawnMuzzleEffect(player, profile, elapsedSeconds);
      return;
    }
    if (profile.style === 'claw') {
      this.spawnClawEffect(player, profile, elapsedSeconds);
      return;
    }
    if (profile.style === 'heavy') {
      this.spawnHeavyEffect(player, profile, elapsedSeconds);
      return;
    }
    if (profile.style === 'mystic') {
      this.spawnMysticEffect(player, profile, elapsedSeconds);
      return;
    }

    // A slash, not a floor ring: the arc sits at chest height, tilts with the
    // swing, and turns through it over its lifetime. Two arcs — a wide soft
    // one in the element colour and a thin white-hot core — read as a blade
    // trail rather than as a range indicator.
    const group = new THREE.Group();
    group.name = `melee-sweep-${player.heroId}`;
    const x = worldMeters(player.position.x);
    const z = worldMeters(player.position.z);
    group.position.set(x, this.surfaceHeightAt(x, z) + 1.15, z);
    const yaw = Math.atan2(player.facing.x, player.facing.z);
    group.rotation.y = yaw - 0.55;
    group.userData.baseYaw = yaw;
    group.userData.swingRadians = 1.25;
    const material = createGlowMaterial(profile.color, 0.95, softRing());
    const coreMaterial = createGlowMaterial(0xfff6dc, 1);
    const flashMaterial = createGlowMaterial(0xfff4dc, 0.9, softDisc());
    const outerRadius = Math.min(2.9, Math.max(1.55, worldMeters(player.attackRangeMm) * 0.46));
    const segments = this.graphicsTier === 'reduced' ? 20 : 32;
    const sweep = new THREE.Mesh(
      new THREE.RingGeometry(
        outerRadius * 0.32,
        outerRadius,
        segments,
        1,
        -Math.PI * 0.48,
        Math.PI * 0.96,
      ),
      material,
    );
    sweep.rotation.x = -Math.PI / 2 + 0.48;
    const core = new THREE.Mesh(
      new THREE.RingGeometry(
        outerRadius * 0.84,
        outerRadius * 0.98,
        segments,
        1,
        -Math.PI * 0.4,
        Math.PI * 0.8,
      ),
      coreMaterial,
    );
    core.rotation.x = -Math.PI / 2 + 0.48;
    core.position.y = 0.03;
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.28, outerRadius * 1.7), flashMaterial);
    blade.rotation.set(-0.35, 0, 0.85);
    blade.position.set(0.15, 0.2, outerRadius * 0.35);
    const bladeB = blade.clone();
    bladeB.rotation.z = 1.05;
    bladeB.position.x = -0.12;
    group.add(sweep, core, blade, bladeB);
    this.addTransientEffect(
      'melee-sweep',
      group,
      [material, coreMaterial, flashMaterial],
      elapsedSeconds,
      0.36,
    );
  }

  private spawnMuzzleEffect(
    player: PlayerSnapshot,
    profile: ReturnType<typeof combatEffectProfileForHero>,
    elapsedSeconds: number,
  ): void {
    const { color, secondary, style } = profile;
    const group = new THREE.Group();
    group.name = `ranged-muzzle-${player.heroId}-${style}`;
    const x = worldMeters(player.position.x);
    const z = worldMeters(player.position.z);
    group.position.set(x, this.surfaceHeightAt(x, z) + 1.05, z);
    group.rotation.y = Math.atan2(player.facing.x, player.facing.z);
    const coreMaterial = createGlowMaterial(color, 0.95);
    const flareMaterial = createGlowMaterial(secondary, 0.75);
    const flashMaterial = createGlowMaterial(0xfff4dc, 0.85, softDisc());
    const materials: THREE.MeshBasicMaterial[] = [coreMaterial, flareMaterial, flashMaterial];
    if (style === 'wave') {
      // A fan of air: a wide flat crescent that leaves the hand and widens.
      const fan = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 1.4, 20, 1, -Math.PI * 0.32, Math.PI * 0.64),
        createGlowMaterial(color, 0.8, softRing()),
      );
      fan.rotation.x = -Math.PI / 2 + 0.25;
      fan.rotation.z = Math.PI / 2;
      fan.position.z = 1.0;
      const edge = new THREE.Mesh(
        new THREE.RingGeometry(1.3, 1.45, 20, 1, -Math.PI * 0.3, Math.PI * 0.6),
        createGlowMaterial(secondary, 1),
      );
      edge.rotation.copy(fan.rotation);
      edge.position.z = 1.0;
      group.userData.spreadZ = 1.2;
      group.add(fan, edge);
      materials.push(
        fan.material as THREE.MeshBasicMaterial,
        edge.material as THREE.MeshBasicMaterial,
      );
    } else if (style === 'flame') {
      // Tongues of fire leaping forward from the palm.
      for (let index = 0; index < 4; index += 1) {
        const tongue = new THREE.Mesh(
          new THREE.ConeGeometry(0.16 - index * 0.02, 0.9 + index * 0.25, 7),
          createGlowMaterial(index % 2 === 0 ? color : secondary, 0.85),
        );
        tongue.rotation.x = Math.PI / 2;
        tongue.rotation.z = (index - 1.5) * 0.35;
        tongue.position.set((index - 1.5) * 0.18, 0.1 + index * 0.08, 1.0 + index * 0.15);
        group.add(tongue);
        materials.push(tongue.material as THREE.MeshBasicMaterial);
      }
      group.userData.riseY = 0.6;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), flashMaterial);
      glow.position.z = 1.0;
      group.add(glow);
    } else if (style === 'orb') {
      // A charged sphere that swells and sheds motes.
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), coreMaterial);
      orb.position.z = 0.95;
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.62, 24),
        createGlowMaterial(secondary, 0.9, softRing()),
      );
      halo.position.z = 0.95;
      group.add(orb, halo);
      materials.push(halo.material as THREE.MeshBasicMaterial);
      for (let index = 0; index < 6; index += 1) {
        const mote = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), flareMaterial);
        const angle = (index / 6) * Math.PI * 2;
        mote.position.set(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0.95);
        mote.userData.driftX = Math.cos(angle) * 0.6;
        mote.userData.driftY = Math.sin(angle) * 0.6;
        group.add(mote);
      }
      group.userData.swell = 1.6;
    } else {
      // Bolt: a straight bright dart with a tight flash.
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), coreMaterial);
      core.position.z = 0.95;
      const dart = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.4, 8), flareMaterial);
      dart.rotation.x = Math.PI / 2;
      dart.position.z = 1.5;
      const flashA = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), flashMaterial);
      flashA.position.z = 0.95;
      const flashB = flashA.clone();
      flashB.rotation.y = Math.PI / 2;
      group.add(core, dart, flashA, flashB);
    }
    this.addTransientEffect('muzzle', group, materials, elapsedSeconds, 0.22);
  }

  /** Three parallel rakes: a beast's swipe, not a sword's arc. */
  private spawnClawEffect(
    player: PlayerSnapshot,
    profile: ReturnType<typeof combatEffectProfileForHero>,
    elapsedSeconds: number,
  ): void {
    const group = new THREE.Group();
    group.name = `melee-claw-${player.heroId}`;
    const x = worldMeters(player.position.x);
    const z = worldMeters(player.position.z);
    group.position.set(x, this.surfaceHeightAt(x, z) + 1.2, z);
    const yaw = Math.atan2(player.facing.x, player.facing.z);
    group.rotation.y = yaw;
    group.userData.baseYaw = yaw;
    group.userData.swingRadians = 0.55;
    const reach = Math.min(2.6, Math.max(1.4, worldMeters(player.attackRangeMm) * 0.42));
    const materials: THREE.MeshBasicMaterial[] = [];
    for (let index = 0; index < 3; index += 1) {
      const material = createGlowMaterial(index === 1 ? 0xfff6dc : profile.color, 0.95);
      materials.push(material);
      const rake = new THREE.Mesh(
        new THREE.RingGeometry(reach * 0.55, reach, 18, 1, -Math.PI * 0.3, Math.PI * 0.6),
        material,
      );
      rake.rotation.x = -Math.PI / 2 + 0.75;
      rake.rotation.z = 0.35;
      rake.position.set((index - 1) * 0.28, (index - 1) * 0.22, 0.4);
      rake.scale.set(1, 0.35, 1);
      group.add(rake);
    }
    const spray = createGlowMaterial(profile.secondary, 0.8, softDisc());
    materials.push(spray);
    for (let index = 0; index < 5; index += 1) {
      const drop = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), spray);
      drop.position.set((index - 2) * 0.3, 0.2, reach * 0.8);
      drop.userData.driftX = (index - 2) * 0.5;
      drop.userData.driftY = 0.9 - Math.abs(index - 2) * 0.2;
      group.add(drop);
    }
    this.addTransientEffect('melee-sweep', group, materials, elapsedSeconds, 0.3);
  }

  /** Ground slam: shock ring, dust dome and thrown debris. */
  private spawnHeavyEffect(
    player: PlayerSnapshot,
    profile: ReturnType<typeof combatEffectProfileForHero>,
    elapsedSeconds: number,
  ): void {
    const group = new THREE.Group();
    group.name = `melee-heavy-${player.heroId}`;
    const x = worldMeters(player.position.x);
    const z = worldMeters(player.position.z);
    const yaw = Math.atan2(player.facing.x, player.facing.z);
    const reach = Math.min(2.4, Math.max(1.2, worldMeters(player.attackRangeMm) * 0.4));
    group.position.set(
      x + Math.sin(yaw) * reach * 0.8,
      this.surfaceHeightAt(x, z) + 0.08,
      z + Math.cos(yaw) * reach * 0.8,
    );
    const ringMaterial = createGlowMaterial(profile.color, 0.9, softRing());
    const domeMaterial = createGlowMaterial(profile.secondary, 0.55);
    const debrisMaterial = createGlowMaterial(0xd9c9a8, 0.9);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 1.1, 28), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.userData.swell = 2.2;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      domeMaterial,
    );
    dome.userData.swell = 1.5;
    group.add(ring, dome);
    for (let index = 0; index < 7; index += 1) {
      const chip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.18), debrisMaterial);
      const angle = (index / 7) * Math.PI * 2 + 0.3;
      chip.position.set(Math.cos(angle) * 0.3, 0.1, Math.sin(angle) * 0.3);
      chip.userData.driftX = Math.cos(angle) * 1.6;
      chip.userData.driftY = 1.4 + (index % 3) * 0.4;
      chip.userData.driftZ = Math.sin(angle) * 1.6;
      chip.rotation.set(angle, angle * 0.7, 0);
      group.add(chip);
    }
    this.addTransientEffect(
      'melee-sweep',
      group,
      [ringMaterial, domeMaterial, debrisMaterial],
      elapsedSeconds,
      0.42,
    );
  }

  /** Sigil strike: a spinning rune ring at the target with a sparkle. */
  private spawnMysticEffect(
    player: PlayerSnapshot,
    profile: ReturnType<typeof combatEffectProfileForHero>,
    elapsedSeconds: number,
  ): void {
    const group = new THREE.Group();
    group.name = `melee-mystic-${player.heroId}`;
    const x = worldMeters(player.position.x);
    const z = worldMeters(player.position.z);
    const yaw = Math.atan2(player.facing.x, player.facing.z);
    const reach = Math.min(2.4, Math.max(1.2, worldMeters(player.attackRangeMm) * 0.4));
    group.position.set(
      x + Math.sin(yaw) * reach * 0.7,
      this.surfaceHeightAt(x, z) + 1.0,
      z + Math.cos(yaw) * reach * 0.7,
    );
    const ringMaterial = createGlowMaterial(profile.color, 0.95, softRing());
    const runeMaterial = createGlowMaterial(profile.secondary, 0.9);
    const sparkMaterial = createGlowMaterial(0xfff8e0, 1, softDisc());
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32), ringMaterial);
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.38, 24), ringMaterial);
    inner.rotation.z = 0.5;
    outer.userData.spinZ = 4;
    inner.userData.spinZ = -6;
    group.add(outer, inner);
    for (let index = 0; index < 6; index += 1) {
      const rune = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.02), runeMaterial);
      const angle = (index / 6) * Math.PI * 2;
      rune.position.set(Math.cos(angle) * 0.72, Math.sin(angle) * 0.72, 0.02);
      rune.rotation.z = angle;
      outer.add(rune);
    }
    const spark = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), sparkMaterial);
    spark.userData.swell = 1.8;
    group.add(spark);
    // Face the camera side (billboard about Y toward the facing direction).
    group.rotation.y = yaw;
    this.addTransientEffect(
      'melee-sweep',
      group,
      [ringMaterial, runeMaterial, sparkMaterial],
      elapsedSeconds,
      0.38,
    );
  }

  private spawnHeroSkillCastEffect(
    player: PlayerSnapshot,
    profile: HeroSkillVfxProfile,
    elapsedSeconds: number,
  ): void {
    const visual = createHeroSkillVisual(profile, 'cast', this.graphicsTier === 'reduced');
    const x = worldMeters(player.position.x);
    const z = worldMeters(player.position.z);
    placeHeroSkillVisual(visual.group, x, this.surfaceHeightAt(x, z) + 0.08, z);
    visual.group.userData.baseRotationY = Math.atan2(player.facing.x, player.facing.z);
    visual.group.rotation.y = visual.group.userData.baseRotationY;
    this.heroSkillCastsSpawned += 1;
    this.activeCastEffectsSpawned += 1;
    this.lastSkillHeroId = profile.heroId;
    this.addTransientEffect(
      'hero-skill',
      visual.group,
      visual.materials,
      elapsedSeconds,
      visual.durationSeconds,
    );
  }

  private spawnHeroSkillImpactEffect(
    profile: HeroSkillVfxProfile,
    position: EffectPosition,
    elapsedSeconds: number,
    scaleMultiplier = 1,
  ): void {
    const visual = createHeroSkillVisual(profile, 'impact', this.graphicsTier === 'reduced');
    placeHeroSkillVisual(visual.group, position.x, position.surfaceY + 0.07, position.z);
    visual.group.userData.baseScale = profile.scale * scaleMultiplier;
    this.heroSkillImpactsSpawned += 1;
    this.lastSkillHeroId = profile.heroId;
    this.addTransientEffect(
      'hero-skill',
      visual.group,
      visual.materials,
      elapsedSeconds,
      visual.durationSeconds,
    );
  }

  private spawnMonsterAttackEffect(
    monster: MonsterSnapshot,
    target: EffectPosition,
    elapsedSeconds: number,
  ): void {
    const profile = monsterAttackVfxProfile(monster.kind, monster.element);
    const reduced = this.graphicsTier === 'reduced';
    const swing = createMonsterSkillVisual(profile, 'cast', reduced);
    const monsterX = worldMeters(monster.position.x);
    const monsterZ = worldMeters(monster.position.z);
    placeHeroSkillVisual(
      swing.group,
      monsterX,
      this.surfaceHeightAt(monsterX, monsterZ) + 0.08,
      monsterZ,
    );
    swing.group.userData.baseRotationY = Math.atan2(
      target.x - swing.group.position.x,
      target.z - swing.group.position.z,
    );
    swing.group.rotation.y = swing.group.userData.baseRotationY;
    this.monsterSkillCastsSpawned += 1;
    this.lastMonsterKind = monster.kind;
    this.addTransientEffect(
      'monster-skill',
      swing.group,
      swing.materials,
      elapsedSeconds,
      swing.durationSeconds,
    );

    const hit = createMonsterSkillVisual(profile, 'impact', reduced);
    placeHeroSkillVisual(hit.group, target.x, target.surfaceY + 0.07, target.z);
    hit.group.userData.baseScale = profile.scale * 0.82;
    this.addTransientEffect(
      'monster-skill',
      hit.group,
      hit.materials,
      elapsedSeconds,
      hit.durationSeconds,
    );
  }

  private spawnImpactEffect(
    position: EffectPosition,
    critical: boolean,
    elapsedSeconds: number,
  ): void {
    const group = new THREE.Group();
    group.name = critical ? 'critical-impact' : 'damage-impact';
    group.position.set(position.x, position.y, position.z);
    const color = critical ? 0xffd36b : 0xff8566;
    const coreMaterial = createGlowMaterial(color, critical ? 0.98 : 0.86);
    const ringMaterial = createGlowMaterial(
      critical ? 0xfff1a8 : 0xffc29b,
      critical ? 0.92 : 0.66,
      softRing(),
    );
    const flashMaterial = createGlowMaterial(0xfff6e4, critical ? 0.95 : 0.7, softDisc());
    const core = new THREE.Mesh(
      critical ? new THREE.OctahedronGeometry(0.48, 1) : new THREE.IcosahedronGeometry(0.34, 1),
      coreMaterial,
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, critical ? 0.95 : 0.72, critical ? 28 : 20),
      ringMaterial,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = position.surfaceY + 0.13 - position.y;
    // Hit star: thin shards radiating from the point of contact, the mark
    // every action game leaves where a blow lands.
    const shardCount = critical ? 6 : 4;
    const shardLength = critical ? 1.5 : 1.0;
    for (let index = 0; index < shardCount; index += 1) {
      const shard = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, shardLength),
        index % 2 === 0 ? flashMaterial : coreMaterial,
      );
      const angle = (index / shardCount) * Math.PI * 2 + (critical ? 0.3 : 0.55);
      shard.rotation.set(Math.cos(angle) * 0.9, angle, 0);
      shard.position.set(
        Math.sin(angle) * shardLength * 0.35,
        Math.cos(angle) * shardLength * 0.2,
        Math.cos(angle) * shardLength * 0.35,
      );
      group.add(shard);
    }
    const flashA = new THREE.Mesh(
      new THREE.PlaneGeometry(critical ? 2.6 : 1.7, critical ? 2.6 : 1.7),
      flashMaterial,
    );
    const flashB = flashA.clone();
    flashB.rotation.y = Math.PI / 2;
    group.add(core, ring, flashA, flashB);
    this.impactEffectsSpawned += 1;
    this.addTransientEffect(
      critical ? 'critical' : 'impact',
      group,
      [coreMaterial, ringMaterial, flashMaterial],
      elapsedSeconds,
      critical ? 0.5 : 0.34,
    );
  }

  private spawnCastEffect(position: EffectPosition, color: number, elapsedSeconds: number): void {
    const group = new THREE.Group();
    group.name = 'active-cast-pulse';
    group.position.set(position.x, position.surfaceY + 0.13, position.z);
    const ringMaterial = createGlowMaterial(color, 0.82);
    const coreMaterial = createGlowMaterial(0xffefba, 0.46);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1.18, 36), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 8), coreMaterial);
    core.position.y = position.y - group.position.y;
    group.add(ring, core);
    this.activeCastEffectsSpawned += 1;
    this.addTransientEffect('cast', group, [ringMaterial, coreMaterial], elapsedSeconds, 0.52);
  }

  private spawnHealEffect(position: EffectPosition, elapsedSeconds: number): void {
    const group = new THREE.Group();
    group.name = 'heal-pulse';
    group.position.set(position.x, position.surfaceY + 0.14, position.z);
    const material = createGlowMaterial(0x76e59a, 0.72);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.95, 30), material);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    this.addTransientEffect('heal', group, [material], elapsedSeconds, 0.58);
  }

  private addTransientEffect(
    kind: TransientEffectKind,
    group: THREE.Group,
    materials: readonly THREE.MeshBasicMaterial[],
    elapsedSeconds: number,
    durationSeconds: number,
  ): void {
    this.root.add(group);
    this.transientEffects.push({
      kind,
      group,
      materials,
      startedAtSeconds: elapsedSeconds,
      durationSeconds,
    });
    this.trimTransientEffects();
  }

  private trimTransientEffects(): void {
    while (this.transientEffects.length > this.transientLimit) {
      const oldest = this.transientEffects.shift();
      if (oldest) {
        disposeGroup(oldest.group);
      }
    }
  }

  private updateTransientEffects(elapsedSeconds: number): void {
    for (let index = this.transientEffects.length - 1; index >= 0; index -= 1) {
      const effect = this.transientEffects[index];
      if (!effect) {
        continue;
      }
      const progress = Math.max(
        0,
        Math.min(1, (elapsedSeconds - effect.startedAtSeconds) / effect.durationSeconds),
      );
      if (progress >= 1) {
        disposeGroup(effect.group);
        this.transientEffects.splice(index, 1);
        continue;
      }
      effect.group.visible = this.isWithinEffectRange(effect.group.position);
      if (!effect.group.visible) {
        continue;
      }
      if (effect.kind === 'hero-skill') {
        updateHeroSkillVisual(effect.group, progress, elapsedSeconds);
      } else if (effect.kind === 'monster-skill') {
        updateMonsterSkillVisual(effect.group, progress, elapsedSeconds);
      }
      const authored = effect.kind === 'hero-skill' || effect.kind === 'monster-skill';
      const scale = authored
        ? 1
        : effect.kind === 'melee-sweep'
          ? 0.88 + progress * 0.32
          : effect.kind === 'muzzle'
            ? 0.72 + progress * 0.7
            : effect.kind === 'critical'
              ? 0.58 + progress * 1.45
              : effect.kind === 'cast' || effect.kind === 'heal'
                ? 0.62 + progress * 1.25
                : 0.68 + progress;
      if (!authored) {
        effect.group.scale.setScalar(scale);
      }
      if (authored) {
        continue;
      }
      if (effect.kind === 'melee-sweep') {
        const baseYaw = Number(effect.group.userData.baseYaw ?? effect.group.rotation.y);
        const swing = Number(effect.group.userData.swingRadians ?? 0);
        // Fast out of the gate, easing to a stop: the swing has already been
        // committed by the time the event arrives, so the trail decelerates.
        const eased = 1 - (1 - progress) ** 2.2;
        effect.group.rotation.y = baseYaw - swing * 0.5 + swing * eased;
      }
      // Per-part motion tags set by the style builders: drifting motes and
      // debris, swelling rings, spinning sigils, rising tongues, spreading fans.
      const eased = 1 - (1 - progress) ** 2;
      effect.group.traverse((child) => {
        const data = child.userData;
        if (typeof data.driftX === 'number' || typeof data.driftY === 'number') {
          if (data.baseX === undefined) {
            data.baseX = child.position.x;
            data.baseY = child.position.y;
            data.baseZ = child.position.z;
          }
          child.position.set(
            Number(data.baseX) + Number(data.driftX ?? 0) * eased,
            Number(data.baseY) + Number(data.driftY ?? 0) * eased - progress * progress * 0.8,
            Number(data.baseZ) + Number(data.driftZ ?? 0) * eased,
          );
        }
        if (typeof data.swell === 'number') {
          child.scale.setScalar(1 + (Number(data.swell) - 1) * eased);
        }
        if (typeof data.spinZ === 'number') {
          child.rotation.z += Number(data.spinZ) * 0.016;
        }
      });
      if (typeof effect.group.userData.riseY === 'number') {
        effect.group.position.y += Number(effect.group.userData.riseY) * 0.016;
      }
      if (typeof effect.group.userData.spreadZ === 'number') {
        effect.group.translateZ(Number(effect.group.userData.spreadZ) * 0.016 * 4);
      }
      for (const material of effect.materials) {
        const baseOpacity =
          typeof material.userData.baseOpacity === 'number' ? material.userData.baseOpacity : 1;
        material.opacity = baseOpacity * (1 - progress) ** 1.35;
      }
    }
  }
}
