import { MAP_BOUNDARY, MAP_SPAWN_POINTS } from '@jwgb/content';
import { heroId, playerId } from '@jwgb/core';
import { describe, expect, it } from 'vitest';
import { addPlayerToState, createSimulationState } from '../packages/sim/src/state';

/** Millimetre distance from a point to the boundary polygon. */
function edgeDistanceMm(x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < MAP_BOUNDARY.length; index += 1) {
    const a = MAP_BOUNDARY[index];
    const b = MAP_BOUNDARY[(index + 1) % MAP_BOUNDARY.length];
    if (!a || !b) {
      continue;
    }
    const deltaX = b.x - a.x;
    const deltaZ = b.z - a.z;
    const lengthSquared = deltaX * deltaX + deltaZ * deltaZ || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * deltaX + (z - a.z) * deltaZ) / lengthSquared));
    best = Math.min(best, Math.hypot(x - (a.x + deltaX * t), z - (a.z + deltaZ * t)));
  }
  return best;
}

function mapState() {
  return createSimulationState(7, [], { enabled: false }, { enabled: true });
}

describe('map spawn selection', () => {
  it('seats a small match away from the boundary', () => {
    // The authored ring start puts most micro-positions on the rim: the median
    // sits 8 m from the edge. A half-empty room should still open in the map,
    // not with everyone's back to a cliff.
    const state = mapState();
    const distances: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const player = addPlayerToState(state, {
        playerId: playerId(`p${index}`),
        heroId: heroId('H001'),
      });
      distances.push(edgeDistanceMm(player.position.x, player.position.z));
    }
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(25_000);
  });

  it('still fills every authored position when the room is full', () => {
    const state = mapState();
    const used = new Set<string>();
    for (let index = 0; index < MAP_SPAWN_POINTS.length; index += 1) {
      const player = addPlayerToState(state, {
        playerId: playerId(`p${index}`),
        heroId: heroId('H001'),
      });
      used.add(`${player.position.x},${player.position.z}`);
    }
    expect(used.size).toBe(MAP_SPAWN_POINTS.length);
  });
});
