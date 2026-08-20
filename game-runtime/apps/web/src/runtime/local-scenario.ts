import {
  EQUIPMENT_IDS,
  GENERIC_ACTIVE_IDS,
  PASSIVE_IDS,
  type PassiveLoadoutEntry,
} from '@jwgb/content';
import type { ActiveId, EquipmentId, HeroId, Vec2Mm } from '@jwgb/core';
import { vec2Mm } from '@jwgb/core';
import type { PveSimulationOptions, StaticSolidRect } from '@jwgb/sim';

export type LocalScenarioId = 'default' | 'M1' | 'D6' | 'D21' | 'MAP';

export interface LocalWorldScenario {
  readonly id: LocalScenarioId;
  readonly localHeroId?: HeroId;
  /** Omitted in map mode so players consume authoritative map spawn points. */
  readonly localPosition?: Vec2Mm;
  readonly staticSolids: readonly StaticSolidRect[];
  /** Enables the compiled 840m 百眼迷城 geometry for this local match. */
  readonly mapEnabled?: boolean;
  /** Selects the authoritative PVE population for the scenario. */
  readonly pve?: PveSimulationOptions;
  readonly botCount?: number;
  readonly activeAbilityId?: ActiveId;
  readonly passives?: readonly PassiveLoadoutEntry[];
  readonly equipmentIds?: readonly EquipmentId[];
}

export const DEFAULT_LOCAL_WORLD_SCENARIO: LocalWorldScenario = {
  id: 'default',
  localPosition: vec2Mm(0, 0),
  staticSolids: [],
};

const M1_COMBAT_SCENARIO: LocalWorldScenario = {
  id: 'M1',
  localPosition: vec2Mm(0, 0),
  staticSolids: [],
  passives: [
    { passiveId: PASSIVE_IDS.critical, level: 5 },
    { passiveId: PASSIVE_IDS.reactiveShield, level: 5 },
    { passiveId: PASSIVE_IDS.feignDeath, level: 5 },
    { passiveId: PASSIVE_IDS.passiveRevive, level: 5 },
  ],
  equipmentIds: [
    EQUIPMENT_IDS.refinedIronStaff,
    EQUIPMENT_IDS.coarseClothArmor,
    EQUIPMENT_IDS.goldenCudgel,
  ],
};

const BLINK_SCENARIO: LocalWorldScenario = {
  id: 'D6',
  localPosition: vec2Mm(0, 10_000),
  activeAbilityId: GENERIC_ACTIVE_IDS.blink,
  staticSolids: [
    {
      solidId: 'blink-thin-1500',
      minimumX: -4_500,
      maximumX: 4_500,
      minimumZ: 3_000,
      maximumZ: 3_600,
    },
    {
      solidId: 'blink-thick-blocker',
      minimumX: -4_500,
      maximumX: 4_500,
      minimumZ: -2_500,
      maximumZ: -1_500,
    },
  ],
};

const ICE_COFFIN_SCENARIO: LocalWorldScenario = {
  id: 'D21',
  localPosition: vec2Mm(0, 0),
  activeAbilityId: GENERIC_ACTIVE_IDS.iceCoffin,
  staticSolids: [],
};

const MAP_SCENARIO: LocalWorldScenario = {
  id: 'MAP',
  staticSolids: [],
  mapEnabled: true,
  pve: { enabled: true, population: 'full' },
  botCount: 6,
  passives: [
    { passiveId: PASSIVE_IDS.critical, level: 5 },
    { passiveId: PASSIVE_IDS.reactiveShield, level: 5 },
  ],
  equipmentIds: [EQUIPMENT_IDS.refinedIronStaff, EQUIPMENT_IDS.coarseClothArmor],
};

export function localWorldScenarioFromActive(value: string | null): LocalWorldScenario {
  switch (value?.toUpperCase()) {
    case 'M1':
      return M1_COMBAT_SCENARIO;
    case 'D6':
      return BLINK_SCENARIO;
    case 'D21':
      return ICE_COFFIN_SCENARIO;
    case 'MAP':
      return MAP_SCENARIO;
    default:
      return DEFAULT_LOCAL_WORLD_SCENARIO;
  }
}
