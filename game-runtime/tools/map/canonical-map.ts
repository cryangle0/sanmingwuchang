/**
 * Typed loader for migration/content/map-engineering-840-canonical.json.
 *
 * Converts every coordinate to integer millimeters in the sim convention
 * (x east, z north). Nest bases are stored in source pixels and are the only
 * records needing the pixel origin/scale transform.
 */

import { readFileSync } from 'node:fs';

/** Source vocabulary for per-wall traversal permissions. */
export type CanonicalTraversalFlag = 'ALLOW' | 'DENY';

export interface CanonicalMapDocument {
  readonly meta: {
    readonly scale_m_per_px: number;
    readonly origin_px: readonly [number, number];
    readonly span_m: string;
    readonly safe_circle?: {
      readonly initial_diameter: number;
      readonly phases?: readonly {
        readonly t0: number;
        readonly t1: number | null;
        readonly r: number;
        readonly center: string;
        readonly window_candidates?: readonly number[];
      }[];
    };
  };
  readonly boundary: readonly (readonly [number, number])[];
  readonly walls: readonly {
    readonly id: string;
    readonly cls: string;
    /** Source traversal flag: may a blink terminate past this wall. */
    readonly blink: CanonicalTraversalFlag;
    /** Source traversal flag: may a flying actor cross this wall. */
    readonly fly: CanonicalTraversalFlag;
    readonly height: number;
    readonly pts: readonly (readonly [number, number])[];
  }[];
  readonly highlands: readonly {
    readonly name: string;
    readonly z: number;
    readonly overlook_m: number;
    readonly poly: readonly (readonly [number, number])[];
    readonly ramps: readonly (readonly (readonly [number, number])[])[];
  }[];
  readonly nodes: Readonly<Record<string, readonly [number, number]>>;
  readonly edges: readonly {
    readonly id: string;
    readonly a: string;
    readonly b: string;
    readonly cls: string;
    readonly width: number;
    readonly length: number;
  }[];
  readonly courts: Readonly<
    Record<
      string,
      {
        readonly center: readonly [number, number];
        readonly hex: readonly (readonly [number, number])[];
        readonly gates: readonly (readonly [number, number])[];
        readonly final_shops: readonly (readonly [number, number])[];
        readonly revives: readonly (readonly [number, number])[];
        readonly rocks: readonly (readonly [number, number])[];
      }
    >
  >;
  readonly pigs: readonly { readonly id: string; readonly pos: readonly [number, number] }[];
  readonly dragons: readonly { readonly id: string; readonly pos: readonly [number, number] }[];
  readonly elites: readonly { readonly id: string; readonly pos: readonly [number, number] }[];
  readonly shops_micro: readonly {
    readonly id: string;
    readonly macro: string;
    readonly pos: readonly [number, number];
  }[];
  readonly spawn_micro: readonly {
    readonly id: string;
    readonly zone: string;
    readonly facing_deg: number;
    readonly pos: readonly [number, number];
  }[];
  readonly rocks: readonly {
    readonly id: string;
    readonly r: number;
    readonly pos: readonly [number, number];
  }[];
  readonly monster_slots: readonly {
    readonly id: string;
    readonly kind: string;
    readonly band: string;
    readonly nest: string;
    readonly pos: readonly [number, number];
    readonly migration: readonly (readonly [number, number])[];
  }[];
  readonly nests: readonly {
    readonly id: string;
    readonly kind: string;
    readonly band: string;
    readonly base: readonly [number, number];
    readonly slots: readonly string[];
  }[];
  readonly nest_links: readonly (readonly [string, string])[];
  readonly chest_pool: readonly (readonly [number, number])[];
  readonly chokes: readonly (readonly [number, number])[];
}

export function loadCanonicalMap(path: string): CanonicalMapDocument {
  return JSON.parse(readFileSync(path, 'utf8')) as CanonicalMapDocument;
}

export function metersToMm(value: number): number {
  return Math.round(value * 1_000);
}

export function degreesToMillidegrees(value: number): number {
  return Math.round(value * 1_000);
}

export function metersPointToMm(point: readonly [number, number]): { x: number; z: number } {
  return { x: metersToMm(point[0]), z: metersToMm(point[1]) };
}

/** Nest bases are pixels: x = (px - originX) * scale, z = (originZ - py) * scale. */
export function pixelPointToMm(
  point: readonly [number, number],
  meta: CanonicalMapDocument['meta'],
): { x: number; z: number } {
  const [originX, originZ] = meta.origin_px;
  const scale = meta.scale_m_per_px;
  return {
    x: metersToMm((point[0] - originX) * scale),
    z: metersToMm((originZ - point[1]) * scale),
  };
}
