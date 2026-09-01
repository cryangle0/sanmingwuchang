import {
  AUTHORITATIVE_HEROES,
  getActiveDefinition,
  getAuthoritativePassive,
  getEquipmentDefinition,
} from '@jwgb/content';
import { distanceSquaredMm, type EntityId } from '@jwgb/core';
import type { LootSnapshot, PlayerSnapshot, WorldSnapshot } from '@jwgb/sim';

export const WORLD_INTERACT_RADIUS_MM = 2_500;
export const LOOT_HEAP_CELL_MM = 2_000;
export const WORLD_SHEET_PAGE_SIZE = 12;

export function shopDisplayName(shop: WorldSnapshot['shops'][number]): string {
  if (shop.kind === 'taibai') return '太白金星';
  if (shop.kind === 'heishan') return '黑山老妖';
  if (shop.kind === 'shoemaker') {
    return shop.shopId.endsWith('-b') ? '鞋匠乙' : '鞋匠甲';
  }
  return shop.shopId.endsWith('-b') ? '土地公乙' : '土地公甲';
}

export function shopStatusLabel(
  shop: WorldSnapshot['shops'][number],
  relocationSeconds: number,
): string {
  if (shop.status === 'relocating') {
    return `迁移中 · ${relocationSeconds}秒后重试`;
  }
  return '营业中';
}

export function stableTaibaiOffers(
  shopId: string,
  version: number,
  excludeHeroId: string,
): readonly (typeof AUTHORITATIVE_HEROES)[number][] {
  const pool = AUTHORITATIVE_HEROES.filter((hero) => hero.id !== excludeHeroId);
  if (pool.length <= 5) {
    return pool;
  }
  let seed = version * 1315423911;
  for (let index = 0; index < shopId.length; index += 1) {
    seed = (seed ^ (shopId.charCodeAt(index) * 16777619)) >>> 0;
  }
  const picked: (typeof AUTHORITATIVE_HEROES)[number][] = [];
  const remaining = [...pool];
  for (let count = 0; count < 5 && remaining.length > 0; count += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const index = seed % remaining.length;
    const [hero] = remaining.splice(index, 1);
    if (hero) {
      picked.push(hero);
    }
  }
  return picked;
}

export function lootDropTitle(drop: LootSnapshot): string {
  if (drop.bookPassiveId) {
    return `技能书 · ${getAuthoritativePassive(drop.bookPassiveId).name}`;
  }
  if (drop.activeId) {
    return `通用主动 · ${getActiveDefinition(drop.activeId).name}`;
  }
  if (drop.equipmentId) {
    return `装备 · ${getEquipmentDefinition(drop.equipmentId).name}`;
  }
  const parts: string[] = [];
  if (drop.gold > 0) parts.push(`${drop.gold}金`);
  if (drop.gems > 0) parts.push(`${drop.gems}宝石`);
  if (drop.experience > 0) parts.push(`${drop.experience}经验`);
  return parts.length > 0 ? parts.join(' · ') : '地面掉落';
}

export function lootDropKindLabel(drop: LootSnapshot): string {
  if (drop.bookPassiveId) return '技能书';
  if (drop.activeId) return '通用主动';
  if (drop.equipmentId) return '装备';
  return '资源';
}

export interface NearbyLootDrop {
  readonly drop: LootSnapshot;
  readonly distanceMm: number;
}

export interface LootHeap {
  readonly key: string;
  readonly drops: readonly NearbyLootDrop[];
  readonly position: LootSnapshot['position'];
  readonly distanceMm: number;
}

function isLootAvailable(drop: LootSnapshot, tick: number): boolean {
  return drop.expiresAtTick > tick;
}

export function nearbyLootDrops(
  snapshot: WorldSnapshot,
  player: PlayerSnapshot,
): NearbyLootDrop[] {
  return snapshot.lootDrops
    .filter((drop) => isLootAvailable(drop, snapshot.tick))
    .map((drop) => ({
      drop,
      distanceMm: Math.sqrt(distanceSquaredMm(player.position, drop.position)),
    }))
    .filter((entry) => entry.distanceMm <= WORLD_INTERACT_RADIUS_MM)
    .sort(
      (left, right) =>
        left.distanceMm - right.distanceMm || Number(left.drop.entityId) - Number(right.drop.entityId),
    );
}

export function clusterLootHeaps(entries: readonly NearbyLootDrop[]): LootHeap[] {
  const buckets = new Map<string, NearbyLootDrop[]>();
  for (const entry of entries) {
    const key = `${Math.round(entry.drop.position.x / LOOT_HEAP_CELL_MM)}:${Math.round(
      entry.drop.position.z / LOOT_HEAP_CELL_MM,
    )}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(key, [entry]);
    }
  }
  return [...buckets.entries()]
    .map(([key, drops]) => {
      const nearest = drops[0];
      return {
        key,
        drops,
        position: nearest?.drop.position ?? { x: 0, z: 0 },
        distanceMm: nearest?.distanceMm ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => left.distanceMm - right.distanceMm || left.key.localeCompare(right.key));
}

export function nearbyShop(
  snapshot: WorldSnapshot,
  player: PlayerSnapshot,
): WorldSnapshot['shops'][number] | undefined {
  let closest: WorldSnapshot['shops'][number] | undefined;
  let closestDistance = Number.MAX_SAFE_INTEGER;
  for (const shop of snapshot.shops) {
    const distance = Math.sqrt(distanceSquaredMm(player.position, shop.position));
    if (distance > WORLD_INTERACT_RADIUS_MM) {
      continue;
    }
    if (
      !closest ||
      (shop.status === 'open' && closest.status !== 'open') ||
      distance < closestDistance
    ) {
      closest = shop;
      closestDistance = distance;
    }
  }
  return closest;
}

export function heapFocusKey(heap: LootHeap, focusedEntityId: EntityId | null): string {
  return `${heap.key}:${focusedEntityId ?? heap.drops[0]?.drop.entityId ?? ''}:${heap.drops
    .map((entry) => entry.drop.entityId)
    .join(',')}`;
}
