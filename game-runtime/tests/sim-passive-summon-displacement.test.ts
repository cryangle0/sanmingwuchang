import {
  getPassiveDefinition,
  HERO_IDS,
  M0_RULES,
  PASSIVE_IDS,
  passiveLevelValue,
} from '@jwgb/content';
import { createPlayerIntent, entityId, playerId, vec2Mm } from '@jwgb/core';
import {
  GameSimulation,
  type MutableSimulationState,
  type PlayerEntity,
  type SummonEntity,
} from '@jwgb/sim';
import { createBasicAttackSnapshot, resolveBasicHit } from '../packages/sim/src/systems/basic-hit';
import { getOutgoingDamageBasisPoints } from '../packages/sim/src/systems/lethal-protection';
import { applyBasicHitStatuses } from '../packages/sim/src/systems/passive-runtime';

function internalState(simulation: GameSimulation): MutableSimulationState {
  return (
    simulation as unknown as {
      readonly state: MutableSimulationState;
    }
  ).state;
}

function requiredPlayer(
  state: MutableSimulationState,
  entityIdValue: PlayerEntity['entityId'],
): PlayerEntity {
  const player = state.players.get(entityIdValue);
  if (!player) {
    throw new Error(`missing player ${entityIdValue}`);
  }
  return player;
}

function addSummon(
  state: MutableSimulationState,
  owner: PlayerEntity,
  overrides: Partial<SummonEntity> = {},
): SummonEntity {
  const summon: SummonEntity = {
    entityId: entityId(state.nextEntityId),
    ownerEntityId: owner.entityId,
    kind: 'wolf-spirit',
    position: vec2Mm(owner.position.x, owner.position.z),
    hp: 500,
    maxHp: 500,
    attackPower: 0,
    targetable: true,
    expiresAtTick: state.tick + 1_000,
    attackCooldownTicks: 0,
    touchCooldownTicks: 0,
    destroyedByHostileDamage: false,
    ...overrides,
  };
  state.nextEntityId += 1;
  state.summons.set(summon.entityId, summon);
  return summon;
}

describe('passive summon and displacement authority', () => {
  it('stops B03 knockback at the first expanded static wall boundary', () => {
    const simulation = new GameSimulation({
      rootSeed: 0x901,
      staticSolids: [
        {
          solidId: 'knockback-wall',
          minimumX: 1_000,
          maximumX: 2_000,
          minimumZ: -2_000,
          maximumZ: 2_000,
        },
      ],
    });
    const ownerId = simulation.addPlayer({
      playerId: playerId('knockback-owner'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(-1_000, 0),
      passives: [{ passiveId: PASSIVE_IDS.knockback, level: 5 }],
    });
    const targetId = simulation.addPlayer({
      playerId: playerId('knockback-target'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });
    const state = internalState(simulation);
    const owner = requiredPlayer(state, ownerId);
    const target = requiredPlayer(state, targetId);

    applyBasicHitStatuses(state, [], owner, target, true, PASSIVE_IDS.knockback);

    expect(target.position).toEqual(vec2Mm(1_000 - M0_RULES.playerCapsuleRadiusMm - 1, 0));
  });

  it('applies B44 lightning AOE to hostile targetable summons', () => {
    const simulation = new GameSimulation({ rootSeed: 0x902 });
    const ownerId = simulation.addPlayer({
      playerId: playerId('thunder-owner'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.thunderstorm, level: 5 }],
    });
    const targetId = simulation.addPlayer({
      playerId: playerId('thunder-target'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(2_000, 0),
    });
    const state = internalState(simulation);
    const owner = requiredPlayer(state, ownerId);
    const target = requiredPlayer(state, targetId);
    const summon = addSummon(state, target, {
      position: vec2Mm(2_500, 0),
    });
    const definition = getPassiveDefinition(PASSIVE_IDS.thunderstorm);
    if (definition.effect !== 'thunderstorm') {
      throw new Error('B44 definition mismatch');
    }
    const expectedDamage = passiveLevelValue(definition.damageByLevel, 5);

    resolveBasicHit(state, [], owner, target, {
      ...createBasicAttackSnapshot(owner, getOutgoingDamageBasisPoints(owner)),
      forcedPassiveId: PASSIVE_IDS.thunderstorm,
    });

    expect(summon.hp).toBe(summon.maxHp - expectedDamage);
  });

  it('triggers B37 only for hostile destruction, not natural expiry', () => {
    const expired = new GameSimulation({ rootSeed: 0x903 });
    const expiredOwnerId = expired.addPlayer({
      playerId: playerId('expired-owner'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.resonance, level: 5 }],
    });
    expired.addPlayer({
      playerId: playerId('expired-observer'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(20_000, 0),
    });
    const expiredState = internalState(expired);
    const expiredOwner = requiredPlayer(expiredState, expiredOwnerId);
    expiredOwner.hp -= 100;
    addSummon(expiredState, expiredOwner, { expiresAtTick: 1 });
    expired.drainEvents();
    expired.step();

    expect(expiredOwner.hp).toBe(expiredOwner.maxHp - 100);
    expect(
      expired
        .drainEvents()
        .filter(
          (event) => event.type === 'passive-proc' && event.passiveId === PASSIVE_IDS.resonance,
        ),
    ).toHaveLength(0);

    const destroyed = new GameSimulation({ rootSeed: 0x904 });
    const destroyedOwnerId = destroyed.addPlayer({
      playerId: playerId('destroyed-owner'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.resonance, level: 5 }],
    });
    const attackerId = destroyed.addPlayer({
      playerId: playerId('summon-attacker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });
    const destroyedState = internalState(destroyed);
    const destroyedOwner = requiredPlayer(destroyedState, destroyedOwnerId);
    destroyedOwner.hp -= 100;
    const summon = addSummon(destroyedState, destroyedOwner, {
      hp: 1,
      maxHp: 1,
    });
    destroyed.submitIntent(
      attackerId,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: summon.entityId,
      }),
    );
    destroyed.drainEvents();
    destroyed.step();

    expect(destroyedOwner.hp).toBe(destroyedOwner.maxHp - 55);
    expect(destroyedState.summons.has(summon.entityId)).toBe(false);
    expect(destroyed.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'passive-proc',
          passiveId: PASSIVE_IDS.resonance,
          detail: 'summon-death',
        }),
      ]),
    );
  });
});
