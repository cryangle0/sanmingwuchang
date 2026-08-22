/**
 * All imported presentation assets are normalized to metres before they reach
 * the renderer. Keep the final gameplay-facing dimensions here so model
 * catalog metadata and placement code cannot drift apart.
 */
export const WORLD_SCALE_PROFILE = {
  character: {
    playerModelScale: 1,
    monsterModelScale: 1,
    playerSelectionRing: {
      innerRadius: 0.7,
      outerRadius: 0.94,
      elevation: 0.085,
    },
    playerHealthBar: {
      width: 1.58,
      height: 0.1,
      backgroundWidth: 1.66,
      backgroundHeight: 0.15,
      offset: 0.3,
    },
    playerShield: {
      radius: 1.42,
      y: 1.12,
    },
    playerIceCoffin: {
      radius: 0.74,
      length: 1.08,
      y: 1.24,
    },
    monsterHealthBar: {
      height: 0.1,
      backgroundHeight: 0.14,
      offset: 0.26,
    },
  },
  map: {
    landmarkWorldHeights: {
      'wuxia-gate-court': 15,
      'wuxia-citadel': 12,
      'wuxia-east-asia-hall': 10,
      'wuxia-mountain-gate': 12,
      'lowpoly-asian-village': 12,
      'lowpoly-asian-house': 8.5,
      'lowpoly-torii': 7.5,
      'lowpoly-rock-formation': 4.7,
    },
    rockMinWorldHeight: 1.45,
    rockMaxWorldHeight: 4.25,
    rockBaseWorldHeight: 2.05,
    rockVariationWorldHeight: 1.25,
  },
  flora: {
    treeTargetHeights: {
      pine: 7.8,
      oak: 7.7,
      twisted: 7.1,
      dead: 6.8,
      asia: 6.8,
      maple: 7.7,
      cypress: 7.2,
      beech: 7.8,
      willow: 7.4,
    },
    rockTargetHeight: 2.45,
    bushTargetHeight: 2.65,
    fernTargetHeight: 1.2,
    mushroomTargetHeight: 0.72,
    asiaBushTargetHeight: 2.35,
    reedTargetHeight: 3.65,
    smallPlant1TargetHeight: 1.45,
    smallPlant2TargetHeight: 1.6,
    burdockTargetHeight: 1.05,
  },
} as const;

export type ImportedLandmarkId = keyof typeof WORLD_SCALE_PROFILE.map.landmarkWorldHeights;

export function importedLandmarkWorldHeight(assetId: string): number | null {
  const height = WORLD_SCALE_PROFILE.map.landmarkWorldHeights[assetId as ImportedLandmarkId];
  return typeof height === 'number' ? height : null;
}

export function normalizedAssetScale(targetHeight: number, worldHeight: number): number {
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) {
    throw new Error(`world scale: invalid target height ${targetHeight}`);
  }
  if (!Number.isFinite(worldHeight) || worldHeight <= 0) {
    throw new Error(`world scale: invalid world height ${worldHeight}`);
  }
  return worldHeight / targetHeight;
}
