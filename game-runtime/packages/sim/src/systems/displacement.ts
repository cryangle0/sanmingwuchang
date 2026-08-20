import { clampToCircle, type Vec2Mm, vec2Mm } from '@jwgb/core';
import { WALK_TRAVERSAL, type WallTraversal } from '../geometry/wall-traversal';
import type { MutableSimulationState, PlayerEntity, SimEvent, StaticSolidRect } from '../types';
import { isBlockedByActiveWall, resolveActiveWallMovement } from './active-collision';
import { interruptAirdropChannel } from './airdrop';
import { equipmentDisplacementBasisPoints } from './equipment-query';

function containsExpandedSolid(
  position: Vec2Mm,
  radiusMm: number,
  solid: StaticSolidRect,
): boolean {
  return (
    position.x >= solid.minimumX - radiusMm &&
    position.x <= solid.maximumX + radiusMm &&
    position.z >= solid.minimumZ - radiusMm &&
    position.z <= solid.maximumZ + radiusMm
  );
}

function isBlocked(
  position: Vec2Mm,
  radiusMm: number,
  solids: MutableSimulationState['staticSolids'],
): boolean {
  return solids.some((solid) => containsExpandedSolid(position, radiusMm, solid));
}

export function isLegalDisplacementDestination(
  state: MutableSimulationState,
  position: Vec2Mm,
  radiusMm: number,
): boolean {
  if (state.mapField) {
    return (
      !state.mapField.isCircleBlocked(position, radiusMm) &&
      !isBlockedByActiveWall(state, position, radiusMm)
    );
  }
  const clamped = clampToCircle(position, Math.max(0, state.arenaRadiusMm - radiusMm));
  return (
    clamped.x === position.x &&
    clamped.z === position.z &&
    !isBlocked(position, radiusMm, state.staticSolids) &&
    !isBlockedByActiveWall(state, position, radiusMm)
  );
}

export function resolveStaticSolidCollision(
  position: Vec2Mm,
  radiusMm: number,
  solids: MutableSimulationState['staticSolids'],
): Vec2Mm {
  let resolved = position;
  for (const solid of solids) {
    const minimumX = solid.minimumX - radiusMm;
    const maximumX = solid.maximumX + radiusMm;
    const minimumZ = solid.minimumZ - radiusMm;
    const maximumZ = solid.maximumZ + radiusMm;
    if (
      resolved.x < minimumX ||
      resolved.x > maximumX ||
      resolved.z < minimumZ ||
      resolved.z > maximumZ
    ) {
      continue;
    }
    const pushLeft = Math.abs(resolved.x - minimumX);
    const pushRight = Math.abs(maximumX - resolved.x);
    const pushDown = Math.abs(resolved.z - minimumZ);
    const pushUp = Math.abs(maximumZ - resolved.z);
    const smallestPush = Math.min(pushLeft, pushRight, pushDown, pushUp);
    if (smallestPush === pushLeft) {
      resolved = vec2Mm(minimumX, resolved.z);
    } else if (smallestPush === pushRight) {
      resolved = vec2Mm(maximumX, resolved.z);
    } else if (smallestPush === pushDown) {
      resolved = vec2Mm(resolved.x, minimumZ);
    } else {
      resolved = vec2Mm(resolved.x, maximumZ);
    }
  }
  return resolved;
}

export function resolveWorldMovement(
  state: MutableSimulationState,
  origin: Vec2Mm,
  requestedDestination: Vec2Mm,
  radiusMm: number,
  traversal: WallTraversal = WALK_TRAVERSAL,
): Vec2Mm {
  const staticResolved = state.mapField
    ? state.mapField.resolveMovement(origin, requestedDestination, radiusMm, traversal)
    : resolveStaticSolidCollision(
        clampToCircle(requestedDestination, Math.max(0, state.arenaRadiusMm - radiusMm)),
        radiusMm,
        state.staticSolids,
      );
  return resolveActiveWallMovement(state, origin, staticResolved, radiusMm);
}

export function resolveForcedDisplacement(
  state: MutableSimulationState,
  origin: Vec2Mm,
  requestedDestination: Vec2Mm,
  radiusMm: number,
): Vec2Mm {
  if (state.mapField) {
    return resolveActiveWallMovement(
      state,
      origin,
      state.mapField.resolveDisplacementPath(origin, requestedDestination, radiusMm),
      radiusMm,
    );
  }
  const destination = clampToCircle(
    requestedDestination,
    Math.max(0, state.arenaRadiusMm - radiusMm),
  );
  const deltaX = destination.x - origin.x;
  const deltaZ = destination.z - origin.z;
  const steps = Math.max(Math.abs(deltaX), Math.abs(deltaZ));
  if (steps === 0) {
    return origin;
  }

  let lastLegal = origin;
  for (let step = 1; step <= steps; step += 1) {
    const candidate = vec2Mm(
      origin.x + Math.trunc((deltaX * step) / steps),
      origin.z + Math.trunc((deltaZ * step) / steps),
    );
    if (isBlocked(candidate, radiusMm, state.staticSolids)) {
      return resolveActiveWallMovement(state, origin, lastLegal, radiusMm);
    }
    lastLegal = candidate;
  }
  return resolveActiveWallMovement(state, origin, lastLegal, radiusMm);
}

export function resolveTargetForcedDisplacement(
  state: MutableSimulationState,
  events: SimEvent[],
  target: PlayerEntity | { readonly position: Vec2Mm },
  origin: Vec2Mm,
  requestedDestination: Vec2Mm,
  radiusMm: number,
): Vec2Mm {
  if (!('heroId' in target)) {
    if ('kind' in target && target.kind === 'core-boss') {
      return origin;
    }
    return resolveForcedDisplacement(state, origin, requestedDestination, radiusMm);
  }
  const basisPoints = equipmentDisplacementBasisPoints(target);
  const deltaX = requestedDestination.x - origin.x;
  const deltaZ = requestedDestination.z - origin.z;
  const adjustedDestination = vec2Mm(
    origin.x + Math.trunc((deltaX * basisPoints) / 10_000),
    origin.z + Math.trunc((deltaZ * basisPoints) / 10_000),
  );
  const resolved = resolveForcedDisplacement(state, origin, adjustedDestination, radiusMm);
  if (resolved.x !== origin.x || resolved.z !== origin.z) {
    interruptAirdropChannel(state, events, target.entityId, 'forced-displacement');
  }
  return resolved;
}

export function resolvePlayerForcedDisplacement(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  requestedDestination: Vec2Mm,
  radiusMm: number,
): Vec2Mm {
  const origin = player.position;
  const resolved = resolveForcedDisplacement(state, origin, requestedDestination, radiusMm);
  if (resolved.x !== origin.x || resolved.z !== origin.z) {
    interruptAirdropChannel(state, events, player.entityId, 'forced-displacement');
  }
  return resolved;
}
