import { type FiveElement, getHeroDefinition } from '@jwgb/content';
import type { EntityId, HeroId } from '@jwgb/core';
import type {
  ActiveProjectileSnapshot,
  ActiveTargetEffectSnapshot,
  ActiveZoneSnapshot,
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
  updateHeroSkillVisual,
} from './hero-skill-vfx';

type GraphicsTier = 'balanced' | 'reduced';
type TransientEffectKind =
  | 'melee-sweep'
  | 'muzzle'
  | 'impact'
  | 'critical'
  | 'cast'
  | 'heal'
  | 'hero-skill';
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

interface TransientCombatEffect {
  readonly kind: TransientEffectKind;
  readonly group: THREE.Group;
  readonly materials: readonly THREE.MeshBasicMaterial[];
  readonly startedAtSeconds: number;
  readonly durationSeconds: number;
}

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
  readonly impactEffectsSpawned: number;
  readonly lastAttackHeroId: string | null;
  readonly lastSkillHeroId: string | null;
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

export function combatEffectProfileForHero(heroId: HeroId): {
  readonly heroId: HeroId;
  readonly attackKind: 'melee' | 'ranged-projectile';
  readonly color: number;
} {
  const hero = getHeroDefinition(heroId);
  return {
    heroId,
    attackKind: hero.basicAttackKind,
    color: effectColorForElement(hero.element),
  };
}

function createGlowMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.userData.baseOpacity = opacity;
  return material;
}

function disposeGroup(group: THREE.Group): void {
  group.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
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

function entityPosition(
  snapshot: WorldSnapshot,
  entityId: EntityId,
): { readonly x: number; readonly y: number; readonly z: number } | null {
  const player = snapshot.players.find((candidate) => candidate.entityId === entityId);
  if (player) {
    return {
      x: worldMeters(player.position.x),
      y: player.lifeState === 'soul-flight' ? 3.2 : 1.05,
      z: worldMeters(player.position.z),
    };
  }
  const monster = snapshot.monsters.find((candidate) => candidate.entityId === entityId);
  if (monster) {
    return {
      x: worldMeters(monster.position.x),
      y: Math.max(0.7, worldMeters(monster.collisionRadiusMm) * 1.25),
      z: worldMeters(monster.position.z),
    };
  }
  const summon = snapshot.summons.find((candidate) => candidate.entityId === entityId);
  if (summon) {
    return {
      x: worldMeters(summon.position.x),
      y: summon.kind === 'stone-statue' ? 1.2 : 0.8,
      z: worldMeters(summon.position.z),
    };
  }
  const zone = snapshot.activeZones.find((candidate) => candidate.entityId === entityId);
  return zone ? { x: worldMeters(zone.center.x), y: 0.3, z: worldMeters(zone.center.z) } : null;
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
  private readonly transientEffects: TransientCombatEffect[] = [];
  private graphicsTier: GraphicsTier;
  private basicAttackEffectsSpawned = 0;
  private activeCastEffectsSpawned = 0;
  private heroSkillCastsSpawned = 0;
  private heroSkillImpactsSpawned = 0;
  private impactEffectsSpawned = 0;
  private lastAttackHeroId: string | null = null;
  private lastSkillHeroId: string | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    graphicsTier: GraphicsTier,
  ) {
    this.graphicsTier = graphicsTier;
    this.root.name = 'combat-effects';
    scene.add(this.root);
  }

  setGraphicsTier(tier: GraphicsTier): void {
    this.graphicsTier = tier;
    this.trimTransientEffects();
  }

  update(snapshot: WorldSnapshot, events: readonly SimEvent[], elapsedSeconds: number): void {
    this.syncActiveProjectiles(snapshot.activeProjectiles, elapsedSeconds);
    this.syncActiveZones(snapshot.activeZones, snapshot.tick, elapsedSeconds);
    this.syncActiveTargetEffects(snapshot, elapsedSeconds);
    this.syncHeroAuras(snapshot.players, elapsedSeconds);
    this.processEvents(snapshot, events, elapsedSeconds);
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
      impactEffectsSpawned: this.impactEffectsSpawned,
      lastAttackHeroId: this.lastAttackHeroId,
      lastSkillHeroId: this.lastSkillHeroId,
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
    for (const effect of this.transientEffects) {
      disposeGroup(effect.group);
    }
    this.activeProjectileVisuals.clear();
    this.activeZoneVisuals.clear();
    this.activeTargetEffectVisuals.clear();
    this.heroAuraVisuals.clear();
    this.transientEffects.length = 0;
    this.scene.remove(this.root);
  }

  private get transientLimit(): number {
    return this.graphicsTier === 'reduced' ? 40 : 80;
  }

  private syncActiveProjectiles(
    projectiles: readonly ActiveProjectileSnapshot[],
    elapsedSeconds: number,
  ): void {
    const currentIds = new Set(projectiles.map((projectile) => projectile.entityId));
    for (const [entityId, visual] of this.activeProjectileVisuals) {
      if (!currentIds.has(entityId)) {
        disposeGroup(visual.group);
        this.activeProjectileVisuals.delete(entityId);
      }
    }
    for (const projectile of projectiles) {
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
    visual.group.position.set(
      worldMeters(projectile.position.x),
      1.05,
      worldMeters(projectile.position.z),
    );
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
    const currentIds = new Set(zones.map((zone) => zone.entityId));
    for (const [entityId, visual] of this.activeZoneVisuals) {
      if (!currentIds.has(entityId)) {
        disposeGroup(visual.group);
        this.activeZoneVisuals.delete(entityId);
      }
    }
    for (const zone of zones) {
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
    visual.group.position.set(worldMeters(zone.center.x), 0, worldMeters(zone.center.z));
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

  private syncActiveTargetEffects(snapshot: WorldSnapshot, elapsedSeconds: number): void {
    const visibleEffects = (snapshot.activeTargetEffects ?? []).filter(
      (effect) =>
        heroSkillVfxProfile(String(effect.activeId)) !== null &&
        entityPosition(snapshot, effect.targetEntityId) !== null,
    );
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
      const position = entityPosition(snapshot, effect.targetEntityId);
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

      visual.group.position.set(position.x, 0.06, position.z);
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
    const activePlayers = players.filter((player) => this.hasPersistentHeroAura(player));
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
      visual.group.position.set(
        worldMeters(player.position.x),
        0.055,
        worldMeters(player.position.z),
      );
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

  private processEvents(
    snapshot: WorldSnapshot,
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

    for (const event of events) {
      if (event.type === 'basic-attack') {
        const source = snapshot.players.find(
          (candidate) => candidate.entityId === event.sourceEntityId,
        );
        if (source) {
          this.spawnBasicAttackEffect(source, elapsedSeconds);
        }
      } else if (event.type === 'active-cast') {
        const source = snapshot.players.find((candidate) => candidate.entityId === event.entityId);
        const activeId = String(event.activeAbilityId);
        const profile = heroSkillVfxProfile(activeId);
        if (source && profile) {
          this.spawnHeroSkillCastEffect(source, profile, elapsedSeconds);
        } else {
          const position = entityPosition(snapshot, event.entityId);
          if (!position) {
            continue;
          }
          const color = combatEffectProfileForHero(event.heroId).color;
          this.spawnCastEffect(position, color, elapsedSeconds);
        }
      } else if (event.type === 'damage' && event.hpDamage + event.shieldDamage > 0) {
        const position = entityPosition(snapshot, event.targetEntityId);
        if (position) {
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
          } else {
            this.spawnImpactEffect(position, critical, elapsedSeconds);
          }
          damagedTargets.add(`${event.tick}:${event.targetEntityId}`);
        }
      } else if (event.type === 'monster-damaged') {
        const key = `${event.tick}:${event.targetEntityId}`;
        const position = entityPosition(snapshot, event.targetEntityId);
        if (position && !damagedTargets.has(key)) {
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
        const position = entityPosition(snapshot, event.targetEntityId);
        if (position && !damagedTargets.has(key)) {
          const profile = heroSkillVfxProfile(String(event.activeAbilityId));
          if (profile) {
            this.spawnHeroSkillImpactEffect(profile, position, elapsedSeconds);
          } else {
            this.spawnImpactEffect(position, false, elapsedSeconds);
          }
          damagedTargets.add(key);
        }
      } else if (event.type === 'active-heal') {
        const position = entityPosition(snapshot, event.targetEntityId);
        if (position) {
          const profile = heroSkillVfxProfile(String(event.activeAbilityId));
          if (profile) {
            this.spawnHeroSkillImpactEffect(profile, position, elapsedSeconds);
          } else {
            this.spawnHealEffect(position, elapsedSeconds);
          }
        }
      } else if (event.type === 'active-status-applied') {
        const position = entityPosition(snapshot, event.targetEntityId);
        const profile = heroSkillVfxProfile(String(event.activeAbilityId));
        const key = `${event.activeAbilityId}:${event.tick}:${event.targetEntityId}`;
        if (position && profile && !skillDamagedTargets.has(key)) {
          this.spawnHeroSkillImpactEffect(profile, position, elapsedSeconds, 0.82);
          skillDamagedTargets.add(key);
        }
      } else if (
        event.type === 'passive-proc' &&
        event.activeAbilityId !== undefined &&
        event.targetEntityId !== null
      ) {
        const position = entityPosition(snapshot, event.targetEntityId);
        const profile = heroSkillVfxProfile(String(event.activeAbilityId));
        const key = `${event.activeAbilityId}:${event.tick}:${event.targetEntityId}`;
        if (position && profile && !skillDamagedTargets.has(key)) {
          this.spawnHeroSkillImpactEffect(profile, position, elapsedSeconds);
          skillDamagedTargets.add(key);
        }
      } else if (event.type === 'summon-spawned' && event.activeAbilityId !== undefined) {
        const position = entityPosition(snapshot, event.entityId);
        const profile = heroSkillVfxProfile(String(event.activeAbilityId));
        if (position && profile) {
          this.spawnHeroSkillImpactEffect(profile, position, elapsedSeconds, 0.9);
        }
      }
    }
  }

  private spawnBasicAttackEffect(player: PlayerSnapshot, elapsedSeconds: number): void {
    const profile = combatEffectProfileForHero(player.heroId);
    this.basicAttackEffectsSpawned += 1;
    this.lastAttackHeroId = player.heroId;
    if (profile.attackKind === 'ranged-projectile') {
      this.spawnMuzzleEffect(player, profile.color, elapsedSeconds);
      return;
    }

    const group = new THREE.Group();
    group.name = `melee-sweep-${player.heroId}`;
    group.position.set(worldMeters(player.position.x), 0.48, worldMeters(player.position.z));
    group.rotation.y = Math.atan2(player.facing.x, player.facing.z);
    const material = createGlowMaterial(profile.color, 0.78);
    const outerRadius = Math.min(2.4, Math.max(1.25, worldMeters(player.attackRangeMm) * 0.36));
    const sweep = new THREE.Mesh(
      new THREE.RingGeometry(
        outerRadius * 0.48,
        outerRadius,
        this.graphicsTier === 'reduced' ? 20 : 30,
        1,
        -Math.PI * 0.86,
        Math.PI * 0.72,
      ),
      material,
    );
    sweep.rotation.x = -Math.PI / 2;
    group.add(sweep);
    this.addTransientEffect('melee-sweep', group, [material], elapsedSeconds, 0.3);
  }

  private spawnMuzzleEffect(player: PlayerSnapshot, color: number, elapsedSeconds: number): void {
    const group = new THREE.Group();
    group.name = `ranged-muzzle-${player.heroId}`;
    group.position.set(worldMeters(player.position.x), 1.05, worldMeters(player.position.z));
    group.rotation.y = Math.atan2(player.facing.x, player.facing.z);
    const coreMaterial = createGlowMaterial(color, 0.9);
    const flareMaterial = createGlowMaterial(0xffe5ad, 0.66);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), coreMaterial);
    core.position.z = 0.95;
    const flare = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 10), flareMaterial);
    flare.rotation.x = Math.PI / 2;
    flare.position.z = 1.22;
    group.add(core, flare);
    this.addTransientEffect('muzzle', group, [coreMaterial, flareMaterial], elapsedSeconds, 0.18);
  }

  private spawnHeroSkillCastEffect(
    player: PlayerSnapshot,
    profile: HeroSkillVfxProfile,
    elapsedSeconds: number,
  ): void {
    const visual = createHeroSkillVisual(profile, 'cast', this.graphicsTier === 'reduced');
    visual.group.position.set(worldMeters(player.position.x), 0.08, worldMeters(player.position.z));
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
    position: { readonly x: number; readonly y: number; readonly z: number },
    elapsedSeconds: number,
    scaleMultiplier = 1,
  ): void {
    const visual = createHeroSkillVisual(profile, 'impact', this.graphicsTier === 'reduced');
    visual.group.position.set(position.x, 0.07, position.z);
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

  private spawnImpactEffect(
    position: { readonly x: number; readonly y: number; readonly z: number },
    critical: boolean,
    elapsedSeconds: number,
  ): void {
    const group = new THREE.Group();
    group.name = critical ? 'critical-impact' : 'damage-impact';
    group.position.set(position.x, position.y, position.z);
    const color = critical ? 0xffd36b : 0xff8566;
    const coreMaterial = createGlowMaterial(color, critical ? 0.96 : 0.76);
    const ringMaterial = createGlowMaterial(critical ? 0xfff1a8 : 0xffc29b, critical ? 0.88 : 0.58);
    const core = new THREE.Mesh(
      critical ? new THREE.OctahedronGeometry(0.48, 1) : new THREE.IcosahedronGeometry(0.34, 1),
      coreMaterial,
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, critical ? 0.9 : 0.68, critical ? 28 : 20),
      ringMaterial,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -position.y + 0.13;
    group.add(core, ring);
    this.impactEffectsSpawned += 1;
    this.addTransientEffect(
      critical ? 'critical' : 'impact',
      group,
      [coreMaterial, ringMaterial],
      elapsedSeconds,
      critical ? 0.5 : 0.34,
    );
  }

  private spawnCastEffect(
    position: { readonly x: number; readonly y: number; readonly z: number },
    color: number,
    elapsedSeconds: number,
  ): void {
    const group = new THREE.Group();
    group.name = 'active-cast-pulse';
    group.position.set(position.x, 0.13, position.z);
    const ringMaterial = createGlowMaterial(color, 0.82);
    const coreMaterial = createGlowMaterial(0xffefba, 0.46);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1.18, 36), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 8), coreMaterial);
    core.position.y = position.y;
    group.add(ring, core);
    this.activeCastEffectsSpawned += 1;
    this.addTransientEffect('cast', group, [ringMaterial, coreMaterial], elapsedSeconds, 0.52);
  }

  private spawnHealEffect(
    position: { readonly x: number; readonly y: number; readonly z: number },
    elapsedSeconds: number,
  ): void {
    const group = new THREE.Group();
    group.name = 'heal-pulse';
    group.position.set(position.x, 0.14, position.z);
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
      if (effect.kind === 'hero-skill') {
        updateHeroSkillVisual(effect.group, progress, elapsedSeconds);
      }
      const scale =
        effect.kind === 'hero-skill'
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
      if (effect.kind !== 'hero-skill') {
        effect.group.scale.setScalar(scale);
      }
      for (const material of effect.materials) {
        const baseOpacity =
          typeof material.userData.baseOpacity === 'number' ? material.userData.baseOpacity : 1;
        material.opacity = baseOpacity * (1 - progress) ** 1.35;
      }
    }
  }
}
