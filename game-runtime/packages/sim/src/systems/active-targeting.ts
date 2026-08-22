import { terrainBlocksLineOfSight } from '@jwgb/content';
import { distanceSquaredMm, type EntityId, type Vec2Mm } from '@jwgb/core';
import { segmentsIntersect } from '../geometry/integer-geometry';
import { flightTraversal, WALK_TRAVERSAL, type WallTraversal } from '../geometry/wall-traversal';
import { sortedMonsters, sortedPlayers } from '../state';
import type {
  ActiveZoneEntity,
  MonsterEntity,
  MutableSimulationState,
  PlayerEntity,
  SummonEntity,
} from '../types';
import { findFirstActiveWallContact } from './active-collision';
import { segmentIntersectsCircle } from './active-geometry';
import {
  equipmentFlightWallHeightMm,
  equipmentStealthRevealRangeMm,
  equipmentVisionRangeMm,
} from './equipment-query';

export type ActiveTarget = PlayerEntity | MonsterEntity | SummonEntity | ActiveZoneEntity;

export function isActivePlayer(target: ActiveTarget): target is PlayerEntity {
  return 'heroId' in target;
}

export function isActiveSummon(target: ActiveTarget): target is SummonEntity {
  return 'ownerEntityId' in target && 'attackPower' in target && !('activeId' in target);
}

export function isActiveZone(target: ActiveTarget): target is ActiveZoneEntity {
  return 'activeId' in target && 'center' in target;
}

export function activeTargetPosition(target: ActiveTarget) {
  return isActiveZone(target) ? target.center : target.position;
}

export function activeTargetCollisionRadius(target: ActiveTarget): number {
  if (isActivePlayer(target)) {
    return 450;
  }
  if (isActiveSummon(target)) {
    return 600;
  }
  if (isActiveZone(target)) {
    return Math.max(600, target.radiusMm);
  }
  return target.collisionRadiusMm;
}

function segmentIntersectsExpandedRect(
  start: Vec2Mm,
  end: Vec2Mm,
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
): boolean {
  const corners: readonly Vec2Mm[] = [
    { x: minimumX, z: minimumZ },
    { x: maximumX, z: minimumZ },
    { x: maximumX, z: maximumZ },
    { x: minimumX, z: maximumZ },
  ];
  const inside = (point: Vec2Mm): boolean =>
    point.x >= minimumX && point.x <= maximumX && point.z >= minimumZ && point.z <= maximumZ;
  if (inside(start) || inside(end)) {
    return true;
  }
  for (let index = 0; index < corners.length; index += 1) {
    const first = corners[index] as Vec2Mm;
    const second = corners[(index + 1) % corners.length] as Vec2Mm;
    if (segmentsIntersect(start, end, first, second)) {
      return true;
    }
  }
  return false;
}

function hasStaticSolidLineBlock(
  state: MutableSimulationState,
  start: Vec2Mm,
  end: Vec2Mm,
  clearanceMm: number,
): boolean {
  return state.staticSolids.some((solid) =>
    segmentIntersectsExpandedRect(
      start,
      end,
      solid.minimumX - clearanceMm,
      solid.maximumX + clearanceMm,
      solid.minimumZ - clearanceMm,
      solid.maximumZ + clearanceMm,
    ),
  );
}

function targetPassableWallHeight(target: ActiveTarget): number {
  if (isActivePlayer(target)) {
    return target.flightActive ? equipmentFlightWallHeightMm(target) : 0;
  }
  if (!isActiveZone(target) && 'kind' in target && target.kind === 'flying') {
    return 2_500;
  }
  return 0;
}

export function hasDirectLineOfSight(
  state: MutableSimulationState,
  start: Vec2Mm,
  end: Vec2Mm,
  clearanceMm = 450,
  traversal: WallTraversal = WALK_TRAVERSAL,
): boolean {
  const mapBlock =
    state.mapField?.firstLineOfSightBlock(start, end, clearanceMm, traversal) ?? null;
  if (mapBlock !== null) {
    return false;
  }
  if (state.mapField && terrainBlocksLineOfSight(start, end)) {
    return false;
  }
  if (hasStaticSolidLineBlock(state, start, end, clearanceMm)) {
    return false;
  }
  const distanceMm = Math.trunc(Math.sqrt(distanceSquaredMm(start, end)));
  if (
    distanceMm > 0 &&
    findFirstActiveWallContact(state, start, end, distanceMm, clearanceMm) !== undefined
  ) {
    return false;
  }
  return true;
}

function hasPrivateReveal(
  state: MutableSimulationState,
  sourceEntityId: EntityId,
  targetEntityId: EntityId,
): boolean {
  for (const effect of state.activeTargetEffects.values()) {
    if (
      effect.sourceEntityId === sourceEntityId &&
      effect.targetEntityId === targetEntityId &&
      effect.revealToSource &&
      effect.expiresAtTick > state.tick
    ) {
      return true;
    }
  }
  for (const targetState of state.passiveTargetStates.values()) {
    if (
      targetState.sourceEntityId === sourceEntityId &&
      targetState.targetEntityId === targetEntityId &&
      targetState.revealExpiresAtTick > state.tick
    ) {
      return true;
    }
  }
  return state.bountyMarks.some(
    (mark) =>
      mark.targetEntityId === targetEntityId &&
      mark.expiresAtTick > state.tick &&
      (mark.revealToAll || mark.sourceEntityId === sourceEntityId),
  );
}

function hasCoreBossReveal(
  state: MutableSimulationState,
  observer: PlayerEntity,
  targetPosition: Vec2Mm,
): boolean {
  const revealRadiusSquared = 10_000 * 10_000;
  const sources: Vec2Mm[] = [];
  for (const monster of state.monsters.values()) {
    if (monster.kind === 'core-boss') {
      sources.push(monster.position);
    }
  }
  for (const anchor of state.coreBossRevealAnchors.values()) {
    if (anchor.expiresAtTick > state.tick) {
      sources.push(anchor.position);
    }
  }
  return sources.some(
    (source) =>
      distanceSquaredMm(observer.position, source) <= revealRadiusSquared &&
      distanceSquaredMm(observer.position, targetPosition) <= revealRadiusSquared &&
      hasDirectLineOfSight(state, observer.position, source, 450) &&
      hasDirectLineOfSight(state, observer.position, targetPosition, 450),
  );
}

export function canSeeActiveTarget(
  state: MutableSimulationState,
  owner: PlayerEntity,
  target: ActiveTarget,
): boolean {
  const targetPosition = activeTargetPosition(target);
  const visionRangeMm = equipmentVisionRangeMm(owner);
  if (distanceSquaredMm(owner.position, targetPosition) > visionRangeMm * visionRangeMm) {
    return false;
  }
  const stealthRevealRangeMm = equipmentStealthRevealRangeMm(owner);
  if (
    isActivePlayer(target) &&
    (target.stealthTicks > 0 || target.nightCloakStealthed) &&
    !hasPrivateReveal(state, owner.entityId, target.entityId) &&
    !hasCoreBossReveal(state, owner, target.position) &&
    (stealthRevealRangeMm === 0 ||
      distanceSquaredMm(owner.position, target.position) >
        stealthRevealRangeMm * stealthRevealRangeMm)
  ) {
    return false;
  }
  // A sightline clears a low wall when either end is above it.
  const sightHeightBudgetMm = Math.max(
    isActivePlayer(owner) && owner.flightActive ? equipmentFlightWallHeightMm(owner) : 0,
    targetPassableWallHeight(target),
  );
  if (
    !hasDirectLineOfSight(
      state,
      owner.position,
      targetPosition,
      activeTargetCollisionRadius(target),
      flightTraversal(sightHeightBudgetMm),
    )
  ) {
    return false;
  }

  for (const zone of state.activeZones.values()) {
    if (
      zone.kind !== 'smoke' ||
      zone.expiresAtTick <= state.tick ||
      !segmentIntersectsCircle(owner.position, targetPosition, zone.center, zone.radiusMm)
    ) {
      continue;
    }
    const ownerInside =
      distanceSquaredMm(owner.position, zone.center) <= zone.radiusMm * zone.radiusMm;
    const targetInside =
      distanceSquaredMm(targetPosition, zone.center) <= zone.radiusMm * zone.radiusMm;
    if (!ownerInside || !targetInside) {
      return false;
    }
  }
  return true;
}

function isLiving(target: ActiveTarget): boolean {
  if (isActivePlayer(target)) {
    return target.lifeState === 'alive';
  }
  if (isActiveSummon(target)) {
    return target.targetable && target.hp > 0;
  }
  if (isActiveZone(target)) {
    return target.targetable && target.hp > 0;
  }
  return target.hp > 0 && target.invulnerableTicks <= 0;
}

export function isHostileActiveTarget(
  state: MutableSimulationState,
  owner: PlayerEntity,
  target: ActiveTarget,
  rangeMm: number,
): boolean {
  if (
    !isLiving(target) ||
    distanceSquaredMm(owner.position, activeTargetPosition(target)) > rangeMm * rangeMm
  ) {
    return false;
  }
  if (isActivePlayer(target) && target.entityId === owner.entityId) {
    return false;
  }
  if ((isActiveSummon(target) || isActiveZone(target)) && target.ownerEntityId === owner.entityId) {
    return false;
  }
  return canSeeActiveTarget(state, owner, target);
}

export function sortedActiveTargets(state: MutableSimulationState): ActiveTarget[] {
  return [
    ...sortedPlayers(state),
    ...sortedMonsters(state),
    ...[...state.summons.values()].sort(
      (left, right) => Number(left.entityId) - Number(right.entityId),
    ),
    ...[...state.activeZones.values()]
      .filter((zone) => zone.targetable)
      .sort((left, right) => Number(left.entityId) - Number(right.entityId)),
  ];
}

export function selectHostileActiveTarget(
  state: MutableSimulationState,
  owner: PlayerEntity,
  rangeMm: number,
  predicate: (target: ActiveTarget) => boolean = () => true,
): ActiveTarget | undefined {
  const candidates = sortedActiveTargets(state).filter(
    (target) => isHostileActiveTarget(state, owner, target, rangeMm) && predicate(target),
  );
  if (owner.intent.targetEntityId !== null) {
    const requested = candidates.find((target) => target.entityId === owner.intent.targetEntityId);
    if (requested) {
      return requested;
    }
  }
  return candidates.sort(
    (left, right) =>
      distanceSquaredMm(owner.position, activeTargetPosition(left)) -
        distanceSquaredMm(owner.position, activeTargetPosition(right)) ||
      Number(left.entityId) - Number(right.entityId),
  )[0];
}

export function selectVisiblePlayer(
  state: MutableSimulationState,
  owner: PlayerEntity,
  rangeMm: number,
  includeSelf: boolean,
): PlayerEntity | undefined {
  const candidates = sortedPlayers(state).filter(
    (target) =>
      target.lifeState === 'alive' &&
      (includeSelf || target.entityId !== owner.entityId) &&
      distanceSquaredMm(owner.position, target.position) <= rangeMm * rangeMm &&
      (target.entityId === owner.entityId || canSeeActiveTarget(state, owner, target)),
  );
  if (owner.intent.targetEntityId !== null) {
    const requested = candidates.find((target) => target.entityId === owner.intent.targetEntityId);
    if (requested) {
      return requested;
    }
  }
  return includeSelf
    ? candidates.find((target) => target.entityId === owner.entityId)
    : candidates[0];
}
