import { GENERIC_ACTIVE_IDS, HERO_IDS, PASSIVE_IDS } from '@jwgb/content';
import { createPlayerIntent, type EntityId, playerId, SeededRng, vec2Mm } from '@jwgb/core';
import {
  GameSimulation,
  type MonsterEntity,
  type MutableSimulationState,
  type PlayerEntity,
} from '@jwgb/sim';

function internalState(simulation: GameSimulation): MutableSimulationState {
  return (
    simulation as unknown as {
      readonly state: MutableSimulationState;
    }
  ).state;
}

function requiredPlayer(state: MutableSimulationState, entityIdValue: EntityId): PlayerEntity {
  const player = state.players.get(entityIdValue);
  if (!player) {
    throw new Error(`missing player ${entityIdValue}`);
  }
  return player;
}

function firstMonster(state: MutableSimulationState): MonsterEntity {
  const monsters = [...state.monsters.values()].sort(
    (left, right) => Number(left.entityId) - Number(right.entityId),
  )[0];
  const monster =
    [...state.monsters.values()]
      .sort((left, right) => Number(left.entityId) - Number(right.entityId))
      .find((candidate) => candidate.hp >= 120) ?? monsters;
  if (!monster) {
    throw new Error('missing PVE monster');
  }
  monster.invulnerableTicks = 0;
  return monster;
}

function rootSeedForFirstCombatRollBelow(threshold: number): number {
  for (let rootSeed = 1; rootSeed < 10_000; rootSeed += 1) {
    if (new SeededRng(rootSeed).fork('combat').nextInt(100) < threshold) {
      return rootSeed;
    }
  }
  throw new Error(`no combat seed found below ${threshold}`);
}

function createMonsterReactionScenario(
  rootSeed: number,
  passives: PlayerEntity['passives'],
): {
  readonly simulation: GameSimulation;
  readonly target: ReturnType<GameSimulation['addPlayer']>;
  readonly observer: ReturnType<GameSimulation['addPlayer']>;
  readonly targetState: PlayerEntity;
  readonly monster: MonsterEntity;
} {
  const simulation = new GameSimulation({
    rootSeed,
    pve: { enabled: true, population: 'demo' },
  });
  const target = simulation.addPlayer({
    playerId: playerId('reaction-target'),
    heroId: HERO_IDS.sunWukong,
    position: vec2Mm(0, 0),
    passives,
  });
  const observer = simulation.addPlayer({
    playerId: playerId('reaction-observer'),
    heroId: HERO_IDS.sunWukong,
    position: vec2Mm(80_000, 80_000),
  });
  const state = internalState(simulation);
  return {
    simulation,
    target,
    observer,
    targetState: requiredPlayer(state, target),
    monster: firstMonster(state),
  };
}

describe('passive combat authority', () => {
  it('uses B18 current attack power for active attack coefficients only', () => {
    const simulation = new GameSimulation({ rootSeed: 0x801 });
    const caster = simulation.addPlayer({
      playerId: playerId('bloodlust-caster'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.lightning,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.bloodlust, level: 5 }],
    });
    const target = simulation.addPlayer({
      playerId: playerId('bloodlust-target'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(10_000, 0),
    });
    const state = internalState(simulation);
    const casterState = requiredPlayer(state, caster);
    casterState.hp = Math.trunc(casterState.maxHp / 5);
    simulation.drainEvents();

    simulation.submitIntent(
      caster,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
        targetEntityId: target,
      }),
    );
    simulation.step();
    simulation.drainEvents();
    simulation.step(10);

    expect(
      simulation
        .drainEvents()
        .find(
          (event) =>
            event.type === 'damage' &&
            event.sourceEntityId === caster &&
            event.targetEntityId === target,
        ),
    ).toMatchObject({
      type: 'damage',
      hpDamage: 218,
    });
  });

  it('reflects B22 from actual post-reduction basic damage into a monster', () => {
    const { simulation, target, monster } = createMonsterReactionScenario(0x802, [
      { passiveId: PASSIVE_IDS.ironSkin, level: 1 },
      { passiveId: PASSIVE_IDS.reflect, level: 1 },
    ]);
    const monsterHpBefore = monster.hp;
    simulation.drainEvents();

    expect(simulation.damage(target, 100, monster.entityId, 'basic')).toBe(94);
    expect(monster.hp).toBe(monsterHpBefore - 9);
    expect(simulation.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'passive-proc',
          passiveId: PASSIVE_IDS.reflect,
          sourceEntityId: target,
          targetEntityId: monster.entityId,
          amount: 9,
        }),
      ]),
    );
  });

  it('counters direct monster damage as non-elemental reflect damage', () => {
    const rootSeed = rootSeedForFirstCombatRollBelow(16);
    const { simulation, target, monster } = createMonsterReactionScenario(rootSeed, [
      { passiveId: PASSIVE_IDS.counter, level: 5 },
    ]);
    const monsterHpBefore = monster.hp;
    simulation.drainEvents();

    expect(simulation.damage(target, 20, monster.entityId, 'skill')).toBe(20);
    expect(monster.hp).toBe(monsterHpBefore - 120);
    expect(simulation.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'critical-hit',
          passiveId: PASSIVE_IDS.counter,
          sourceEntityId: target,
          targetEntityId: monster.entityId,
          criticalDamagePercent: 200,
        }),
        expect.objectContaining({
          type: 'passive-proc',
          passiveId: PASSIVE_IDS.counter,
          detail: 'counter',
          amount: 120,
          durationTicks: 10,
        }),
      ]),
    );
  });

  it('converts B24 after skill damage and cannot rescue lethal damage', () => {
    const first = createMonsterReactionScenario(0x804, [
      { passiveId: PASSIVE_IDS.absorption, level: 5 },
    ]);
    const monsterHpBefore = first.monster.hp;
    first.simulation.drainEvents();

    expect(first.simulation.damage(first.target, 100, first.monster.entityId, 'skill')).toBe(100);
    expect(first.targetState.hp).toBe(first.targetState.maxHp - 75);
    expect(first.monster.hp).toBe(monsterHpBefore - 12);

    const lethal = createMonsterReactionScenario(0x805, [
      { passiveId: PASSIVE_IDS.absorption, level: 5 },
    ]);
    lethal.targetState.hp = 50;
    lethal.simulation.drainEvents();
    lethal.simulation.damage(lethal.target, 100, lethal.monster.entityId, 'skill');

    expect(lethal.targetState.hp).toBe(0);
    expect(lethal.targetState.lifeState).toBe('soul-flight');
    expect(
      lethal.simulation
        .drainEvents()
        .filter(
          (event) => event.type === 'passive-proc' && event.passiveId === PASSIVE_IDS.absorption,
        ),
    ).toHaveLength(0);
  });
});
