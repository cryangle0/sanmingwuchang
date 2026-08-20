import {
  EQUIPMENT_IDS,
  type EquipmentRarity,
  elementDamageBasisPoints,
  type FiveElement,
  M1_EQUIPMENT,
  M1_GENERIC_ACTIVES,
  M1_PASSIVES,
  MAP_COURTS,
} from '@jwgb/content';
import { type ActiveId, type EntityId, type PassiveId, TICKS_PER_SECOND } from '@jwgb/core';
import type {
  LootDrop,
  MonsterEntity,
  MonsterKind,
  MonsterRespawn,
  MutableSimulationState,
  SimEvent,
} from '../types';
import { activeTargetDamageBonusBasisPoints } from './active-damage';
import { handleCoreBossDefeated, recordCoreBossThreat } from './core-boss';
import {
  equipmentElementDamageBasisPoints,
  equipmentMonsterDamageBasisPoints,
} from './equipment-query';
import { clearComboShoesTargetState } from './equipment-state';
import { getOutgoingDamageBasisPoints } from './lethal-protection';
import { createRuntimeLootDrop, emitLootDropped } from './loot-runtime';
import { createTreasureHunterDrop } from './passive-economy';
import { resolvePassiveKill } from './passive-kill';
import { markCombatActivity, targetDamageBonusBasisPoints } from './passive-runtime';

const MONSTER_RESPAWN_TICKS: Readonly<Record<MonsterKind, number>> = {
  'ground-melee': 40 * TICKS_PER_SECOND,
  'ground-ranged': 40 * TICKS_PER_SECOND,
  flying: 45 * TICKS_PER_SECOND,
  pig: 120 * TICKS_PER_SECOND,
  'elite-tank': 180 * TICKS_PER_SECOND,
  'elite-ranged': 180 * TICKS_PER_SECOND,
  'dragon-king': 240 * TICKS_PER_SECOND,
  'core-boss': 300 * TICKS_PER_SECOND,
};

function monsterGold(monster: MonsterEntity): number {
  switch (monster.kind) {
    case 'ground-melee':
      return monster.ring === 'outer' ? 90 : monster.ring === 'middle' ? 140 : 180;
    case 'ground-ranged':
      return monster.ring === 'outer' ? 90 : monster.ring === 'middle' ? 140 : 180;
    case 'flying':
      return monster.ring === 'outer' ? 140 : monster.ring === 'middle' ? 200 : 260;
    case 'pig':
      return 700;
    case 'elite-tank':
    case 'elite-ranged':
      return 1_400;
    case 'dragon-king':
      return 2_000;
    case 'core-boss':
      return 3_000;
  }
}

function monsterExperience(monster: MonsterEntity): number {
  switch (monster.kind) {
    case 'ground-melee':
    case 'ground-ranged':
      return monster.ring === 'outer' ? 28 : monster.ring === 'middle' ? 40 : 56;
    case 'flying':
      return monster.ring === 'outer' ? 40 : monster.ring === 'middle' ? 56 : 78;
    case 'pig':
      return 80;
    case 'elite-tank':
    case 'elite-ranged':
      return 200;
    case 'dragon-king':
      return 300;
    case 'core-boss':
      return 400;
  }
}

function passiveBookPool(monster: MonsterEntity): readonly PassiveId[] {
  switch (monster.kind) {
    case 'flying':
      return ['B03', 'B15', 'B27', 'B28', 'B30'] as PassiveId[];
    case 'pig':
      return ['B31', 'B32', 'B33', 'B34', 'B35', 'B41', 'B42'] as PassiveId[];
    case 'elite-tank':
      return ['B16', 'B17', 'B18', 'B20', 'B21', 'B24', 'B38', 'B40'] as PassiveId[];
    case 'elite-ranged':
      return ['B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B26', 'B29'] as PassiveId[];
    default:
      return M1_PASSIVES.map((passive) => passive.id);
  }
}

function passiveBookCount(state: MutableSimulationState, monster: MonsterEntity): number {
  switch (monster.kind) {
    case 'ground-melee':
    case 'ground-ranged':
      return state.random.combat.nextInt(100) < 10 ? 1 : 0;
    case 'flying':
      return state.random.combat.nextInt(100) < 20 ? 1 : 0;
    case 'pig':
      return state.random.combat.nextInt(100) < 55 ? 1 : 0;
    case 'elite-tank':
    case 'elite-ranged':
      return 1;
    case 'core-boss':
      return 2;
    case 'dragon-king':
      return 0;
  }
}

function choosePassiveBook(state: MutableSimulationState, monster: MonsterEntity): PassiveId {
  const pool = passiveBookPool(monster);
  const passiveId = pool[state.random.combat.nextInt(pool.length)] ?? M1_PASSIVES[0]?.id;
  if (!passiveId) {
    throw new Error('M1 passive book pool is empty');
  }
  return passiveId;
}

const RARITY_RANK: Readonly<Record<EquipmentRarity, number>> = {
  white: 0,
  blue: 1,
  purple: 2,
  gold: 3,
};

function chooseRarity(
  state: MutableSimulationState,
  monster: MonsterEntity,
  sourceEntityId: EntityId,
): EquipmentRarity | null {
  if (monster.kind === 'pig') {
    const roll = state.random.combat.nextInt(100);
    return roll < 60 ? 'white' : roll < 90 ? 'blue' : 'purple';
  }
  if (monster.kind === 'elite-tank' || monster.kind === 'elite-ranged') {
    const roll = state.random.combat.nextInt(100);
    return roll < 35 ? 'white' : roll < 75 ? 'blue' : 'purple';
  }
  if (monster.kind === 'dragon-king') {
    let rarity: EquipmentRarity;
    const roll = state.random.combat.nextInt(100);
    rarity = roll < 55 ? 'blue' : roll < 90 ? 'purple' : 'gold';
    const source = state.players.get(sourceEntityId);
    if (
      source &&
      monster.element !== null &&
      elementDamageBasisPoints(source.element, monster.element) > 10_000 &&
      RARITY_RANK[rarity] < RARITY_RANK.gold
    ) {
      rarity =
        RARITY_RANK[rarity] === RARITY_RANK.white
          ? 'blue'
          : RARITY_RANK[rarity] === RARITY_RANK.blue
            ? 'purple'
            : 'gold';
    }
    return rarity;
  }
  if (monster.kind === 'core-boss') {
    return state.random.combat.nextInt(100) < 75 ? 'purple' : 'gold';
  }
  return null;
}

function equipmentThemeMatches(
  equipmentId: (typeof M1_EQUIPMENT)[number]['id'],
  element: FiveElement,
): boolean {
  const themes: Readonly<Record<FiveElement, readonly string[]>> = {
    metal: ['W1', 'W4', 'B6', 'P1', 'P11', 'G6', 'G8', 'G9', 'G10'],
    wood: ['W2', 'B5', 'B8', 'P4', 'P5', 'P7', 'P14', 'G5', 'G9'],
    water: ['W3', 'B3', 'B12', 'B13', 'P6', 'P8', 'P15', 'G4', 'G7'],
    fire: ['W1', 'B10', 'B11', 'P2', 'P3', 'P4', 'G8', 'G10'],
    earth: ['W2', 'W5', 'W6', 'B2', 'B7', 'P9', 'P12', 'G1', 'G3'],
  };
  return themes[element]?.includes(String(equipmentId)) ?? false;
}

function chooseEquipment(
  state: MutableSimulationState,
  monster: MonsterEntity,
  sourceEntityId: EntityId,
): (typeof M1_EQUIPMENT)[number]['id'] | null {
  if (monster.kind === 'pig' && state.random.combat.nextInt(100) >= 20) {
    return null;
  }
  if (
    (monster.kind === 'elite-tank' || monster.kind === 'elite-ranged') &&
    state.random.combat.nextInt(100) >= 65
  ) {
    return null;
  }
  const rarity = chooseRarity(state, monster, sourceEntityId);
  if (rarity === null) {
    return null;
  }

  let candidates = M1_EQUIPMENT.filter(
    (equipment) => equipment.rarity === rarity && equipment.id !== EQUIPMENT_IDS.nineTurnPill,
  );
  if (monster.kind === 'pig') {
    const themed = candidates.filter(
      (equipment) =>
        equipment.id === EQUIPMENT_IDS.treasureBag ||
        equipment.id === EQUIPMENT_IDS.nightWatchLamp ||
        equipment.id === EQUIPMENT_IDS.clothBag ||
        equipment.id === EQUIPMENT_IDS.gamblingMedal ||
        equipment.id === EQUIPMENT_IDS.demonRevealingPearl,
    );
    if (themed.length > 0) {
      candidates = themed;
    }
  } else if (monster.kind === 'elite-tank') {
    const themed = candidates.filter((equipment) =>
      equipment.stats.some((stat) => stat.stat === 'max-hp-flat'),
    );
    if (themed.length > 0) {
      candidates = themed;
    }
  } else if (monster.kind === 'elite-ranged') {
    const themed = candidates.filter((equipment) =>
      equipment.stats.some((stat) => stat.stat === 'attack-flat'),
    );
    if (themed.length > 0) {
      candidates = themed;
    }
  } else if (monster.kind === 'dragon-king') {
    const themed =
      monster.element === null
        ? []
        : candidates.filter((equipment) =>
            equipmentThemeMatches(equipment.id, monster.element as FiveElement),
          );
    if (themed.length > 0) {
      candidates = themed;
    }
  }
  const chosen = candidates[state.random.combat.nextInt(candidates.length)];
  return chosen?.id ?? null;
}

function chooseCoreEquipment(
  state: MutableSimulationState,
  monster: MonsterEntity,
  sourceEntityId: EntityId,
): (typeof M1_EQUIPMENT)[number]['id'] | null {
  return chooseEquipment(state, monster, sourceEntityId);
}

function chooseCoreGoldenCudgel(
  state: MutableSimulationState,
): (typeof M1_EQUIPMENT)[number]['id'] | null {
  if (state.goldenCudgelDropped || state.random.combat.nextInt(100) >= 5) {
    return null;
  }
  state.goldenCudgelDropped = true;
  return EQUIPMENT_IDS.goldenCudgel;
}

function chooseActiveDrop(
  state: MutableSimulationState,
  monster: MonsterEntity,
): LootDrop['activeId'] {
  if (monster.kind === 'core-boss') {
    const active = M1_GENERIC_ACTIVES[state.random.combat.nextInt(M1_GENERIC_ACTIVES.length)];
    return active?.id ?? null;
  }
  if (monster.kind === 'elite-tank' || monster.kind === 'elite-ranged') {
    return state.random.combat.nextInt(100) < 10
      ? (M1_GENERIC_ACTIVES[state.random.combat.nextInt(M1_GENERIC_ACTIVES.length)]?.id ?? null)
      : null;
  }
  return null;
}

function createCurrencyDrop(
  state: MutableSimulationState,
  monster: MonsterEntity,
  goldMultiplier = 1,
  experienceMultiplier = 1,
): LootDrop {
  return createRuntimeLootDrop(state, {
    position: monster.position,
    kind: 'currency',
    gold: Math.max(0, Math.trunc(monsterGold(monster) * goldMultiplier)),
    experience: Math.max(0, Math.trunc(monsterExperience(monster) * experienceMultiplier)),
    gems:
      monster.kind === 'core-boss'
        ? 3
        : monster.kind === 'dragon-king'
          ? 3
          : monster.kind === 'elite-tank' || monster.kind === 'elite-ranged'
            ? 2
            : state.random.combat.nextInt(100) < (monster.kind === 'pig' ? 60 : 30)
              ? 1
              : 0,
    expiresAtTick: state.tick + 60 * TICKS_PER_SECOND,
  });
}

function createBookDrop(
  state: MutableSimulationState,
  monster: MonsterEntity,
  bookPassiveId: PassiveId,
): LootDrop {
  return createRuntimeLootDrop(state, {
    position: monster.position,
    kind: 'skill-book',
    bookPassiveId,
  });
}

function createEquipmentDrops(
  state: MutableSimulationState,
  monster: MonsterEntity,
  sourceEntityId: EntityId,
): LootDrop[] {
  const equipmentId =
    monster.kind === 'core-boss'
      ? chooseCoreEquipment(state, monster, sourceEntityId)
      : chooseEquipment(state, monster, sourceEntityId);
  if (equipmentId === null) {
    return [];
  }
  const drops = [
    createRuntimeLootDrop(state, {
      position: monster.position,
      kind: 'equipment',
      equipmentId,
    }),
  ];
  if (monster.kind === 'core-boss') {
    const goldenCudgel = chooseCoreGoldenCudgel(state);
    if (goldenCudgel !== null) {
      drops.push(
        createRuntimeLootDrop(state, {
          position: monster.position,
          kind: 'equipment',
          equipmentId: goldenCudgel,
        }),
      );
    }
  }
  return drops;
}

function createActiveDrop(state: MutableSimulationState, monster: MonsterEntity): LootDrop | null {
  const activeId = chooseActiveDrop(state, monster);
  if (activeId === null) {
    return null;
  }
  return createRuntimeLootDrop(state, {
    position: monster.position,
    kind: 'active',
    activeId,
    expiresAtTick: state.tick + 120 * TICKS_PER_SECOND,
  });
}

function createLootDrops(
  state: MutableSimulationState,
  monster: MonsterEntity,
  sourceEntityId: EntityId,
  goldMultiplier = 1,
  experienceMultiplier = 1,
): LootDrop[] {
  const drops = [createCurrencyDrop(state, monster, goldMultiplier, experienceMultiplier)];
  for (let index = 0; index < passiveBookCount(state, monster); index += 1) {
    drops.push(createBookDrop(state, monster, choosePassiveBook(state, monster)));
  }
  drops.push(...createEquipmentDrops(state, monster, sourceEntityId));
  const active = createActiveDrop(state, monster);
  if (active) {
    drops.push(active);
  }
  return drops;
}

function nextCoreCourt(
  state: MutableSimulationState,
  monster: MonsterEntity,
): { readonly courtId: string | null; readonly homePosition: MonsterEntity['homePosition'] } {
  if (state.mapField === null) {
    return {
      courtId: monster.courtId,
      homePosition: monster.homePosition,
    };
  }
  const currentIndex = Math.max(
    0,
    MAP_COURTS.findIndex((court) => court.id === monster.courtId),
  );
  const next = MAP_COURTS[(currentIndex + 1) % MAP_COURTS.length];
  if (!next) {
    return {
      courtId: monster.courtId,
      homePosition: monster.homePosition,
    };
  }
  return {
    courtId: next.id,
    homePosition: { x: next.center.x, z: next.center.z },
  };
}

function scheduleRespawn(state: MutableSimulationState, monster: MonsterEntity): void {
  if (monster.kind === 'core-boss' && state.tick >= 14 * 60 * TICKS_PER_SECOND) {
    return;
  }
  const nextCourt =
    monster.kind === 'core-boss'
      ? nextCoreCourt(state, monster)
      : { courtId: monster.courtId, homePosition: monster.homePosition };
  const respawn: MonsterRespawn = {
    kind: monster.kind,
    ring: monster.ring,
    element: monster.element,
    homePosition: nextCourt.homePosition,
    courtId: nextCourt.courtId,
    respawnAtTick: state.tick + MONSTER_RESPAWN_TICKS[monster.kind],
  };
  state.monsterRespawns.push(respawn);
}

function killMonster(
  state: MutableSimulationState,
  events: SimEvent[],
  monster: MonsterEntity,
  sourceEntityId: EntityId | null,
  victimHpBefore: number,
  goldMultiplier = 1,
  experienceMultiplier = 1,
): void {
  if (!state.monsters.has(monster.entityId)) {
    return;
  }
  clearComboShoesTargetState(state, monster.entityId);
  state.monsters.delete(monster.entityId);
  if (monster.kind === 'core-boss') {
    handleCoreBossDefeated(state, events, monster);
  }
  scheduleRespawn(state, monster);
  const drops = createLootDrops(
    state,
    monster,
    sourceEntityId ?? monster.entityId,
    goldMultiplier,
    experienceMultiplier,
  );
  const treasureDrop =
    sourceEntityId === null ? null : createTreasureHunterDrop(state, sourceEntityId, monster);
  if (treasureDrop) {
    drops.push(treasureDrop);
  }
  events.push({
    type: 'monster-killed',
    tick: state.tick,
    sourceEntityId,
    targetEntityId: monster.entityId,
    kind: monster.kind,
  });
  for (const drop of drops) {
    emitLootDropped(state, events, drop, sourceEntityId ?? monster.entityId);
  }
  if (sourceEntityId !== null) {
    resolvePassiveKill(state, events, {
      sourceEntityId,
      victimEntityId: monster.entityId,
      victimKind: 'monster',
      victimHpBefore,
      victimMaxHp: monster.maxHp,
    });
  }
}

export function applyMonsterDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  sourceEntityId: EntityId | null,
  monster: MonsterEntity,
  amount: number,
  sourceElement: FiveElement | null,
  options: {
    readonly outgoingDamageBasisPointsOverride?: number;
    readonly ignoreExecute?: boolean;
    readonly ignoreSourceBonuses?: boolean;
    readonly ignoreElement?: boolean;
    readonly periodic?: boolean;
    readonly lootGoldMultiplier?: number;
    readonly lootExperienceMultiplier?: number;
    readonly environmental?: boolean;
    readonly activeAbilityId?: ActiveId;
  } = {},
): number {
  if (amount <= 0 || monster.invulnerableTicks > 0 || !state.monsters.has(monster.entityId)) {
    return 0;
  }
  const sourcePlayer = sourceEntityId === null ? undefined : state.players.get(sourceEntityId);
  const outgoingDamageBasisPoints =
    options.ignoreSourceBonuses === true
      ? 10_000
      : (options.outgoingDamageBasisPointsOverride ??
        (sourcePlayer ? getOutgoingDamageBasisPoints(sourcePlayer) : 10_000));
  const targetDamageBasisPoints =
    sourcePlayer && options.ignoreSourceBonuses !== true
      ? Math.trunc(
          (targetDamageBonusBasisPoints(sourcePlayer, monster, options.ignoreExecute === true) *
            activeTargetDamageBonusBasisPoints(state, sourcePlayer.entityId, monster.entityId)) /
            10_000,
        )
      : 10_000;
  const monsterDamageBasisPoints =
    sourcePlayer && options.ignoreSourceBonuses !== true
      ? equipmentMonsterDamageBasisPoints(sourcePlayer)
      : 10_000;
  const conditionalDamage = Math.trunc(
    (amount * outgoingDamageBasisPoints * targetDamageBasisPoints) / 100_000_000,
  );
  const outgoingDamage = Math.trunc((conditionalDamage * monsterDamageBasisPoints) / 10_000);
  const victimHpBefore = monster.hp;
  const elementBasisPoints =
    options.ignoreElement === true || sourceElement === null
      ? 10_000
      : sourcePlayer
        ? monster.element === null
          ? 10_000
          : equipmentElementDamageBasisPoints(sourcePlayer, monster.element)
        : monster.element === null
          ? 10_000
          : elementDamageBasisPoints(sourceElement, monster.element);
  const actualDamage = Math.min(
    monster.hp,
    Math.max(1, Math.trunc((outgoingDamage * elementBasisPoints) / 10_000)),
  );
  monster.hp -= actualDamage;
  markCombatActivity(state, sourceEntityId, monster.entityId);
  if (monster.kind === 'core-boss' && sourceEntityId !== null) {
    recordCoreBossThreat(state, sourceEntityId, actualDamage);
  }
  events.push({
    type: 'monster-damaged',
    tick: state.tick,
    sourceEntityId,
    targetEntityId: monster.entityId,
    ...(options.activeAbilityId === undefined ? {} : { activeAbilityId: options.activeAbilityId }),
    amount: actualDamage,
    remainingHp: monster.hp,
  });
  if (monster.hp === 0) {
    killMonster(
      state,
      events,
      monster,
      sourceEntityId,
      victimHpBefore,
      options.lootGoldMultiplier ?? 1,
      options.lootExperienceMultiplier ?? 1,
    );
  }
  return actualDamage;
}

export function resolveMonsterBasicHit(
  state: MutableSimulationState,
  events: SimEvent[],
  sourceEntityId: EntityId,
  monster: MonsterEntity,
  amount: number,
  sourceElement: FiveElement,
): number {
  return applyMonsterDamage(state, events, sourceEntityId, monster, amount, sourceElement, {
    outgoingDamageBasisPointsOverride: 10_000,
  });
}
