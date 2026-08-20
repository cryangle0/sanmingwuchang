/**
 * Greedy Hertel-Mehlhorn style convex merge over an ear-clip triangulation.
 *
 * Pieces are index rings into the source polygon. Shared diagonals are
 * visited in sorted key order and removed whenever the union stays convex,
 * so the decomposition is deterministic for identical input.
 */

import { type CompilePoint, crossOrientation } from './polygon-math';
import type { TriangleIndices } from './triangulate';

export function mergeTrianglesIntoConvexPieces(
  ring: readonly CompilePoint[],
  triangles: readonly TriangleIndices[],
): number[][] {
  let pieces: number[][] = triangles.map((triangle) => [...triangle]);

  let merged = true;
  while (merged) {
    merged = false;
    const edgeOwners = collectSharedEdges(pieces);
    for (const [edgeKey, owners] of edgeOwners) {
      if (owners.length !== 2) {
        continue;
      }
      const [firstPiece, secondPiece] = owners as [number, number];
      const left = pieces[firstPiece];
      const right = pieces[secondPiece];
      if (left === undefined || right === undefined) {
        continue;
      }
      const [u, v] = edgeKey.split('|').map(Number) as [number, number];
      const union = mergeAcrossEdge(left, right, u, v);
      if (union !== null && isConvexIndexRing(ring, union)) {
        pieces[firstPiece] = union;
        pieces.splice(secondPiece, 1);
        merged = true;
        break;
      }
    }
  }

  pieces = pieces.map((piece) => piece);
  pieces.sort((left, right) => Math.min(...left) - Math.min(...right));
  return pieces;
}

function collectSharedEdges(pieces: readonly (readonly number[])[]): Map<string, number[]> {
  const owners = new Map<string, number[]>();
  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
    const piece = pieces[pieceIndex] as readonly number[];
    for (let index = 0; index < piece.length; index += 1) {
      const a = piece[index] as number;
      const b = piece[(index + 1) % piece.length] as number;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const list = owners.get(key);
      if (list === undefined) {
        owners.set(key, [pieceIndex]);
      } else {
        list.push(pieceIndex);
      }
    }
  }
  return new Map(
    [...owners.entries()].sort(([leftKey], [rightKey]) => compareKeys(leftKey, rightKey)),
  );
}

function compareKeys(left: string, right: string): number {
  const [la, lb] = left.split('|').map(Number) as [number, number];
  const [ra, rb] = right.split('|').map(Number) as [number, number];
  return la !== ra ? la - ra : lb - rb;
}

/**
 * Merges two counter-clockwise index rings sharing the undirected edge u-v.
 * Returns null when the rings do not actually share the edge in opposite
 * directions (which would indicate inconsistent input).
 */
function mergeAcrossEdge(
  left: readonly number[],
  right: readonly number[],
  u: number,
  v: number,
): number[] | null {
  const orientedInLeft = findDirectedEdge(left, u, v);
  if (orientedInLeft !== null) {
    return spliceRings(left, right, orientedInLeft.from, orientedInLeft.to);
  }
  const orientedInRight = findDirectedEdge(right, u, v);
  if (orientedInRight !== null) {
    return spliceRings(right, left, orientedInRight.from, orientedInRight.to);
  }
  return null;
}

function findDirectedEdge(
  piece: readonly number[],
  u: number,
  v: number,
): { from: number; to: number } | null {
  for (let index = 0; index < piece.length; index += 1) {
    const a = piece[index] as number;
    const b = piece[(index + 1) % piece.length] as number;
    if ((a === u && b === v) || (a === v && b === u)) {
      return { from: a, to: b };
    }
  }
  return null;
}

/** first contains the directed edge from->to; second contains to->from. */
function spliceRings(
  first: readonly number[],
  second: readonly number[],
  from: number,
  to: number,
): number[] {
  const firstRotated = rotateToStart(first, to);
  const secondRotated = rotateToStart(second, from);
  return [...firstRotated, ...secondRotated.slice(1, secondRotated.length - 1)];
}

function rotateToStart(piece: readonly number[], start: number): number[] {
  const offset = piece.indexOf(start);
  if (offset < 0) {
    throw new Error(`convex merge: vertex ${start} missing from piece`);
  }
  return [...piece.slice(offset), ...piece.slice(0, offset)];
}

function isConvexIndexRing(ring: readonly CompilePoint[], indices: readonly number[]): boolean {
  if (indices.length < 3) {
    return false;
  }
  for (let index = 0; index < indices.length; index += 1) {
    const previous = ring[indices[(index + indices.length - 1) % indices.length] as number];
    const current = ring[indices[index] as number];
    const next = ring[indices[(index + 1) % indices.length] as number];
    if (previous === undefined || current === undefined || next === undefined) {
      return false;
    }
    if (crossOrientation(previous, current, next) < 0) {
      return false;
    }
  }
  return true;
}
