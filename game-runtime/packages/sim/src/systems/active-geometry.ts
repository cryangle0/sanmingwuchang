import { distanceSquaredMm, type Vec2Mm, vec2Mm } from '@jwgb/core';
import type { PlayerEntity } from '../types';

export function activeDirection(owner: PlayerEntity): Vec2Mm {
  const source =
    owner.intent.aim.x !== 0 || owner.intent.aim.z !== 0 ? owner.intent.aim : owner.facing;
  return source.x === 0 && source.z === 0 ? vec2Mm(0, 1_000) : vec2Mm(source.x, source.z);
}

export function pointInDirection(origin: Vec2Mm, direction: Vec2Mm, distanceMm: number): Vec2Mm {
  return vec2Mm(
    origin.x + Math.trunc((direction.x * distanceMm) / 1_000),
    origin.z + Math.trunc((direction.z * distanceMm) / 1_000),
  );
}

export function perpendicular(direction: Vec2Mm): Vec2Mm {
  return vec2Mm(-direction.z, direction.x);
}

export function pointAlongSegment(
  start: Vec2Mm,
  end: Vec2Mm,
  numerator: number,
  denominator: number,
): Vec2Mm {
  if (denominator <= 0 || numerator <= 0) {
    return vec2Mm(start.x, start.z);
  }
  if (numerator >= denominator) {
    return vec2Mm(end.x, end.z);
  }
  return vec2Mm(
    start.x + Math.trunc(((end.x - start.x) * numerator) / denominator),
    start.z + Math.trunc(((end.z - start.z) * numerator) / denominator),
  );
}

export function distanceSquaredToSegment(point: Vec2Mm, start: Vec2Mm, end: Vec2Mm): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared === 0) {
    return distanceSquaredMm(point, start);
  }
  const projection = Math.max(
    0,
    Math.min(lengthSquared, (point.x - start.x) * deltaX + (point.z - start.z) * deltaZ),
  );
  return distanceSquaredMm(point, pointAlongSegment(start, end, projection, lengthSquared));
}

export function projectionAlongSegment(
  point: Vec2Mm,
  start: Vec2Mm,
  end: Vec2Mm,
  segmentLengthMm: number,
): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared === 0) {
    return 0;
  }
  const projection = Math.max(
    0,
    Math.min(lengthSquared, (point.x - start.x) * deltaX + (point.z - start.z) * deltaZ),
  );
  return Math.trunc((segmentLengthMm * projection) / lengthSquared);
}

export function isInsideLine(
  point: Vec2Mm,
  center: Vec2Mm,
  direction: Vec2Mm,
  lengthMm: number,
  radiusMm: number,
): boolean {
  const half = Math.trunc(lengthMm / 2);
  const start = pointInDirection(center, direction, -half);
  const end = pointInDirection(center, direction, half);
  return distanceSquaredToSegment(point, start, end) <= radiusMm * radiusMm;
}

export function isInsideCone(
  point: Vec2Mm,
  origin: Vec2Mm,
  direction: Vec2Mm,
  rangeMm: number,
): boolean {
  const deltaX = point.x - origin.x;
  const deltaZ = point.z - origin.z;
  const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (distanceSquared > rangeMm * rangeMm) {
    return false;
  }
  const dot = deltaX * direction.x + deltaZ * direction.z;
  return dot >= 0 && dot * dot * 4 >= distanceSquared * 1_000_000;
}

export function segmentIntersectsCircle(
  start: Vec2Mm,
  end: Vec2Mm,
  center: Vec2Mm,
  radiusMm: number,
): boolean {
  return distanceSquaredToSegment(center, start, end) <= radiusMm * radiusMm;
}
