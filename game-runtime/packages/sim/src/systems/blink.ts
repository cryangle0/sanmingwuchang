import { type ActiveAbilityDefinition, M0_RULES } from '@jwgb/content';
import {
  INPUT_AXIS_SCALE,
  integerSquareRoot,
  normalizeAxisPair,
  type Vec2Mm,
  vec2Mm,
} from '@jwgb/core';
import type { MapCollisionField } from '../geometry/map-collision-field';
import { BLINK_TRAVERSAL } from '../geometry/wall-traversal';
import type { MutableSimulationState, PlayerEntity, SimEvent, StaticSolidRect } from '../types';

type BlinkDefinition = Extract<ActiveAbilityDefinition, { readonly effect: 'capsule-sweep-blink' }>;

interface BlockingSolid {
  readonly solidId: string;
  readonly entryDistanceMm: number;
}

function blinkDirection(player: PlayerEntity): Vec2Mm {
  const requested = player.intent.aim;
  if (requested.x !== 0 || requested.z !== 0) {
    return normalizeAxisPair(requested.x, requested.z, INPUT_AXIS_SCALE);
  }
  if (player.facing.x !== 0 || player.facing.z !== 0) {
    return normalizeAxisPair(player.facing.x, player.facing.z, INPUT_AXIS_SCALE);
  }
  return vec2Mm(0, INPUT_AXIS_SCALE);
}

function positionAtDistance(origin: Vec2Mm, direction: Vec2Mm, distanceMm: number): Vec2Mm {
  return vec2Mm(
    origin.x + Math.trunc((direction.x * distanceMm) / INPUT_AXIS_SCALE),
    origin.z + Math.trunc((direction.z * distanceMm) / INPUT_AXIS_SCALE),
  );
}

function isInsideArena(position: Vec2Mm, state: MutableSimulationState): boolean {
  const legalRadiusMm = state.arenaRadiusMm - M0_RULES.playerCapsuleRadiusMm;
  return position.x * position.x + position.z * position.z <= legalRadiusMm * legalRadiusMm;
}

function arenaLimitedDistance(
  state: MutableSimulationState,
  origin: Vec2Mm,
  direction: Vec2Mm,
  requestedDistanceMm: number,
): number {
  if (isInsideArena(positionAtDistance(origin, direction, requestedDistanceMm), state)) {
    return requestedDistanceMm;
  }

  let legalDistanceMm = 0;
  let illegalDistanceMm = requestedDistanceMm + 1;
  while (illegalDistanceMm - legalDistanceMm > 1) {
    const candidateDistanceMm = Math.trunc((legalDistanceMm + illegalDistanceMm) / 2);
    if (isInsideArena(positionAtDistance(origin, direction, candidateDistanceMm), state)) {
      legalDistanceMm = candidateDistanceMm;
    } else {
      illegalDistanceMm = candidateDistanceMm;
    }
  }
  return legalDistanceMm;
}

function containsPlayerCenter(position: Vec2Mm, solid: StaticSolidRect): boolean {
  const radiusMm = M0_RULES.playerCapsuleRadiusMm;
  return (
    position.x >= solid.minimumX - radiusMm &&
    position.x <= solid.maximumX + radiusMm &&
    position.z >= solid.minimumZ - radiusMm &&
    position.z <= solid.maximumZ + radiusMm
  );
}

function firstSolidAtPosition(
  state: MutableSimulationState,
  position: Vec2Mm,
): StaticSolidRect | undefined {
  return state.staticSolids.find((solid) => containsPlayerCenter(position, solid));
}

function firstBlockingSolid(
  state: MutableSimulationState,
  origin: Vec2Mm,
  direction: Vec2Mm,
  requestedDistanceMm: number,
  maximumChordMm: number,
): BlockingSolid | undefined {
  let continuousEntryDistanceMm: number | null = null;
  let entrySolidId: string | null = null;

  for (let distanceMm = 0; distanceMm <= requestedDistanceMm; distanceMm += 1) {
    const solid = firstSolidAtPosition(state, positionAtDistance(origin, direction, distanceMm));
    if (!solid) {
      continuousEntryDistanceMm = null;
      entrySolidId = null;
      continue;
    }

    if (continuousEntryDistanceMm === null) {
      continuousEntryDistanceMm = distanceMm;
      entrySolidId = solid.solidId;
    }
    if (
      distanceMm - continuousEntryDistanceMm > maximumChordMm ||
      distanceMm === requestedDistanceMm
    ) {
      return {
        solidId: entrySolidId ?? solid.solidId,
        entryDistanceMm: continuousEntryDistanceMm,
      };
    }
  }
  return undefined;
}

/** Map mode: the concave boundary caps blink distance sample by sample. */
function boundaryLimitedDistance(
  field: MapCollisionField,
  origin: Vec2Mm,
  direction: Vec2Mm,
  requestedDistanceMm: number,
): number {
  for (let distanceMm = 0; distanceMm <= requestedDistanceMm; distanceMm += 1) {
    const sample = positionAtDistance(origin, direction, distanceMm);
    if (!field.isCircleInsideBoundary(sample, M0_RULES.playerCapsuleRadiusMm)) {
      return Math.max(0, distanceMm - 1);
    }
  }
  return requestedDistanceMm;
}

/**
 * Map mode twin of firstBlockingSolid over convex wall pieces.
 *
 * 可越障级 (VAULT) walls are transparent to blink per the map source, so only
 * 封界级 (BOUND) walls and the playfield boundary can stop a blink. The
 * continuous-chord rule still applies to the walls that do block.
 */
function firstBlockingPiece(
  field: MapCollisionField,
  origin: Vec2Mm,
  direction: Vec2Mm,
  requestedDistanceMm: number,
  maximumChordMm: number,
): BlockingSolid | undefined {
  let continuousEntryDistanceMm: number | null = null;
  let entryPieceId: string | null = null;

  for (let distanceMm = 0; distanceMm <= requestedDistanceMm; distanceMm += 1) {
    const pieceId = field.firstWallPieceAt(
      positionAtDistance(origin, direction, distanceMm),
      M0_RULES.playerCapsuleRadiusMm,
      BLINK_TRAVERSAL,
    );
    if (pieceId === null) {
      continuousEntryDistanceMm = null;
      entryPieceId = null;
      continue;
    }

    if (continuousEntryDistanceMm === null) {
      continuousEntryDistanceMm = distanceMm;
      entryPieceId = pieceId;
    }
    if (
      distanceMm - continuousEntryDistanceMm > maximumChordMm ||
      distanceMm === requestedDistanceMm
    ) {
      return {
        solidId: entryPieceId ?? pieceId,
        entryDistanceMm: continuousEntryDistanceMm,
      };
    }
  }
  return undefined;
}

/**
 * Blink may cross a 可越障级 wall but may never end inside one, so the landing
 * millimeter is validated against ordinary standing collision and walked back
 * along the ray until it is legal. Open-ground blinks cost a single query.
 */
function lastLandableDistanceMm(
  field: MapCollisionField,
  origin: Vec2Mm,
  direction: Vec2Mm,
  distanceMm: number,
): number {
  for (let candidateMm = distanceMm; candidateMm > 0; candidateMm -= 1) {
    const sample = positionAtDistance(origin, direction, candidateMm);
    if (!field.isCircleBlocked(sample, M0_RULES.playerCapsuleRadiusMm)) {
      return candidateMm;
    }
  }
  return 0;
}

export function resolveBlink(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  definition: BlinkDefinition,
): void {
  const previousPosition = player.position;
  const direction = blinkDirection(player);
  const arenaDistanceMm = state.mapField
    ? boundaryLimitedDistance(state.mapField, previousPosition, direction, definition.distanceMm)
    : arenaLimitedDistance(state, previousPosition, direction, definition.distanceMm);
  const blockingSolid = state.mapField
    ? firstBlockingPiece(
        state.mapField,
        previousPosition,
        direction,
        arenaDistanceMm,
        definition.maxContinuousSolidChordMm,
      )
    : firstBlockingSolid(
        state,
        previousPosition,
        direction,
        arenaDistanceMm,
        definition.maxContinuousSolidChordMm,
      );
  const stoppedDistanceMm = blockingSolid
    ? Math.max(0, blockingSolid.entryDistanceMm - 1)
    : arenaDistanceMm;
  const actualDistanceMm = state.mapField
    ? lastLandableDistanceMm(state.mapField, previousPosition, direction, stoppedDistanceMm)
    : stoppedDistanceMm;
  const newPosition = positionAtDistance(previousPosition, direction, actualDistanceMm);
  player.position = newPosition;
  player.moveRemainderX = 0;
  player.moveRemainderZ = 0;

  const deltaX = newPosition.x - previousPosition.x;
  const deltaZ = newPosition.z - previousPosition.z;
  events.push({
    type: 'blink',
    tick: state.tick,
    entityId: player.entityId,
    previousPosition,
    newPosition,
    requestedDistanceMm: definition.distanceMm,
    actualDistanceMm: integerSquareRoot(deltaX * deltaX + deltaZ * deltaZ),
    blockingSolidId: blockingSolid?.solidId ?? null,
  });
}
