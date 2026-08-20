import type { EntityId } from '@jwgb/core';
import type { SimEvent } from '@jwgb/sim';

export interface ModelAnimationEventTriggers {
  readonly playerAttacks: ReadonlySet<EntityId>;
  readonly playerSpells: ReadonlySet<EntityId>;
  readonly monsterSpells: ReadonlySet<EntityId>;
}

export function collectModelAnimationEventTriggers(
  events: readonly SimEvent[],
): ModelAnimationEventTriggers {
  const playerAttacks = new Set<EntityId>();
  const playerSpells = new Set<EntityId>();
  const monsterSpells = new Set<EntityId>();
  for (const event of events) {
    if (event.type === 'basic-attack') {
      playerAttacks.add(event.sourceEntityId);
    } else if (
      event.type === 'damage' &&
      event.cause === 'basic' &&
      event.sourceEntityId !== null
    ) {
      playerAttacks.add(event.sourceEntityId);
    } else if (event.type === 'active-cast') {
      playerSpells.add(event.entityId);
    } else if (event.type === 'core-boss-cast' && event.phase === 'warning') {
      monsterSpells.add(event.bossEntityId);
    }
  }
  return { playerAttacks, playerSpells, monsterSpells };
}
