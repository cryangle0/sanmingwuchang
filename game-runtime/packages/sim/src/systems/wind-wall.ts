import { type ActiveAbilityDefinition, M0_RULES } from '@jwgb/content';
import {
  clampToCircle,
  entityId,
  INPUT_AXIS_SCALE,
  normalizeAxisPair,
  type Vec2Mm,
  vec2Mm,
} from '@jwgb/core';
import { sortedPlayers } from '../state';
import type { MutableSimulationState, PlayerEntity, SimEvent, WindWallEntity } from '../types';

type WindWallDefinition = Extract<ActiveAbilityDefinition, { readonly effect: 'wind-wall' }>;

const PROJECTILE_RADIUS_MM = 120;

export interface WindWallSweepHit {
  readonly wall: WindWallEntity;
  readonly fractionNumerator: number;
  readonly fractionDenominator: number;
}

function castDirection(player: PlayerEntity): Vec2Mm {
  const requested = player.intent.aim;
  if (requested.x !== 0 || requested.z !== 0) {
    return normalizeAxisPair(requested.x, requested.z, INPUT_AXIS_SCALE);
  }
  if (player.facing.x !== 0 || player.facing.z !== 0) {
    return normalizeAxisPair(player.facing.x, player.facing.z, INPUT_AXIS_SCALE);
  }
  return vec2Mm(0, INPUT_AXIS_SCALE);
}

function offset(position: Vec2Mm, direction: Vec2Mm, distanceMm: number): Vec2Mm {
  return vec2Mm(
    position.x + Math.trunc((direction.x * distanceMm) / INPUT_AXIS_SCALE),
    position.z + Math.trunc((direction.z * distanceMm) / INPUT_AXIS_SCALE),
  );
}

function projections(
  point: Vec2Mm,
  wall: Pick<WindWallEntity, 'center' | 'direction'>,
): { readonly normal: number; readonly tangent: number } {
  const deltaX = point.x - wall.center.x;
  const deltaZ = point.z - wall.center.z;
  return {
    normal: (deltaX * wall.direction.x + deltaZ * wall.direction.z) / INPUT_AXIS_SCALE,
    tangent: (-deltaX * wall.direction.z + deltaZ * wall.direction.x) / INPUT_AXIS_SCALE,
  };
}

function scaledProjections(
  point: Vec2Mm,
  wall: Pick<WindWallEntity, 'center' | 'direction'>,
): { readonly normal: number; readonly tangent: number } {
  const deltaX = point.x - wall.center.x;
  const deltaZ = point.z - wall.center.z;
  return {
    normal: deltaX * wall.direction.x + deltaZ * wall.direction.z,
    tangent: -deltaX * wall.direction.z + deltaZ * wall.direction.x,
  };
}

function touchesWall(player: PlayerEntity, wall: WindWallEntity): boolean {
  const projection = projections(player.position, wall);
  return (
    Math.abs(projection.normal) <= M0_RULES.playerCapsuleRadiusMm &&
    Math.abs(projection.tangent) <= wall.lengthMm / 2 + M0_RULES.playerCapsuleRadiusMm
  );
}

export function createWindWall(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  definition: WindWallDefinition,
): WindWallEntity {
  const direction = castDirection(owner);
  const center = clampToCircle(
    offset(owner.position, direction, definition.rangeMm),
    state.arenaRadiusMm,
  );
  const wall: WindWallEntity = {
    entityId: entityId(state.nextEntityId),
    ownerEntityId: owner.entityId,
    activeAbilityId: definition.id,
    center,
    direction,
    lengthMm: definition.lengthMm,
    remainingTicks: definition.durationTicks,
  };
  state.nextEntityId += 1;
  state.windWalls.set(wall.entityId, wall);
  events.push({
    type: 'active-world-spawned',
    tick: state.tick,
    entityId: wall.entityId,
    ownerEntityId: owner.entityId,
    activeAbilityId: definition.id,
    activeWorldKind: 'wind-wall',
  });

  for (const candidate of sortedPlayers(state)) {
    if (
      candidate.entityId === owner.entityId ||
      candidate.lifeState !== 'alive' ||
      !touchesWall(candidate, wall)
    ) {
      continue;
    }
    candidate.position = clampToCircle(
      offset(candidate.position, direction, definition.knockbackMm),
      state.arenaRadiusMm,
    );
  }

  return wall;
}

export function advanceWindWalls(state: MutableSimulationState, events: SimEvent[]): void {
  for (const wall of [...state.windWalls.values()]) {
    wall.remainingTicks -= 1;
    if (wall.remainingTicks <= 0) {
      state.windWalls.delete(wall.entityId);
      events.push({
        type: 'active-world-expired',
        tick: state.tick,
        entityId: wall.entityId,
        ownerEntityId: wall.ownerEntityId,
        activeAbilityId: wall.activeAbilityId,
        activeWorldKind: 'wind-wall',
      });
    }
  }
}

export function removeOwnedWindWalls(
  state: MutableSimulationState,
  ownerEntityId: PlayerEntity['entityId'],
  events?: SimEvent[],
): void {
  for (const wall of [...state.windWalls.values()]) {
    if (wall.ownerEntityId === ownerEntityId) {
      state.windWalls.delete(wall.entityId);
      events?.push({
        type: 'active-world-expired',
        tick: state.tick,
        entityId: wall.entityId,
        ownerEntityId: wall.ownerEntityId,
        activeAbilityId: wall.activeAbilityId,
        activeWorldKind: 'wind-wall',
      });
    }
  }
}

function compareSweepHits(left: WindWallSweepHit, right: WindWallSweepHit): number {
  const fractionDelta =
    left.fractionNumerator * right.fractionDenominator -
    right.fractionNumerator * left.fractionDenominator;
  return fractionDelta || Number(left.wall.entityId) - Number(right.wall.entityId);
}

export function findFirstBlockingWindWall(
  state: MutableSimulationState,
  start: Vec2Mm,
  end: Vec2Mm,
  projectileRadiusMm = PROJECTILE_RADIUS_MM,
): WindWallSweepHit | undefined {
  const hits: WindWallSweepHit[] = [];

  for (const wall of state.windWalls.values()) {
    const startProjection = scaledProjections(start, wall);
    const endProjection = scaledProjections(end, wall);
    const normalLimit = projectileRadiusMm * INPUT_AXIS_SCALE;
    let fractionNumerator: number;
    let fractionDenominator: number;
    if (Math.abs(startProjection.normal) <= normalLimit) {
      fractionNumerator = 0;
      fractionDenominator = 1;
    } else if (startProjection.normal > normalLimit) {
      if (endProjection.normal > normalLimit) {
        continue;
      }
      fractionNumerator = startProjection.normal - normalLimit;
      fractionDenominator = startProjection.normal - endProjection.normal;
    } else {
      if (endProjection.normal < -normalLimit) {
        continue;
      }
      fractionNumerator = startProjection.normal + normalLimit;
      fractionDenominator = startProjection.normal - endProjection.normal;
    }
    if (fractionDenominator < 0) {
      fractionNumerator *= -1;
      fractionDenominator *= -1;
    }
    if (
      fractionNumerator < 0 ||
      fractionNumerator > fractionDenominator ||
      fractionDenominator <= 0
    ) {
      continue;
    }

    const tangentNumerator =
      startProjection.tangent * fractionDenominator +
      (endProjection.tangent - startProjection.tangent) * fractionNumerator;
    const tangentLimit =
      (wall.lengthMm / 2 + projectileRadiusMm) * INPUT_AXIS_SCALE * fractionDenominator;
    if (Math.abs(tangentNumerator) <= tangentLimit) {
      hits.push({
        wall,
        fractionNumerator,
        fractionDenominator,
      });
    }
  }

  return hits.sort(compareSweepHits)[0];
}
