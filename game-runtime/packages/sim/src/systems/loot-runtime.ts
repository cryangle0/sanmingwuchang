import type { EquippedEquipmentInstance } from '@jwgb/content';
import { type EquipmentId, entityId, type Vec2Mm, vec2Mm } from '@jwgb/core';
import type { LootDrop, LootDropKind, MutableSimulationState, SimEvent } from '../types';

export const LOOT_SAFE_ZONE_EXPIRY = Number.MAX_SAFE_INTEGER;
export const LOOT_CURRENCY_EXPIRY_TICKS = 60 * 20;
export const LOOT_SHORT_EXPIRY_TICKS = 60 * 20;
export const LOOT_LONG_EXPIRY_TICKS = 120 * 20;
export const LOOT_STORM_GRACE_TICKS = 60 * 20;

export function createRuntimeLootDrop(
  state: MutableSimulationState,
  values: {
    readonly position: Vec2Mm;
    readonly gold?: number;
    readonly experience?: number;
    readonly gems?: number;
    readonly equipmentId?: EquipmentId | null;
    readonly bookPassiveId?: LootDrop['bookPassiveId'];
    readonly activeId?: LootDrop['activeId'];
    readonly kind: LootDropKind;
    readonly expiresAtTick?: number;
    readonly equipmentInstance?: EquippedEquipmentInstance | null;
  },
): LootDrop {
  const instance = values.equipmentInstance ?? null;
  const drop: LootDrop = {
    entityId: entityId(state.nextEntityId),
    position: vec2Mm(values.position.x, values.position.z),
    gold: values.gold ?? 0,
    experience: values.experience ?? 0,
    gems: values.gems ?? 0,
    equipmentId: values.equipmentId ?? null,
    bookPassiveId: values.bookPassiveId ?? null,
    createdAtTick: state.tick,
    expiresAtTick:
      values.expiresAtTick ??
      (values.kind === 'equipment' ||
      values.kind === 'death-equipment' ||
      values.kind === 'skill-book' ||
      values.kind === 'active'
        ? LOOT_SAFE_ZONE_EXPIRY
        : state.tick + LOOT_CURRENCY_EXPIRY_TICKS),
    kind: values.kind,
    activeId: values.activeId ?? null,
    equipmentInstanceId: instance?.instanceId ?? null,
    acquiredAtTick: instance?.acquiredAtTick ?? null,
    permanentAttackBonus: instance?.permanentAttackBonus ?? 0,
    stormCoveredSinceTick: null,
  };
  state.nextEntityId += 1;
  state.lootDrops.set(drop.entityId, drop);
  return drop;
}

export function emitLootDropped(
  state: MutableSimulationState,
  events: SimEvent[],
  drop: LootDrop,
  sourceEntityId: LootDrop['entityId'],
): void {
  events.push({
    type: 'loot-dropped',
    tick: state.tick,
    entityId: drop.entityId,
    sourceEntityId,
    gold: drop.gold,
    experience: drop.experience,
    gems: drop.gems,
    equipmentId: drop.equipmentId,
    bookPassiveId: drop.bookPassiveId,
    activeId: drop.activeId ?? null,
    ...(drop.kind === undefined ? {} : { lootKind: drop.kind }),
  });
}

export function createEquipmentLootDrop(
  state: MutableSimulationState,
  position: Vec2Mm,
  instance: EquippedEquipmentInstance,
  kind: 'equipment' | 'death-equipment' = 'equipment',
): LootDrop {
  return createRuntimeLootDrop(state, {
    position,
    equipmentId: instance.equipmentId,
    kind,
    equipmentInstance: instance,
    expiresAtTick: LOOT_SAFE_ZONE_EXPIRY,
  });
}
