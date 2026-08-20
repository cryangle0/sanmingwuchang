import { assertSafeInteger, invariant } from './assert';
import type { Brand } from './brand';

export type EntityId = Brand<number, 'EntityId'>;
export type ActiveId = Brand<string, 'ActiveId'>;
export type PassiveId = Brand<string, 'PassiveId'>;
export type EquipmentId = Brand<string, 'EquipmentId'>;
export type EquipmentInstanceId = Brand<number, 'EquipmentInstanceId'>;
export type HeroId = Brand<string, 'HeroId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type RoomId = Brand<string, 'RoomId'>;
export type Tick = Brand<number, 'Tick'>;

export function entityId(value: number): EntityId {
  assertSafeInteger(value, 'entityId');
  invariant(value > 0, 'entityId must be positive');
  return value as EntityId;
}

export function activeId(value: string): ActiveId {
  invariant(/^(H\d{3}|D(?:[1-9]|1\d|2[0-2]))$/.test(value), `invalid active id: ${value}`);
  return value as ActiveId;
}

export function passiveId(value: string): PassiveId {
  invariant(/^B(?:0[1-9]|[1-3]\d|4[0-4])$/.test(value), `invalid passive id: ${value}`);
  return value as PassiveId;
}

export function equipmentId(value: string): EquipmentId {
  invariant(
    /^(?:W[1-6]|B(?:[1-9]|1[0-4])|P(?:[1-9]|1[0-8])|G(?:[1-9]|10))$/.test(value),
    `invalid equipment id: ${value}`,
  );
  return value as EquipmentId;
}

export function equipmentInstanceId(value: number): EquipmentInstanceId {
  assertSafeInteger(value, 'equipmentInstanceId');
  invariant(value > 0, 'equipmentInstanceId must be positive');
  return value as EquipmentInstanceId;
}

export function heroId(value: string): HeroId {
  invariant(/^H\d{3}$/.test(value), `invalid hero id: ${value}`);
  return value as HeroId;
}

export function playerId(value: string): PlayerId {
  const normalized = value.trim();
  invariant(normalized.length > 0 && normalized.length <= 64, 'playerId length must be 1-64');
  return normalized as PlayerId;
}

export function roomId(value: string): RoomId {
  const normalized = value.trim();
  invariant(normalized.length > 0 && normalized.length <= 64, 'roomId length must be 1-64');
  return normalized as RoomId;
}

export function tick(value: number): Tick {
  assertSafeInteger(value, 'tick');
  invariant(value >= 0, 'tick must be non-negative');
  return value as Tick;
}
