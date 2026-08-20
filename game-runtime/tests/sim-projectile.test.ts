import { getHeroDefinition, HERO_IDS, PASSIVE_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, replaySimulation, type SimEvent } from '@jwgb/sim';
import { addPlayerToState, createSimulationState } from '../packages/sim/src/state';
import { createBasicAttackSnapshot } from '../packages/sim/src/systems/basic-hit';
import { advanceProjectiles, launchBasicProjectile } from '../packages/sim/src/systems/projectile';

function requiredIronFanProjectile() {
  const definition = getHeroDefinition(HERO_IDS.ironFanPrincess).basicProjectile;
  if (!definition) {
    throw new Error('Iron Fan Princess projectile definition is missing');
  }
  return definition;
}

describe('ranged basic projectile simulation', () => {
  it('launches on the release tick and starts 55 m/s movement on the following tick', () => {
    const simulation = new GameSimulation({ rootSeed: 801 });
    const attacker = simulation.addPlayer({
      playerId: playerId('projectile-speed-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('projectile-speed-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(20_000, 0),
    });

    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step();

    expect(simulation.getSnapshot().projectiles[0]).toMatchObject({
      ownerEntityId: attacker,
      targetEntityId: target,
      position: vec2Mm(0, 0),
      speedMmPerSecond: 55_000,
      collisionRadiusMm: 120,
      remainingTravelMm: 20_000,
    });
    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      627,
    );

    simulation.step();
    expect(simulation.getSnapshot().projectiles[0]).toMatchObject({
      position: vec2Mm(2_750, 0),
      remainingTravelMm: 17_250,
    });
  });

  it('uses continuous sweep so a projectile cannot tunnel through a nearby actor', () => {
    const simulation = new GameSimulation({ rootSeed: 802 });
    const attacker = simulation.addPlayer({
      playerId: playerId('projectile-sweep-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('projectile-sweep-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(2_000, 0),
    });

    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step();
    expect(simulation.getSnapshot().projectiles).toHaveLength(1);
    simulation.step();

    expect(simulation.getSnapshot().projectiles).toHaveLength(0);
    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      586,
    );
  });

  it('homes toward the committed target center after release without rechecking vision', () => {
    const simulation = new GameSimulation({ rootSeed: 803 });
    const attacker = simulation.addPlayer({
      playerId: playerId('projectile-homing-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('projectile-homing-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(10_000, 0),
    });

    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step();
    simulation.submitIntent(
      target,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 1_000,
      }),
    );
    simulation.step();

    const projectile = simulation.getSnapshot().projectiles[0];
    expect(projectile?.position.x).toBeGreaterThan(0);
    expect(projectile?.position.z).toBeGreaterThan(0);
    expect(projectile?.targetEntityId).toBe(target);
  });

  it('hits the first actor along the sweep and resolves element against that actor', () => {
    const simulation = new GameSimulation({ rootSeed: 808 });
    const attacker = simulation.addPlayer({
      playerId: playerId('projectile-body-block-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const bodyBlocker = simulation.addPlayer({
      playerId: playerId('projectile-body-blocker'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(4_000, 0),
    });
    const committedTarget = simulation.addPlayer({
      playerId: playerId('projectile-body-block-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(20_000, 0),
    });

    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: committedTarget,
      }),
    );
    simulation.step(3);

    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === bodyBlocker)?.hp,
    ).toBe(427);
    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === committedTarget)?.hp,
    ).toBe(627);
    expect(simulation.getSnapshot().projectiles).toHaveLength(0);
  });

  it('continues after owner true death and preserves the original damage source', () => {
    const simulation = new GameSimulation({ rootSeed: 804 });
    const attacker = simulation.addPlayer({
      playerId: playerId('projectile-dead-owner'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
      passives: [{ passiveId: PASSIVE_IDS.passiveRevive, level: 5 }],
    });
    const target = simulation.addPlayer({
      playerId: playerId('projectile-owner-credit-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(18_000, 0),
    });

    simulation.damage(attacker, 99_999);
    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step();
    simulation.drainEvents();
    simulation.damage(attacker, 99_999);
    expect(simulation.getSnapshot().projectiles).toHaveLength(1);

    for (let tick = 0; tick < 10 && simulation.getSnapshot().projectiles.length > 0; tick += 1) {
      simulation.step();
    }

    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      574,
    );
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        sourceEntityId: attacker,
        targetEntityId: target,
        cause: 'basic',
      }),
    );
  });

  it('destroys an in-flight projectile when its committed target is eliminated', () => {
    const state = createSimulationState(805);
    const attacker = addPlayerToState(state, {
      playerId: playerId('projectile-target-eliminated-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const target = addPlayerToState(state, {
      playerId: playerId('projectile-target-eliminated'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(20_000, 0),
    });
    const events: SimEvent[] = [];

    launchBasicProjectile(
      state,
      attacker,
      target,
      requiredIronFanProjectile(),
      createBasicAttackSnapshot(attacker, 10_000),
      attacker.attackRangeMm,
    );
    target.lifeState = 'eliminated';
    state.tick += 1;
    advanceProjectiles(state, events);

    expect(state.projectiles.size).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('expires after the base 20 m travel budget when the target escapes farther away', () => {
    const state = createSimulationState(806);
    const attacker = addPlayerToState(state, {
      playerId: playerId('projectile-lifetime-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const target = addPlayerToState(state, {
      playerId: playerId('projectile-lifetime-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(20_000, 0),
    });
    const events: SimEvent[] = [];

    launchBasicProjectile(
      state,
      attacker,
      target,
      requiredIronFanProjectile(),
      createBasicAttackSnapshot(attacker, 10_000),
      attacker.attackRangeMm,
    );
    target.position = vec2Mm(120_000, 0);
    for (let tick = 0; tick < 10 && state.projectiles.size > 0; tick += 1) {
      state.tick += 1;
      advanceProjectiles(state, events);
    }

    expect(state.projectiles.size).toBe(0);
    expect(target.hp).toBe(627);
    expect(events).toHaveLength(0);
  });

  it('replays an in-flight projectile to the same state hash', () => {
    const simulation = new GameSimulation({ rootSeed: 807 });
    const attacker = simulation.addPlayer({
      playerId: playerId('projectile-replay-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('projectile-replay-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(20_000, 0),
    });

    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step(4);

    expect(simulation.getSnapshot().projectiles).toHaveLength(1);
    const tape = simulation.exportReplay();
    expect(replaySimulation(tape).getStateHash()).toBe(tape.expectedStateHash);
  });
});
