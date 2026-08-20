import { EQUIPMENT_IDS, getActiveDefinition, HERO_IDS } from '@jwgb/content';
import {
  activeId,
  createPlayerIntent,
  type EntityId,
  entityId,
  heroId,
  playerId,
  vec2Mm,
} from '@jwgb/core';
import { GameSimulation, type MutableSimulationState, type PlayerEntity } from '@jwgb/sim';
import { canSeeActiveTarget } from '../packages/sim/src/systems/active-targeting';

interface ActiveScenario {
  readonly simulation: GameSimulation;
  readonly state: MutableSimulationState;
  readonly caster: EntityId;
  readonly target: EntityId;
}

function internalState(simulation: GameSimulation): MutableSimulationState {
  return (
    simulation as unknown as {
      readonly state: MutableSimulationState;
    }
  ).state;
}

function requiredPlayer(state: MutableSimulationState, targetEntityId: EntityId): PlayerEntity {
  const player = state.players.get(targetEntityId);
  if (!player) {
    throw new Error(`missing player ${targetEntityId}`);
  }
  return player;
}

function createScenario(
  activeIdValue: string,
  options: {
    readonly casterPosition?: { readonly x: number; readonly z: number };
    readonly targetPosition?: { readonly x: number; readonly z: number };
    readonly secondTargetPosition?: { readonly x: number; readonly z: number };
  } = {},
): ActiveScenario & { readonly secondTarget?: EntityId } {
  const simulation = new GameSimulation({ rootSeed: 0x5100 + Number(activeIdValue.slice(1)) });
  const caster = simulation.addPlayer({
    playerId: playerId(`${activeIdValue}-caster`),
    heroId: activeIdValue.startsWith('H') ? heroId(activeIdValue) : HERO_IDS.sunWukong,
    activeAbilityId: activeId(activeIdValue),
    position: options.casterPosition
      ? vec2Mm(options.casterPosition.x, options.casterPosition.z)
      : vec2Mm(0, 0),
  });
  const target = simulation.addPlayer({
    playerId: playerId(`${activeIdValue}-target`),
    heroId: HERO_IDS.sunWukong,
    position: options.targetPosition
      ? vec2Mm(options.targetPosition.x, options.targetPosition.z)
      : vec2Mm(10_000, 0),
  });
  const secondTarget = options.secondTargetPosition
    ? simulation.addPlayer({
        playerId: playerId(`${activeIdValue}-second-target`),
        heroId: HERO_IDS.sunWukong,
        position: vec2Mm(options.secondTargetPosition.x, options.secondTargetPosition.z),
      })
    : undefined;
  simulation.drainEvents();
  return {
    simulation,
    state: internalState(simulation),
    caster,
    target,
    ...(secondTarget === undefined ? {} : { secondTarget }),
  };
}

function cast(
  scenario: ActiveScenario,
  options: {
    readonly targetEntityId?: EntityId | null;
    readonly secondaryTargetEntityId?: EntityId | null;
    readonly aimX?: number;
    readonly aimZ?: number;
    readonly alternateActive?: boolean;
  } = {},
): void {
  const caster = requiredPlayer(scenario.state, scenario.caster);
  scenario.simulation.submitIntent(
    scenario.caster,
    createPlayerIntent({
      sequence: caster.intent.sequence + 1,
      moveX: 0,
      moveZ: 0,
      aimX: options.aimX ?? 1_000,
      aimZ: options.aimZ ?? 0,
      castActive: true,
      targetEntityId: options.targetEntityId ?? scenario.target,
      secondaryTargetEntityId: options.secondaryTargetEntityId ?? null,
      alternateActive: options.alternateActive ?? false,
    }),
  );
  scenario.simulation.step();
}

function playerSnapshot(scenario: ActiveScenario, targetEntityId: EntityId) {
  const player = scenario.simulation
    .getSnapshot()
    .players.find((candidate) => candidate.entityId === targetEntityId);
  if (!player) {
    throw new Error(`missing player snapshot ${targetEntityId}`);
  }
  return player;
}

describe('scripted hero active runtime behavior', () => {
  it.each([
    {
      id: 'H002',
      kind: 'fire-wall',
      targetPosition: vec2Mm(7_500, 0),
      pulseTicks: 20,
      slowBasisPoints: 10_000,
    },
    {
      id: 'H003',
      kind: 'damage-slow',
      targetPosition: vec2Mm(10_000, 0),
      pulseTicks: 20,
      slowBasisPoints: 7_500,
    },
    {
      id: 'H006',
      kind: 'spreading-poison',
      targetPosition: vec2Mm(10_000, 0),
      pulseTicks: 20,
      slowBasisPoints: 10_000,
    },
    {
      id: 'H007',
      kind: 'damage-slow',
      targetPosition: vec2Mm(10_000, 0),
      pulseTicks: 20,
      slowBasisPoints: 6_000,
    },
    {
      id: 'H033',
      kind: 'displacement-lock',
      targetPosition: vec2Mm(10_000, 0),
      pulseTicks: 20,
      slowBasisPoints: 4_000,
    },
  ])('$id creates a live $kind zone whose pulse changes its target', (entry) => {
    const scenario = createScenario(entry.id, { targetPosition: entry.targetPosition });
    const hpBefore = playerSnapshot(scenario, scenario.target).hp;

    cast(scenario, { aimX: 1_000, aimZ: 0 });

    expect(scenario.simulation.getSnapshot().activeZones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activeId: activeId(entry.id),
          kind: entry.kind,
        }),
      ]),
    );
    scenario.simulation.step(entry.pulseTicks);

    const target = playerSnapshot(scenario, scenario.target);
    expect(target.hp).toBeLessThan(hpBefore);
    expect(target.slowBasisPoints).toBe(entry.slowBasisPoints);
    if (entry.id === 'H002') {
      expect(scenario.simulation.getSnapshot().activeTargetEffects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            activeId: activeId('H002'),
            targetEntityId: scenario.target,
            kind: 'damage-over-time',
          }),
        ]),
      );
    }
    if (entry.id === 'H006') {
      expect(scenario.simulation.getSnapshot().activeZones).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            activeId: activeId('H006'),
            followTargetEntityId: scenario.target,
            generation: 1,
          }),
        ]),
      );
    }
    if (entry.id === 'H033') {
      expect(target.displacementLockTicks).toBe(60);
    }
  });

  it('H004 injects three venom stacks, ticks, then detonates them for max-health damage', () => {
    const scenario = createScenario('H004');
    cast(scenario);

    expect(scenario.simulation.getSnapshot().activeTargetEffects).toEqual([
      expect.objectContaining({
        activeId: activeId('H004'),
        targetEntityId: scenario.target,
        kind: 'venom',
        stacks: 3,
        fixedDamage: 5,
      }),
    ]);
    const hpBeforePulse = playerSnapshot(scenario, scenario.target).hp;
    scenario.simulation.step(20);
    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(hpBeforePulse);

    requiredPlayer(scenario.state, scenario.caster).activeCooldownTicks = 0;
    const hpBeforeDetonation = playerSnapshot(scenario, scenario.target).hp;
    cast(scenario);

    expect(scenario.simulation.getSnapshot().activeTargetEffects).toHaveLength(0);
    expect(
      hpBeforeDetonation - playerSnapshot(scenario, scenario.target).hp,
    ).toBeGreaterThanOrEqual(
      Math.trunc((playerSnapshot(scenario, scenario.target).maxHp * 9) / 100),
    );
  });

  it('H005 petrifies one enemy into simultaneous invulnerability and hard control', () => {
    const scenario = createScenario('H005');
    cast(scenario);
    expect(playerSnapshot(scenario, scenario.target)).toMatchObject({
      invulnerableTicks: 30,
      hardControlTicks: 30,
    });
  });

  it.each([
    { id: 'H008', delayTicks: 30, slowBasisPoints: 10_000 },
    { id: 'H029', delayTicks: 24, slowBasisPoints: 6_000 },
  ])('$id resolves its warned area strike after the authored delay', (entry) => {
    const scenario = createScenario(entry.id);
    const hpBefore = playerSnapshot(scenario, scenario.target).hp;
    cast(scenario);

    expect(scenario.simulation.getSnapshot().activeZones[0]).toMatchObject({
      activeId: activeId(entry.id),
      kind: 'delayed-strike',
      activatesAtTick: 1 + entry.delayTicks,
    });
    scenario.simulation.step(entry.delayTicks);

    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(hpBefore);
    expect(playerSnapshot(scenario, scenario.target).slowBasisPoints).toBe(entry.slowBasisPoints);
  });

  it('H010 arms the next basic with a guaranteed critical and missing-health damage', () => {
    const scenario = createScenario('H010', { targetPosition: vec2Mm(4_000, 0) });
    cast(scenario);
    expect(playerSnapshot(scenario, scenario.caster)).toMatchObject({
      armedCriticalTicks: 2_147_483_647,
      armedMissingHpDamagePercent: 15,
      armedActiveId: activeId('H010'),
    });
  });

  it('H011 stops its dash on the first target and applies damage plus control', () => {
    const scenario = createScenario('H011', { targetPosition: vec2Mm(10_000, 0) });
    const hpBefore = playerSnapshot(scenario, scenario.target).hp;
    cast(scenario);

    expect(playerSnapshot(scenario, scenario.caster).position.x).toBeGreaterThan(0);
    expect(playerSnapshot(scenario, scenario.caster).position.x).toBeLessThanOrEqual(10_000);
    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(hpBefore);
    expect(playerSnapshot(scenario, scenario.target).hardControlTicks).toBe(16);
  });

  it('H012 creates two harmless decoys with thirty percent inherited health', () => {
    const scenario = createScenario('H012');
    const caster = playerSnapshot(scenario, scenario.caster);
    cast(scenario);

    const decoys = scenario.simulation
      .getSnapshot()
      .summons.filter((summon) => summon.kind === 'decoy');
    expect(decoys).toHaveLength(2);
    expect(decoys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerEntityId: scenario.caster,
          maxHp: Math.trunc((caster.maxHp * 3_000) / 10_000),
          attackPower: 0,
          expiresAtTick: 161,
        }),
      ]),
    );
  });

  it('H013 teleports behind its target and arms a guaranteed critical', () => {
    const scenario = createScenario('H013', { targetPosition: vec2Mm(10_000, 0) });
    requiredPlayer(scenario.state, scenario.target).facing = vec2Mm(1_000, 0);
    cast(scenario);

    expect(playerSnapshot(scenario, scenario.caster)).toMatchObject({
      position: vec2Mm(8_500, 0),
      armedCriticalTicks: 2_147_483_647,
      armedActiveId: activeId('H013'),
    });
  });

  it('H014 blinks forward and its abandoned body detonates after one second', () => {
    const scenario = createScenario('H014', { targetPosition: vec2Mm(0, 0) });
    const hpBefore = playerSnapshot(scenario, scenario.target).hp;
    cast(scenario);

    expect(playerSnapshot(scenario, scenario.caster).position).toEqual(vec2Mm(15_000, 0));
    expect(scenario.simulation.getSnapshot().activeZones[0]).toMatchObject({
      activeId: activeId('H014'),
      kind: 'decoy-bomb',
      center: vec2Mm(0, 0),
    });
    scenario.simulation.step(20);
    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(hpBefore);
  });

  it('H015 damages and slows targets inside its forward cone', () => {
    const scenario = createScenario('H015', {
      targetPosition: vec2Mm(5_000, 0),
      secondTargetPosition: vec2Mm(-5_000, 0),
    });
    const secondTarget = scenario.secondTarget;
    if (secondTarget === undefined) throw new Error('missing second target');
    const firstHp = playerSnapshot(scenario, scenario.target).hp;
    const secondHp = playerSnapshot(scenario, secondTarget).hp;
    cast(scenario);

    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(firstHp);
    expect(playerSnapshot(scenario, scenario.target).slowBasisPoints).toBe(7_000);
    expect(playerSnapshot(scenario, secondTarget).hp).toBe(secondHp);
  });

  it('H016 traverses the full line, damaging and knocking back every intersected enemy', () => {
    const scenario = createScenario('H016', {
      targetPosition: vec2Mm(8_000, 0),
      secondTargetPosition: vec2Mm(14_000, 0),
    });
    const secondTarget = scenario.secondTarget;
    if (secondTarget === undefined) throw new Error('missing second target');
    const firstHp = playerSnapshot(scenario, scenario.target).hp;
    const secondHp = playerSnapshot(scenario, secondTarget).hp;
    cast(scenario);

    expect(playerSnapshot(scenario, scenario.caster).position).toEqual(vec2Mm(25_000, 0));
    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(firstHp);
    expect(playerSnapshot(scenario, secondTarget).hp).toBeLessThan(secondHp);
    expect(playerSnapshot(scenario, scenario.target).position.x).toBeGreaterThan(8_000);
    expect(playerSnapshot(scenario, secondTarget).position.x).toBeGreaterThan(14_000);
  });

  it('H017 pushes nearby enemies to its radius edge and hard-controls them', () => {
    const scenario = createScenario('H017', { targetPosition: vec2Mm(5_000, 0) });
    const hpBefore = playerSnapshot(scenario, scenario.target).hp;
    cast(scenario);

    expect(playerSnapshot(scenario, scenario.target)).toMatchObject({
      position: vec2Mm(12_000, 0),
      hardControlTicks: 20,
    });
    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(hpBefore);
  });

  it('H019 applies three seconds of silence inside the warned zone', () => {
    const scenario = createScenario('H019');
    cast(scenario);
    scenario.simulation.step();
    expect(playerSnapshot(scenario, scenario.target).silenceTicks).toBe(60);
  });

  it.each([
    { id: 'H020', kind: 'stone-arhat', count: 1, hp: 500, attack: 30 },
    { id: 'D19', kind: 'bean-soldier', count: 3, hp: 150, attack: 15 },
  ])('$id creates its authored combat summons', (entry) => {
    const scenario = createScenario(entry.id);
    cast(scenario);
    const summons = scenario.simulation
      .getSnapshot()
      .summons.filter((summon) => summon.kind === entry.kind);
    expect(summons).toHaveLength(entry.count);
    for (const summon of summons) {
      expect(summon).toMatchObject({
        ownerEntityId: scenario.caster,
        hp: entry.hp,
        maxHp: entry.hp,
        attackPower: entry.attack,
      });
    }
  });

  it('H021 pulls every nearby enemy to the caster after its one-second warning', () => {
    const scenario = createScenario('H021', { targetPosition: vec2Mm(10_000, 0) });
    const hpBefore = playerSnapshot(scenario, scenario.target).hp;
    cast(scenario);
    scenario.simulation.step(20);

    expect(playerSnapshot(scenario, scenario.target).position).toEqual(vec2Mm(0, 0));
    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(hpBefore);
  });

  it('H022 spends the bounded gold amount and converts ten percent to true damage', () => {
    const scenario = createScenario('H022');
    const hpBefore = playerSnapshot(scenario, scenario.target).hp;
    cast(scenario);

    expect(playerSnapshot(scenario, scenario.caster).gold).toBe(0);
    expect(hpBefore - playerSnapshot(scenario, scenario.target).hp).toBe(50);
    expect(scenario.simulation.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'damage',
          sourceEntityId: scenario.caster,
          targetEntityId: scenario.target,
          cause: 'active',
          form: 'true',
          hpDamage: 50,
        }),
      ]),
    );
  });

  it('H023 attaches a revealed damage-over-time effect for eight seconds', () => {
    const scenario = createScenario('H023');
    cast(scenario);
    expect(scenario.simulation.getSnapshot().activeTargetEffects).toEqual([
      expect.objectContaining({
        activeId: activeId('H023'),
        kind: 'damage-over-time',
        targetEntityId: scenario.target,
        revealToSource: true,
        expiresAtTick: 161,
      }),
    ]);
  });

  it('H025 creates a following aura that damages enemies and heals its owner', () => {
    const scenario = createScenario('H025', { targetPosition: vec2Mm(4_000, 0) });
    const owner = requiredPlayer(scenario.state, scenario.caster);
    owner.hp -= 100;
    const ownerHpBefore = owner.hp;
    const targetHpBefore = requiredPlayer(scenario.state, scenario.target).hp;
    cast(scenario);
    scenario.simulation.step(20);

    expect(playerSnapshot(scenario, scenario.caster).hp).toBeGreaterThan(ownerHpBefore);
    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(targetHpBefore);
    expect(scenario.simulation.getSnapshot().activeZones[0]).toMatchObject({
      activeId: activeId('H025'),
      kind: 'lifesteal-aura',
      followsOwner: true,
    });
  });

  it('H026 deals target damage and applies a two-second hard control', () => {
    const scenario = createScenario('H026');
    const hpBefore = playerSnapshot(scenario, scenario.target).hp;
    cast(scenario);
    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(hpBefore);
    expect(playerSnapshot(scenario, scenario.target).hardControlTicks).toBe(40);
  });

  it('H027 heals the explicitly selected hero regardless of allegiance', () => {
    const scenario = createScenario('H027');
    requiredPlayer(scenario.state, scenario.target).hp = 100;
    cast(scenario);
    expect(playerSnapshot(scenario, scenario.target).hp).toBe(320);
  });

  it('H028 marks one target for thirty percent bonus damage', () => {
    const scenario = createScenario('H028');
    cast(scenario);
    expect(scenario.simulation.getSnapshot().activeTargetEffects).toEqual([
      expect.objectContaining({
        activeId: activeId('H028'),
        kind: 'damage-mark',
        targetEntityId: scenario.target,
        targetDamageBonusPercent: 30,
      }),
    ]);
    expect(scenario.simulation.damage(scenario.target, 100, scenario.caster, 'skill')).toBe(130);
  });

  it('H030 heals every hero inside its neutral four-pulse area', () => {
    const scenario = createScenario('H030', { targetPosition: vec2Mm(5_000, 0) });
    requiredPlayer(scenario.state, scenario.caster).hp -= 100;
    requiredPlayer(scenario.state, scenario.target).hp -= 100;
    const casterHpBefore = requiredPlayer(scenario.state, scenario.caster).hp;
    const targetHpBefore = requiredPlayer(scenario.state, scenario.target).hp;
    cast(scenario);
    scenario.simulation.step(20);

    expect(playerSnapshot(scenario, scenario.caster).hp).toBe(casterHpBefore + 40);
    expect(playerSnapshot(scenario, scenario.target).hp).toBe(targetHpBefore + 40);
  });

  it('H031 creates a solid ring that blocks crossing movement', () => {
    const scenario = createScenario('H031', { targetPosition: vec2Mm(16_000, 0) });
    cast(scenario);
    expect(scenario.simulation.getSnapshot().activeZones[0]).toMatchObject({
      activeId: activeId('H031'),
      kind: 'ring-wall',
      center: vec2Mm(16_000, 0),
      radiusMm: 10_000,
    });

    scenario.simulation.submitIntent(
      scenario.caster,
      createPlayerIntent({
        sequence: 2,
        moveX: 1_000,
        moveZ: 0,
      }),
    );
    scenario.simulation.step(60);
    expect(playerSnapshot(scenario, scenario.caster).position.x).toBeLessThan(6_000);
  });

  it('H032 grants mobile invulnerability while locking world-resource interactions', () => {
    const scenario = createScenario('H032');
    cast(scenario);
    expect(playerSnapshot(scenario, scenario.caster)).toMatchObject({
      invulnerableTicks: 60,
      worldInteractionLockTicks: 60,
    });
    expect(scenario.simulation.damage(scenario.caster, 100, scenario.target, 'skill')).toBe(0);
  });

  it('H034 grants eighty-percent damage reduction and fifteen-percent movement speed', () => {
    const scenario = createScenario('H034');
    cast(scenario);
    expect(playerSnapshot(scenario, scenario.caster)).toMatchObject({
      activeDamageReductionTicks: 80,
      activeDamageReductionBasisPoints: 2_000,
      activeSpeedBonusTicks: 80,
      activeSpeedBonusPercent: 15,
    });
    expect(scenario.simulation.damage(scenario.caster, 100, scenario.target, 'skill')).toBe(20);
  });

  it('H036 creates one targetable 300-health ice wall with a forty-second lifetime', () => {
    const scenario = createScenario('H036');
    cast(scenario);
    expect(scenario.simulation.getSnapshot().activeZones).toEqual([
      expect.objectContaining({
        activeId: activeId('H036'),
        kind: 'ice-wall',
        hp: 300,
        maxHp: 300,
        targetable: true,
        expiresAtTick: 801,
      }),
    ]);
  });

  it('H037 petrifies the selected target and can select its owner as the alternate mode', () => {
    const scenario = createScenario('H037');
    cast(scenario);
    expect(playerSnapshot(scenario, scenario.target)).toMatchObject({
      invulnerableTicks: 30,
      hardControlTicks: 30,
    });

    requiredPlayer(scenario.state, scenario.caster).activeCooldownTicks = 0;
    cast(scenario, { targetEntityId: scenario.caster });
    expect(playerSnapshot(scenario, scenario.caster)).toMatchObject({
      invulnerableTicks: 30,
      hardControlTicks: 30,
    });
  });

  it('H038 smoke blocks line of sight when only the target is inside', () => {
    const scenario = createScenario('H038', { targetPosition: vec2Mm(10_000, 0) });
    cast(scenario);
    const owner = requiredPlayer(scenario.state, scenario.caster);
    const target = requiredPlayer(scenario.state, scenario.target);
    expect(scenario.simulation.getSnapshot().activeZones[0]).toMatchObject({
      activeId: activeId('H038'),
      kind: 'smoke',
      center: vec2Mm(10_000, 0),
      radiusMm: 8_000,
    });
    expect(canSeeActiveTarget(scenario.state, owner, target)).toBe(false);
  });
});

describe('scripted generic active runtime behavior', () => {
  it.each([
    {
      id: 'D1',
      kind: 'hook',
      targetPosition: vec2Mm(10_000, 0),
      steps: 4,
      expectedStatus: 'displacementLockTicks',
      expectedStatusValue: 6,
    },
    {
      id: 'D4',
      kind: 'polymorph',
      targetPosition: vec2Mm(10_000, 0),
      steps: 4,
      expectedStatus: 'polymorphTicks',
      expectedStatusValue: 40,
    },
    {
      id: 'H024',
      kind: 'line-damage',
      targetPosition: vec2Mm(20_000, 0),
      steps: 6,
      expectedStatus: null,
      expectedStatusValue: 0,
    },
    {
      id: 'H035',
      kind: 'root',
      targetPosition: vec2Mm(10_000, 0),
      steps: 4,
      expectedStatus: 'displacementLockTicks',
      expectedStatusValue: 40,
    },
  ])('$id projectile reaches its target and resolves $kind', (entry) => {
    const scenario = createScenario(entry.id, { targetPosition: entry.targetPosition });
    const hpBefore = playerSnapshot(scenario, scenario.target).hp;
    cast(scenario);
    expect(scenario.simulation.getSnapshot().activeProjectiles[0]).toMatchObject({
      activeId: activeId(entry.id),
      kind: entry.kind,
    });
    scenario.simulation.step(entry.steps);

    const target = playerSnapshot(scenario, scenario.target);
    if (entry.id === 'D4' || entry.id === 'H035') {
      expect(target.hp).toBe(hpBefore);
    } else {
      expect(target.hp).toBeLessThan(hpBefore);
    }
    if (entry.expectedStatus !== null) {
      expect(target[entry.expectedStatus as keyof typeof target]).toBe(entry.expectedStatusValue);
    }
    if (entry.id === 'D1') {
      expect(target.position.x).toBeLessThanOrEqual(1_200);
    }
    if (entry.id === 'D4') {
      expect(target.polymorphSpeedBonusPercent).toBe(30);
    }
  });

  it('D7 grants five seconds of stealth and thirty-percent speed', () => {
    const scenario = createScenario('D7');
    cast(scenario, { targetEntityId: null });
    expect(playerSnapshot(scenario, scenario.caster)).toMatchObject({
      stealthTicks: 100,
      activeSpeedBonusTicks: 100,
      activeSpeedBonusPercent: 30,
    });
  });

  it('D10 chains to at most six nearby targets with deterministic decay', () => {
    const scenario = createScenario('D10', {
      targetPosition: vec2Mm(10_000, 0),
      secondTargetPosition: vec2Mm(20_000, 0),
    });
    const secondTarget = scenario.secondTarget;
    if (secondTarget === undefined) throw new Error('missing second target');
    const firstHp = playerSnapshot(scenario, scenario.target).hp;
    const secondHp = playerSnapshot(scenario, secondTarget).hp;
    cast(scenario);

    const firstDamage = firstHp - playerSnapshot(scenario, scenario.target).hp;
    const secondDamage = secondHp - playerSnapshot(scenario, secondTarget).hp;
    expect(firstDamage).toBeGreaterThan(0);
    expect(secondDamage).toBeGreaterThan(0);
    expect(secondDamage).toBeLessThan(firstDamage);
  });

  it('D12 creates an eighteen-hundred-tick private reward mark', () => {
    const scenario = createScenario('D12');
    cast(scenario);
    expect(scenario.simulation.getSnapshot().bountyMarks).toEqual([
      {
        sourceEntityId: scenario.caster,
        targetEntityId: scenario.target,
        rewardGold: 800,
        rewardRecipientEntityId: scenario.caster,
        revealToAll: false,
        expiresAtTick: 1_801,
      },
    ]);
  });

  it('D13 swaps two explicitly selected living targets without moving its caster', () => {
    const scenario = createScenario('D13', {
      targetPosition: vec2Mm(10_000, 0),
      secondTargetPosition: vec2Mm(20_000, 0),
    });
    const secondTarget = scenario.secondTarget;
    if (secondTarget === undefined) throw new Error('missing second target');
    cast(scenario, {
      targetEntityId: scenario.target,
      secondaryTargetEntityId: secondTarget,
    });

    expect(playerSnapshot(scenario, scenario.caster).position).toEqual(vec2Mm(0, 0));
    expect(playerSnapshot(scenario, scenario.target).position).toEqual(vec2Mm(20_000, 0));
    expect(playerSnapshot(scenario, secondTarget).position).toEqual(vec2Mm(10_000, 0));
  });

  it('D14 restores position and health from five seconds earlier', () => {
    const scenario = createScenario('D14', { targetPosition: vec2Mm(50_000, 0) });
    scenario.simulation.submitIntent(
      scenario.caster,
      createPlayerIntent({
        sequence: 1,
        moveX: 1_000,
        moveZ: 0,
      }),
    );
    scenario.simulation.step(100);
    requiredPlayer(scenario.state, scenario.caster).hp -= 200;
    const positionBefore = playerSnapshot(scenario, scenario.caster).position.x;
    const hpBefore = playerSnapshot(scenario, scenario.caster).hp;
    cast(scenario, { targetEntityId: null });

    expect(playerSnapshot(scenario, scenario.caster).position.x).toBeLessThan(positionBefore);
    expect(playerSnapshot(scenario, scenario.caster).hp).toBeGreaterThan(hpBefore);
  });

  it('D15 steals five hundred gold from a player target', () => {
    const scenario = createScenario('D15');
    requiredPlayer(scenario.state, scenario.target).gold = 900;
    cast(scenario);
    expect(playerSnapshot(scenario, scenario.caster).gold).toBe(1_000);
    expect(playerSnapshot(scenario, scenario.target).gold).toBe(400);
  });

  it('D17 toggles a public self-bounty contract', () => {
    const scenario = createScenario('D17');
    cast(scenario, { targetEntityId: null });
    expect(scenario.simulation.getSnapshot().bountyMarks).toEqual([
      expect.objectContaining({
        sourceEntityId: scenario.caster,
        targetEntityId: scenario.caster,
        revealToAll: true,
        expiresAtTick: Number.MAX_SAFE_INTEGER,
      }),
    ]);

    requiredPlayer(scenario.state, scenario.caster).activeCooldownTicks = 0;
    cast(scenario, { targetEntityId: null });
    expect(scenario.simulation.getSnapshot().bountyMarks).toHaveLength(0);
  });

  it('D18 reveals old equipment drops inside eighty meters for twenty seconds', () => {
    const scenario = createScenario('D18');
    const lootEntityId = entityId(scenario.state.nextEntityId);
    scenario.state.nextEntityId += 1;
    scenario.state.lootDrops.set(lootEntityId, {
      entityId: lootEntityId,
      position: vec2Mm(20_000, 0),
      gold: 0,
      experience: 0,
      gems: 0,
      equipmentId: EQUIPMENT_IDS.wolfFang,
      bookPassiveId: null,
      createdAtTick: -200,
      expiresAtTick: Number.MAX_SAFE_INTEGER,
    });
    cast(scenario, { targetEntityId: null });

    expect(playerSnapshot(scenario, scenario.caster).treasureSenseTicks).toBe(400);
    expect(scenario.simulation.getSnapshot().activeLootReveals).toEqual([
      {
        key: `${Number(scenario.caster)}:${Number(lootEntityId)}`,
        sourceEntityId: scenario.caster,
        lootEntityId,
        expiresAtTick: 401,
      },
    ]);
  });

  it('D20 arms a trap that damages, controls, and reveals its first entrant', () => {
    const scenario = createScenario('D20', { targetPosition: vec2Mm(10_000, 0) });
    const hpBefore = playerSnapshot(scenario, scenario.target).hp;
    cast(scenario);
    const trap = scenario.simulation.getSnapshot().activeZones[0];
    expect(trap).toMatchObject({
      activeId: activeId('D20'),
      kind: 'trap',
      center: vec2Mm(3_500, 0),
      hp: 1,
      targetable: true,
    });

    requiredPlayer(scenario.state, scenario.target).position = vec2Mm(3_500, 0);
    scenario.simulation.step();
    expect(playerSnapshot(scenario, scenario.target).hp).toBeLessThan(hpBefore);
    expect(playerSnapshot(scenario, scenario.target).hardControlTicks).toBe(30);
    expect(scenario.simulation.getSnapshot().activeTargetEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activeId: activeId('D20'),
          targetEntityId: scenario.target,
          kind: 'reveal',
          revealToSource: true,
        }),
        expect.objectContaining({
          activeId: activeId('D20'),
          targetEntityId: scenario.target,
          kind: 'stun',
        }),
      ]),
    );
    expect(scenario.simulation.getSnapshot().activeTargetEffects).toHaveLength(2);
    expect(scenario.simulation.getSnapshot().activeZones).toHaveLength(0);
  });

  it('keeps every scripted definition connected to the tested runtime dispatch', () => {
    const ids = [
      ...Array.from({ length: 37 }, (_, index) => `H${String(index + 2).padStart(3, '0')}`),
      'D1',
      'D3',
      'D4',
      'D7',
      'D9',
      'D10',
      'D12',
      'D13',
      'D14',
      'D15',
      'D17',
      'D18',
      'D19',
      'D20',
    ].filter((id) => id !== 'H009' && id !== 'H018');
    for (const id of ids) {
      expect(getActiveDefinition(activeId(id)).effect).toBe('scripted');
    }
  });
});
