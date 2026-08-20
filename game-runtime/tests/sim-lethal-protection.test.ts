import { EQUIPMENT_IDS, HERO_IDS, PASSIVE_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, SeededRng, vec2Mm } from '@jwgb/core';
import { GameSimulation, replaySimulation, type SimEvent } from '@jwgb/sim';
import { addPlayerToState, createSimulationState } from '../packages/sim/src/state';
import { applyDamage } from '../packages/sim/src/systems/damage';

function findSeedForFirstB19Roll(success: boolean): number {
  for (let seed = 1; seed < 10_000; seed += 1) {
    const rng = new SeededRng(seed).fork('combat');
    if (rng.nextInt(100) < 10 === success) {
      return seed;
    }
  }
  throw new Error('unable to find deterministic B19 seed');
}

function findSeedForB19Direction(directionIndex: number): number {
  for (let seed = 1; seed < 100_000; seed += 1) {
    const rng = new SeededRng(seed).fork('combat');
    if (rng.nextInt(100) < 10 && rng.nextInt(8) === directionIndex) {
      return seed;
    }
  }
  throw new Error('unable to find deterministic B19 direction seed');
}

describe('lethal protection transaction', () => {
  it('resolves B19 before B20 and G1 with exactly one direction draw on level 5 success', () => {
    const rootSeed = findSeedForFirstB19Roll(true);
    const state = createSimulationState(rootSeed);
    const player = addPlayerToState(state, {
      playerId: playerId('b19-priority'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [
        { passiveId: PASSIVE_IDS.feignDeath, level: 5 },
        { passiveId: PASSIVE_IDS.passiveRevive, level: 5 },
      ],
      equipmentIds: [EQUIPMENT_IDS.nineTurnPill],
    });
    const events: SimEvent[] = [];
    const expectedCombatRng = new SeededRng(rootSeed).fork('combat');
    expect(expectedCombatRng.nextInt(100)).toBeLessThan(10);
    expectedCombatRng.nextInt(8);

    applyDamage(state, events, {
      sourceEntityId: null,
      targetEntityId: player.entityId,
      amount: 99_999,
      cause: 'debug',
      form: 'true',
    });

    expect(player).toMatchObject({
      hp: 97,
      livesRemaining: 3,
      trueDeaths: 0,
      lifeState: 'alive',
      b19RetriggerLockTicks: 20,
    });
    expect(state.consumedB20PlayerIds.has(player.playerId)).toBe(false);
    expect(player.equipment).toHaveLength(1);
    expect(state.random.combat.snapshot()).toBe(expectedCombatRng.snapshot());
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'lethal-protection',
        protection: 'b19-feign-death',
        hpRestored: 97,
      }),
    );
    expect(events.some((event) => event.type === 'true-death')).toBe(false);
  });

  it('does not redraw the B19 direction when the selected blink has no legal movement', () => {
    const rootSeed = findSeedForB19Direction(0);
    const state = createSimulationState(rootSeed);
    const player = addPlayerToState(state, {
      playerId: playerId('b19-no-redraw'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(120_000, 0),
      passives: [{ passiveId: PASSIVE_IDS.feignDeath, level: 5 }],
    });
    const events: SimEvent[] = [];
    const expectedCombatRng = new SeededRng(rootSeed).fork('combat');
    expect(expectedCombatRng.nextInt(100)).toBeLessThan(10);
    expect(expectedCombatRng.nextInt(8)).toBe(0);

    applyDamage(state, events, {
      sourceEntityId: null,
      targetEntityId: player.entityId,
      amount: 99_999,
      cause: 'debug',
      form: 'true',
    });

    expect(player.position).toEqual(vec2Mm(120_000, 0));
    expect(state.random.combat.snapshot()).toBe(expectedCombatRng.snapshot());
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'lethal-protection',
        protection: 'b19-feign-death',
        didBlink: false,
        previousPosition: vec2Mm(120_000, 0),
        newPosition: vec2Mm(120_000, 0),
      }),
    );
  });

  it('locks B19 for twenty ticks after success without consuming another proc draw', () => {
    const rootSeed = findSeedForFirstB19Roll(true);
    const state = createSimulationState(rootSeed);
    const player = addPlayerToState(state, {
      playerId: playerId('b19-lock'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.feignDeath, level: 5 }],
    });
    const events: SimEvent[] = [];

    applyDamage(state, events, {
      sourceEntityId: null,
      targetEntityId: player.entityId,
      amount: 99_999,
      cause: 'debug',
      form: 'true',
    });
    const rngAfterSuccess = state.random.combat.snapshot();
    applyDamage(state, events, {
      sourceEntityId: null,
      targetEntityId: player.entityId,
      amount: 99_999,
      cause: 'debug',
      form: 'true',
    });

    expect(state.random.combat.snapshot()).toBe(rngAfterSuccess);
    expect(player).toMatchObject({
      lifeState: 'soul-flight',
      livesRemaining: 2,
      trueDeaths: 1,
      b19RetriggerLockTicks: 20,
    });
    expect(
      events.filter(
        (event) => event.type === 'lethal-protection' && event.protection === 'b19-feign-death',
      ),
    ).toHaveLength(1);
  });

  it('uses B20 only after a failed B19 roll and permanently spends the match charge', () => {
    const rootSeed = findSeedForFirstB19Roll(false);
    const state = createSimulationState(rootSeed);
    const player = addPlayerToState(state, {
      playerId: playerId('b20-ledger'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [
        { passiveId: PASSIVE_IDS.feignDeath, level: 5 },
        { passiveId: PASSIVE_IDS.passiveRevive, level: 1 },
      ],
    });
    const events: SimEvent[] = [];

    applyDamage(state, events, {
      sourceEntityId: null,
      targetEntityId: player.entityId,
      amount: 99_999,
      cause: 'debug',
      form: 'true',
    });

    expect(player).toMatchObject({
      hp: 122,
      livesRemaining: 3,
      trueDeaths: 0,
      lifeState: 'alive',
    });
    expect(state.consumedB20PlayerIds.has(player.playerId)).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'lethal-protection',
        protection: 'b20-passive-revive',
        hpRestored: 122,
      }),
    );

    player.passives.splice(0, player.passives.length);
    player.passives.push({ passiveId: PASSIVE_IDS.passiveRevive, level: 1 });
    applyDamage(state, events, {
      sourceEntityId: null,
      targetEntityId: player.entityId,
      amount: 99_999,
      cause: 'debug',
      form: 'true',
    });

    expect(player).toMatchObject({
      lifeState: 'soul-flight',
      livesRemaining: 2,
      trueDeaths: 1,
    });
    expect(
      events.filter(
        (event) => event.type === 'lethal-protection' && event.protection === 'b20-passive-revive',
      ),
    ).toHaveLength(1);
  });

  it('applies the B20 level 5 damage multiplier and hard-control immunity for the buff', () => {
    const simulation = new GameSimulation({ rootSeed: 301 });
    const revived = simulation.addPlayer({
      playerId: playerId('b20-level-five'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.passiveRevive, level: 5 }],
    });
    const target = simulation.addPlayer({
      playerId: playerId('b20-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(4_000, 0),
    });

    simulation.damage(revived, 99_999);
    expect(simulation.hardControl(revived, 20)).toBe(false);
    simulation.submitIntent(
      revived,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step();

    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === revived),
    ).toMatchObject({
      b20ReviveBuffTicks: 99,
      lifeState: 'alive',
    });
    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      549,
    );
  });

  it('uses G1 after spent B20, consumes the item, and blocks same-tick follow-up damage', () => {
    const simulation = new GameSimulation({ rootSeed: 401 });
    const protectedPlayer = simulation.addPlayer({
      playerId: playerId('g1-chain'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.passiveRevive, level: 1 }],
      equipmentIds: [EQUIPMENT_IDS.nineTurnPill],
    });

    simulation.damage(protectedPlayer, 99_999);
    simulation.damage(protectedPlayer, 99_999);
    expect(simulation.damage(protectedPlayer, 99_999)).toBe(0);
    expect(simulation.getSnapshot().players[0]).toMatchObject({
      hp: 488,
      livesRemaining: 3,
      trueDeaths: 0,
      lifeState: 'alive',
      invulnerableTicks: 40,
      b20ChargeAvailable: false,
      hasNineTurnPill: false,
    });

    simulation.step(40);
    simulation.damage(protectedPlayer, 99_999);
    expect(simulation.getSnapshot().players[0]).toMatchObject({
      lifeState: 'soul-flight',
      livesRemaining: 2,
      trueDeaths: 1,
    });
  });

  it('replays loadouts, charge consumption, timers, and equipment consumption to the same hash', () => {
    const simulation = new GameSimulation({ rootSeed: 501 });
    const attacker = simulation.addPlayer({
      playerId: playerId('replay-attacker'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(0, 0),
    });
    const protectedPlayer = simulation.addPlayer({
      playerId: playerId('replay-protected'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(4_000, 0),
      passives: [{ passiveId: PASSIVE_IDS.passiveRevive, level: 5 }],
      equipmentIds: [EQUIPMENT_IDS.nineTurnPill],
    });
    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: protectedPlayer,
      }),
    );
    simulation.step(191);

    const protectedSnapshot = simulation
      .getSnapshot()
      .players.find((player) => player.entityId === protectedPlayer);
    expect(protectedSnapshot).toMatchObject({
      b20ChargeAvailable: false,
      hasNineTurnPill: false,
      b20ReviveBuffTicks: 24,
      invulnerableTicks: 40,
    });
    const tape = simulation.exportReplay();
    expect(tape.roster[1]).toMatchObject({
      passives: [{ passiveId: PASSIVE_IDS.passiveRevive, level: 5 }],
      equipmentIds: [EQUIPMENT_IDS.nineTurnPill],
    });
    expect(replaySimulation(tape).getStateHash()).toBe(tape.expectedStateHash);
  });

  it('rejects an invalid loadout without consuming entity or equipment instance ids', () => {
    const state = createSimulationState(601);
    expect(() =>
      addPlayerToState(state, {
        playerId: playerId('invalid-loadout'),
        heroId: HERO_IDS.sunWukong,
        passives: [
          { passiveId: PASSIVE_IDS.feignDeath, level: 1 },
          { passiveId: PASSIVE_IDS.feignDeath, level: 2 },
        ],
        equipmentIds: [EQUIPMENT_IDS.nineTurnPill],
      }),
    ).toThrow('duplicate passive in loadout');

    expect(state).toMatchObject({
      nextEntityId: 1,
      nextEquipmentInstanceId: 1,
    });
    expect(state.players.size).toBe(0);
    expect(state.initialSpawnIndices.size).toBe(0);
  });
});
