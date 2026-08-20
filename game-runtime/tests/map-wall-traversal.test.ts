import type { MapConvexPieceRecord } from '@jwgb/content';
import {
  GENERIC_ACTIVE_IDS,
  HERO_IDS,
  MAP_BOUNDARY,
  MAP_GEOMETRY_HASH,
  MAP_SPAWN_POINTS,
  MAP_WALL_PIECES,
} from '@jwgb/content';
import { createPlayerIntent, playerId, type Vec2Mm, vec2Mm } from '@jwgb/core';
import {
  BLINK_TRAVERSAL,
  flightTraversal,
  GameSimulation,
  MapCollisionField,
  WALK_TRAVERSAL,
  wallPieceBlocks,
} from '@jwgb/sim';
import { describe, expect, it } from 'vitest';

const PLAYER_RADIUS_MM = 450;
/** Equipment flight budget used by the runtime for 可越障级 walls. */
const FLIGHT_BUDGET_MM = 2_500;
/** D6 blink distance; see GENERIC_ACTIVE_IDS.blink. */
const BLINK_DISTANCE_MM = 15_000;

/**
 * Synthetic pieces covering every permission combination. Heights are positive
 * because every authored wall is, and a zero-height piece would be crossable by
 * a zero flight budget.
 */
const SAMPLE_PIECES = [
  { label: 'vault', heightMm: 2_500, blinkPassable: true, flightPassable: true },
  { label: 'bound', heightMm: 6_000, blinkPassable: false, flightPassable: false },
  { label: 'blink only', heightMm: 2_500, blinkPassable: true, flightPassable: false },
  { label: 'flight only', heightMm: 2_500, blinkPassable: false, flightPassable: true },
  { label: 'low but sealed', heightMm: 1_000, blinkPassable: false, flightPassable: false },
] as const;

function mapField(): MapCollisionField {
  return new MapCollisionField(MAP_GEOMETRY_HASH, MAP_BOUNDARY, MAP_WALL_PIECES);
}

function centroidOf(piece: MapConvexPieceRecord): Vec2Mm {
  return vec2Mm(
    Math.trunc(piece.vertices.reduce((sum, vertex) => sum + vertex.x, 0) / piece.vertices.length),
    Math.trunc(piece.vertices.reduce((sum, vertex) => sum + vertex.z, 0) / piece.vertices.length),
  );
}

describe('wall traversal permissions', () => {
  it('blocks walking through every wall piece whatever the permissions say', () => {
    for (const piece of SAMPLE_PIECES) {
      expect(wallPieceBlocks(piece, WALK_TRAVERSAL)).toBe(true);
    }
  });

  it('lets blink cross blink-passable pieces and nothing else', () => {
    for (const piece of SAMPLE_PIECES) {
      expect(wallPieceBlocks(piece, BLINK_TRAVERSAL)).toBe(!piece.blinkPassable);
    }
    // Blink carries no flight budget: even a 1 mm flight-only wall stays solid.
    expect(
      wallPieceBlocks({ heightMm: 1, blinkPassable: false, flightPassable: true }, BLINK_TRAVERSAL),
    ).toBe(true);
  });

  it('lets flight cross a flight-passable piece within its budget but not beyond it', () => {
    const vault = { heightMm: 2_500, blinkPassable: true, flightPassable: true };

    expect(wallPieceBlocks(vault, flightTraversal(2_500))).toBe(false);
    expect(wallPieceBlocks(vault, flightTraversal(6_000))).toBe(false);
    expect(wallPieceBlocks(vault, flightTraversal(2_499))).toBe(true);
    expect(wallPieceBlocks(vault, flightTraversal(1))).toBe(true);
  });

  it('never lets flight cross a piece the map source left flight-denied', () => {
    // The regression this contract exists for: passability used to be inferred
    // from height, so any short 封界级 wall became flyable.
    const lowSealed = { heightMm: 1_000, blinkPassable: false, flightPassable: false };
    expect(lowSealed.heightMm).toBeLessThan(FLIGHT_BUDGET_MM);
    expect(wallPieceBlocks(lowSealed, flightTraversal(FLIGHT_BUDGET_MM))).toBe(true);
    expect(wallPieceBlocks(lowSealed, flightTraversal(1_000))).toBe(true);
    expect(wallPieceBlocks(lowSealed, flightTraversal(600_000))).toBe(true);

    // A blink-passable wall gives flight no permission either.
    const blinkOnly = { heightMm: 1_000, blinkPassable: true, flightPassable: false };
    expect(wallPieceBlocks(blinkOnly, flightTraversal(FLIGHT_BUDGET_MM))).toBe(true);
  });

  it('collapses a zero or negative flight budget to walking', () => {
    expect(WALK_TRAVERSAL).toEqual({ blinkPassable: false, flightHeightBudgetMm: 0 });
    expect(BLINK_TRAVERSAL).toEqual({ blinkPassable: true, flightHeightBudgetMm: 0 });
    expect(flightTraversal(0)).toBe(WALK_TRAVERSAL);
    expect(flightTraversal(-1)).toBe(WALK_TRAVERSAL);
    expect(flightTraversal(1)).toEqual({ blinkPassable: false, flightHeightBudgetMm: 1 });

    for (const piece of SAMPLE_PIECES) {
      expect(wallPieceBlocks(piece, flightTraversal(0))).toBe(
        wallPieceBlocks(piece, WALK_TRAVERSAL),
      );
    }
  });
});

describe('compiled wall traversal data', () => {
  it('gives every piece boolean permissions that agree with its wall class', () => {
    const classCounts = new Map<string, number>();
    for (const piece of MAP_WALL_PIECES) {
      expect(typeof piece.blinkPassable).toBe('boolean');
      expect(typeof piece.flightPassable).toBe('boolean');
      expect(['BOUND', 'VAULT']).toContain(piece.wallClass);
      if (piece.wallClass === 'VAULT') {
        expect(piece.blinkPassable).toBe(true);
        expect(piece.flightPassable).toBe(true);
      } else {
        expect(piece.blinkPassable).toBe(false);
        expect(piece.flightPassable).toBe(false);
      }
      // The same permissions seen through the single decision point.
      expect(wallPieceBlocks(piece, WALK_TRAVERSAL)).toBe(true);
      expect(wallPieceBlocks(piece, BLINK_TRAVERSAL)).toBe(piece.wallClass !== 'VAULT');
      classCounts.set(piece.wallClass, (classCounts.get(piece.wallClass) ?? 0) + 1);
    }
    // Both classes must exist or the branches above never ran.
    expect(classCounts.get('VAULT') ?? 0).toBeGreaterThan(0);
    expect(classCounts.get('BOUND') ?? 0).toBeGreaterThan(0);
    expect(classCounts.size).toBe(2);
  });

  it('reproduces the retired height rule for flight on the current map', () => {
    expect(MAP_WALL_PIECES.length).toBeGreaterThan(0);
    for (const piece of MAP_WALL_PIECES) {
      expect(wallPieceBlocks(piece, flightTraversal(FLIGHT_BUDGET_MM))).toBe(
        !(piece.heightMm <= FLIGHT_BUDGET_MM),
      );
    }
  });
});

describe('map collision field traversal', () => {
  it('hides vault pieces from blink queries while walking still collides', () => {
    const field = mapField();
    const vault = MAP_WALL_PIECES.find(
      (piece) =>
        piece.wallClass === 'VAULT' &&
        field.firstWallPieceAt(centroidOf(piece), PLAYER_RADIUS_MM, BLINK_TRAVERSAL) === null,
    );
    expect(vault).toBeDefined();
    if (!vault) {
      return;
    }

    const centroid = centroidOf(vault);
    expect(field.firstWallPieceAt(centroid, PLAYER_RADIUS_MM, WALK_TRAVERSAL)).not.toBeNull();
    expect(field.circleTouchesWall(centroid, PLAYER_RADIUS_MM)).toBe(true);
    expect(field.isCircleBlocked(centroid, PLAYER_RADIUS_MM)).toBe(true);

    expect(field.firstWallPieceAt(centroid, PLAYER_RADIUS_MM, BLINK_TRAVERSAL)).toBeNull();
    expect(field.circleTouchesWall(centroid, PLAYER_RADIUS_MM, BLINK_TRAVERSAL)).toBe(false);
    expect(
      field.circleTouchesWall(centroid, PLAYER_RADIUS_MM, flightTraversal(FLIGHT_BUDGET_MM)),
    ).toBe(false);
  });

  it('reports bound pieces for walking, blink and flight alike', () => {
    const field = mapField();
    const bound = MAP_WALL_PIECES.find((piece) => piece.wallClass === 'BOUND');
    expect(bound).toBeDefined();
    if (!bound) {
      return;
    }

    const centroid = centroidOf(bound);
    expect(field.firstWallPieceAt(centroid, PLAYER_RADIUS_MM, WALK_TRAVERSAL)).not.toBeNull();
    expect(field.firstWallPieceAt(centroid, PLAYER_RADIUS_MM, BLINK_TRAVERSAL)).not.toBeNull();
    expect(
      field.firstWallPieceAt(centroid, PLAYER_RADIUS_MM, flightTraversal(FLIGHT_BUDGET_MM)),
    ).not.toBeNull();
    expect(field.isCircleBlocked(centroid, PLAYER_RADIUS_MM, BLINK_TRAVERSAL)).toBe(true);
  });
});

describe('map blink landing legality', () => {
  it('walks a blink back out of the vault wall it is allowed to cross', () => {
    const field = mapField();
    // A blink whose full 15 m would end inside a vault wall. The wall is
    // transparent to the sweep, so only the landing check keeps it legal.
    let chosen: { readonly origin: Vec2Mm; readonly target: Vec2Mm } | null = null;
    for (const piece of MAP_WALL_PIECES) {
      if (piece.wallClass !== 'VAULT') {
        continue;
      }
      const target = centroidOf(piece);
      const origin = vec2Mm(target.x - BLINK_DISTANCE_MM, target.z);
      if (
        !field.isCircleBlocked(target, PLAYER_RADIUS_MM) ||
        field.isCircleBlocked(origin, PLAYER_RADIUS_MM)
      ) {
        continue;
      }
      chosen = { origin, target };
      break;
    }
    expect(chosen).not.toBeNull();
    if (!chosen) {
      return;
    }

    const simulation = new GameSimulation({ rootSeed: 20_260_726, map: { enabled: true } });
    const entity = simulation.addPlayer({
      playerId: playerId('vault-blinker'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.blink,
      position: chosen.origin,
    });
    simulation.drainEvents();
    simulation.submitIntent(
      entity,
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
    const events = simulation.drainEvents();

    const landing = simulation.getSnapshot().players[0]?.position;
    expect(landing).toBeDefined();
    if (!landing) {
      return;
    }
    expect(field.isCircleBlocked(landing, PLAYER_RADIUS_MM)).toBe(false);
    expect(landing.z).toBe(chosen.origin.z);
    expect(landing.x).toBeGreaterThan(chosen.origin.x);
    expect(landing.x).toBeLessThan(chosen.target.x);

    const blink = events.find((event) => event.type === 'blink');
    expect(blink).toBeDefined();
    if (blink?.type !== 'blink') {
      return;
    }
    expect(blink.requestedDistanceMm).toBe(BLINK_DISTANCE_MM);
    expect(blink.actualDistanceMm).toBeLessThan(BLINK_DISTANCE_MM);
    // No 封界级 wall stopped the sweep, so the shortening came from the landing
    // check alone: one millimeter further along the ray must be illegal.
    expect(blink.blockingSolidId).toBeNull();
    expect(field.isCircleBlocked(vec2Mm(landing.x + 1, landing.z), PLAYER_RADIUS_MM)).toBe(true);
  });

  it('never ends a blink inside a wall from any scanned spawn point', () => {
    const field = mapField();
    const directions = [
      { aimX: 1_000, aimZ: 0 },
      { aimX: 0, aimZ: 1_000 },
      { aimX: -1_000, aimZ: 0 },
      { aimX: 0, aimZ: -1_000 },
      { aimX: 707, aimZ: 707 },
      { aimX: -707, aimZ: 707 },
      { aimX: 707, aimZ: -707 },
      { aimX: -707, aimZ: -707 },
    ] as const;
    const spawns = MAP_SPAWN_POINTS.slice(0, directions.length);
    expect(spawns).toHaveLength(directions.length);

    const simulation = new GameSimulation({ rootSeed: 20_260_727, map: { enabled: true } });
    const entities = spawns.map((spawn, index) =>
      simulation.addPlayer({
        playerId: playerId(`blinker-${index}`),
        heroId: HERO_IDS.sunWukong,
        activeAbilityId: GENERIC_ACTIVE_IDS.blink,
        position: vec2Mm(spawn.position.x, spawn.position.z),
      }),
    );
    for (const [index, entity] of entities.entries()) {
      const direction = directions[index] as (typeof directions)[number];
      simulation.submitIntent(
        entity,
        createPlayerIntent({
          sequence: 1,
          moveX: 0,
          moveZ: 0,
          aimX: direction.aimX,
          aimZ: direction.aimZ,
          castActive: true,
        }),
      );
    }
    simulation.step();

    const players = simulation.getSnapshot().players;
    expect(players).toHaveLength(spawns.length);
    for (const player of players) {
      expect(field.isCircleBlocked(player.position, PLAYER_RADIUS_MM)).toBe(false);
      expect(field.circleTouchesWall(player.position, PLAYER_RADIUS_MM)).toBe(false);
      expect(field.isCircleInsideBoundary(player.position, PLAYER_RADIUS_MM)).toBe(true);
    }
  });
});
