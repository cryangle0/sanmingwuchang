import * as THREE from 'three';

/**
 * Bare-trunk (枝下高) correction shared by both tree pipelines.
 *
 * The source trees put their first leaves around 30 % of the total height, so
 * from the chase lens a wood read as a wall of foliage sitting almost on the
 * ground: raising the whole tree (which the world-scale profile already does)
 * scales the trunk and the canopy together and never exposes any trunk.
 *
 * What actually has to change is the proportion. Everything above the first
 * leaf is remapped so the canopy starts at `TREE_BOLE_FRACTION` of the height
 * while the crown top stays put; the geometry below the first leaf — the trunk
 * — is untouched, so its share of the tree simply grows. The model is still
 * normalised to its profile height at placement time, so this costs nothing in
 * world size: only the silhouette changes.
 */

/** Height at which the first leaves appear, as a fraction of the tree height. */
export const TREE_BOLE_FRACTION = 0.46;

export interface CanopyPart {
  readonly geometry: THREE.BufferGeometry;
  readonly isLeaf: boolean;
}

export interface CanopyBounds {
  readonly minY: number;
  readonly maxY: number;
  /** Height where the canopy begins after the correction. */
  readonly boleY: number;
}

/**
 * Raises the canopy of every part in place. `fallbackFirstLeafFraction` is used
 * when a model has no separately identifiable leaf part (a single baked mesh
 * with the trunk and the crown joined), where the split has to be estimated.
 */
export function exposeTreeTrunk(
  parts: readonly CanopyPart[],
  fallbackFirstLeafFraction = 0.3,
): CanopyBounds {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let firstLeafY = Number.POSITIVE_INFINITY;
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    const bounds = part.geometry.boundingBox;
    if (!bounds) {
      continue;
    }
    minY = Math.min(minY, bounds.min.y);
    maxY = Math.max(maxY, bounds.max.y);
    if (part.isLeaf) {
      firstLeafY = Math.min(firstLeafY, bounds.min.y);
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY - minY <= 0.001) {
    throw new Error('tree canopy: invalid bounds');
  }
  const height = maxY - minY;
  const boleY = minY + height * TREE_BOLE_FRACTION;
  if (!Number.isFinite(firstLeafY)) {
    firstLeafY = minY + height * fallbackFirstLeafFraction;
  }
  if (firstLeafY >= boleY - height * 0.01) {
    return { minY, maxY, boleY };
  }
  const scale = (maxY - boleY) / (maxY - firstLeafY);
  for (const part of parts) {
    const position = part.geometry.getAttribute('position');
    if (!(position instanceof THREE.BufferAttribute)) {
      continue;
    }
    for (let index = 0; index < position.count; index += 1) {
      const y = position.getY(index);
      if (y <= firstLeafY) {
        continue;
      }
      position.setY(index, boleY + (y - firstLeafY) * scale);
    }
    position.needsUpdate = true;
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
  }
  return { minY, maxY, boleY };
}
