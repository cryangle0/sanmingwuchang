/**
 * All imported presentation assets are normalized to metres before they reach
 * the renderer. Keep the final gameplay-facing dimensions here so model
 * catalog metadata and placement code cannot drift apart.
 */
export const WORLD_SCALE_PROFILE = {
  character: {
    playerModelScale: 1.5,
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
    /**
     * Heroes stand 3.3–3.75 m on screen (2.2–2.5 m models × 1.5). Buildings
     * are sized against that figure, not against a real 1.75 m person: a house
     * five heroes tall, a gate court eight. The east-asia hall sits on open
     * ground so it can keep most of its native height; citadel and mountain
     * gate stay a step under native so their footprints still fit the
     * authored plateaus.
     */
    landmarkWorldHeights: {
      'wuxia-gate-court': 30,
      'wuxia-citadel': 22,
      'wuxia-east-asia-hall': 24,
      'wuxia-mountain-gate': 24,
      'lowpoly-asian-village': 24,
      'lowpoly-asian-house': 18,
      'lowpoly-torii': 16,
      'lowpoly-rock-formation': 9,
      'free-pagoda-niko313': 30,
      'free-stone-cart': 5.2,
      'free-stone-lion': 3.5,
      'free-pagoda-ruin': 24,
    },
    rockMinWorldHeight: 1.45,
    rockMaxWorldHeight: 4.25,
    rockBaseWorldHeight: 2.05,
    rockVariationWorldHeight: 1.25,
    /**
     * The procedural 唐宋 buildings are authored at metric scale, so these
     * world heights are each model's own height (a scale of 1). Districts keep
     * real proportions against a 3.3–3.75 m hero: a house is three heroes
     * tall, a pagoda six, a gate tower three.
     */
    structureWorldHeights: {
      'tang-hall': 10.29,
      'tang-pagoda': 20,
      'tang-paifang': 6.49,
      'tang-gate-tower': 11.64,
      'tang-inn': 9.59,
      'tang-teahouse': 5.14,
      'tang-shrine': 4.09,
      'tang-drum-tower': 10.8,
      'tang-corridor': 4.69,
      'tang-scripture-pillar': 7.36,
      'tang-stele': 3.77,
      'tang-lantern-post': 4.29,
      'tang-well': 3.99,
    } as Readonly<Record<string, number>>,
  },
  flora: {
    /**
     * Crown-top height of the near-camera flora, metres.
     *
     * These used to sit at 6.8–7.8 m, which put the canopy of a 7 m tree about
     * two metres off the ground: from the chase lens the forest read as a wall
     * of leaves with no visible trunks. Raised to match the 12.5–24 m
     * procedural forest so the trunks clear the undergrowth and the canopy
     * sits overhead where it belongs.
     */
    treeTargetHeights: {
      pine: 13.4,
      oak: 13.0,
      twisted: 12.0,
      dead: 11.6,
      asia: 11.8,
      maple: 13.2,
      cypress: 12.6,
      beech: 13.6,
      willow: 12.4,
      lush: 13.4,
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
