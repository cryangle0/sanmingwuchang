import type { ActiveId } from '@jwgb/core';
import { getGenericActiveDefinition } from './generic-active';
import { type ActiveAbilityDefinition, getHeroActiveDefinition } from './hero';

export function getActiveDefinition(id: ActiveId): ActiveAbilityDefinition {
  const active = getHeroActiveDefinition(id) ?? getGenericActiveDefinition(id);
  if (!active) {
    throw new Error(`active ${id} is not available in the M1 content set`);
  }
  return active;
}
