import {
  AUTHORITATIVE_CONTENT_COUNTS,
  AUTHORITATIVE_EQUIPMENT,
  AUTHORITATIVE_GENERIC_ACTIVES,
  AUTHORITATIVE_HEROES,
  AUTHORITATIVE_PASSIVES,
  AUTHORITATIVE_RUNTIME_COVERAGE,
  AUTHORITATIVE_WORLD_SUMMARY,
} from './authoritative.generated';
import { AUTHORITATIVE_MAP_STATIC_SOLIDS } from './map.generated';

export type {
  AuthoritativeEquipmentRecord,
  AuthoritativeHeroRecord,
  AuthoritativeNamedContentRecord,
  AuthoritativeWorldSummary,
  RuntimeImplementationStatus,
} from './authoritative-types';

export {
  AUTHORITATIVE_CONTENT_COUNTS,
  AUTHORITATIVE_EQUIPMENT,
  AUTHORITATIVE_GENERIC_ACTIVES,
  AUTHORITATIVE_HEROES,
  AUTHORITATIVE_MAP_STATIC_SOLIDS,
  AUTHORITATIVE_PASSIVES,
  AUTHORITATIVE_RUNTIME_COVERAGE,
  AUTHORITATIVE_WORLD_SUMMARY,
};

function indexById<T extends { readonly id: string }>(
  records: readonly T[],
): ReadonlyMap<string, T> {
  return new Map(records.map((record) => [record.id, record]));
}

const HERO_BY_ID = indexById(AUTHORITATIVE_HEROES);
const GENERIC_ACTIVE_BY_ID = indexById(AUTHORITATIVE_GENERIC_ACTIVES);
const PASSIVE_BY_ID = indexById(AUTHORITATIVE_PASSIVES);
const EQUIPMENT_BY_ID = indexById(AUTHORITATIVE_EQUIPMENT);

function required<T>(kind: string, id: string, records: ReadonlyMap<string, T>): T {
  const record = records.get(id);
  if (!record) {
    throw new Error(`unknown authoritative ${kind} ${id}`);
  }
  return record;
}

export function getAuthoritativeHero(id: string) {
  return required('hero', id, HERO_BY_ID);
}

export function getAuthoritativeGenericActive(id: string) {
  return required('generic active', id, GENERIC_ACTIVE_BY_ID);
}

export function getAuthoritativePassive(id: string) {
  const match = /^B0*(\d+)$/i.exec(id);
  const authorityId = match ? `B${Number(match[1])}` : id;
  return required('passive', authorityId, PASSIVE_BY_ID);
}

export function getAuthoritativeEquipment(id: string) {
  return required('equipment', id, EQUIPMENT_BY_ID);
}
