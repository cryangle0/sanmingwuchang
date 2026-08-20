import { M0_RULES, PASSIVE_IDS } from '@jwgb/content';
import { INPUT_AXIS_SCALE, TICKS_PER_SECOND, vec2Mm } from '@jwgb/core';
import { flightTraversal } from '../geometry/wall-traversal';
import { sortedPlayers } from '../state';
import type { MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import { maybeSpawnAfterimage, resetAfterimageTimer } from './afterimage';
import { resolveWorldMovement } from './displacement';
import { equipmentFlightWallHeightMm } from './equipment-query';
import { isIceCoffinLocked } from './ice-coffin';
import { findPassiveLoadout } from './passive-runtime';
import { currentMoveSpeedMmPerSecond } from './player-speed';
import { cancelHeroSwapIfOutsideTether } from './shop';

const MOVEMENT_DENOMINATOR = INPUT_AXIS_SCALE * TICKS_PER_SECOND;

function axisStep(input: number, speed: number, remainder: number): [number, number] {
  const numerator = input * speed + remainder;
  const movement = Math.trunc(numerator / MOVEMENT_DENOMINATOR);
  return [movement, numerator - movement * MOVEMENT_DENOMINATOR];
}

function canMove(player: PlayerEntity): boolean {
  return (
    (player.lifeState === 'alive' || player.lifeState === 'revive-protection') &&
    player.hardControlTicks === 0 &&
    !isIceCoffinLocked(player)
  );
}

export function advanceMovement(state: MutableSimulationState, events: SimEvent[] = []): void {
  for (const player of sortedPlayers(state)) {
    if (!canMove(player)) {
      continue;
    }

    const movement = player.intent.movement;
    const aim = player.intent.aim;
    if (aim.x !== 0 || aim.z !== 0) {
      player.facing = vec2Mm(aim.x, aim.z);
    }
    const b36 = findPassiveLoadout(player, PASSIVE_IDS.momentum);
    const b36MaxStacks = b36 ? ([5, 6, 6, 7, 8][b36.level - 1] ?? 0) : 0;
    if (movement.x !== 0 || movement.z !== 0) {
      player.b36MovingTicks += 1;
      if (b36 && player.b36MovingTicks >= TICKS_PER_SECOND) {
        player.b36Stacks = Math.min(b36MaxStacks, player.b36Stacks + 1);
        player.b36MovingTicks = 0;
      }
    } else {
      player.b36Stacks = 0;
      player.b36MovingTicks = 0;
      resetAfterimageTimer(player);
    }
    const moveSpeedMmPerSecond = currentMoveSpeedMmPerSecond(state, player);
    const [deltaX, remainderX] = axisStep(movement.x, moveSpeedMmPerSecond, player.moveRemainderX);
    const [deltaZ, remainderZ] = axisStep(movement.z, moveSpeedMmPerSecond, player.moveRemainderZ);

    player.moveRemainderX = remainderX;
    player.moveRemainderZ = remainderZ;

    if (movement.x !== 0 || movement.z !== 0) {
      player.facing = vec2Mm(movement.x, movement.z);
    }

    if (deltaX === 0 && deltaZ === 0) {
      continue;
    }

    const previousPosition = player.position;
    const requestedPosition = vec2Mm(player.position.x + deltaX, player.position.z + deltaZ);
    player.position = resolveWorldMovement(
      state,
      previousPosition,
      requestedPosition,
      M0_RULES.playerCapsuleRadiusMm,
      flightTraversal(player.flightActive ? equipmentFlightWallHeightMm(player) : 0),
    );
    cancelHeroSwapIfOutsideTether(state, events, player);
    maybeSpawnAfterimage(state, player, previousPosition);
  }
}
