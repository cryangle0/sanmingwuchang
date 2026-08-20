import { distanceSquaredMm, type Vec2Mm, vec2Mm } from '@jwgb/core';
import type { ActiveZoneEntity, MutableSimulationState } from '../types';
import { distanceSquaredToSegment, isInsideLine, pointAlongSegment } from './active-geometry';

function isWall(zone: ActiveZoneEntity): boolean {
  return zone.kind === 'ring-wall' || zone.kind === 'ice-wall';
}

function isActiveWall(zone: ActiveZoneEntity, tick: number): boolean {
  return (
    isWall(zone) &&
    zone.activatesAtTick <= tick &&
    zone.expiresAtTick > tick &&
    (zone.kind !== 'ice-wall' || zone.hp > 0)
  );
}

function isBlockedByZone(position: Vec2Mm, radiusMm: number, zone: ActiveZoneEntity): boolean {
  if (zone.kind === 'ice-wall') {
    return isInsideLine(
      position,
      zone.center,
      zone.direction,
      zone.lengthMm,
      zone.radiusMm + radiusMm,
    );
  }
  const distanceMm = Math.trunc(Math.sqrt(distanceSquaredMm(position, zone.center)));
  const halfThickness = Math.max(1, Math.trunc(zone.lengthMm / 2));
  return Math.abs(distanceMm - zone.radiusMm) <= halfThickness + radiusMm;
}

export function isBlockedByActiveWall(
  state: MutableSimulationState,
  position: Vec2Mm,
  radiusMm: number,
): ActiveZoneEntity | undefined {
  return [...state.activeZones.values()]
    .filter((zone) => isActiveWall(zone, state.tick))
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .find((zone) => isBlockedByZone(position, radiusMm, zone));
}

export function resolveActiveWallMovement(
  state: MutableSimulationState,
  origin: Vec2Mm,
  requested: Vec2Mm,
  radiusMm: number,
): Vec2Mm {
  const deltaX = requested.x - origin.x;
  const deltaZ = requested.z - origin.z;
  const distanceMm = Math.max(Math.abs(deltaX), Math.abs(deltaZ));
  if (distanceMm === 0) {
    return requested;
  }
  const steps = Math.max(1, Math.ceil(distanceMm / 100));
  let lastLegal = vec2Mm(origin.x, origin.z);
  for (let step = 1; step <= steps; step += 1) {
    const candidate = pointAlongSegment(origin, requested, step, steps);
    if (isBlockedByActiveWall(state, candidate, radiusMm)) {
      return lastLegal;
    }
    lastLegal = candidate;
  }
  return lastLegal;
}

export interface ActiveWallSweepHit {
  readonly wall: ActiveZoneEntity;
  readonly distanceMm: number;
}

export function findFirstActiveWallContact(
  state: MutableSimulationState,
  start: Vec2Mm,
  end: Vec2Mm,
  sweepDistanceMm: number,
  radiusMm: number,
  ignoredWallEntityId?: number,
): ActiveWallSweepHit | undefined {
  const walls = [...state.activeZones.values()]
    .filter(
      (zone) => isActiveWall(zone, state.tick) && Number(zone.entityId) !== ignoredWallEntityId,
    )
    .sort((left, right) => Number(left.entityId) - Number(right.entityId));
  let best: ActiveWallSweepHit | undefined;
  const steps = Math.max(1, Math.ceil(sweepDistanceMm / 50));
  for (const wall of walls) {
    if (
      wall.kind === 'ice-wall' &&
      distanceSquaredToSegment(wall.center, start, end) >
        (wall.lengthMm + wall.radiusMm + radiusMm) ** 2
    ) {
      continue;
    }
    for (let step = 0; step <= steps; step += 1) {
      const point = pointAlongSegment(start, end, step, steps);
      if (!isBlockedByZone(point, radiusMm, wall)) {
        continue;
      }
      const distanceMm = Math.trunc((sweepDistanceMm * step) / steps);
      if (
        !best ||
        distanceMm < best.distanceMm ||
        (distanceMm === best.distanceMm && Number(wall.entityId) < Number(best.wall.entityId))
      ) {
        best = { wall, distanceMm };
      }
      break;
    }
  }
  return best;
}
