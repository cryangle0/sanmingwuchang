import type { MapConvexPieceRecord } from '@jwgb/content';
import {
  HERO_IDS,
  MAP_BOUNDARY,
  MAP_GEOMETRY_HASH,
  MAP_SPAWN_POINTS,
  MAP_WALL_PIECES,
} from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { flightTraversal, GameSimulation, MapCollisionField, replaySimulation } from '@jwgb/sim';
import { describe, expect, it } from 'vitest';
import { createSimulationState } from '../packages/sim/src/state';
import { hasDirectLineOfSight } from '../packages/sim/src/systems/active-targeting';

const PLAYER_RADIUS_MM = 450;

function mapField(): MapCollisionField {
  return new MapCollisionField(MAP_GEOMETRY_HASH, MAP_BOUNDARY, MAP_WALL_PIECES);
}

describe('map collision field', () => {
  it('keeps line of sight open when no map or static blocker is configured', () => {
    const state = createSimulationState(1);

    expect(hasDirectLineOfSight(state, vec2Mm(0, 0), vec2Mm(0, 0))).toBe(true);
    expect(hasDirectLineOfSight(state, vec2Mm(0, 0), vec2Mm(10_000, 0))).toBe(true);
  });

  it('reports boundary wall centers as blocked and spawn points as free', () => {
    const field = mapField();
    for (const spawn of MAP_SPAWN_POINTS) {
      expect(field.isCircleBlocked(spawn.position, PLAYER_RADIUS_MM)).toBe(false);
    }
    const piece = MAP_WALL_PIECES.find((item) => item.wallClass === 'BOUND');
    expect(piece).toBeDefined();
    if (!piece) {
      return;
    }
    const centroid = {
      x: Math.trunc(
        piece.vertices.reduce((sum, vertex) => sum + vertex.x, 0) / piece.vertices.length,
      ),
      z: Math.trunc(
        piece.vertices.reduce((sum, vertex) => sum + vertex.z, 0) / piece.vertices.length,
      ),
    };
    expect(field.circleTouchesWall(centroid, PLAYER_RADIUS_MM)).toBe(true);
  });

  it('lets walking cross VAULT hills but never BOUND walls', () => {
    const vault = MAP_WALL_PIECES.find((piece) => piece.wallClass === 'VAULT');
    const boundary = MAP_WALL_PIECES.find((piece) => piece.wallClass === 'BOUND');
    expect(vault).toBeDefined();
    expect(boundary).toBeDefined();
    if (!vault || !boundary) {
      return;
    }

    const centroidOf = (piece: MapConvexPieceRecord) => ({
      x: Math.trunc(
        piece.vertices.reduce((sum, vertex) => sum + vertex.x, 0) / piece.vertices.length,
      ),
      z: Math.trunc(
        piece.vertices.reduce((sum, vertex) => sum + vertex.z, 0) / piece.vertices.length,
      ),
    });

    expect(mapField().isCircleBlocked(centroidOf(vault), PLAYER_RADIUS_MM)).toBe(false);
    expect(
      mapField().isCircleBlocked(centroidOf(vault), PLAYER_RADIUS_MM, flightTraversal(2_500)),
    ).toBe(false);
    expect(
      mapField().isCircleBlocked(centroidOf(boundary), PLAYER_RADIUS_MM, flightTraversal(2_500)),
    ).toBe(true);
  });

  it('rejects positions outside the boundary polygon', () => {
    const field = mapField();
    expect(field.isCircleInsideBoundary(vec2Mm(1_000_000, 1_000_000), PLAYER_RADIUS_MM)).toBe(
      false,
    );
  });

  it('never returns a blocked position from sliding movement', () => {
    const field = mapField();
    const piece = MAP_WALL_PIECES[0];
    expect(piece).toBeDefined();
    if (!piece) {
      return;
    }
    const first = piece.vertices[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    // March straight at the first wall vertex from a legal offset position.
    let position = vec2Mm(first.x - 3_000, first.z - 3_000);
    if (field.isCircleBlocked(position, PLAYER_RADIUS_MM)) {
      position = vec2Mm(first.x - 6_000, first.z - 6_000);
    }
    expect(field.isCircleBlocked(position, PLAYER_RADIUS_MM)).toBe(false);
    for (let step = 0; step < 40; step += 1) {
      position = field.resolveMovement(
        position,
        vec2Mm(position.x + 200, position.z + 200),
        PLAYER_RADIUS_MM,
      );
      expect(field.isCircleBlocked(position, PLAYER_RADIUS_MM)).toBe(false);
    }
  });
});

describe('map-enabled simulation', () => {
  it('spawns 30 players on distinct authoritative map spawn points', () => {
    const simulation = new GameSimulation({ rootSeed: 20_260_725, map: { enabled: true } });
    for (let index = 0; index < 30; index += 1) {
      simulation.addPlayer({
        playerId: playerId(`p${index}`),
        heroId: HERO_IDS.sunWukong,
      });
    }
    const snapshot = simulation.getSnapshot();
    expect(snapshot.mapGeometryHash).toBe(MAP_GEOMETRY_HASH);
    const spawnKeys = new Set(
      MAP_SPAWN_POINTS.map((spawn) => `${spawn.position.x}|${spawn.position.z}`),
    );
    const seen = new Set<string>();
    for (const player of snapshot.players) {
      const key = `${player.position.x}|${player.position.z}`;
      expect(spawnKeys.has(key)).toBe(true);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(() =>
      simulation.addPlayer({ playerId: playerId('p30'), heroId: HERO_IDS.sunWukong }),
    ).toThrow(/capacity/);
  });

  it('keeps a moving player out of walls and inside the boundary', () => {
    const simulation = new GameSimulation({ rootSeed: 99, map: { enabled: true } });
    const entity = simulation.addPlayer({
      playerId: playerId('walker'),
      heroId: HERO_IDS.sunWukong,
    });
    const field = mapField();
    // Walk hard in one direction for 30 seconds; wherever the player ends up,
    // the position must remain legal against walls and the boundary.
    simulation.submitIntent(entity, createPlayerIntent({ sequence: 1, moveX: 1_000, moveZ: 0 }));
    simulation.step(600);
    const midPosition = simulation.getSnapshot().players[0]?.position;
    expect(midPosition).toBeDefined();
    if (!midPosition) {
      return;
    }
    expect(field.isCircleBlocked(midPosition, PLAYER_RADIUS_MM)).toBe(false);

    simulation.submitIntent(entity, createPlayerIntent({ sequence: 2, moveX: 0, moveZ: 1_000 }));
    simulation.step(600);
    const endPosition = simulation.getSnapshot().players[0]?.position;
    expect(endPosition).toBeDefined();
    if (!endPosition) {
      return;
    }
    expect(field.isCircleBlocked(endPosition, PLAYER_RADIUS_MM)).toBe(false);
  });

  it('prevents a ranged attack from acquiring a target through a map wall', () => {
    const field = mapField();
    // Find a wall piece thin enough to sit between two players 20m apart.
    let chosen: {
      pieceId: string;
      shooter: { x: number; z: number };
      target: { x: number; z: number };
    } | null = null;
    for (const piece of MAP_WALL_PIECES) {
      if (piece.wallClass !== 'BOUND') {
        continue;
      }
      const xs = piece.vertices.map((vertex) => vertex.x);
      const zs = piece.vertices.map((vertex) => vertex.z);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const width = maxX - minX;
      if (width < 2_000 || width > 9_000) {
        continue;
      }
      const centroidZ = Math.trunc(zs.reduce((sum, value) => sum + value, 0) / zs.length);
      const shooter = { x: minX - 4_000, z: centroidZ };
      const target = { x: maxX + 4_000, z: centroidZ };
      if (
        !field.isCircleBlocked(shooter, PLAYER_RADIUS_MM) &&
        !field.isCircleBlocked(target, PLAYER_RADIUS_MM)
      ) {
        chosen = { pieceId: piece.pieceId, shooter, target };
        break;
      }
    }
    expect(chosen).not.toBeNull();
    if (!chosen) {
      return;
    }

    const simulation = new GameSimulation({ rootSeed: 7_777, map: { enabled: true } });
    const attacker = simulation.addPlayer({
      playerId: playerId('shooter'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(chosen.shooter.x, chosen.shooter.z),
    });
    const target = simulation.addPlayer({
      playerId: playerId('victim'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(chosen.target.x, chosen.target.z),
    });
    simulation.submitIntent(
      attacker,
      createPlayerIntent({ sequence: 1, moveX: 0, moveZ: 0, attack: true, targetEntityId: target }),
    );
    simulation.step(12);

    const snapshot = simulation.getSnapshot();
    const combatEvents = simulation
      .drainEvents()
      .filter(
        (event) =>
          (event.type === 'damage' || event.type === 'projectile-blocked') &&
          event.targetEntityId === target,
      );
    expect(combatEvents).toEqual([]);
    expect(snapshot.projectiles).toEqual([]);
    const victim = simulation.getSnapshot().players.find((player) => player.entityId === target);
    expect(victim?.hp).toBe(victim?.maxHp);
  });

  it('replays a map match to the identical final state hash', () => {
    const simulation = new GameSimulation({ rootSeed: 424_242, map: { enabled: true } });
    const first = simulation.addPlayer({
      playerId: playerId('alpha'),
      heroId: HERO_IDS.sunWukong,
    });
    const second = simulation.addPlayer({
      playerId: playerId('beta'),
      heroId: HERO_IDS.ironFanPrincess,
    });
    simulation.submitIntent(first, createPlayerIntent({ sequence: 1, moveX: 1_000, moveZ: 250 }));
    simulation.submitIntent(second, createPlayerIntent({ sequence: 1, moveX: -750, moveZ: 1_000 }));
    simulation.step(200);

    const tape = simulation.exportReplay();
    expect(tape.map?.enabled).toBe(true);
    const replayed = replaySimulation(tape);
    expect(replayed.getStateHash()).toBe(tape.expectedStateHash);
  });

  it('produces a different state hash than the legacy arena for the same inputs', () => {
    const legacy = new GameSimulation({ rootSeed: 5 });
    const mapped = new GameSimulation({ rootSeed: 5, map: { enabled: true } });
    for (const simulation of [legacy, mapped]) {
      simulation.addPlayer({ playerId: playerId('solo'), heroId: HERO_IDS.sunWukong });
      simulation.step(10);
    }
    expect(legacy.getStateHash()).not.toBe(mapped.getStateHash());
    expect(legacy.getSnapshot().mapGeometryHash).toBeNull();
  });
});
