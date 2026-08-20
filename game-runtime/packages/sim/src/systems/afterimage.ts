import { getPassiveDefinition, PASSIVE_IDS, passiveLevelValue } from '@jwgb/content';
import { distanceSquaredMm, entityId, type Vec2Mm, vec2Mm } from '@jwgb/core';
import { sortedMonsters, sortedPlayers } from '../state';
import type {
  AfterimageEntity,
  MonsterEntity,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
  SummonEntity,
} from '../types';
import { applyDamage } from './damage';
import { getOutgoingDamageBasisPoints } from './lethal-protection';
import { applyMonsterDamage } from './monster-damage';
import { findPassiveLoadout, maxSlow } from './passive-runtime';
import { applySummonDamage } from './summon-health';

type AfterimageTarget = PlayerEntity | MonsterEntity | SummonEntity;

function isPlayerTarget(target: AfterimageTarget): target is PlayerEntity {
  return 'heroId' in target;
}

function isSummonTarget(target: AfterimageTarget): target is SummonEntity {
  return 'ownerEntityId' in target;
}

function isLivingTarget(target: AfterimageTarget): boolean {
  return isPlayerTarget(target)
    ? target.lifeState === 'alive'
    : isSummonTarget(target)
      ? target.targetable && target.hp > 0
      : target.hp > 0;
}

export function resetAfterimageTimer(player: PlayerEntity): void {
  player.b30NextAfterimageTick = 0;
}

export function maybeSpawnAfterimage(
  state: MutableSimulationState,
  player: PlayerEntity,
  previousPosition: Vec2Mm,
): void {
  const loadout = findPassiveLoadout(player, PASSIVE_IDS.afterimage);
  if (!loadout) {
    return;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.afterimage);
  if (definition.effect !== 'afterimage') {
    return;
  }
  const intervalTicks = passiveLevelValue(definition.intervalTicksByLevel, loadout.level);
  if (player.b30NextAfterimageTick === 0) {
    player.b30NextAfterimageTick = state.tick + intervalTicks;
    return;
  }
  if (state.tick < player.b30NextAfterimageTick) {
    return;
  }
  const durationTicks = passiveLevelValue(definition.durationTicksByLevel, loadout.level);
  const afterimage: AfterimageEntity = {
    entityId: entityId(state.nextEntityId),
    ownerEntityId: player.entityId,
    position: vec2Mm(previousPosition.x, previousPosition.z),
    slowPercent: passiveLevelValue(definition.slowPercentByLevel, loadout.level),
    slowDurationTicks: durationTicks,
    explosionDamage: loadout.level === 5 ? definition.level5ExplosionDamage : 0,
    explosionRadiusMm: definition.level5ExplosionRadiusMm,
    expiresAtTick: state.tick + durationTicks,
  };
  state.nextEntityId += 1;
  state.afterimages.set(afterimage.entityId, afterimage);
  player.b30NextAfterimageTick += intervalTicks;
}

function applyExplosionDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  afterimage: AfterimageEntity,
  owner: PlayerEntity,
): void {
  if (afterimage.explosionDamage <= 0) {
    return;
  }
  const radiusSquared = afterimage.explosionRadiusMm * afterimage.explosionRadiusMm;
  for (const target of [
    ...sortedPlayers(state),
    ...sortedMonsters(state),
    ...state.summons.values(),
  ]) {
    if (
      target.entityId === owner.entityId ||
      (isSummonTarget(target) && target.ownerEntityId === owner.entityId) ||
      !isLivingTarget(target) ||
      distanceSquaredMm(afterimage.position, target.position) > radiusSquared
    ) {
      continue;
    }
    if (isPlayerTarget(target)) {
      applyDamage(state, events, {
        sourceEntityId: owner.entityId,
        targetEntityId: target.entityId,
        amount: afterimage.explosionDamage,
        cause: 'passive',
        form: 'skill',
      });
    } else if (isSummonTarget(target)) {
      applySummonDamage(
        state,
        events,
        owner.entityId,
        target,
        Math.max(
          1,
          Math.trunc((afterimage.explosionDamage * getOutgoingDamageBasisPoints(owner)) / 10_000),
        ),
      );
    } else {
      applyMonsterDamage(
        state,
        events,
        owner.entityId,
        target,
        afterimage.explosionDamage,
        owner.element,
      );
    }
  }
}

export function advanceAfterimages(state: MutableSimulationState, events: SimEvent[]): void {
  const afterimages = [...state.afterimages.values()].sort(
    (left, right) => Number(left.entityId) - Number(right.entityId),
  );
  for (const afterimage of afterimages) {
    const owner = state.players.get(afterimage.ownerEntityId);
    if (!owner || owner.lifeState === 'eliminated' || afterimage.expiresAtTick <= state.tick) {
      state.afterimages.delete(afterimage.entityId);
      continue;
    }
    const target = [...sortedPlayers(state), ...sortedMonsters(state), ...state.summons.values()]
      .filter(
        (candidate) =>
          candidate.entityId !== owner.entityId &&
          (!isSummonTarget(candidate) || candidate.ownerEntityId !== owner.entityId) &&
          isLivingTarget(candidate) &&
          distanceSquaredMm(afterimage.position, candidate.position) <= 1_000 * 1_000,
      )
      .sort(
        (left, right) =>
          distanceSquaredMm(afterimage.position, left.position) -
            distanceSquaredMm(afterimage.position, right.position) ||
          Number(left.entityId) - Number(right.entityId),
      )[0];
    if (!target) {
      continue;
    }
    if (!isSummonTarget(target)) {
      maxSlow(target, afterimage.slowPercent, afterimage.slowDurationTicks);
    }
    applyExplosionDamage(state, events, afterimage, owner);
    state.afterimages.delete(afterimage.entityId);
    events.push({
      type: 'passive-proc',
      tick: state.tick,
      passiveId: PASSIVE_IDS.afterimage,
      sourceEntityId: owner.entityId,
      targetEntityId: target.entityId,
      detail: 'afterimage-triggered',
      amount: afterimage.explosionDamage,
      durationTicks: afterimage.slowDurationTicks,
    });
  }
}
