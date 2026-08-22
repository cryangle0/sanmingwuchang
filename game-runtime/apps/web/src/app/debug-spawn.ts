import { MAP_BOUNDARY, MAP_GEOMETRY_HASH, MAP_SPAWN_POINTS, MAP_WALL_PIECES } from '@jwgb/content';
import { type Vec2Mm, vec2Mm } from '@jwgb/core';
import { MapCollisionField } from '@jwgb/sim';

/**
 * Keeps the `?spawn=` debug override on ground a character can stand on.
 *
 * A position inside a wall is not a bad camera angle, it is a soft lock: the
 * mover resolves overlaps by rejection, so a character that starts embedded in
 * a solid has nowhere to slide and simply never moves. That reads as "movement
 * is broken" rather than "this coordinate is inside the boundary wall", which
 * is an expensive way to lose an afternoon.
 *
 * Rather than refuse the override, the nearest standable point is used and the
 * substitution is logged, so a rough coordinate still lands somewhere useful.
 */

/** Player collision radius; matches the mover's own figure. */
const PLAYER_RADIUS_MM = 450;
const SEARCH_STEP_MM = 2_000;
const SEARCH_RINGS = 24;
const SEARCH_DIRECTIONS = 16;

let field: MapCollisionField | null = null;

function collisionField(): MapCollisionField {
  if (!field) {
    field = new MapCollisionField(MAP_GEOMETRY_HASH, MAP_BOUNDARY, MAP_WALL_PIECES);
  }
  return field;
}

export function isStandable(position: Vec2Mm): boolean {
  return !collisionField().isCircleBlocked(position, PLAYER_RADIUS_MM);
}

/**
 * The requested point if a character fits there, otherwise the closest point
 * that one does. Falls back to an authored spawn micro-position when the
 * request is deep inside a solid.
 */
export function resolveDebugSpawn(requested: Vec2Mm): Vec2Mm {
  if (isStandable(requested)) {
    return requested;
  }

  for (let ring = 1; ring <= SEARCH_RINGS; ring += 1) {
    const radiusMm = ring * SEARCH_STEP_MM;
    for (let step = 0; step < SEARCH_DIRECTIONS; step += 1) {
      const angle = (step / SEARCH_DIRECTIONS) * Math.PI * 2;
      const candidate = vec2Mm(
        Math.round(requested.x + Math.cos(angle) * radiusMm),
        Math.round(requested.z + Math.sin(angle) * radiusMm),
      );
      if (isStandable(candidate)) {
        console.warn(
          `[spawn] ${describe(requested)} is inside collision; moved to ${describe(candidate)} ` +
            `(${(radiusMm / 1_000).toFixed(0)} m away).`,
        );
        return candidate;
      }
    }
  }

  const fallback = MAP_SPAWN_POINTS[0];
  console.warn(
    `[spawn] ${describe(requested)} is inside collision and nothing standable was found nearby; ` +
      'falling back to an authored spawn point.',
  );
  return fallback ? vec2Mm(fallback.position.x, fallback.position.z) : vec2Mm(0, 0);
}

function describe(position: Vec2Mm): string {
  return `spawn=${(position.x / 1_000).toFixed(0)},${(position.z / 1_000).toFixed(0)}`;
}
