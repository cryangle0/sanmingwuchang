import { HERO_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation } from '@jwgb/sim';

describe('Iron Fan Princess wind wall', () => {
  it('creates a three-second non-solid wall and knocks intersecting units five meters', () => {
    const simulation = new GameSimulation({ rootSeed: 71 });
    const ironFan = simulation.addPlayer({
      playerId: playerId('iron-fan'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('wall-contact'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(15_000, 0),
    });

    simulation.submitIntent(
      ironFan,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        aimX: 1_000,
        aimZ: 0,
        castActive: true,
      }),
    );
    simulation.step();

    expect(simulation.getSnapshot().windWalls[0]).toMatchObject({
      ownerEntityId: ironFan,
      center: vec2Mm(15_000, 0),
      direction: vec2Mm(1_000, 0),
      lengthMm: 12_000,
      remainingTicks: 60,
    });
    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === target)?.position,
    ).toEqual(vec2Mm(20_000, 0));

    simulation.step(59);
    expect(simulation.getSnapshot().windWalls).toHaveLength(1);
    simulation.step();
    expect(simulation.getSnapshot().windWalls).toHaveLength(0);
  });

  it('blocks ranged basic projectiles that cross its segment', () => {
    const simulation = new GameSimulation({ rootSeed: 72 });
    const owner = simulation.addPlayer({
      playerId: playerId('wall-owner'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const attacker = simulation.addPlayer({
      playerId: playerId('ranged-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(5_000, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('ranged-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(20_000, 0),
    });

    simulation.submitIntent(
      owner,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        aimX: 1_000,
        aimZ: 0,
        castActive: true,
      }),
    );
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
    simulation.step(4);

    expect(simulation.getSnapshot().players.find((player) => player.entityId === target)?.hp).toBe(
      627,
    );
    expect(simulation.getSnapshot().projectiles).toHaveLength(0);
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'projectile-blocked',
        sourceEntityId: attacker,
        targetEntityId: target,
      }),
    );
  });

  it('chooses the nearest wall contact before lower entity id', () => {
    const simulation = new GameSimulation({ rootSeed: 73 });
    const farWallOwner = simulation.addPlayer({
      playerId: playerId('far-wall-owner'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(0, 0),
    });
    const nearWallOwner = simulation.addPlayer({
      playerId: playerId('near-wall-owner'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(-5_000, 0),
    });
    const attacker = simulation.addPlayer({
      playerId: playerId('two-wall-attacker'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(5_000, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('two-wall-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(20_000, 0),
    });

    for (const [entityId, sequence] of [
      [farWallOwner, 1],
      [nearWallOwner, 1],
    ] as const) {
      simulation.submitIntent(
        entityId,
        createPlayerIntent({
          sequence,
          moveX: 0,
          moveZ: 0,
          aimX: 1_000,
          aimZ: 0,
          castActive: true,
        }),
      );
    }
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

    const walls = simulation.getSnapshot().windWalls;
    const farWall = walls.find((wall) => wall.center.x === 15_000);
    const nearWall = walls.find((wall) => wall.center.x === 10_000);
    expect(Number(farWall?.entityId)).toBeLessThan(Number(nearWall?.entityId));

    simulation.drainEvents();
    simulation.step(2);
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'projectile-blocked',
        wallEntityId: nearWall?.entityId,
      }),
    );
  });
});
