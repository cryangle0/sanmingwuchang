import { MAP_WALL_PIECES, type MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildInteriorRidges } from '../apps/web/src/render/map/interior-ridges';
import {
  convexContains,
  dressingSurfaceMeters,
  groundSurfaceMeters,
  massifSurfaceMeters,
} from '../apps/web/src/render/map/map-sampling';

const MM = 1_000;

function build(): { group: THREE.Group; massifs: number; tracked: THREE.BufferGeometry[] } {
  const group = new THREE.Group();
  const materials = {
    boundaryCliffFace: new THREE.MeshStandardMaterial({ vertexColors: true }),
  } as unknown as Parameters<typeof buildInteriorRidges>[1];
  const tracked: THREE.BufferGeometry[] = [];
  const massifs = buildInteriorRidges(group, materials, (geometry) => {
    tracked.push(geometry);
    return geometry;
  });
  return { group, massifs, tracked };
}

/** Distance from a point to the nearest footprint, zero when a piece contains it. */
function footprintDistanceMm(
  pieces: readonly (typeof MAP_WALL_PIECES)[number][],
  point: MapPointMm,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const piece of pieces) {
    if (convexContains(piece.vertices, point)) {
      return 0;
    }
    for (let index = 0; index < piece.vertices.length; index += 1) {
      const a = piece.vertices[index] as MapPointMm;
      const b = piece.vertices[(index + 1) % piece.vertices.length] as MapPointMm;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSquared = dx * dx + dz * dz || 1;
      const t = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared),
      );
      const offX = point.x - (a.x + dx * t);
      const offZ = point.z - (a.z + dz * t);
      best = Math.min(best, Math.hypot(offX, offZ));
    }
  }
  return best;
}

describe('封界级 wall massifs', () => {
  const boundPieces = MAP_WALL_PIECES.filter((piece) => piece.wallClass === 'BOUND');
  const vaultPieces = MAP_WALL_PIECES.filter((piece) => piece.wallClass === 'VAULT');
  const boundWalls = new Set(boundPieces.map((piece) => piece.wallId));

  it('raises one massif per BOUND wall and none over the walkable VAULT hills', () => {
    const { group, massifs, tracked } = build();
    expect(boundWalls.size).toBeGreaterThan(0);
    expect(massifs).toBe(boundWalls.size);

    const mesh = group.getObjectByName('interior-ridges') as THREE.Mesh;
    expect(mesh).toBeDefined();
    expect(mesh.geometry.getAttribute('color')).toBeDefined();

    const positions = mesh.geometry.getAttribute('position');
    expect(positions.count).toBeGreaterThan(0);
    let footVertices = 0;
    for (let index = 0; index < positions.count; index += 1) {
      const point: MapPointMm = {
        x: Math.round(positions.getX(index) * MM),
        z: Math.round(positions.getZ(index) * MM),
      };
      const distance = footprintDistanceMm(boundPieces, point);
      const climb = positions.getY(index) - groundSurfaceMeters(point);
      if (climb < 0) {
        // The foot of every slope sits exactly on the compiled polygon, so at
        // ground level the rock covers the forbidden ground and nothing else.
        footVertices += 1;
        expect(distance).toBeLessThanOrEqual(1);
      } else {
        // Higher up, the crest of a concave wall may overhang its own outline
        // by a few metres; that is rock above the player's head, not a wall
        // they can walk into.
        expect(distance).toBeLessThan(4 * MM);
      }
      expect(vaultPieces.some((piece) => convexContains(piece.vertices, point))).toBe(false);
    }
    expect(footVertices).toBeGreaterThan(0);
    for (const geometry of tracked) {
      geometry.dispose();
    }
  });

  it('keeps the crests low enough for the chase camera to see past them', () => {
    const { group, tracked } = build();
    const mesh = group.getObjectByName('interior-ridges') as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position');
    let tallest = 0;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const ground = groundSurfaceMeters({ x: Math.round(x * MM), z: Math.round(z * MM) });
      tallest = Math.max(tallest, positions.getY(index) - ground);
    }
    // Taller than the 6 m sim wall so it reads as impassable rock, but well
    // under the old 30 m ranges that hid players standing behind them.
    expect(tallest).toBeGreaterThan(6);
    expect(tallest).toBeLessThan(18);
    for (const geometry of tracked) {
      geometry.dispose();
    }
  });

  it('answers the drawn rock height under any point of a massif so dressing stands on it', () => {
    const { group, tracked } = build();
    const mesh = group.getObjectByName('interior-ridges') as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    expect(index).toBeNull();

    // Every facet centroid must be answered by the sampler with the facet's own
    // height (or a higher overlapping facet), never with the ground under it.
    let checked = 0;
    let raised = 0;
    for (let triangle = 0; triangle + 2 < positions.count; triangle += 3 * 7) {
      // Columns rising from the ridge's own end vertices are vertical slivers
      // with no plan area; nothing can stand on them, so they are not sampled.
      const planArea =
        Math.abs(
          (positions.getX(triangle + 1) - positions.getX(triangle)) *
            (positions.getZ(triangle + 2) - positions.getZ(triangle)) -
            (positions.getX(triangle + 2) - positions.getX(triangle)) *
              (positions.getZ(triangle + 1) - positions.getZ(triangle)),
        ) / 2;
      if (planArea < 1e-3) {
        continue;
      }
      const x =
        (positions.getX(triangle) + positions.getX(triangle + 1) + positions.getX(triangle + 2)) /
        3;
      const y =
        (positions.getY(triangle) + positions.getY(triangle + 1) + positions.getY(triangle + 2)) /
        3;
      const z =
        (positions.getZ(triangle) + positions.getZ(triangle + 1) + positions.getZ(triangle + 2)) /
        3;
      const point: MapPointMm = { x: Math.round(x * MM), z: Math.round(z * MM) };
      const sampled = massifSurfaceMeters(point);
      expect(sampled).not.toBeNull();
      expect(sampled as number).toBeGreaterThanOrEqual(y - 0.05);
      const dressing = dressingSurfaceMeters(point);
      expect(dressing).toBeGreaterThanOrEqual(groundSurfaceMeters(point));
      expect(dressing).toBeGreaterThanOrEqual((sampled as number) - 1e-6);
      if (dressing - groundSurfaceMeters(point) > 1) {
        raised += 1;
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(100);
    expect(raised).toBeGreaterThan(checked / 2);

    // Open ground far from any wall is not a massif.
    expect(massifSurfaceMeters({ x: 0, z: 0 })).toBeNull();
    expect(dressingSurfaceMeters({ x: 0, z: 0 })).toBeCloseTo(
      groundSurfaceMeters({ x: 0, z: 0 }),
      6,
    );
    for (const geometry of tracked) {
      geometry.dispose();
    }
  });
});
