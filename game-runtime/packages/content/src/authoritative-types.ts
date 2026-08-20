export type RuntimeImplementationStatus = 'implemented' | 'definition-only';

export interface AuthoritativeHeroRecord {
  readonly id: string;
  readonly name: string;
  readonly template: string;
  readonly movementClass: 'ground' | 'flying';
  readonly element: string;
  readonly level15: {
    readonly attack: number;
    readonly maxHp: number;
    readonly moveSpeedMmPerSecond: number;
    readonly attackRangeMm: number;
    readonly attacksPerSecondMilli: number;
  };
  readonly active: {
    readonly id: string;
    readonly name: string;
    readonly cooldownTicks: number;
    readonly runtimeStatus: RuntimeImplementationStatus;
  };
}

export interface AuthoritativeNamedContentRecord {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly runtimeStatus: RuntimeImplementationStatus;
}

export interface AuthoritativeEquipmentRecord {
  readonly id: string;
  readonly name: string;
  readonly rarity: 'white' | 'blue' | 'purple' | 'gold';
  readonly summary: string;
  readonly runtimeStatus: RuntimeImplementationStatus;
}

export interface AuthoritativeWorldSummary {
  readonly pve: {
    readonly simultaneousPopulation: number;
    readonly melee: number;
    readonly ranged: number;
    readonly flying: number;
    readonly pigsActive: number;
    readonly elites: number;
    readonly dragonsActive: number;
    readonly coreBoss: number;
  };
  readonly map: {
    readonly spanMeters: string;
    readonly nodes: number;
    readonly edges: number;
    readonly walls: number;
    readonly highlands: number;
    readonly courts: number;
    readonly pigCandidates: number;
    readonly dragonCandidates: number;
    readonly eliteArenas: number;
    readonly shopAnchors: number;
    readonly spawnPoints: number;
    readonly rocks: number;
    readonly monsterSlots: number;
    readonly chestPoints: number;
    readonly sourceDiscrepancies: readonly string[];
    readonly openValidationItems: readonly string[];
    readonly canonicalWallsHaveStableIds: boolean;
  };
}

export interface AuthoritativeStaticSolidRecord {
  readonly solidId: string;
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumZ: number;
  readonly maximumZ: number;
}

export interface AuthoritativeMapPoiRecord {
  readonly id: string;
  readonly zone: string;
  readonly x: number;
  readonly z: number;
}
