import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAP_WALL_PIECES } from '@jwgb/content';
import { describe, expect, it } from 'vitest';

/**
 * The authority ledger, the canonical map and the compiler must agree on wall
 * traversal. `npm run map:authority` checks this too, but that script is not
 * part of `npm test`, and a drift here silently changes blink and flight rules.
 */

type TraversalFlag = 'ALLOW' | 'DENY';

interface CanonicalMapWalls {
  readonly walls: readonly {
    readonly id: string;
    readonly cls: string;
    readonly blink: TraversalFlag;
    readonly fly: TraversalFlag;
    readonly height: number;
  }[];
}

interface AuthorityLedger {
  readonly schema: string;
  readonly decisions: readonly {
    readonly topic: string;
    readonly acceptedCounts?: Readonly<Record<string, number>>;
    readonly classTable?: Readonly<
      Record<
        string,
        {
          readonly blink: TraversalFlag;
          readonly fly: TraversalFlag;
          readonly heightM: number;
        }
      >
    >;
  }[];
}

function readJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), ...segments), 'utf8')) as T;
}

const canonical = readJson<CanonicalMapWalls>(
  'migration',
  'content',
  'map-engineering-840-canonical.json',
);
const authority = readJson<AuthorityLedger>('migration', 'content', 'map-authority-v1.json');
const wallTraversalDecision = authority.decisions.find(
  (decision) => decision.topic === 'wall-traversal',
);

const EXPECTED_WALL_COUNTS = { BOUND: 11, VAULT: 31 } as const;

describe('map wall traversal authority', () => {
  it('carries a class table for exactly the classes the map uses', () => {
    expect(authority.schema).toBe('jwgb.map-authority.v1');
    expect(wallTraversalDecision).toBeDefined();
    const classTable = wallTraversalDecision?.classTable;
    expect(classTable).toBeDefined();
    if (!classTable) {
      return;
    }

    expect(Object.keys(classTable).sort()).toEqual(['BOUND', 'VAULT']);
    expect(classTable.BOUND).toEqual({ blink: 'DENY', fly: 'DENY', heightM: 6 });
    expect(classTable.VAULT).toEqual({ blink: 'ALLOW', fly: 'ALLOW', heightM: 2.5 });
    expect(wallTraversalDecision?.acceptedCounts).toEqual(EXPECTED_WALL_COUNTS);
  });

  it('matches every canonical wall to its class entry', () => {
    const classTable = wallTraversalDecision?.classTable;
    expect(classTable).toBeDefined();
    if (!classTable) {
      return;
    }

    const counts = new Map<string, number>();
    for (const wall of canonical.walls) {
      const entry = classTable[wall.cls];
      expect(entry, `wall ${wall.id} class ${wall.cls}`).toBeDefined();
      if (!entry) {
        continue;
      }
      expect(wall.blink, `wall ${wall.id} blink`).toBe(entry.blink);
      expect(wall.fly, `wall ${wall.id} fly`).toBe(entry.fly);
      expect(wall.height, `wall ${wall.id} height`).toBe(entry.heightM);
      counts.set(wall.cls, (counts.get(wall.cls) ?? 0) + 1);
    }

    expect(canonical.walls).toHaveLength(42);
    expect(counts.get('VAULT')).toBe(EXPECTED_WALL_COUNTS.VAULT);
    expect(counts.get('BOUND')).toBe(EXPECTED_WALL_COUNTS.BOUND);
    expect(counts.size).toBe(2);
    expect(new Set(canonical.walls.map((wall) => wall.id)).size).toBe(canonical.walls.length);
  });

  it('keeps the compiler traversal table identical to the ledger class table', () => {
    const classTable = wallTraversalDecision?.classTable;
    expect(classTable).toBeDefined();
    if (!classTable) {
      return;
    }

    const compilerSource = readFileSync(
      resolve(process.cwd(), 'tools', 'map', 'compile-map-geometry.ts'),
      'utf8',
    );
    const tableBlock = /const WALL_TRAVERSAL = \{([\s\S]*?)\} as const satisfies/.exec(
      compilerSource,
    )?.[1];
    expect(tableBlock).toBeDefined();
    if (!tableBlock) {
      return;
    }

    const compilerTable = new Map<string, string>();
    for (const match of tableBlock.matchAll(
      /(\w+):\s*\{\s*blink:\s*'(ALLOW|DENY)',\s*fly:\s*'(ALLOW|DENY)',?\s*\}/g,
    )) {
      const [, wallClass, blink, fly] = match;
      if (!wallClass || !blink || !fly) {
        continue;
      }
      compilerTable.set(wallClass, `${blink}/${fly}`);
    }

    expect(compilerTable.size).toBe(Object.keys(classTable).length);
    for (const [wallClass, entry] of Object.entries(classTable)) {
      expect(compilerTable.get(wallClass), `compiler class ${wallClass}`).toBe(
        `${entry.blink}/${entry.fly}`,
      );
    }
  });

  it('compiles every wall piece from the permissions of its canonical wall', () => {
    const wallsById = new Map(canonical.walls.map((wall) => [wall.id, wall] as const));
    expect(MAP_WALL_PIECES.length).toBeGreaterThan(0);

    for (const piece of MAP_WALL_PIECES) {
      const wall = wallsById.get(piece.wallId);
      expect(wall, `piece ${piece.pieceId}`).toBeDefined();
      if (!wall) {
        continue;
      }
      expect(piece.wallClass, `piece ${piece.pieceId} class`).toBe(wall.cls);
      expect(piece.heightMm, `piece ${piece.pieceId} height`).toBe(Math.round(wall.height * 1_000));
      expect(piece.blinkPassable, `piece ${piece.pieceId} blink`).toBe(wall.blink === 'ALLOW');
      expect(piece.flightPassable, `piece ${piece.pieceId} flight`).toBe(wall.fly === 'ALLOW');
    }

    expect(new Set(MAP_WALL_PIECES.map((piece) => piece.wallId)).size).toBe(canonical.walls.length);
  });
});
