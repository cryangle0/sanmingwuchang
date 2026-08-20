import type { ActiveAbilityDefinition } from '@jwgb/content';
import type { PlayerEntity } from '../types';

type IceCoffinDefinition = Extract<
  ActiveAbilityDefinition,
  { readonly effect: 'self-lock-invulnerability' }
>;

export function startIceCoffin(player: PlayerEntity, definition: IceCoffinDefinition): void {
  player.iceCoffinTicks = definition.durationTicks;
}

export function isIceCoffinLocked(player: PlayerEntity): boolean {
  return player.iceCoffinTicks > 0;
}
