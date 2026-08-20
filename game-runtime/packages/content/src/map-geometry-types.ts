// Hand-written types for map-geometry.generated.ts. Runtime data is emitted
// by tools/map/compile-map-geometry.ts from the canonical engineering JSON.

export interface MapPointMm {
  readonly x: number;
  readonly z: number;
}

export interface MapRouteNodeRecord {
  readonly id: string;
  readonly position: MapPointMm;
}

export interface MapRouteEdgeRecord {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly roadClass: string;
  readonly widthMm: number;
  readonly lengthMm: number;
}

/** One convex piece of a decomposed wall polygon. Vertices are CCW integer mm. */
export interface MapConvexPieceRecord {
  readonly pieceId: string;
  readonly wallId: string;
  readonly wallClass: string;
  readonly heightMm: number;
  /**
   * Traversal permissions transcribed from the map source, not inferred from
   * height. Walking is always blocked; these only relax blink and flight.
   * Line of sight is blocked by every piece regardless of these flags.
   */
  readonly blinkPassable: boolean;
  readonly flightPassable: boolean;
  readonly vertices: readonly MapPointMm[];
}

export interface MapHighlandRecord {
  readonly name: string;
  readonly topHeightMm: number;
  readonly overlookRangeMm: number;
  readonly vertices: readonly MapPointMm[];
  /** Ear-clip triangulation of vertices (index triples, sim-CCW). */
  readonly triangles: readonly (readonly [number, number, number])[];
  readonly ramps: readonly {
    readonly a: MapPointMm;
    readonly b: MapPointMm;
  }[];
}

export interface MapSpawnPointRecord {
  readonly id: string;
  readonly zone: string;
  readonly facingMillidegrees: number;
  /** Unit facing vector scaled by 1000, math convention (x east, z north). */
  readonly facing: MapPointMm;
  readonly position: MapPointMm;
}

export interface MapCourtRecord {
  readonly id: string;
  readonly center: MapPointMm;
  readonly hexVertices: readonly MapPointMm[];
  readonly gates: readonly MapPointMm[];
  readonly finalShops: readonly MapPointMm[];
  readonly revivePoints: readonly MapPointMm[];
  readonly rockPoints: readonly MapPointMm[];
}

export interface MapNamedPointRecord {
  readonly id: string;
  readonly position: MapPointMm;
}

export interface MapShopRecord {
  readonly id: string;
  readonly macroId: string;
  readonly position: MapPointMm;
}

export interface MapSafeCirclePhaseRecord {
  readonly startMinutes: number;
  readonly endMinutes: number | null;
  readonly radiusMm: number;
  readonly center: string;
  readonly windowCandidatesSeconds: readonly number[];
}

export interface MapRockRecord {
  readonly id: string;
  readonly radiusMm: number;
  readonly position: MapPointMm;
}

export interface MapMonsterSlotRecord {
  readonly id: string;
  readonly kind: string;
  readonly band: string;
  readonly nestId: string;
  readonly position: MapPointMm;
  readonly migration: readonly MapPointMm[];
}

export interface MapNestRecord {
  readonly id: string;
  readonly kind: string;
  readonly band: string;
  readonly base: MapPointMm;
  readonly slotIds: readonly string[];
}
