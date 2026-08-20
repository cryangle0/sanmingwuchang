import { assertSafeInteger, invariant } from './assert';

export interface Vec2Mm {
  readonly x: number;
  readonly z: number;
}

export const ZERO_VEC2_MM: Vec2Mm = Object.freeze({ x: 0, z: 0 });

export function vec2Mm(x: number, z: number): Vec2Mm {
  assertSafeInteger(x, 'x');
  assertSafeInteger(z, 'z');
  return { x, z };
}

export function clampInteger(value: number, minimum: number, maximum: number): number {
  assertSafeInteger(value, 'value');
  assertSafeInteger(minimum, 'minimum');
  assertSafeInteger(maximum, 'maximum');
  invariant(minimum <= maximum, 'minimum must not exceed maximum');
  return Math.min(maximum, Math.max(minimum, value));
}

export function integerSquareRoot(value: number): number {
  assertSafeInteger(value, 'value');
  invariant(value >= 0, 'value must be non-negative');

  let result = Math.floor(Math.sqrt(value));
  while ((result + 1) * (result + 1) <= value) {
    result += 1;
  }
  while (result * result > value) {
    result -= 1;
  }
  return result;
}

export function distanceSquaredMm(left: Vec2Mm, right: Vec2Mm): number {
  const dx = left.x - right.x;
  const dz = left.z - right.z;
  const result = dx * dx + dz * dz;
  assertSafeInteger(result, 'distanceSquaredMm');
  return result;
}

export function normalizeAxisPair(x: number, z: number, scale = 1_000): Vec2Mm {
  const clampedX = clampInteger(x, -scale, scale);
  const clampedZ = clampInteger(z, -scale, scale);
  const magnitudeSquared = clampedX * clampedX + clampedZ * clampedZ;

  if (magnitudeSquared <= scale * scale) {
    return vec2Mm(clampedX, clampedZ);
  }

  const magnitude = integerSquareRoot(magnitudeSquared);
  invariant(magnitude > 0, 'non-zero input must have positive magnitude');
  return vec2Mm(
    Math.trunc((clampedX * scale) / magnitude),
    Math.trunc((clampedZ * scale) / magnitude),
  );
}

export function clampToCircle(position: Vec2Mm, radiusMm: number): Vec2Mm {
  assertSafeInteger(radiusMm, 'radiusMm');
  invariant(radiusMm >= 0, 'radiusMm must be non-negative');
  const distanceSquared = position.x * position.x + position.z * position.z;

  if (distanceSquared <= radiusMm * radiusMm) {
    return position;
  }

  const distance = integerSquareRoot(distanceSquared);
  return vec2Mm(
    Math.trunc((position.x * radiusMm) / distance),
    Math.trunc((position.z * radiusMm) / distance),
  );
}

export function moveToward(from: Vec2Mm, to: Vec2Mm, maximumDistanceMm: number): Vec2Mm {
  assertSafeInteger(maximumDistanceMm, 'maximumDistanceMm');
  invariant(maximumDistanceMm >= 0, 'maximumDistanceMm must be non-negative');

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distanceSquared = dx * dx + dz * dz;

  if (distanceSquared === 0 || distanceSquared <= maximumDistanceMm * maximumDistanceMm) {
    return to;
  }

  const distance = integerSquareRoot(distanceSquared);
  return vec2Mm(
    from.x + Math.trunc((dx * maximumDistanceMm) / distance),
    from.z + Math.trunc((dz * maximumDistanceMm) / distance),
  );
}
