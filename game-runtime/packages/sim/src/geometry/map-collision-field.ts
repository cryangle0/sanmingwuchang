/**
 * Authoritative collision field for the compiled 840m map.
 *
 * Walls are convex integer-mm pieces; the playfield edge is a concave
 * boundary ring. All queries are exact integer math except the documented
 * 1 mm lattice epsilon in segment distance. Long edges are subdivided at
 * construction so no product can overflow the float64 integer range.
 */

import type { MapConvexPieceRecord, MapPointMm } from '@jwgb/content';
import type { Vec2Mm } from '@jwgb/core';
import {
  closestPointOnSegment,
  convexContainsPoint,
  distanceSquaredBetween,
  distanceSquaredToSegment,
  MAX_SEGMENT_LENGTH_MM,
  ringContainsPoint,
  segmentsIntersect,
  subdivideSegment,
} from './integer-geometry';
import { type GridAabb, StaticSpatialGrid } from './spatial-grid';
import { WALK_TRAVERSAL, type WallTraversal, wallPieceBlocks } from './wall-traversal';

interface IndexedPiece {
  readonly pieceId: string;
  readonly heightMm: number;
  readonly blinkPassable: boolean;
  readonly flightPassable: boolean;
  readonly vertices: readonly Vec2Mm[];
  readonly segments: readonly (readonly Vec2Mm[])[];
  readonly aabb: GridAabb;
}

interface IndexedBoundarySegment {
  readonly a: Vec2Mm;
  readonly b: Vec2Mm;
  readonly aabb: GridAabb;
}

const GRID_CELL_MM = 16_384;

function aabbOfPoints(points: readonly Vec2Mm[]): GridAabb {
  let minimumX = Number.MAX_SAFE_INTEGER;
  let maximumX = Number.MIN_SAFE_INTEGER;
  let minimumZ = Number.MAX_SAFE_INTEGER;
  let maximumZ = Number.MIN_SAFE_INTEGER;
  for (const point of points) {
    minimumX = Math.min(minimumX, point.x);
    maximumX = Math.max(maximumX, point.x);
    minimumZ = Math.min(minimumZ, point.z);
    maximumZ = Math.max(maximumZ, point.z);
  }
  return { minimumX, maximumX, minimumZ, maximumZ };
}

function inflate(aabb: GridAabb, byMm: number): GridAabb {
  return {
    minimumX: aabb.minimumX - byMm,
    maximumX: aabb.maximumX + byMm,
    minimumZ: aabb.minimumZ - byMm,
    maximumZ: aabb.maximumZ + byMm,
  };
}

function pointAabb(point: Vec2Mm, radiusMm: number): GridAabb {
  return {
    minimumX: point.x - radiusMm,
    maximumX: point.x + radiusMm,
    minimumZ: point.z - radiusMm,
    maximumZ: point.z + radiusMm,
  };
}

export class MapCollisionField {
  readonly geometryHash: string;
  private readonly boundary: readonly Vec2Mm[];
  private readonly pieces: readonly IndexedPiece[];
  private readonly boundarySegments: readonly IndexedBoundarySegment[];
  private readonly pieceGrid: StaticSpatialGrid;
  private readonly boundaryGrid: StaticSpatialGrid;

  constructor(
    geometryHash: string,
    boundary: readonly MapPointMm[],
    wallPieces: readonly MapConvexPieceRecord[],
  ) {
    this.geometryHash = geometryHash;
    this.boundary = boundary.map((point) => ({ x: point.x, z: point.z }));

    this.pieces = wallPieces.map((piece) => {
      const vertices = piece.vertices.map((point) => ({ x: point.x, z: point.z }));
      const segments: (readonly Vec2Mm[])[] = [];
      for (let index = 0; index < vertices.length; index += 1) {
        const a = vertices[index] as Vec2Mm;
        const b = vertices[(index + 1) % vertices.length] as Vec2Mm;
        segments.push(...subdivideSegment(a, b, MAX_SEGMENT_LENGTH_MM));
      }
      return {
        pieceId: piece.pieceId,
        heightMm: piece.heightMm,
        blinkPassable: piece.blinkPassable,
        flightPassable: piece.flightPassable,
        vertices,
        segments,
        aabb: aabbOfPoints(vertices),
      };
    });

    this.boundarySegments = [];
    const boundarySegments: IndexedBoundarySegment[] = [];
    for (let index = 0; index < this.boundary.length; index += 1) {
      const a = this.boundary[index] as Vec2Mm;
      const b = this.boundary[(index + 1) % this.boundary.length] as Vec2Mm;
      for (const [start, end] of subdivideSegment(a, b, MAX_SEGMENT_LENGTH_MM)) {
        boundarySegments.push({
          a: start as Vec2Mm,
          b: end as Vec2Mm,
          aabb: aabbOfPoints([start as Vec2Mm, end as Vec2Mm]),
        });
      }
    }
    this.boundarySegments = boundarySegments;

    const worldBounds = inflate(aabbOfPoints(this.boundary), GRID_CELL_MM);
    this.pieceGrid = new StaticSpatialGrid(
      worldBounds,
      GRID_CELL_MM,
      this.pieces.map((piece) => piece.aabb),
    );
    this.boundaryGrid = new StaticSpatialGrid(
      worldBounds,
      GRID_CELL_MM,
      this.boundarySegments.map((segment) => segment.aabb),
    );
  }

  /** True when the circle touches an impassable wall piece or leaves the playfield. */
  isCircleBlocked(
    center: Vec2Mm,
    radiusMm: number,
    traversal: WallTraversal = WALK_TRAVERSAL,
  ): boolean {
    return (
      !this.isCircleInsideBoundary(center, radiusMm) ||
      this.circleTouchesWall(center, radiusMm, traversal)
    );
  }

  circleTouchesWall(
    center: Vec2Mm,
    radiusMm: number,
    traversal: WallTraversal = WALK_TRAVERSAL,
  ): boolean {
    return this.firstWallPieceAt(center, radiusMm, traversal) !== null;
  }

  /** Stable lowest-index wall piece the circle touches, or null. */
  firstWallPieceAt(
    center: Vec2Mm,
    radiusMm: number,
    traversal: WallTraversal = WALK_TRAVERSAL,
  ): string | null {
    const radiusSquared = radiusMm * radiusMm;
    let firstBlockedPieceIndex = Number.POSITIVE_INFINITY;
    this.pieceGrid.forEachUniqueItem(pointAabb(center, radiusMm), (pieceIndex) => {
      if (pieceIndex >= firstBlockedPieceIndex) {
        return;
      }
      const piece = this.pieces[pieceIndex] as IndexedPiece;
      if (!wallPieceBlocks(piece, traversal)) {
        return;
      }
      if (convexContainsPoint(piece.vertices, center)) {
        firstBlockedPieceIndex = pieceIndex;
        return;
      }
      for (const [a, b] of piece.segments) {
        const closest = closestPointOnSegment(a as Vec2Mm, b as Vec2Mm, center);
        if (distanceSquaredBetween(closest, center) <= radiusSquared) {
          firstBlockedPieceIndex = pieceIndex;
          return;
        }
      }
    });
    return Number.isFinite(firstBlockedPieceIndex)
      ? (this.pieces[firstBlockedPieceIndex] as IndexedPiece).pieceId
      : null;
  }

  isCircleInsideBoundary(center: Vec2Mm, radiusMm: number): boolean {
    if (!ringContainsPoint(this.boundary, center)) {
      return false;
    }
    const radiusSquared = radiusMm * radiusMm;
    let touchesBoundary = false;
    this.boundaryGrid.forEachUniqueItem(pointAabb(center, radiusMm), (segmentIndex) => {
      const segment = this.boundarySegments[segmentIndex] as IndexedBoundarySegment;
      const closest = closestPointOnSegment(segment.a, segment.b, center);
      if (distanceSquaredBetween(closest, center) < radiusSquared) {
        touchesBoundary = true;
        return true;
      }
      return false;
    });
    return !touchesBoundary;
  }

  /**
   * Returns the first wall piece that blocks a line between two actors.
   * Clearance is the combined actor radius, so a line grazing a wall is not
   * considered visible. Low walls can be ignored by flying actors.
   */
  firstLineOfSightBlock(
    start: Vec2Mm,
    end: Vec2Mm,
    clearanceMm = 0,
    traversal: WallTraversal = WALK_TRAVERSAL,
  ): string | null {
    const range = {
      minimumX: Math.min(start.x, end.x) - clearanceMm,
      maximumX: Math.max(start.x, end.x) + clearanceMm,
      minimumZ: Math.min(start.z, end.z) - clearanceMm,
      maximumZ: Math.max(start.z, end.z) + clearanceMm,
    };
    const clearanceSquared = clearanceMm * clearanceMm;
    let firstBlockedPieceIndex = Number.POSITIVE_INFINITY;
    this.pieceGrid.forEachUniqueItem(range, (pieceIndex) => {
      if (pieceIndex >= firstBlockedPieceIndex) {
        return;
      }
      const piece = this.pieces[pieceIndex] as IndexedPiece;
      if (!wallPieceBlocks(piece, traversal)) {
        return;
      }
      if (convexContainsPoint(piece.vertices, start) || convexContainsPoint(piece.vertices, end)) {
        firstBlockedPieceIndex = pieceIndex;
        return;
      }
      for (const [a, b] of piece.segments) {
        if (
          segmentsIntersect(start, end, a as Vec2Mm, b as Vec2Mm) ||
          (clearanceMm > 0 &&
            distanceSquaredToSegment(start, a as Vec2Mm, b as Vec2Mm) <= clearanceSquared) ||
          (clearanceMm > 0 &&
            distanceSquaredToSegment(end, a as Vec2Mm, b as Vec2Mm) <= clearanceSquared) ||
          (clearanceMm > 0 && distanceSquaredToSegment(a as Vec2Mm, start, end) <= clearanceSquared)
        ) {
          firstBlockedPieceIndex = pieceIndex;
          return;
        }
      }
    });
    return Number.isFinite(firstBlockedPieceIndex)
      ? (this.pieces[firstBlockedPieceIndex] as IndexedPiece).pieceId
      : null;
  }

  /**
   * Rejection-based sliding: try the full move, then each axis, else stay.
   * Mirrors the legacy rectangle sliding feel without any pushout math, so a
   * position that was legal last tick can never become illegal this tick.
   */
  resolveMovement(
    from: Vec2Mm,
    to: Vec2Mm,
    radiusMm: number,
    traversal: WallTraversal = WALK_TRAVERSAL,
  ): Vec2Mm {
    if (!this.isCircleBlocked(to, radiusMm, traversal)) {
      return to;
    }
    const slideX: Vec2Mm = { x: to.x, z: from.z };
    if (slideX.x !== from.x && !this.isCircleBlocked(slideX, radiusMm, traversal)) {
      return slideX;
    }
    const slideZ: Vec2Mm = { x: from.x, z: to.z };
    if (slideZ.z !== from.z && !this.isCircleBlocked(slideZ, radiusMm, traversal)) {
      return slideZ;
    }
    return from;
  }

  /** Step-scan used by forced displacement; returns the last legal sample. */
  resolveDisplacementPath(
    origin: Vec2Mm,
    destination: Vec2Mm,
    radiusMm: number,
    traversal: WallTraversal = WALK_TRAVERSAL,
  ): Vec2Mm {
    const deltaX = destination.x - origin.x;
    const deltaZ = destination.z - origin.z;
    const steps = Math.max(Math.abs(deltaX), Math.abs(deltaZ));
    if (steps === 0) {
      return origin;
    }
    let lastLegal = origin;
    for (let step = 1; step <= steps; step += 1) {
      const candidate: Vec2Mm = {
        x: origin.x + Math.trunc((deltaX * step) / steps),
        z: origin.z + Math.trunc((deltaZ * step) / steps),
      };
      if (this.isCircleBlocked(candidate, radiusMm, traversal)) {
        return lastLegal;
      }
      lastLegal = candidate;
    }
    return lastLegal;
  }

  /**
   * First wall contact of a swept circle along [start, end].
   *
   * Coarse samples every half projectile radius, then refines per millimeter
   * back to the entry sample. A grazing corner clip shallower than the coarse
   * step can be missed; that epsilon is accepted for projectile gameplay.
   */
  sweepCircleFirstWallContact(
    start: Vec2Mm,
    end: Vec2Mm,
    sweepDistanceMm: number,
    radiusMm: number,
    traversal: WallTraversal = WALK_TRAVERSAL,
  ): { distanceMm: number; pieceId: string } | null {
    if (sweepDistanceMm <= 0) {
      return null;
    }
    const candidates = this.pieceGrid.query({
      minimumX: Math.min(start.x, end.x) - radiusMm,
      maximumX: Math.max(start.x, end.x) + radiusMm,
      minimumZ: Math.min(start.z, end.z) - radiusMm,
      maximumZ: Math.max(start.z, end.z) + radiusMm,
    });
    if (candidates.length === 0) {
      return null;
    }

    const radiusSquared = radiusMm * radiusMm;
    const testAt = (distanceMm: number): string | null => {
      const sample: Vec2Mm = {
        x: start.x + Math.trunc(((end.x - start.x) * distanceMm) / sweepDistanceMm),
        z: start.z + Math.trunc(((end.z - start.z) * distanceMm) / sweepDistanceMm),
      };
      for (const pieceIndex of candidates) {
        const piece = this.pieces[pieceIndex] as IndexedPiece;
        if (!wallPieceBlocks(piece, traversal)) {
          continue;
        }
        if (convexContainsPoint(piece.vertices, sample)) {
          return piece.pieceId;
        }
        for (const [a, b] of piece.segments) {
          const closest = closestPointOnSegment(a as Vec2Mm, b as Vec2Mm, sample);
          if (distanceSquaredBetween(closest, sample) <= radiusSquared) {
            return piece.pieceId;
          }
        }
      }
      return null;
    };

    const coarseStepMm = Math.max(1, Math.trunc(radiusMm / 2));
    let previousFreeMm = -1;
    let distanceMm = 0;
    for (;;) {
      const hitPieceId = testAt(distanceMm);
      if (hitPieceId !== null) {
        for (let fineMm = previousFreeMm + 1; fineMm < distanceMm; fineMm += 1) {
          const finePieceId = testAt(fineMm);
          if (finePieceId !== null) {
            return { distanceMm: fineMm, pieceId: finePieceId };
          }
        }
        return { distanceMm, pieceId: hitPieceId };
      }
      previousFreeMm = distanceMm;
      if (distanceMm === sweepDistanceMm) {
        return null;
      }
      distanceMm = Math.min(distanceMm + coarseStepMm, sweepDistanceMm);
    }
  }
}
