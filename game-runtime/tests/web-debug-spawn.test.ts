import { MAP_SPAWN_POINTS } from '@jwgb/content';
import { vec2Mm } from '@jwgb/core';
import { describe, expect, it } from 'vitest';
import { isStandable, resolveDebugSpawn } from '../apps/web/src/app/debug-spawn';

describe('debug spawn override', () => {
  it('leaves a standable request untouched', () => {
    const spawn = MAP_SPAWN_POINTS[0];
    if (!spawn) {
      throw new Error('missing spawn point');
    }
    const requested = vec2Mm(spawn.position.x, spawn.position.z);
    expect(resolveDebugSpawn(requested)).toEqual(requested);
  });

  it('moves a request that lands inside the boundary wall onto standable ground', () => {
    // A soft lock, not a bad view: a character that starts embedded in a solid
    // has nowhere to slide and never moves.
    const insideWall = vec2Mm(395_000, 0);
    expect(isStandable(insideWall)).toBe(false);

    const resolved = resolveDebugSpawn(insideWall);
    expect(isStandable(resolved)).toBe(true);
    expect(Math.hypot(resolved.x - insideWall.x, resolved.z - insideWall.z)).toBeLessThan(60_000);
  });
});
