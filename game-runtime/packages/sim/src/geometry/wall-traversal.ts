/**
 * What a given actor or query is allowed to pass through on the map.
 *
 * Wall permissions are authored per wall in the map source and compiled into
 * every convex piece. They are never inferred from wall height: a wall is
 * crossable by blink only when the source marked it 可越障级, and crossable by
 * flight only when the source marked it 可越障级 AND the flying actor's own
 * height budget covers it. VAULT records are now walkable heightfield hills,
 * so only true wall records participate in these permission checks.
 */

export interface WallTraversal {
  /** May cross pieces the map source marked blink-passable. */
  readonly blinkPassable: boolean;
  /** May cross flight-passable pieces no taller than this, in millimeters. */
  readonly flightHeightBudgetMm: number;
}

/** Ordinary ground movement and ground line of sight: true walls are solid. */
export const WALK_TRAVERSAL: WallTraversal = {
  blinkPassable: false,
  flightHeightBudgetMm: 0,
};

/** D6 blink: crosses 可越障级 walls, never 封界级 walls. */
export const BLINK_TRAVERSAL: WallTraversal = {
  blinkPassable: true,
  flightHeightBudgetMm: 0,
};

/**
 * Flight from equipment. A zero budget collapses to {@link WALK_TRAVERSAL},
 * so callers can pass an unconditional budget without branching.
 */
export function flightTraversal(heightBudgetMm: number): WallTraversal {
  return heightBudgetMm <= 0
    ? WALK_TRAVERSAL
    : { blinkPassable: false, flightHeightBudgetMm: heightBudgetMm };
}

/** The single place that decides whether one wall piece stops one traversal. */
export function wallPieceBlocks(
  piece: {
    readonly wallClass?: string;
    readonly heightMm: number;
    readonly blinkPassable: boolean;
    readonly flightPassable: boolean;
  },
  traversal: WallTraversal,
): boolean {
  if (piece.wallClass === 'VAULT') {
    return false;
  }
  if (traversal.blinkPassable && piece.blinkPassable) {
    return false;
  }
  if (piece.flightPassable && piece.heightMm <= traversal.flightHeightBudgetMm) {
    return false;
  }
  return true;
}
