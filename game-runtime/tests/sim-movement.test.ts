import { HERO_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation } from '@jwgb/sim';

describe('20 Hz movement', () => {
  it('moves Sun Wukong exactly one second of integer-millimeter distance', () => {
    const simulation = new GameSimulation({ rootSeed: 7 });
    const entity = simulation.addPlayer({
      playerId: playerId('wukong'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });

    simulation.submitIntent(
      entity,
      createPlayerIntent({
        sequence: 1,
        moveX: 1_000,
        moveZ: 0,
      }),
    );
    simulation.step(20);

    const player = simulation.getSnapshot().players[0];
    expect(player?.position).toEqual(vec2Mm(3_010, 0));
  });

  it('normalizes diagonal input instead of granting extra speed', () => {
    const simulation = new GameSimulation({ rootSeed: 7 });
    const entity = simulation.addPlayer({
      playerId: playerId('wukong'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });

    simulation.submitIntent(
      entity,
      createPlayerIntent({
        sequence: 1,
        moveX: 1_000,
        moveZ: 1_000,
      }),
    );
    simulation.step(20);

    const position = simulation.getSnapshot().players[0]?.position;
    expect(position).toBeDefined();
    expect((position?.x ?? 0) ** 2 + (position?.z ?? 0) ** 2).toBeLessThanOrEqual(3_010 ** 2);
  });

  it('keeps the player outside a static map solid', () => {
    const simulation = new GameSimulation({
      rootSeed: 8,
      staticSolids: [
        {
          solidId: 'map-wall-1',
          minimumX: 1_000,
          maximumX: 2_000,
          minimumZ: -1_000,
          maximumZ: 1_000,
        },
      ],
    });
    const entity = simulation.addPlayer({
      playerId: playerId('wall-collision'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });

    simulation.submitIntent(
      entity,
      createPlayerIntent({
        sequence: 1,
        moveX: 1_000,
        moveZ: 0,
      }),
    );
    simulation.step(20);

    expect(simulation.getSnapshot().players[0]?.position.x).toBe(550);
  });
});
