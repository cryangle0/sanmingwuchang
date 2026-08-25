import { AUTHORITATIVE_HEROES } from '@jwgb/content';
import { activeId, entityId, heroId, vec2Mm } from '@jwgb/core';
import type {
  ActiveProjectileSnapshot,
  ActiveTargetEffectSnapshot,
  ActiveZoneSnapshot,
  PlayerSnapshot,
  SimEvent,
  SummonSnapshot,
  WorldSnapshot,
} from '@jwgb/sim';
import * as THREE from 'three';
import {
  CombatEffectsLayer,
  combatEffectProfileForHero,
} from '../apps/web/src/render/combat-effects';
import {
  createHeroSkillVisual,
  HERO_SKILL_VFX_PROFILES,
} from '../apps/web/src/render/hero-skill-vfx';

const ACTIVE_PROJECTILE_KINDS = ['line-damage', 'root', 'hook', 'polymorph'] as const;
const ACTIVE_ZONE_KINDS = [
  'fire-wall',
  'damage-slow',
  'spreading-poison',
  'delayed-strike',
  'delayed-target-strike',
  'area-pull',
  'decoy-bomb',
  'silence',
  'lifesteal-aura',
  'healing',
  'ring-wall',
  'displacement-lock',
  'ice-wall',
  'smoke',
  'trap',
] as const satisfies readonly ActiveZoneSnapshot['kind'][];

function activeProjectile(
  kind: ActiveProjectileSnapshot['kind'],
  index: number,
): ActiveProjectileSnapshot {
  return {
    entityId: entityId(100 + index),
    ownerEntityId: entityId(1),
    activeId: activeId('H002'),
    kind,
    position: vec2Mm(index * 1_000, 0),
    direction: vec2Mm(0, 1_000),
    speedMmPerSecond: 30_000,
    collisionRadiusMm: 350,
    fixedDamage: 100,
    attackCoefficientBasisPoints: 5_000,
    rootTicks: 20,
    displacementMm: 2_000,
    effectDurationTicks: 40,
    effectSpeedBonusPercent: 20,
    triggerHardControlTicks: 10,
    damagePerDistanceBasisPoints: 0,
    maximumDistanceBonusPercent: 0,
    targetEntityId: null,
    createdAtTick: 1,
    remainingTravelMm: 20_000,
    distanceTravelledMm: 0,
    movementRemainder: 0,
  };
}

function activeZone(kind: ActiveZoneSnapshot['kind'], index: number): ActiveZoneSnapshot {
  return {
    entityId: entityId(200 + index),
    ownerEntityId: entityId(1),
    activeId: activeId('H002'),
    kind,
    targetEntityId: null,
    center: vec2Mm(index * 1_000, 0),
    direction: vec2Mm(0, 1_000),
    radiusMm: 6_000,
    lengthMm: 12_000,
    createdAtTick: 1,
    activatesAtTick: 80,
    expiresAtTick: 240,
    nextPulseTick: 100,
    pulseIntervalTicks: 20,
    fixedDamage: 100,
    attackCoefficientBasisPoints: 5_000,
    slowPercent: 20,
    slowDurationTicks: 40,
    hardControlTicks: 20,
    displacementMm: 2_000,
    healAmount: 100,
    lifestealPercent: 20,
    burnDamagePerSecond: 30,
    burnDurationTicks: 60,
    detonationFixedDamage: 120,
    detonationAttackCoefficientBasisPoints: 4_000,
    triggerHardControlTicks: 20,
    triggerRevealTicks: 40,
    triggerRadiusMm: 4_000,
    hp: 500,
    maxHp: 500,
    targetable: false,
    followsOwner: false,
    followTargetEntityId: null,
    generation: 0,
  };
}

function combatSnapshot(options: {
  readonly players?: readonly PlayerSnapshot[];
  readonly summons?: readonly SummonSnapshot[];
  readonly activeProjectiles?: readonly ActiveProjectileSnapshot[];
  readonly activeZones?: readonly ActiveZoneSnapshot[];
  readonly activeTargetEffects?: readonly ActiveTargetEffectSnapshot[];
  readonly tick?: number;
}): WorldSnapshot {
  return {
    tick: options.tick ?? 100,
    players: options.players ?? [],
    monsters: [],
    summons: options.summons ?? [],
    activeProjectiles: options.activeProjectiles ?? [],
    activeZones: options.activeZones ?? [],
    activeTargetEffects: options.activeTargetEffects ?? [],
  } as unknown as WorldSnapshot;
}

describe('web combat effects', () => {
  it('defines a visible basic-attack profile for every authoritative hero', () => {
    const profiles = AUTHORITATIVE_HEROES.map((record) =>
      combatEffectProfileForHero(heroId(record.id)),
    );

    expect(profiles).toHaveLength(38);
    expect(profiles.every((profile) => profile.color > 0)).toBe(true);
    expect(profiles.filter((profile) => profile.attackKind === 'ranged-projectile')).toHaveLength(
      8,
    );
    expect(profiles.filter((profile) => profile.attackKind === 'melee')).toHaveLength(30);
  });

  it('defines and builds a distinct signature visual for all 38 hero skills', () => {
    expect(HERO_SKILL_VFX_PROFILES).toHaveLength(38);
    expect(new Set(HERO_SKILL_VFX_PROFILES.map((profile) => profile.heroId)).size).toBe(38);
    expect(new Set(HERO_SKILL_VFX_PROFILES.map((profile) => profile.motif)).size).toBe(38);

    for (const profile of HERO_SKILL_VFX_PROFILES) {
      for (const stage of ['cast', 'impact', 'status'] as const) {
        const visual = createHeroSkillVisual(profile, stage, false);
        let meshCount = 0;
        visual.group.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            meshCount += 1;
          }
        });
        expect(meshCount, `${profile.heroId} ${stage}`).toBeGreaterThan(0);
        visual.group.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
          }
        });
        visual.materials.forEach((material) => {
          material.dispose();
        });
      }
    }
  });

  it('renders every active projectile and active zone kind with depth-tested transparent materials', () => {
    const scene = new THREE.Scene();
    const layer = new CombatEffectsLayer(scene, 'balanced');
    layer.update(
      combatSnapshot({
        activeProjectiles: ACTIVE_PROJECTILE_KINDS.map(activeProjectile),
        activeZones: ACTIVE_ZONE_KINDS.map(activeZone),
      }),
      [],
      1,
    );

    const diagnostics = layer.getDiagnostics();
    expect(diagnostics.activeProjectiles).toBe(ACTIVE_PROJECTILE_KINDS.length);
    expect(diagnostics.activeZones).toBe(ACTIVE_ZONE_KINDS.length);
    expect(Object.keys(diagnostics.activeZoneKinds).sort()).toEqual([...ACTIVE_ZONE_KINDS].sort());

    const transparentMaterials: THREE.Material[] = [];
    scene.getObjectByName('combat-effects')?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      transparentMaterials.push(...materials.filter((material) => material.transparent));
    });
    expect(transparentMaterials.length).toBeGreaterThan(0);
    expect(
      transparentMaterials.every((material) => material.depthTest && !material.depthWrite),
    ).toBe(true);

    layer.dispose();
    expect(scene.getObjectByName('combat-effects')).toBeUndefined();
  });

  it('culls combat effects outside the active graphics-tier radius', () => {
    const scene = new THREE.Scene();
    const layer = new CombatEffectsLayer(scene, 'reduced');
    const nearProjectile = {
      ...activeProjectile('line-damage', 1),
      position: vec2Mm(44_000, 0),
    };
    const farProjectile = {
      ...activeProjectile('root', 2),
      position: vec2Mm(46_000, 0),
    };
    const nearZone = {
      ...activeZone('fire-wall', 1),
      center: vec2Mm(50_000, 0),
    };
    const farZone = {
      ...activeZone('damage-slow', 2),
      center: vec2Mm(52_000, 0),
    };
    const snapshot = combatSnapshot({
      activeProjectiles: [nearProjectile, farProjectile],
      activeZones: [nearZone, farZone],
    });

    layer.update(snapshot, [], 1, vec2Mm(0, 0));
    expect(layer.getDiagnostics()).toMatchObject({
      activeProjectiles: 1,
      activeZones: 1,
      transientLimit: 28,
    });

    layer.setGraphicsTier('balanced');
    layer.update(snapshot, [], 2, vec2Mm(0, 0));
    expect(layer.getDiagnostics()).toMatchObject({
      activeProjectiles: 2,
      activeZones: 2,
      transientLimit: 56,
    });

    layer.dispose();
  });

  it('spawns bounded attack, cast, damage and heal effects from authoritative events', () => {
    const scene = new THREE.Scene();
    const layer = new CombatEffectsLayer(scene, 'balanced');
    const player = {
      entityId: entityId(1),
      heroId: heroId('H009'),
      position: vec2Mm(0, 0),
      facing: vec2Mm(0, 1_000),
      lifeState: 'alive',
      attackRangeMm: 5_000,
    } as PlayerSnapshot;
    const events = [
      {
        type: 'basic-attack',
        tick: 100,
        sourceEntityId: entityId(1),
        targetEntityId: entityId(1),
      },
      {
        type: 'active-cast',
        tick: 100,
        entityId: entityId(1),
        heroId: heroId('H009'),
        activeAbilityId: activeId('H009'),
        activeName: '大闹天宫',
      },
      {
        type: 'damage',
        tick: 100,
        sourceEntityId: entityId(1),
        targetEntityId: entityId(1),
        cause: 'basic',
        form: 'basic',
        isCritical: true,
        amount: 100,
        shieldDamage: 0,
        hpDamage: 100,
        shieldBypassHpDamage: 0,
        remainingHp: 900,
        remainingShield: 0,
      },
      {
        type: 'active-heal',
        tick: 100,
        sourceEntityId: entityId(1),
        targetEntityId: entityId(1),
        activeAbilityId: activeId('H009'),
        amount: 50,
        remainingHp: 950,
      },
    ] as readonly SimEvent[];

    layer.update(combatSnapshot({ players: [player] }), events, 10);
    expect(layer.getDiagnostics()).toMatchObject({
      basicAttackEffectsSpawned: 1,
      activeCastEffectsSpawned: 1,
      impactEffectsSpawned: 1,
      lastAttackHeroId: 'H009',
    });
    expect(layer.getDiagnostics().transientEffects).toBe(4);

    layer.update(combatSnapshot({ players: [player] }), [], 11);
    expect(layer.getDiagnostics().transientEffects).toBe(0);

    const attackEvents = Array.from({ length: 120 }, (_, index) => ({
      type: 'basic-attack',
      tick: 200 + index,
      sourceEntityId: entityId(1),
      targetEntityId: entityId(1),
    })) as readonly SimEvent[];
    layer.update(combatSnapshot({ players: [player] }), attackEvents, 12);
    expect(layer.getDiagnostics().transientEffects).toBeLessThanOrEqual(
      layer.getDiagnostics().transientLimit,
    );
    layer.dispose();
  });

  it('uses exact event ability IDs for damage, status and summon effects without recent-cast guessing', () => {
    const scene = new THREE.Scene();
    const layer = new CombatEffectsLayer(scene, 'balanced');
    const source = {
      entityId: entityId(1),
      heroId: heroId('H009'),
      activeAbilityId: activeId('H009'),
      position: vec2Mm(0, 0),
      facing: vec2Mm(0, 1_000),
      lifeState: 'alive',
      attackRangeMm: 5_000,
    } as PlayerSnapshot;
    const target = {
      ...source,
      entityId: entityId(2),
      heroId: heroId('H018'),
      activeAbilityId: activeId('H018'),
      position: vec2Mm(2_000, 0),
    } as PlayerSnapshot;
    const summon = {
      entityId: entityId(3),
      ownerEntityId: source.entityId,
      activeAbilityId: activeId('H012'),
      kind: 'decoy',
      position: vec2Mm(1_000, 1_000),
    } as SummonSnapshot;
    const status = {
      key: '1:2:petrify',
      sourceEntityId: source.entityId,
      targetEntityId: target.entityId,
      activeId: activeId('H037'),
      kind: 'petrify',
      stacks: 1,
      maximumStacks: 1,
      expiresAtTick: 140,
    } as ActiveTargetEffectSnapshot;
    const events = [
      {
        type: 'active-cast',
        tick: 100,
        entityId: source.entityId,
        heroId: source.heroId,
        activeAbilityId: activeId('H009'),
        activeName: 'golden-staff',
      },
      {
        type: 'damage',
        tick: 100,
        sourceEntityId: source.entityId,
        targetEntityId: target.entityId,
        activeAbilityId: activeId('H024'),
        cause: 'active',
        form: 'skill',
        isCritical: false,
        amount: 100,
        shieldDamage: 0,
        hpDamage: 100,
        shieldBypassHpDamage: 0,
        remainingHp: 900,
        remainingShield: 0,
      },
      {
        type: 'active-status-applied',
        tick: 100,
        sourceEntityId: source.entityId,
        targetEntityId: target.entityId,
        activeAbilityId: activeId('H037'),
        status: 'petrify',
        durationTicks: 40,
      },
      {
        type: 'summon-spawned',
        tick: 100,
        entityId: summon.entityId,
        ownerEntityId: source.entityId,
        summonKind: summon.kind,
        activeAbilityId: activeId('H012'),
      },
    ] as readonly SimEvent[];

    layer.update(
      combatSnapshot({
        players: [source, target],
        summons: [summon],
        activeTargetEffects: [status],
      }),
      events,
      10,
    );
    expect(layer.getDiagnostics()).toMatchObject({
      activeTargetEffects: 1,
      heroSkillCastsSpawned: 1,
      heroSkillImpactsSpawned: 3,
      lastSkillHeroId: 'H012',
    });
    expect(scene.getObjectByName('hero-skill-h024-impact-tiger-arrow')).toBeDefined();
    expect(scene.getObjectByName('hero-skill-h037-impact-ram-spirit')).toBeDefined();
    expect(scene.getObjectByName('hero-skill-h012-impact-mirror-clones')).toBeDefined();
    layer.dispose();
  });

  it('does not infer a hero skill when active damage lacks an ability ID', () => {
    const scene = new THREE.Scene();
    const layer = new CombatEffectsLayer(scene, 'balanced');
    const source = {
      entityId: entityId(1),
      heroId: heroId('H009'),
      activeAbilityId: activeId('H009'),
      position: vec2Mm(0, 0),
      facing: vec2Mm(0, 1_000),
      lifeState: 'alive',
      attackRangeMm: 5_000,
    } as PlayerSnapshot;
    const target = {
      ...source,
      entityId: entityId(2),
      position: vec2Mm(2_000, 0),
    } as PlayerSnapshot;
    const events = [
      {
        type: 'active-cast',
        tick: 100,
        entityId: source.entityId,
        heroId: source.heroId,
        activeAbilityId: activeId('H009'),
        activeName: 'golden-staff',
      },
      {
        type: 'damage',
        tick: 100,
        sourceEntityId: source.entityId,
        targetEntityId: target.entityId,
        cause: 'active',
        form: 'skill',
        isCritical: false,
        amount: 100,
        shieldDamage: 0,
        hpDamage: 100,
        shieldBypassHpDamage: 0,
        remainingHp: 900,
        remainingShield: 0,
      },
    ] as readonly SimEvent[];

    layer.update(combatSnapshot({ players: [source, target] }), events, 10);
    expect(layer.getDiagnostics()).toMatchObject({
      heroSkillCastsSpawned: 1,
      heroSkillImpactsSpawned: 0,
      impactEffectsSpawned: 1,
      lastSkillHeroId: 'H009',
    });
    layer.dispose();
  });
});
