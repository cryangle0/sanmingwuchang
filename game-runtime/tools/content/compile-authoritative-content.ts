import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface HeroRecord {
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
    readonly runtimeStatus: 'implemented' | 'definition-only';
  };
}

interface NamedContentRecord {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly runtimeStatus: 'implemented' | 'definition-only';
}

interface EquipmentRecord {
  readonly id: string;
  readonly name: string;
  readonly rarity: 'white' | 'blue' | 'purple' | 'gold';
  readonly summary: string;
  readonly runtimeStatus: 'implemented' | 'definition-only';
}

interface MapEdgeRecord {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly cls: string;
  readonly width: number;
  readonly length: number;
}

interface MapWallRecord {
  readonly id: string;
  readonly cls: string;
  readonly height: number;
  readonly pts: number[][];
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), '..', '..');
const DEFAULT_SOURCE_ROOT = resolve(REPO_ROOT, '..', '西游大乱斗_工程真源候选包_v2');
const TICKS_PER_SECOND = 20;

const IMPLEMENTED_ACTIVE_IDS = new Set([
  'H001',
  'H009',
  'H018',
  'D3',
  'D6',
  'D9',
  'D11',
  'D16',
  'D21',
  'D22',
]);
const IMPLEMENTED_PASSIVE_IDS = new Set(['B6', 'B17', 'B19', 'B20']);
const IMPLEMENTED_EQUIPMENT_IDS = new Set(['W1', 'W2', 'G1', 'G10']);
const GENERIC_ACTIVE_IDS = new Set([
  'D1',
  'D3',
  'D4',
  'D6',
  'D7',
  'D9',
  'D10',
  'D11',
  'D12',
  'D13',
  'D14',
  'D15',
  'D16',
  'D17',
  'D18',
  'D19',
  'D20',
  'D21',
  'D22',
]);

const TEMPLATE_RUNTIME = {
  长弓: { attackRangeMm: 30_000, attacksPerSecondMilli: 900 },
  长弓·飞行: { attackRangeMm: 30_000, attacksPerSecondMilli: 900 },
  连弩: { attackRangeMm: 20_000, attacksPerSecondMilli: 1_600 },
  连弩·飞行: { attackRangeMm: 20_000, attacksPerSecondMilli: 1_600 },
  刺客: { attackRangeMm: 5_000, attacksPerSecondMilli: 1_400 },
  刺客·飞行: { attackRangeMm: 5_000, attacksPerSecondMilli: 1_400 },
  战士: { attackRangeMm: 5_000, attacksPerSecondMilli: 1_100 },
  坦克: { attackRangeMm: 5_000, attacksPerSecondMilli: 900 },
} as const;

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readUtf8(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function runtimeStatus(
  id: string,
  implementedIds: ReadonlySet<string>,
): 'implemented' | 'definition-only' {
  return implementedIds.has(id) ? 'implemented' : 'definition-only';
}

function parseHeroes(skillText: string): HeroRecord[] {
  const heroPattern =
    /^\s*(\d+)\s+(\S+)\s+(长弓·飞行|长弓|连弩·飞行|连弩|刺客·飞行|刺客|战士|坦克)\s+(金|木|水|火|土)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)秒\s*$/gm;
  const heroes: HeroRecord[] = [];
  for (const match of skillText.matchAll(heroPattern)) {
    const numericId = Number(match[1]);
    const template = match[3] as keyof typeof TEMPLATE_RUNTIME;
    const templateRuntime = TEMPLATE_RUNTIME[template];
    const id = `H${numericId.toString().padStart(3, '0')}`;
    heroes.push({
      id,
      name: match[2] ?? '',
      template,
      movementClass: template.includes('飞行') ? 'flying' : 'ground',
      element: match[4] ?? '',
      level15: {
        attack: Number(match[5]),
        maxHp: Number(match[6]),
        moveSpeedMmPerSecond: Number(match[7]) * 10,
        attackRangeMm: templateRuntime.attackRangeMm,
        attacksPerSecondMilli: templateRuntime.attacksPerSecondMilli,
      },
      active: {
        id,
        name: match[8] ?? '',
        cooldownTicks: Number(match[9]) * TICKS_PER_SECOND,
        runtimeStatus: runtimeStatus(id, IMPLEMENTED_ACTIVE_IDS),
      },
    });
  }
  return heroes;
}

function parseGenericActives(skillText: string): NamedContentRecord[] {
  const records: NamedContentRecord[] = [];
  let category = 'uncategorized';
  for (const line of skillText.split('\n')) {
    const categoryMatch = line.match(/^【(.+类)】$/);
    if (categoryMatch && records.length < GENERIC_ACTIVE_IDS.size) {
      category = categoryMatch[1] ?? category;
    }

    const activeMatch = line.match(/^D(\d+)\s*·\s*(.+)$/);
    if (!activeMatch) {
      continue;
    }
    const id = `D${Number(activeMatch[1])}`;
    if (!GENERIC_ACTIVE_IDS.has(id)) {
      continue;
    }
    records.push({
      id,
      name: (activeMatch[2] ?? '').trim(),
      category,
      runtimeStatus: runtimeStatus(id, IMPLEMENTED_ACTIVE_IDS),
    });
  }
  return records;
}

function parsePassives(skillText: string): NamedContentRecord[] {
  const records: NamedContentRecord[] = [];
  let category = 'uncategorized';
  let inPassiveSection = false;
  for (const line of skillText.split('\n')) {
    if (line.includes('四、被动技能池（44个）')) {
      inPassiveSection = true;
      continue;
    }
    if (line.includes('五、全局冲突规则')) {
      break;
    }
    if (!inPassiveSection) {
      continue;
    }

    const categoryMatch = line.match(/^【(.+?)（\d+个）】$/);
    if (categoryMatch) {
      category = categoryMatch[1] ?? category;
    }

    const passiveMatch = line.match(/^B(\d+)\s*·\s*(.+)$/);
    if (!passiveMatch) {
      continue;
    }
    const id = `B${Number(passiveMatch[1])}`;
    records.push({
      id,
      name: (passiveMatch[2] ?? '').trim(),
      category,
      runtimeStatus: runtimeStatus(id, IMPLEMENTED_PASSIVE_IDS),
    });
  }
  return records;
}

function equipmentRarity(id: string): EquipmentRecord['rarity'] {
  if (id.startsWith('W')) {
    return 'white';
  }
  if (id.startsWith('B')) {
    return 'blue';
  }
  if (id.startsWith('P')) {
    return 'purple';
  }
  return 'gold';
}

function parseEquipment(equipmentText: string): EquipmentRecord[] {
  const records: EquipmentRecord[] = [];
  const pattern = /^\s*((?:W|B|P|G)\d+)\s+(\S+)\s+(.+)$/gm;
  for (const match of equipmentText.matchAll(pattern)) {
    const id = match[1] ?? '';
    records.push({
      id,
      name: match[2] ?? '',
      rarity: equipmentRarity(id),
      summary: (match[3] ?? '').trim().replace(/\s{2,}/g, ' | '),
      runtimeStatus: runtimeStatus(id, IMPLEMENTED_EQUIPMENT_IDS),
    });
  }
  return records;
}

function duplicateEdgeKeys(edges: readonly Record<string, unknown>[]): string[] {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    const endpoints = [String(edge.a), String(edge.b)].sort();
    const key = `${endpoints[0]}|${endpoints[1]}|${String(edge.cls)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => `${key} x${count}`)
    .sort();
}

function requireCount(name: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected}, got ${actual}`);
  }
}

const sourceRoot = resolve(argumentValue('--source-root') ?? DEFAULT_SOURCE_ROOT);
const outputPath = resolve(
  argumentValue('--output') ??
    resolve(REPO_ROOT, 'migration', 'content', 'authoritative-content-v1.json'),
);
const reportPath = resolve(
  argumentValue('--report') ??
    resolve(REPO_ROOT, 'migration', 'content', 'authoritative-content-report-v1.md'),
);
const typescriptPath = resolve(
  argumentValue('--typescript-output') ??
    resolve(REPO_ROOT, 'packages', 'content', 'src', 'authoritative.generated.ts'),
);
const mapTypescriptPath = resolve(
  argumentValue('--map-typescript-output') ??
    resolve(REPO_ROOT, 'packages', 'content', 'src', 'map.generated.ts'),
);
const unityPath = resolve(
  argumentValue('--unity-output') ??
    resolve(
      REPO_ROOT,
      'unity',
      'Packages',
      'com.jwgb.content',
      'Runtime',
      'AuthoritativeContentCatalog.g.cs',
    ),
);
const canonicalMapPath = resolve(
  argumentValue('--canonical-map-output') ??
    resolve(REPO_ROOT, 'migration', 'content', 'map-engineering-840-canonical.json'),
);

const skillPath = resolve(sourceRoot, '权威引用文件', '技能表完整版_v1.txt');
const equipmentPath = resolve(sourceRoot, '权威引用文件', '装备系统完整设计_v1.txt');
const authorityPath = resolve(sourceRoot, '00_跨文档冲突审计与权威索引_v1.txt');
const pvePath = resolve(sourceRoot, '03_PVE怪物图鉴与完整数值_v2.txt');
const economyPath = resolve(sourceRoot, '04_经济模拟验证报告_v4.txt');
const mapPath = resolve(sourceRoot, '地图输出', 'map_engineering_840.json');

const skillText = readUtf8(skillPath);
const equipmentText = readUtf8(equipmentPath);
const map = JSON.parse(readUtf8(mapPath)) as Record<string, unknown>;
const heroes = parseHeroes(skillText);
const genericActives = parseGenericActives(skillText);
const passives = parsePassives(skillText);
const equipment = parseEquipment(equipmentText);

requireCount('heroes', heroes.length, 38);
requireCount('generic actives', genericActives.length, 19);
requireCount('passives', passives.length, 44);
requireCount('equipment', equipment.length, 44);

const nodes = map.nodes as Record<string, unknown>;
const edges = map.edges as Record<string, unknown>[];
const walls = map.walls as Record<string, unknown>[];
const mapSourceDiscrepancies = [
  `legacy map text lists 192 nodes; current engineering JSON lists ${Object.keys(nodes).length}`,
  `legacy map text lists 405 edges; current engineering JSON lists ${edges.length}`,
  `legacy map text lists 47 walls; current engineering JSON lists ${walls.length}`,
];
const mapOpenValidationItems = [
  'V9: first encounter median is 10s on the 840m map, below the 60s observation budget; this requires L3 greybox/BOT adjudication.',
  'V11: two 72m decision-node chains remain in 蛛丝峡 and are marked for manual greybox treatment.',
];
const duplicateEdges = duplicateEdgeKeys(edges);
if (duplicateEdges.length > 0) {
  mapOpenValidationItems.push(...duplicateEdges.map((key) => `duplicate map edge: ${key}`));
}
const canonicalWalls: MapWallRecord[] = walls.map((wall, index) => ({
  id: `W${(index + 1).toString().padStart(3, '0')}`,
  cls: String(wall.cls ?? ''),
  height: Number(wall.height ?? 0),
  pts: Array.isArray(wall.pts)
    ? (wall.pts as unknown[]).map((point) =>
        Array.isArray(point) ? [Number(point[0] ?? 0), Number(point[1] ?? 0)] : [0, 0],
      )
    : [],
}));
const canonicalEdges: MapEdgeRecord[] = edges.map((edge, index) => ({
  id: `E${(index + 1).toString().padStart(3, '0')}`,
  a: String(edge.a ?? ''),
  b: String(edge.b ?? ''),
  cls: String(edge.cls ?? ''),
  width: Number(edge.width ?? 0),
  length: Number(edge.length ?? 0),
}));
const canonicalMap = {
  ...map,
  walls: canonicalWalls,
  edges: canonicalEdges,
};
const canonicalStaticSolids = canonicalWalls.map((wall) => {
  const xs = wall.pts.map((point) => point[0] ?? 0);
  const zs = wall.pts.map((point) => point[1] ?? 0);
  return {
    solidId: wall.id,
    minimumX: Math.floor(Math.min(...xs) * 1_000),
    maximumX: Math.ceil(Math.max(...xs) * 1_000),
    minimumZ: Math.floor(Math.min(...zs) * 1_000),
    maximumZ: Math.ceil(Math.max(...zs) * 1_000),
  };
});

const manifest = {
  schema: 'jwgb.authoritative-content.v1',
  rulesetVersion: '3.1.0',
  sourceRoot,
  sources: {
    authority: { path: authorityPath, sha256: sha256(authorityPath) },
    skills: { path: skillPath, sha256: sha256(skillPath) },
    equipment: { path: equipmentPath, sha256: sha256(equipmentPath) },
    pve: { path: pvePath, sha256: sha256(pvePath) },
    economy: { path: economyPath, sha256: sha256(economyPath) },
    map: { path: mapPath, sha256: sha256(mapPath) },
  },
  counts: {
    heroes: heroes.length,
    heroActives: heroes.length,
    genericActives: genericActives.length,
    passives: passives.length,
    skillsTotal: heroes.length + genericActives.length + passives.length,
    equipment: equipment.length,
  },
  runtimeCoverage: {
    heroActivesImplemented: heroes.filter((hero) => hero.active.runtimeStatus === 'implemented')
      .length,
    genericActivesImplemented: genericActives.filter(
      (active) => active.runtimeStatus === 'implemented',
    ).length,
    passivesImplemented: passives.filter((passive) => passive.runtimeStatus === 'implemented')
      .length,
    equipmentImplemented: equipment.filter((item) => item.runtimeStatus === 'implemented').length,
  },
  heroes,
  genericActives,
  passives,
  equipment,
  pve: {
    simultaneousPopulation: 123,
    melee: 58,
    ranged: 38,
    flying: 12,
    pigsActive: 8,
    elites: 4,
    dragonsActive: 2,
    coreBoss: 1,
  },
  map: {
    spanMeters: String((map.meta as Record<string, unknown>).span_m),
    nodes: Object.keys(nodes).length,
    edges: edges.length,
    walls: walls.length,
    highlands: (map.highlands as unknown[]).length,
    courts: Object.keys(map.courts as Record<string, unknown>).length,
    pigCandidates: (map.pigs as unknown[]).length,
    dragonCandidates: (map.dragons as unknown[]).length,
    eliteArenas: (map.elites as unknown[]).length,
    shopAnchors: (map.shops_micro as unknown[]).length,
    spawnPoints: (map.spawn_micro as unknown[]).length,
    rocks: (map.rocks as unknown[]).length,
    monsterSlots: (map.monster_slots as unknown[]).length,
    chestPoints: (map.chest_pool as unknown[]).length,
    sourceDiscrepancies: mapSourceDiscrepancies,
    openValidationItems: mapOpenValidationItems,
    canonicalWallsHaveStableIds: true,
  },
} as const;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
mkdirSync(dirname(canonicalMapPath), { recursive: true });
writeFileSync(canonicalMapPath, `${JSON.stringify(canonicalMap, null, 2)}\n`, 'utf8');

const typescript = `// Generated by tools/content/compile-authoritative-content.ts. Do not edit.
import type {
  AuthoritativeEquipmentRecord,
  AuthoritativeHeroRecord,
  AuthoritativeNamedContentRecord,
  AuthoritativeWorldSummary,
} from './authoritative-types';

export const AUTHORITATIVE_CONTENT_COUNTS = ${JSON.stringify(manifest.counts, null, 2)} as const;

export const AUTHORITATIVE_RUNTIME_COVERAGE = ${JSON.stringify(
  manifest.runtimeCoverage,
  null,
  2,
)} as const;

export const AUTHORITATIVE_HEROES = ${JSON.stringify(
  manifest.heroes,
  null,
  2,
)} as const satisfies readonly AuthoritativeHeroRecord[];

export const AUTHORITATIVE_GENERIC_ACTIVES = ${JSON.stringify(
  manifest.genericActives,
  null,
  2,
)} as const satisfies readonly AuthoritativeNamedContentRecord[];

export const AUTHORITATIVE_PASSIVES = ${JSON.stringify(
  manifest.passives,
  null,
  2,
)} as const satisfies readonly AuthoritativeNamedContentRecord[];

export const AUTHORITATIVE_EQUIPMENT = ${JSON.stringify(
  manifest.equipment,
  null,
  2,
)} as const satisfies readonly AuthoritativeEquipmentRecord[];

export const AUTHORITATIVE_WORLD_SUMMARY = ${JSON.stringify(
  { pve: manifest.pve, map: manifest.map },
  null,
  2,
)} as const satisfies AuthoritativeWorldSummary;
`;

mkdirSync(dirname(typescriptPath), { recursive: true });
writeFileSync(typescriptPath, typescript, 'utf8');
const canonicalShopAnchors = (map.shops_micro as Record<string, unknown>[]).map((shop) => {
  const point = shop.pos as number[];
  return {
    id: String(shop.id ?? ''),
    zone: String(shop.macro ?? ''),
    x: Math.round(Number(point[0] ?? 0) * 1_000),
    z: Math.round(Number(point[1] ?? 0) * 1_000),
  };
});

const mapTypescript = `// Generated by tools/content/compile-authoritative-content.ts. Do not edit.
import type {
  AuthoritativeMapPoiRecord,
  AuthoritativeStaticSolidRecord,
} from './authoritative-types';

export const AUTHORITATIVE_MAP_STATIC_SOLIDS = ${JSON.stringify(
  canonicalStaticSolids,
  null,
  2,
)} as const satisfies readonly AuthoritativeStaticSolidRecord[];

export const AUTHORITATIVE_MAP_SHOPS = ${JSON.stringify(
  canonicalShopAnchors,
  null,
  2,
)} as const satisfies readonly AuthoritativeMapPoiRecord[];
`;
mkdirSync(dirname(mapTypescriptPath), { recursive: true });
writeFileSync(mapTypescriptPath, mapTypescript, 'utf8');

function csharpString(value: string): string {
  return JSON.stringify(value);
}

function csharpStatus(status: 'implemented' | 'definition-only'): string {
  return status === 'implemented'
    ? 'RuntimeImplementationStatus.Implemented'
    : 'RuntimeImplementationStatus.DefinitionOnly';
}

function csharpFloat(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`non-finite map coordinate: ${value}`);
  }
  return `${value.toString()}f`;
}

const unityHeroes = manifest.heroes
  .map(
    (hero) =>
      `            new AuthoritativeHeroRecord(${csharpString(hero.id)}, ${csharpString(
        hero.name,
      )}, ${csharpString(hero.template)}, ${csharpString(hero.movementClass)}, ${csharpString(
        hero.element,
      )}, ${hero.level15.attack}, ${hero.level15.maxHp}, ${
        hero.level15.moveSpeedMmPerSecond
      }, ${hero.level15.attackRangeMm}, ${hero.level15.attacksPerSecondMilli}, ${csharpString(
        hero.active.name,
      )}, ${hero.active.cooldownTicks}, ${csharpStatus(hero.active.runtimeStatus)})`,
  )
  .join(',\n');
const unityGenericActives = manifest.genericActives
  .map(
    (active) =>
      `            new AuthoritativeNamedRecord(${csharpString(active.id)}, ${csharpString(
        active.name,
      )}, ${csharpString(active.category)}, ${csharpStatus(active.runtimeStatus)})`,
  )
  .join(',\n');
const unityPassives = manifest.passives
  .map(
    (passive) =>
      `            new AuthoritativeNamedRecord(${csharpString(passive.id)}, ${csharpString(
        passive.name,
      )}, ${csharpString(passive.category)}, ${csharpStatus(passive.runtimeStatus)})`,
  )
  .join(',\n');
const unityEquipment = manifest.equipment
  .map(
    (item) =>
      `            new AuthoritativeEquipmentRecord(${csharpString(item.id)}, ${csharpString(
        item.name,
      )}, ${csharpString(item.rarity)}, ${csharpString(item.summary)}, ${csharpStatus(
        item.runtimeStatus,
      )})`,
  )
  .join(',\n');
const mapNodeRecords = Object.entries(nodes)
  .map(([id, value]) => {
    const point = value as number[];
    return `            new MapNodeRecord(${csharpString(id)}, ${csharpFloat(
      point[0] ?? 0,
    )}, ${csharpFloat(point[1] ?? 0)})`;
  })
  .join(',\n');
const mapEdgeRecords = canonicalEdges
  .map(
    (edge) =>
      `            new MapEdgeRecord(${csharpString(String(edge.id))}, ${csharpString(
        String(edge.a),
      )}, ${csharpString(String(edge.b))}, ${csharpString(
        String(edge.cls),
      )}, ${csharpFloat(Number(edge.width))}, ${csharpFloat(Number(edge.length))})`,
  )
  .join(',\n');
const mapWallRecords = canonicalWalls
  .map((wall) => {
    const points = (wall.pts as number[][])
      .map((point) => `new MapPoint(${csharpFloat(point[0] ?? 0)}, ${csharpFloat(point[1] ?? 0)})`)
      .join(', ');
    return `            new MapWallRecord(${csharpString(String(wall.id))}, ${csharpString(
      String(wall.cls),
    )}, ${csharpFloat(Number(wall.height))}, new MapPoint[] { ${points} })`;
  })
  .join(',\n');
const mapShopRecords = (map.shops_micro as Record<string, unknown>[])
  .map((shop) => {
    const point = shop.pos as number[];
    return `            new MapPoiRecord(${csharpString(String(shop.id))}, ${csharpString(
      String(shop.macro),
    )}, ${csharpFloat(point[0] ?? 0)}, ${csharpFloat(point[1] ?? 0)})`;
  })
  .join(',\n');
const mapSpawnRecords = (map.spawn_micro as Record<string, unknown>[])
  .map((spawn) => {
    const point = spawn.pos as number[];
    return `            new MapPoiRecord(${csharpString(String(spawn.id))}, ${csharpString(
      String(spawn.zone),
    )}, ${csharpFloat(point[0] ?? 0)}, ${csharpFloat(point[1] ?? 0)})`;
  })
  .join(',\n');

const unity = `// Generated by tools/content/compile-authoritative-content.ts. Do not edit.
namespace Jwgb.Content
{
    public enum RuntimeImplementationStatus : byte
    {
        Implemented = 1,
        DefinitionOnly = 2
    }

    public readonly struct AuthoritativeNamedRecord
    {
        public AuthoritativeNamedRecord(
            string id,
            string name,
            string category,
            RuntimeImplementationStatus runtimeStatus)
        {
            Id = id;
            Name = name;
            Category = category;
            RuntimeStatus = runtimeStatus;
        }

        public string Id { get; }
        public string Name { get; }
        public string Category { get; }
        public RuntimeImplementationStatus RuntimeStatus { get; }
    }

    public readonly struct AuthoritativeEquipmentRecord
    {
        public AuthoritativeEquipmentRecord(
            string id,
            string name,
            string rarity,
            string summary,
            RuntimeImplementationStatus runtimeStatus)
        {
            Id = id;
            Name = name;
            Rarity = rarity;
            Summary = summary;
            RuntimeStatus = runtimeStatus;
        }

        public string Id { get; }
        public string Name { get; }
        public string Rarity { get; }
        public string Summary { get; }
        public RuntimeImplementationStatus RuntimeStatus { get; }
    }

    public readonly struct AuthoritativeHeroRecord
    {
        public AuthoritativeHeroRecord(
            string id,
            string name,
            string template,
            string movementClass,
            string element,
            int level15Attack,
            int level15MaxHp,
            int level15MoveSpeedMmPerSecond,
            int attackRangeMm,
            int attacksPerSecondMilli,
            string activeName,
            int activeCooldownTicks,
            RuntimeImplementationStatus runtimeStatus)
        {
            Id = id;
            Name = name;
            Template = template;
            MovementClass = movementClass;
            Element = element;
            Level15Attack = level15Attack;
            Level15MaxHp = level15MaxHp;
            Level15MoveSpeedMmPerSecond = level15MoveSpeedMmPerSecond;
            AttackRangeMm = attackRangeMm;
            AttacksPerSecondMilli = attacksPerSecondMilli;
            ActiveName = activeName;
            ActiveCooldownTicks = activeCooldownTicks;
            RuntimeStatus = runtimeStatus;
        }

        public string Id { get; }
        public string Name { get; }
        public string Template { get; }
        public string MovementClass { get; }
        public string Element { get; }
        public int Level15Attack { get; }
        public int Level15MaxHp { get; }
        public int Level15MoveSpeedMmPerSecond { get; }
        public int AttackRangeMm { get; }
        public int AttacksPerSecondMilli { get; }
        public string ActiveName { get; }
        public int ActiveCooldownTicks { get; }
        public RuntimeImplementationStatus RuntimeStatus { get; }
    }

    public static class AuthoritativeContentCatalog
    {
        public const string Schema = "jwgb.authoritative-content.v1";
        public const string RulesetVersion = "3.1.0";
        public const int SkillCount = 101;
        public const int PveSimultaneousPopulation = 123;

        public static readonly AuthoritativeHeroRecord[] Heroes =
        {
${unityHeroes}
        };

        public static readonly AuthoritativeNamedRecord[] GenericActives =
        {
${unityGenericActives}
        };

        public static readonly AuthoritativeNamedRecord[] Passives =
        {
${unityPassives}
        };

        public static readonly AuthoritativeEquipmentRecord[] Equipment =
        {
${unityEquipment}
        };
    }
}
`;

mkdirSync(dirname(unityPath), { recursive: true });
writeFileSync(unityPath, unity, 'utf8');

const mapUnityPath = resolve(
  REPO_ROOT,
  'unity',
  'Packages',
  'com.jwgb.content',
  'Runtime',
  'MapEngineeringCatalog.g.cs',
);
const mapUnity = `// Generated by tools/content/compile-authoritative-content.ts. Do not edit.
namespace Jwgb.Content
{
    public readonly struct MapPoint
    {
        public MapPoint(float x, float z)
        {
            X = x;
            Z = z;
        }

        public float X { get; }
        public float Z { get; }
    }

    public readonly struct MapNodeRecord
    {
        public MapNodeRecord(string id, float x, float z)
        {
            Id = id;
            X = x;
            Z = z;
        }

        public string Id { get; }
        public float X { get; }
        public float Z { get; }
    }

    public readonly struct MapEdgeRecord
    {
        public MapEdgeRecord(
            string id,
            string a,
            string b,
            string edgeClass,
            float width,
            float length)
        {
            Id = id;
            A = a;
            B = b;
            Class = edgeClass;
            Width = width;
            Length = length;
        }

        public string Id { get; }
        public string A { get; }
        public string B { get; }
        public string Class { get; }
        public float Width { get; }
        public float Length { get; }
    }

    public readonly struct MapWallRecord
    {
        public MapWallRecord(
            string id,
            string wallClass,
            float height,
            MapPoint[] points)
        {
            Id = id;
            Class = wallClass;
            Height = height;
            Points = points;
        }

        public string Id { get; }
        public string Class { get; }
        public float Height { get; }
        public MapPoint[] Points { get; }
    }

    public readonly struct MapPoiRecord
    {
        public MapPoiRecord(string id, string zone, float x, float z)
        {
            Id = id;
            Zone = zone;
            X = x;
            Z = z;
        }

        public string Id { get; }
        public string Zone { get; }
        public float X { get; }
        public float Z { get; }
    }

    public static class MapEngineeringCatalog
    {
        public const string SourceSchema = "jwgb.authoritative-content.v1";
        public const int NodeCount = ${Object.keys(nodes).length};
        public const int EdgeCount = ${edges.length};
        public const int WallCount = ${walls.length};

        public static readonly MapNodeRecord[] Nodes =
        {
${mapNodeRecords}
        };

        public static readonly MapEdgeRecord[] Edges =
        {
${mapEdgeRecords}
        };

        public static readonly MapWallRecord[] Walls =
        {
${mapWallRecords}
        };

        public static readonly MapPoiRecord[] Shops =
        {
${mapShopRecords}
        };

        public static readonly MapPoiRecord[] Spawns =
        {
${mapSpawnRecords}
        };
    }
}
`;
writeFileSync(mapUnityPath, mapUnity, 'utf8');

const report = `# Authoritative Content Compilation

- Schema: \`${manifest.schema}\`
- Ruleset: \`${manifest.rulesetVersion}\`
- Heroes: ${manifest.counts.heroes}/38
- Skills: ${manifest.counts.skillsTotal}/101
- Equipment: ${manifest.counts.equipment}/44
- PVE simultaneous population: ${manifest.pve.simultaneousPopulation}/123

## Runtime Coverage

- Hero actives: ${manifest.runtimeCoverage.heroActivesImplemented}/38 implemented
- Generic actives: ${manifest.runtimeCoverage.genericActivesImplemented}/19 implemented
- Passives: ${manifest.runtimeCoverage.passivesImplemented}/44 implemented
- Equipment: ${manifest.runtimeCoverage.equipmentImplemented}/44 implemented

## Map Source Discrepancies

${mapSourceDiscrepancies.map((conflict) => `- ${conflict}`).join('\n')}

These are historical count differences. The current map validation report identifies \`map_engineering_840.json\` as the complete engineering authority, so the canonical export uses its 199/342/42 counts.

## Map Open Validation Items

${mapOpenValidationItems.map((item) => `- ${item}`).join('\n')}

The content counts are authoritative-source complete. Runtime coverage and map validation status are reported separately and must not be represented as product completion.
`;

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, report, 'utf8');

console.log(
  JSON.stringify(
    {
      outputPath,
      reportPath,
      typescriptPath,
      unityPath,
      mapUnityPath,
      canonicalMapPath,
      counts: manifest.counts,
      runtimeCoverage: manifest.runtimeCoverage,
      mapOpenValidationItemCount: mapOpenValidationItems.length,
    },
    null,
    2,
  ),
);
