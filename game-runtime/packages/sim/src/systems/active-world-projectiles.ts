import { distanceSquaredMm, moveToward, TICKS_PER_SECOND } from '@jwgb/core';
import type { ActiveProjectileEntity, MutableSimulationState, SimEvent } from '../types';
import { type ActiveWallSweepHit, findFirstActiveWallContact } from './active-collision';
import {
  applyActiveDamage,
  applyActiveRoot,
  applyPolymorph,
  scriptedDamageAmount,
} from './active-damage';
import { pointAlongSegment, projectionAlongSegment } from './active-geometry';
import {
  type ActiveTarget,
  activeTargetCollisionRadius,
  activeTargetPosition,
  isActivePlayer,
  isActiveSummon,
  isActiveZone,
  sortedActiveTargets,
} from './active-targeting';
import { expireActiveProjectile } from './active-world';
import { resolveTargetForcedDisplacement } from './displacement';
import { findFirstBlockingWindWall, type WindWallSweepHit } from './wind-wall';

interface ActorSweepHit {
  readonly target: ActiveTarget;
  readonly distanceMm: number;
}

function firstActorHit(
  state: MutableSimulationState,
  projectile: ActiveProjectileEntity,
  start: { x: number; z: number },
  end: { x: number; z: number },
  sweepDistanceMm: number,
): ActorSweepHit | undefined {
  const hits: ActorSweepHit[] = [];
  for (const target of sortedActiveTargets(state)) {
    if (
      isActiveZone(target) ||
      (isActivePlayer(target) && target.entityId === projectile.ownerEntityId) ||
      (isActiveSummon(target) && target.ownerEntityId === projectile.ownerEntityId) ||
      (!isActivePlayer(target) && !isActiveSummon(target) && target.invulnerableTicks > 0)
    ) {
      continue;
    }
    if (
      isActivePlayer(target)
        ? target.lifeState !== 'alive'
        : isActiveSummon(target)
          ? !target.targetable || target.hp <= 0
          : target.hp <= 0
    ) {
      continue;
    }
    const position = activeTargetPosition(target);
    const radius = activeTargetCollisionRadius(target) + projectile.collisionRadiusMm;
    const deltaX = end.x - start.x;
    const deltaZ = end.z - start.z;
    const segmentLengthSquared = deltaX * deltaX + deltaZ * deltaZ;
    if (segmentLengthSquared === 0) {
      continue;
    }
    const distanceSquared =
      projectionAlongSegment(position, start, end, sweepDistanceMm) >= 0
        ? distanceSquaredMm(
            position,
            pointAlongSegment(
              start,
              end,
              Math.max(
                0,
                Math.min(
                  segmentLengthSquared,
                  (position.x - start.x) * deltaX + (position.z - start.z) * deltaZ,
                ),
              ),
              segmentLengthSquared,
            ),
          )
        : Number.MAX_SAFE_INTEGER;
    if (distanceSquared <= radius * radius) {
      hits.push({
        target,
        distanceMm: projectionAlongSegment(position, start, end, sweepDistanceMm),
      });
    }
  }
  return hits.sort(
    (left, right) =>
      left.distanceMm - right.distanceMm ||
      Number(left.target.entityId) - Number(right.target.entityId),
  )[0];
}

function wallBeforeActor(wallDistance: number, actorHit: ActorSweepHit | undefined): boolean {
  return !actorHit || wallDistance <= actorHit.distanceMm;
}

function chooseWall(
  activeWall: ActiveWallSweepHit | undefined,
  windWall: WindWallSweepHit | undefined,
  actorHit: ActorSweepHit | undefined,
  sweepDistanceMm: number,
): { distanceMm: number; wall: ActiveWallSweepHit | WindWallSweepHit } | undefined {
  const candidates: { distanceMm: number; wall: ActiveWallSweepHit | WindWallSweepHit }[] = [];
  if (activeWall && wallBeforeActor(activeWall.distanceMm, actorHit)) {
    candidates.push({ distanceMm: activeWall.distanceMm, wall: activeWall });
  }
  if (
    windWall &&
    wallBeforeActor(
      Math.trunc((windWall.fractionNumerator * sweepDistanceMm) / windWall.fractionDenominator),
      actorHit,
    )
  ) {
    candidates.push({
      distanceMm: Math.trunc(
        (windWall.fractionNumerator * sweepDistanceMm) / windWall.fractionDenominator,
      ),
      wall: windWall,
    });
  }
  return candidates.sort(
    (left, right) =>
      left.distanceMm - right.distanceMm ||
      (left.wall as ActiveWallSweepHit).wall?.entityId -
        (right.wall as ActiveWallSweepHit).wall?.entityId,
  )[0];
}

function resolveProjectileHit(
  state: MutableSimulationState,
  events: SimEvent[],
  projectile: ActiveProjectileEntity,
  target: ActiveTarget,
): void {
  const owner = state.players.get(projectile.ownerEntityId);
  if (!owner) {
    return;
  }
  const baseAmount = scriptedDamageAmount(owner, {
    fixedDamage: projectile.fixedDamage,
    attackCoefficientBasisPoints: projectile.attackCoefficientBasisPoints,
  });
  const distanceBonusBasisPoints = Math.min(
    projectile.maximumDistanceBonusPercent * 100,
    Math.trunc(projectile.distanceTravelledMm / 10_000) * projectile.damagePerDistanceBasisPoints,
  );
  const amount = Math.trunc((baseAmount * (10_000 + distanceBonusBasisPoints)) / 10_000);
  if (projectile.kind !== 'polymorph') {
    applyActiveDamage(state, events, owner, target, amount, {
      activeAbilityId: projectile.activeId,
    });
  }
  if (projectile.kind === 'root') {
    applyActiveRoot(
      state,
      events,
      target,
      projectile.rootTicks,
      owner,
      projectile.activeId,
    );
  }
  if (projectile.kind === 'hook') {
    if (!isActiveZone(target)) {
      const targetPosition = activeTargetPosition(target);
      const deltaX = targetPosition.x - owner.position.x;
      const deltaZ = targetPosition.z - owner.position.z;
      const targetDistance = Math.max(1, Math.trunc(Math.sqrt(deltaX * deltaX + deltaZ * deltaZ)));
      const stopDistance = Math.min(projectile.displacementMm, targetDistance);
      const destination = {
        x: owner.position.x + Math.trunc((deltaX * stopDistance) / targetDistance),
        z: owner.position.z + Math.trunc((deltaZ * stopDistance) / targetDistance),
      };
      target.position = resolveTargetForcedDisplacement(
        state,
        events,
        target,
        targetPosition,
        destination,
        isActivePlayer(target) ? 450 : isActiveSummon(target) ? 600 : target.collisionRadiusMm,
      );
      if (
        (isActivePlayer(target) || (!isActiveSummon(target) && !isActiveZone(target))) &&
        !(
          !isActivePlayer(target) &&
          !isActiveSummon(target) &&
          !isActiveZone(target) &&
          target.kind === 'core-boss'
        )
      ) {
        target.displacementLockTicks = Math.max(
          target.displacementLockTicks,
          projectile.triggerHardControlTicks,
        );
      }
    }
  }
  if (projectile.kind === 'polymorph') {
    applyPolymorph(
      state,
      events,
      target,
      projectile.effectDurationTicks,
      projectile.effectSpeedBonusPercent,
      owner,
      projectile.activeId,
    );
  }
}

function advanceProjectile(
  state: MutableSimulationState,
  events: SimEvent[],
  projectile: ActiveProjectileEntity,
): void {
  const owner = state.players.get(projectile.ownerEntityId);
  if (!owner || projectile.remainingTravelMm <= 0) {
    expireActiveProjectile(state, events, projectile);
    return;
  }
  const movementNumerator = projectile.speedMmPerSecond + projectile.movementRemainder;
  const fullStep = Math.trunc(movementNumerator / TICKS_PER_SECOND);
  projectile.movementRemainder = movementNumerator - fullStep * TICKS_PER_SECOND;
  const sweepDistance = Math.min(fullStep, projectile.remainingTravelMm);
  if (sweepDistance <= 0) {
    return;
  }
  const start = projectile.position;
  const end = moveToward(
    start,
    {
      x: start.x + Math.trunc((projectile.direction.x * sweepDistance) / 1_000),
      z: start.z + Math.trunc((projectile.direction.z * sweepDistance) / 1_000),
    },
    sweepDistance,
  );
  const actorHit = firstActorHit(state, projectile, start, end, sweepDistance);
  const activeWall = findFirstActiveWallContact(
    state,
    start,
    end,
    sweepDistance,
    projectile.collisionRadiusMm,
  );
  const windWall = findFirstBlockingWindWall(state, start, end, projectile.collisionRadiusMm);
  const wall = chooseWall(activeWall, windWall, actorHit, sweepDistance);
  const mapWall = state.mapField
    ? state.mapField.sweepCircleFirstWallContact(
        start,
        end,
        sweepDistance,
        projectile.collisionRadiusMm,
      )
    : null;
  const wallDistance = wall?.distanceMm ?? Number.MAX_SAFE_INTEGER;
  if (
    (mapWall !== null &&
      mapWall.distanceMm <= wallDistance &&
      (!actorHit || mapWall.distanceMm <= actorHit.distanceMm)) ||
    (wall !== undefined && wallDistance <= (actorHit?.distanceMm ?? Number.MAX_SAFE_INTEGER))
  ) {
    expireActiveProjectile(state, events, projectile);
    return;
  }
  if (actorHit) {
    projectile.position = pointAlongSegment(start, end, actorHit.distanceMm, sweepDistance);
    projectile.distanceTravelledMm += actorHit.distanceMm;
    expireActiveProjectile(state, events, projectile);
    resolveProjectileHit(state, events, projectile, actorHit.target);
    return;
  }
  projectile.position = end;
  projectile.remainingTravelMm -= sweepDistance;
  projectile.distanceTravelledMm += sweepDistance;
  if (projectile.remainingTravelMm <= 0) {
    expireActiveProjectile(state, events, projectile);
  }
}

export function advanceActiveProjectiles(state: MutableSimulationState, events: SimEvent[]): void {
  const projectiles = [...state.activeProjectiles.values()].sort(
    (left, right) => Number(left.entityId) - Number(right.entityId),
  );
  for (const projectile of projectiles) {
    if (state.activeProjectiles.has(projectile.entityId) && projectile.createdAtTick < state.tick) {
      advanceProjectile(state, events, projectile);
    }
  }
}
