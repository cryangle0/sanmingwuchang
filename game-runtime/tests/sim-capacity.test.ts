import { HERO_IDS, M0_RULES, M0_SPAWN_POINTS } from '@jwgb/content';
import { playerId } from '@jwgb/core';
import { GameSimulation } from '@jwgb/sim';

describe('M1 room capacity', () => {
  it('defines thirty unique spawn points inside the arena', () => {
    expect(M0_SPAWN_POINTS).toHaveLength(30);
    expect(new Set(M0_SPAWN_POINTS.map((point) => `${point.x}:${point.z}`))).toHaveLength(30);
    for (const point of M0_SPAWN_POINTS) {
      expect(point.x * point.x + point.z * point.z).toBeLessThanOrEqual(
        M0_RULES.arenaRadiusMm * M0_RULES.arenaRadiusMm,
      );
    }
  });

  it('accepts thirty automatic spawns and rejects the thirty-first', () => {
    const simulation = new GameSimulation({ rootSeed: 0x30 });
    for (let index = 0; index < 30; index += 1) {
      simulation.addPlayer({
        playerId: playerId(`capacity-${index + 1}`),
        heroId: HERO_IDS.sunWukong,
      });
    }

    expect(simulation.getSnapshot().players).toHaveLength(30);
    expect(() =>
      simulation.addPlayer({
        playerId: playerId('capacity-31'),
        heroId: HERO_IDS.sunWukong,
      }),
    ).toThrow('player capacity exhausted');
  });
});
