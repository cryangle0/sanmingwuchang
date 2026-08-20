import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_GEOMETRY_HASH } from '@jwgb/content';
import { type CanonicalTraversalFlag, loadCanonicalMap } from './canonical-map';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const AUTHORITY_PATH = resolve(REPO_ROOT, 'migration', 'content', 'map-authority-v1.json');
const CANONICAL_PATH = resolve(
  REPO_ROOT,
  'migration',
  'content',
  'map-engineering-840-canonical.json',
);
const FIXTURE_PATH = resolve(REPO_ROOT, 'migration', 'fixtures', 'map-v1.json');
const UNITY_CATALOG_PATH = resolve(
  REPO_ROOT,
  'unity',
  'Packages',
  'com.jwgb.content',
  'Runtime',
  'MapGeometryCatalog.g.cs',
);

function readFixtureGeometryHash(): string {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { geometryHash?: string };
  if (!fixture.geometryHash) {
    fail(`${FIXTURE_PATH} has no geometryHash`);
  }
  return fixture.geometryHash;
}

function readUnityGeometryHash(): string {
  const match = /GeometryHash\s*=\s*"([0-9a-f]{16})"/.exec(
    readFileSync(UNITY_CATALOG_PATH, 'utf8'),
  );
  if (!match?.[1]) {
    fail(`${UNITY_CATALOG_PATH} has no GeometryHash constant`);
  }
  return match[1];
}

interface AuthorityDocument {
  readonly schema: string;
  readonly mapVersion: string;
  readonly runtimeAuthority: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly rulesAuthority: {
    readonly rulesetVersion: string;
    readonly hashInput: string;
    readonly rulesHash: string;
  };
  readonly decisions: readonly {
    readonly topic: string;
    readonly acceptedCounts?: Record<string, number>;
    readonly acceptedCount?: number;
    readonly classTable?: Record<
      string,
      {
        readonly blink: CanonicalTraversalFlag;
        readonly fly: CanonicalTraversalFlag;
        readonly heightM: number;
      }
    >;
    readonly currentGeometryHash?: string;
  }[];
}

function fail(message: string): never {
  throw new Error(`verify-map-authority: ${message}`);
}

const authority = JSON.parse(readFileSync(AUTHORITY_PATH, 'utf8')) as AuthorityDocument;
if (authority.schema !== 'jwgb.map-authority.v1') {
  fail(`unexpected schema ${authority.schema}`);
}

const canonicalBytes = readFileSync(CANONICAL_PATH);
const canonicalHash = createHash('sha256').update(canonicalBytes).digest('hex');
if (canonicalHash !== authority.runtimeAuthority.sha256) {
  fail(`canonical sha256 mismatch: ${canonicalHash}`);
}

const canonical = loadCanonicalMap(CANONICAL_PATH);
const routeDecision = authority.decisions.find((entry) => entry.topic === 'route-graph');
const wallDecision = authority.decisions.find((entry) => entry.topic === 'walls');
const spawnDecision = authority.decisions.find((entry) => entry.topic === 'spawn-points');
if (!routeDecision || !wallDecision || !spawnDecision) {
  fail('route, wall and spawn decisions are required');
}

if (
  routeDecision.acceptedCounts?.nodes !== Object.keys(canonical.nodes).length ||
  routeDecision.acceptedCounts?.edges !== canonical.edges.length
) {
  fail('route decision counts do not match canonical');
}
if (wallDecision.acceptedCount !== canonical.walls.length) {
  fail('wall decision count does not match canonical');
}
if (spawnDecision.acceptedCount !== canonical.spawn_micro.length) {
  fail('spawn decision count does not match canonical');
}

const pairKeys = new Set<string>();
const nodeIds = new Set(Object.keys(canonical.nodes));
for (const edge of canonical.edges) {
  if (!nodeIds.has(edge.a) || !nodeIds.has(edge.b)) {
    fail(`edge ${edge.id} has an unknown endpoint`);
  }
  if (edge.a === edge.b) {
    fail(`edge ${edge.id} is a self-loop`);
  }
  const pair = [edge.a, edge.b].sort().join('|');
  if (pairKeys.has(pair)) {
    fail(`duplicate undirected edge pair ${pair}`);
  }
  pairKeys.add(pair);
}

const expectedRulesHash = createHash('sha256')
  .update(authority.rulesAuthority.hashInput)
  .digest('hex')
  .slice(0, 16);
if (expectedRulesHash !== authority.rulesAuthority.rulesHash) {
  fail(`rules hash mismatch: ${expectedRulesHash}`);
}

// Every wall must agree with its class traversal contract. Without this the
// sim would silently fall back to inferring blink and flight from wall height.
const wallTraversalDecision = authority.decisions.find((entry) => entry.topic === 'wall-traversal');
if (!wallTraversalDecision?.classTable) {
  fail('wall-traversal decision with a class table is required');
}
for (const wall of canonical.walls) {
  const expected = wallTraversalDecision.classTable[wall.cls];
  if (!expected) {
    fail(`wall ${wall.id}: class ${wall.cls} is absent from the authority class table`);
  }
  if (wall.blink !== expected.blink || wall.fly !== expected.fly) {
    fail(
      `wall ${wall.id}: class ${wall.cls} requires blink=${expected.blink} fly=${expected.fly}, ` +
        `canonical has blink=${wall.blink} fly=${wall.fly}`,
    );
  }
  if (wall.height !== expected.heightM) {
    fail(
      `wall ${wall.id}: class ${wall.cls} requires height ${expected.heightM}m, got ${wall.height}m`,
    );
  }
}

// The compiled geometry fingerprint must agree across every consumer. This is
// the check that was missing when the golden fixture drifted from the catalog.
const geometryDecision = authority.decisions.find((entry) => entry.topic === 'geometry-and-hash');
const ledgerGeometryHash = geometryDecision?.currentGeometryHash;
if (!ledgerGeometryHash) {
  fail('geometry-and-hash decision must carry currentGeometryHash');
}
const consumers: { readonly label: string; readonly hash: string }[] = [
  { label: 'packages/content map-geometry.generated.ts', hash: MAP_GEOMETRY_HASH },
  { label: 'migration/fixtures/map-v1.json', hash: readFixtureGeometryHash() },
  { label: 'unity MapGeometryCatalog.g.cs', hash: readUnityGeometryHash() },
];
for (const consumer of consumers) {
  if (consumer.hash !== ledgerGeometryHash) {
    fail(
      `geometry hash drift: ledger has ${ledgerGeometryHash} but ${consumer.label} has ${consumer.hash}. ` +
        'Run `npm run map:compile` then `npm run migration:fixtures`.',
    );
  }
}

console.log(
  JSON.stringify(
    {
      schema: authority.schema,
      mapVersion: authority.mapVersion,
      canonicalSha256: canonicalHash,
      nodes: Object.keys(canonical.nodes).length,
      edges: canonical.edges.length,
      walls: canonical.walls.length,
      spawns: canonical.spawn_micro.length,
      rulesHash: authority.rulesAuthority.rulesHash,
      geometryHash: ledgerGeometryHash,
      geometryConsumers: consumers.map((consumer) => consumer.label),
      status: 'verified',
    },
    null,
    2,
  ),
);
