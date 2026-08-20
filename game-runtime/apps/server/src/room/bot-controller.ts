import { createPlayerIntent, type EntityId, type PlayerIntent } from '@jwgb/core';
import type { MatchSnapshot, MonsterSnapshot, PlayerSnapshot } from '@jwgb/sim';

export interface BotWorldView {
  readonly match: Pick<MatchSnapshot, 'status'>;
  readonly players: readonly Pick<
    PlayerSnapshot,
    'entityId' | 'position' | 'facing' | 'hp' | 'lifeState' | 'attackRangeMm'
  >[];
  readonly monsters: readonly Pick<MonsterSnapshot, 'entityId' | 'position' | 'hp' | 'kind'>[];
}

type VisibleTarget = {
  readonly entityId: EntityId;
  readonly position: { readonly x: number; readonly z: number };
  readonly hp: number;
  readonly lifeState?: 'alive' | 'soul-flight' | 'revive-protection' | 'eliminated';
  readonly kind?: string;
};

function distanceSquared(
  left: { readonly x: number; readonly z: number },
  right: { readonly x: number; readonly z: number },
): number {
  const dx = left.x - right.x;
  const dz = left.z - right.z;
  return dx * dx + dz * dz;
}

function chooseTarget(
  snapshot: BotWorldView,
  self: BotWorldView['players'][number],
): VisibleTarget | null {
  let closest: VisibleTarget | null = null;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;
  const consider = (target: VisibleTarget): void => {
    const candidateDistanceSquared = distanceSquared(target.position, self.position);
    if (
      candidateDistanceSquared < closestDistanceSquared ||
      (candidateDistanceSquared === closestDistanceSquared &&
        Number(target.entityId) < Number(closest?.entityId ?? Number.MAX_SAFE_INTEGER))
    ) {
      closest = target;
      closestDistanceSquared = candidateDistanceSquared;
    }
  };

  for (const player of snapshot.players) {
    if (player.entityId !== self.entityId && player.lifeState === 'alive') {
      consider(player);
    }
  }
  for (const monster of snapshot.monsters) {
    if (monster.hp > 0 && monster.kind !== 'core-boss' && monster.kind !== 'dragon-king') {
      consider(monster);
    }
  }
  return closest;
}

function signedAxis(value: number): -1_000 | 0 | 1_000 {
  return value < 0 ? -1_000 : value > 0 ? 1_000 : 0;
}

/**
 * Produces the same ordinary intent shape as a player. The controller only
 * receives an observer snapshot, so an absent target is indistinguishable
 * from a target outside the bot's current vision.
 */
export function createBotIntent(
  snapshot: BotWorldView,
  botEntityId: EntityId,
  sequence: number,
): PlayerIntent {
  const self = snapshot.players.find((player) => player.entityId === botEntityId);
  if (!self || self.lifeState === 'eliminated') {
    return createPlayerIntent({ sequence, moveX: 0, moveZ: 0 });
  }

  const target = chooseTarget(snapshot, self);
  if (!target) {
    const distanceFromCenter = Math.sqrt(
      self.position.x * self.position.x + self.position.z * self.position.z,
    );
    if (distanceFromCenter > Math.max(1, snapshot.match.status === 'finished' ? 0 : 20_000)) {
      return createPlayerIntent({
        sequence,
        moveX: signedAxis(-self.position.x),
        moveZ: signedAxis(-self.position.z),
        aimX: signedAxis(-self.position.x),
        aimZ: signedAxis(-self.position.z),
        interact: false,
      });
    }
    return createPlayerIntent({
      sequence,
      moveX: 0,
      moveZ: 0,
      aimX: self.facing.x,
      aimZ: self.facing.z,
      interact: false,
    });
  }

  const dx = target.position.x - self.position.x;
  const dz = target.position.z - self.position.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const inRange = distance <= self.attackRangeMm;
  const moveX = inRange ? 0 : signedAxis(dx);
  const moveZ = inRange ? 0 : signedAxis(dz);
  return createPlayerIntent({
    sequence,
    moveX,
    moveZ,
    aimX: signedAxis(dx),
    aimZ: signedAxis(dz),
    attack: inRange,
    targetEntityId: target.entityId,
    castActive: false,
    alternateActive: false,
    interact: false,
  });
}
