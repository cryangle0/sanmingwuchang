import { type BasicProjectileDefinition, M0_RULES } from '@jwgb/content';
import {
  distanceSquaredMm,
  entityId,
  moveToward,
  TICKS_PER_SECOND,
  type Vec2Mm,
  vec2Mm,
} from '@jwgb/core';
import { sortedMonsters, sortedPlayers } from '../state';
import type {
  ActiveZoneEntity,
  MonsterEntity,
  MutableSimulationState,
  PlayerEntity,
  ProjectileEntity,
  SimEvent,
  SummonEntity,
} from '../types';
import { findFirstActiveWallContact } from './active-collision';
import { applyActiveDamage } from './active-damage';
import { type BasicAttackSnapshot, resolveBasicHit, resolveColdArrowHit } from './basic-hit';
import { applySummonDamage } from './summon-health';
import { findFirstBlockingWindWall, type WindWallSweepHit } from './wind-wall';

interface ActorSweepHit {
  readonly actor: PlayerEntity | MonsterEntity | SummonEntity | ActiveZoneEntity;
  readonly distanceMm: number;
}

function pointAlongSweep(
  start: Vec2Mm,
  end: Vec2Mm,
  distanceMm: number,
  sweepDistanceMm: number,
): Vec2Mm {
  if (distanceMm <= 0 || sweepDistanceMm <= 0) {
    return start;
  }
  if (distanceMm >= sweepDistanceMm) {
    return end;
  }
  return vec2Mm(
    start.x + Math.trunc(((end.x - start.x) * distanceMm) / sweepDistanceMm),
    start.z + Math.trunc(((end.z - start.z) * distanceMm) / sweepDistanceMm),
  );
}

function firstCircleContactDistance(
  start: Vec2Mm,
  end: Vec2Mm,
  sweepDistanceMm: number,
  center: Vec2Mm,
  combinedRadiusMm: number,
): number | undefined {
  const radiusSquared = combinedRadiusMm * combinedRadiusMm;
  if (distanceSquaredMm(start, center) <= radiusSquared) {
    return 0;
  }

  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const segmentLengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (segmentLengthSquared === 0) {
    return undefined;
  }

  const centerDeltaX = center.x - start.x;
  const centerDeltaZ = center.z - start.z;
  const projectionNumerator = Math.max(
    0,
    Math.min(segmentLengthSquared, centerDeltaX * deltaX + centerDeltaZ * deltaZ),
  );
  const closestDistanceMm = Math.trunc(
    (sweepDistanceMm * projectionNumerator) / segmentLengthSquared,
  );
  let insideDistanceMm: number | undefined;
  for (let offset = -2; offset <= 2; offset += 1) {
    const candidateDistanceMm = Math.max(0, Math.min(sweepDistanceMm, closestDistanceMm + offset));
    const candidate = pointAlongSweep(start, end, candidateDistanceMm, sweepDistanceMm);
    if (distanceSquaredMm(candidate, center) <= radiusSquared) {
      insideDistanceMm =
        insideDistanceMm === undefined
          ? candidateDistanceMm
          : Math.min(insideDistanceMm, candidateDistanceMm);
    }
  }
  if (insideDistanceMm === undefined) {
    return undefined;
  }

  let outsideDistanceMm = 0;
  while (insideDistanceMm - outsideDistanceMm > 1) {
    const candidateDistanceMm = Math.trunc((outsideDistanceMm + insideDistanceMm) / 2);
    const candidate = pointAlongSweep(start, end, candidateDistanceMm, sweepDistanceMm);
    if (distanceSquaredMm(candidate, center) <= radiusSquared) {
      insideDistanceMm = candidateDistanceMm;
    } else {
      outsideDistanceMm = candidateDistanceMm;
    }
  }
  return insideDistanceMm;
}

function firstActorSweepHit(
  state: MutableSimulationState,
  projectile: ProjectileEntity,
  start: Vec2Mm,
  end: Vec2Mm,
  sweepDistanceMm: number,
): ActorSweepHit | undefined {
  const hits: ActorSweepHit[] = [];

  for (const player of sortedPlayers(state)) {
    if (player.entityId === projectile.ownerEntityId || player.lifeState !== 'alive') {
      continue;
    }
    const combinedRadiusMm = projectile.collisionRadiusMm + M0_RULES.playerCapsuleRadiusMm;
    const distanceMm = firstCircleContactDistance(
      start,
      end,
      sweepDistanceMm,
      player.position,
      combinedRadiusMm,
    );
    if (distanceMm !== undefined) {
      hits.push({ actor: player, distanceMm });
    }
  }

  for (const monster of sortedMonsters(state)) {
    if (monster.invulnerableTicks > 0) {
      continue;
    }
    const combinedRadiusMm = projectile.collisionRadiusMm + monster.collisionRadiusMm;
    const distanceMm = firstCircleContactDistance(
      start,
      end,
      sweepDistanceMm,
      monster.position,
      combinedRadiusMm,
    );
    if (distanceMm !== undefined) {
      hits.push({ actor: monster, distanceMm });
    }
  }

  for (const summon of state.summons.values()) {
    if (!summon.targetable || summon.hp <= 0 || summon.ownerEntityId === projectile.ownerEntityId) {
      continue;
    }
    const distanceMm = firstCircleContactDistance(
      start,
      end,
      sweepDistanceMm,
      summon.position,
      projectile.collisionRadiusMm + 600,
    );
    if (distanceMm !== undefined) {
      hits.push({ actor: summon, distanceMm });
    }
  }

  for (const zone of state.activeZones.values()) {
    if (!zone.targetable || zone.hp <= 0 || zone.ownerEntityId === projectile.ownerEntityId) {
      continue;
    }
    const distanceMm = firstCircleContactDistance(
      start,
      end,
      sweepDistanceMm,
      zone.center,
      projectile.collisionRadiusMm + 600,
    );
    if (distanceMm !== undefined) {
      hits.push({ actor: zone, distanceMm });
    }
  }

  return hits.sort(
    (left, right) =>
      left.distanceMm - right.distanceMm ||
      Number(left.actor.entityId) - Number(right.actor.entityId),
  )[0];
}

function wallContactsBeforeTarget(
  wallHit: WindWallSweepHit,
  actorHit: ActorSweepHit | undefined,
  sweepDistanceMm: number,
): boolean {
  if (!actorHit) {
    return true;
  }
  return (
    wallHit.fractionNumerator * sweepDistanceMm <= actorHit.distanceMm * wallHit.fractionDenominator
  );
}

function removeProjectile(state: MutableSimulationState, projectile: ProjectileEntity): void {
  state.projectiles.delete(projectile.entityId);
}

function resolveProjectileHit(
  state: MutableSimulationState,
  events: SimEvent[],
  projectile: ProjectileEntity,
  target: PlayerEntity | MonsterEntity | SummonEntity | ActiveZoneEntity,
): void {
  removeProjectile(state, projectile);
  const owner = state.players.get(projectile.ownerEntityId);
  if (!owner) {
    return;
  }
  if ('activeId' in target) {
    applyActiveDamage(state, events, owner, target, projectile.baseDamage, {
      ...(projectile.activeAbilityId === undefined
        ? {}
        : { activeAbilityId: projectile.activeAbilityId }),
    });
    return;
  }
  if ('ownerEntityId' in target) {
    applySummonDamage(
      state,
      events,
      owner.entityId,
      target,
      Math.max(
        1,
        Math.trunc((projectile.baseDamage * projectile.outgoingDamageBasisPoints) / 10_000),
      ),
      {
        ...(projectile.activeAbilityId === undefined
          ? {}
          : { activeAbilityId: projectile.activeAbilityId }),
      },
    );
    return;
  }
  if (projectile.kind === 'cold-arrow') {
    resolveColdArrowHit(state, events, owner, target, projectile.baseDamage);
  } else {
    resolveBasicHit(state, events, owner, target, {
      sourceEntityId: projectile.ownerEntityId,
      sourceElement: projectile.sourceElement,
      baseDamage: projectile.baseDamage,
      outgoingDamageBasisPoints: projectile.outgoingDamageBasisPoints,
      ...(projectile.activeAbilityId === undefined
        ? {}
        : { armedActiveId: projectile.activeAbilityId }),
    });
  }
}

export function launchColdArrowProjectile(
  state: MutableSimulationState,
  owner: PlayerEntity,
  target: PlayerEntity | MonsterEntity | SummonEntity | ActiveZoneEntity,
  baseDamage: number,
  maxTravelDistanceMm: number,
): ProjectileEntity {
  const projectile: ProjectileEntity = {
    entityId: entityId(state.nextEntityId),
    kind: 'cold-arrow',
    ownerEntityId: owner.entityId,
    targetEntityId: target.entityId,
    position: vec2Mm(owner.position.x, owner.position.z),
    speedMmPerSecond: 55_000,
    collisionRadiusMm: 120,
    sourceElement: owner.element,
    baseDamage,
    outgoingDamageBasisPoints: 10_000,
    createdAtTick: state.tick,
    remainingTravelMm: maxTravelDistanceMm,
    movementRemainder: 0,
  };
  state.nextEntityId += 1;
  state.projectiles.set(projectile.entityId, projectile);
  return projectile;
}

export function launchBasicProjectile(
  state: MutableSimulationState,
  owner: PlayerEntity,
  target: PlayerEntity | MonsterEntity | SummonEntity | ActiveZoneEntity,
  definition: BasicProjectileDefinition,
  attack: BasicAttackSnapshot,
  maxTravelDistanceMm: number,
): ProjectileEntity {
  const projectile: ProjectileEntity = {
    entityId: entityId(state.nextEntityId),
    kind: 'basic',
    ownerEntityId: owner.entityId,
    targetEntityId: target.entityId,
    position: vec2Mm(owner.position.x, owner.position.z),
    speedMmPerSecond: definition.speedMmPerSecond,
    collisionRadiusMm: definition.collisionRadiusMm,
    sourceElement: attack.sourceElement,
    baseDamage: attack.baseDamage,
    outgoingDamageBasisPoints: attack.outgoingDamageBasisPoints,
    ...(attack.armedActiveId === undefined
      ? {}
      : { activeAbilityId: attack.armedActiveId }),
    createdAtTick: state.tick,
    remainingTravelMm: maxTravelDistanceMm,
    movementRemainder: 0,
  };
  state.nextEntityId += 1;
  state.projectiles.set(projectile.entityId, projectile);
  return projectile;
}

export function advanceProjectiles(state: MutableSimulationState, events: SimEvent[]): void {
  const projectiles = [...state.projectiles.values()].sort(
    (left, right) => Number(left.entityId) - Number(right.entityId),
  );

  for (const projectile of projectiles) {
    if (!state.projectiles.has(projectile.entityId) || projectile.createdAtTick >= state.tick) {
      continue;
    }

    const target =
      state.players.get(projectile.targetEntityId) ??
      state.monsters.get(projectile.targetEntityId) ??
      state.summons.get(projectile.targetEntityId);
    const activeTarget = target ?? state.activeZones.get(projectile.targetEntityId);
    if (
      !activeTarget ||
      ('heroId' in activeTarget && activeTarget.lifeState === 'eliminated') ||
      (!('heroId' in activeTarget) && activeTarget.hp <= 0) ||
      projectile.remainingTravelMm <= 0
    ) {
      removeProjectile(state, projectile);
      continue;
    }

    const movementNumerator = projectile.speedMmPerSecond + projectile.movementRemainder;
    const fullStepMm = Math.trunc(movementNumerator / TICKS_PER_SECOND);
    projectile.movementRemainder = movementNumerator - fullStepMm * TICKS_PER_SECOND;
    const sweepDistanceMm = Math.min(fullStepMm, projectile.remainingTravelMm);
    if (sweepDistanceMm <= 0) {
      continue;
    }

    const start = projectile.position;
    const end = moveToward(
      start,
      'activeId' in activeTarget ? activeTarget.center : activeTarget.position,
      sweepDistanceMm,
    );
    const actorHit = firstActorSweepHit(state, projectile, start, end, sweepDistanceMm);
    const windWallHit = findFirstBlockingWindWall(state, start, end, projectile.collisionRadiusMm);
    const activeWallHit = findFirstActiveWallContact(
      state,
      start,
      end,
      sweepDistanceMm,
      projectile.collisionRadiusMm,
      'activeId' in activeTarget ? Number(activeTarget.entityId) : undefined,
    );
    const mapWallHit = state.mapField
      ? state.mapField.sweepCircleFirstWallContact(
          start,
          end,
          sweepDistanceMm,
          projectile.collisionRadiusMm,
        )
      : null;

    const windBlocks =
      windWallHit !== undefined && wallContactsBeforeTarget(windWallHit, actorHit, sweepDistanceMm);
    const mapBlocks =
      mapWallHit !== null && (!actorHit || mapWallHit.distanceMm <= actorHit.distanceMm);
    const activeWallBlocks =
      activeWallHit !== undefined && (!actorHit || activeWallHit.distanceMm <= actorHit.distanceMm);

    if (windBlocks || mapBlocks || activeWallBlocks) {
      // Both blockers beat actors at ties; between blockers the nearer wins,
      // with the dynamic wind wall preferred on an exact tie.
      const windDistance = windBlocks
        ? Math.trunc(
            ((windWallHit as WindWallSweepHit).fractionNumerator * sweepDistanceMm) /
              (windWallHit as WindWallSweepHit).fractionDenominator,
          )
        : Number.MAX_SAFE_INTEGER;
      const mapDistance = mapBlocks
        ? (mapWallHit as { distanceMm: number }).distanceMm
        : Number.MAX_SAFE_INTEGER;
      const activeDistance = activeWallBlocks
        ? (activeWallHit as NonNullable<typeof activeWallHit>).distanceMm
        : Number.MAX_SAFE_INTEGER;
      const firstDistance = Math.min(windDistance, mapDistance, activeDistance);
      const windFirst = windDistance === firstDistance;
      const activeFirst = !windFirst && activeDistance === firstDistance;
      removeProjectile(state, projectile);
      events.push({
        type: 'projectile-blocked',
        tick: state.tick,
        projectileEntityId: projectile.entityId,
        sourceEntityId: projectile.ownerEntityId,
        targetEntityId: projectile.targetEntityId,
        wallEntityId: windFirst
          ? (windWallHit as WindWallSweepHit).wall.entityId
          : activeFirst
            ? (activeWallHit as NonNullable<typeof activeWallHit>).wall.entityId
            : null,
        blockingSolidId:
          windFirst || activeFirst ? null : (mapWallHit as { pieceId: string }).pieceId,
        projectileKind: projectile.kind,
      });
      continue;
    }

    if (actorHit) {
      projectile.position = pointAlongSweep(start, end, actorHit.distanceMm, sweepDistanceMm);
      resolveProjectileHit(state, events, projectile, actorHit.actor);
      continue;
    }

    projectile.position = end;
    projectile.remainingTravelMm -= sweepDistanceMm;
    if (projectile.remainingTravelMm <= 0) {
      removeProjectile(state, projectile);
    }
  }
}
