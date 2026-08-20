import { type GridAabb, StaticSpatialGrid } from '@jwgb/sim';
import { describe, expect, it } from 'vitest';

function aabb(minimumX: number, maximumX: number, minimumZ: number, maximumZ: number): GridAabb {
  return { minimumX, maximumX, minimumZ, maximumZ };
}

describe('static spatial grid', () => {
  it('returns unique candidates in ascending item order', () => {
    const grid = new StaticSpatialGrid(aabb(0, 100, 0, 100), 10, [
      aabb(5, 25, 5, 25),
      aabb(35, 45, 35, 45),
      aabb(15, 75, 15, 75),
    ]);

    expect(grid.query(aabb(0, 100, 0, 100))).toEqual([0, 1, 2]);
    expect(grid.query(aabb(20, 40, 20, 40))).toEqual([0, 1, 2]);
  });

  it('supports unique traversal and early stopping', () => {
    const grid = new StaticSpatialGrid(aabb(0, 100, 0, 100), 10, [
      aabb(0, 100, 0, 100),
      aabb(40, 60, 40, 60),
    ]);
    const visited: number[] = [];

    grid.forEachUniqueItem(aabb(45, 55, 45, 55), (itemIndex) => {
      visited.push(itemIndex);
      return itemIndex === 0;
    });

    expect(visited).toEqual([0]);
  });
});
