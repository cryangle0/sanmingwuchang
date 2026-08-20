import type { PlayerEntity } from '../types';

export function canUseWorldResources(player: PlayerEntity): boolean {
  return (
    player.lifeState === 'alive' &&
    player.worldInteractionLockTicks <= 0 &&
    player.iceCoffinTicks <= 0 &&
    player.hardControlTicks <= 0 &&
    player.polymorphTicks <= 0
  );
}
