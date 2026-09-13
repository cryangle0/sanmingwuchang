import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildGrassworksVegetationLayer,
  GRASSWORKS_SOURCE_PROFILE,
  GRASSWORKS_VEGETATION_ASSET_PATHS,
  sampleGrassworksGrassPoints,
  sampleGrassworksTreePoints,
  sampleHillTreePoints,
  sampleMassifTreePoints,
} from '../apps/web/src/render/map/grassworks-vegetation';
import {
  dressingSurfaceMeters,
  groundSurfaceMeters,
  isInsideBoundWall,
  isInsideVaultWall,
} from '../apps/web/src/render/map/map-sampling';

const repositoryRoot = resolve(import.meta.dirname, '..');
const assetRoot = resolve(repositoryRoot, 'apps/web/public');

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('web Grassworks vegetation', () => {
  it('ships the adapted tree and demo grass atlas with matching metadata', () => {
    const manifestPath = resolve(assetRoot, 'models/grassworks/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      readonly schema: string;
      readonly source: {
        readonly license: string;
        readonly excludedGrassAtlas: {
          readonly included: boolean;
          readonly reason: string;
        };
      };
      readonly runtime: {
        readonly treeAsset: string;
        readonly treeBytes: number;
        readonly treeSha256: string;
        readonly grassAtlas: string;
        readonly grassAtlasBytes: number;
        readonly grassAtlasSha256: string;
        readonly grassAtlasWidth: number;
        readonly grassAtlasHeight: number;
        readonly grassAtlasSource: string;
        readonly grassAtlasLicense: string;
        readonly grassAtlasRects: readonly {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        }[];
        readonly grassAtlasTufts: readonly { readonly id: string; readonly slot: number }[];
        readonly leafPolicy: string;
        readonly billboardSprites: number;
        readonly leafSprites: {
          readonly source: string;
          readonly leafMaterials: number;
          readonly billboardMaterials: number;
          readonly highAlphaCutoff: number;
          readonly lowAlphaCutoff: number;
        };
      };
      readonly variants: readonly {
        readonly variant: number;
        readonly sourceHighTriangles: number;
        readonly sourceLowTriangles: number;
      }[];
    };

    expect(manifest.schema).toBe('jwgb.grassworks-vegetation.v1');
    expect(manifest.source.license).toContain('No license file');
    expect(manifest.source.excludedGrassAtlas.included).toBe(true);
    expect(manifest.source.excludedGrassAtlas.reason).toContain('pngtree');
    expect(manifest.runtime.grassAtlasSource).toContain('grass-atlas5.png');
    expect(manifest.runtime.grassAtlasWidth).toBe(GRASSWORKS_SOURCE_PROFILE.runtimeAtlas.width);
    expect(manifest.runtime.grassAtlasHeight).toBe(GRASSWORKS_SOURCE_PROFILE.runtimeAtlas.height);
    // The runtime samples exactly the slots the import tool packed; a stale
    // rect would cut through a clump and bring the straight-edged blades back.
    expect(manifest.runtime.grassAtlasRects).toEqual(GRASSWORKS_SOURCE_PROFILE.runtimeAtlas.rects);
    expect(manifest.runtime.grassAtlasTufts.map((tuft) => tuft.id)).toEqual([
      'dense-seeded',
      'wide-fine',
    ]);
    for (const rect of manifest.runtime.grassAtlasRects) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(manifest.runtime.grassAtlasWidth);
      expect(rect.y + rect.height).toBeLessThanOrEqual(manifest.runtime.grassAtlasHeight);
    }
    expect(manifest.runtime.leafPolicy).toContain('photographic');
    expect(manifest.runtime.leafPolicy).toContain('billboard');
    expect(manifest.runtime.leafPolicy).toContain('Do not replace');
    expect(manifest.runtime.billboardSprites).toBe(9);
    expect(manifest.runtime.leafSprites.leafMaterials).toBeGreaterThan(0);
    expect(manifest.runtime.leafSprites.billboardMaterials).toBe(9);
    expect(manifest.runtime.leafSprites.highAlphaCutoff).toBe(0.5);
    expect(manifest.runtime.leafSprites.lowAlphaCutoff).toBe(0.35);
    expect(manifest.runtime.leafSprites.source).toContain('terrain2.glb');
    expect(manifest.variants).toHaveLength(9);
    expect(manifest.variants.every((variant) => variant.sourceHighTriangles > 0)).toBe(true);
    expect(manifest.variants.every((variant) => variant.sourceLowTriangles === 4)).toBe(true);

    const treePath = resolve(assetRoot, manifest.runtime.treeAsset);
    const grassPath = resolve(assetRoot, manifest.runtime.grassAtlas);
    expect(statSync(treePath).size).toBe(manifest.runtime.treeBytes);
    expect(statSync(grassPath).size).toBe(manifest.runtime.grassAtlasBytes);
    expect(sha256(treePath)).toBe(manifest.runtime.treeSha256);
    expect(sha256(grassPath)).toBe(manifest.runtime.grassAtlasSha256);
    expect(GRASSWORKS_VEGETATION_ASSET_PATHS).toEqual([
      manifest.runtime.treeAsset,
      manifest.runtime.grassAtlas,
    ]);
  });

  it('keeps whole-map grass placement deterministic and climbs the massifs', () => {
    const first = sampleGrassworksGrassPoints(0x08b3d5a4);
    const second = sampleGrassworksGrassPoints(0x08b3d5a4);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(250_000);
    const onMassifs = first.filter((point) => isInsideBoundWall(point));
    expect(onMassifs.length).toBeGreaterThan(5_000);
  }, 30_000);

  it('scatters trees across the whole walkable map and woods the BOUND massifs', () => {
    const first = sampleGrassworksTreePoints(0x08b3d5a4);
    const second = sampleGrassworksTreePoints(0x08b3d5a4);
    expect(second).toEqual(first);
    const massif = sampleMassifTreePoints(0x08b3d5a4);
    const hill = sampleHillTreePoints(0x08b3d5a4);
    expect(massif.length).toBeGreaterThan(500);
    expect(hill.length).toBeGreaterThan(80);
    expect(massif.every((point) => isInsideBoundWall(point))).toBe(true);
    expect(hill.every((point) => isInsideVaultWall(point))).toBe(true);
    expect(first.length).toBeGreaterThanOrEqual(
      GRASSWORKS_SOURCE_PROFILE.runtimeTreeCount + massif.length,
    );
    // Hill trees stay off the massifs, so the massif lattice alone woods them.
    expect(first.filter((point) => isInsideBoundWall(point))).toHaveLength(massif.length);
    expect(first.filter((point) => isInsideVaultWall(point)).length).toBeGreaterThan(80);

    // Massif trees stand on the drawn rock, not on the ground buried inside it.
    const lifted = massif.filter(
      (point) => dressingSurfaceMeters(point) - groundSurfaceMeters(point) > 1,
    );
    expect(lifted.length).toBeGreaterThan(massif.length / 2);

    const xs = first.map((point) => point.x / 1_000);
    const zs = first.map((point) => point.z / 1_000);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(500);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(400);

    const quadrants = { nw: 0, ne: 0, sw: 0, se: 0 };
    for (const point of first) {
      const x = point.x / 1_000;
      const z = point.z / 1_000;
      if (x < 0 && z >= 0) {
        quadrants.nw += 1;
      } else if (x >= 0 && z >= 0) {
        quadrants.ne += 1;
      } else if (x < 0 && z < 0) {
        quadrants.sw += 1;
      } else {
        quadrants.se += 1;
      }
    }
    expect(quadrants.nw).toBeGreaterThan(80);
    expect(quadrants.ne).toBeGreaterThan(80);
    expect(quadrants.sw).toBeGreaterThan(80);
    expect(quadrants.se).toBeGreaterThan(80);
  }, 30_000);

  it('preserves the source profile in the WebGL adaptation', () => {
    expect(GRASSWORKS_SOURCE_PROFILE).toMatchObject({
      tileSizeMeters: 25,
      renderBatchSizeMeters: 50,
      maxDistanceMeters: 150,
      atlasColumns: 2,
      atlasRows: 2,
      influenceResolution: 0,
      runtimeSpacingMeters: 1.25,
      runtimeMaxDistanceMeters: 180,
      runtimeReducedMaxDistanceMeters: 108,
      runtimeRoadVergeMm: -1,
      runtimeTreeCount: 3_800,
      runtimeTreePlacement: 'whole-map clustered woodland',
      runtimeTreeHeightMeters: { min: 12.5, max: 24 },
      runtimeMassifTreeSpacingMeters: 2.6,
      runtimeHillTreeSpacingMeters: 3.6,
      runtimeUnderstory: 'bush, asia-bush and fern GLBs clustered under every placed tree',
      runtimeTreeHighDistanceMeters: 48,
      runtimeTreeLowDistanceMeters: 260,
      runtimeReducedTreeLowDistanceMeters: 208,
      runtimeTreeHighHysteresisMeters: 5,
      runtimeTreeLowHysteresisMeters: 16,
      leafSprites: {
        highAlphaTest: 0.5,
        lowAlphaTest: 0.35,
        highEmissiveIntensity: 0.12,
        lowEmissiveIntensity: 0.06,
        highWind: 0.13,
        lowWind: 0.095,
      },
    });
    expect(GRASSWORKS_SOURCE_PROFILE.sourceLods).toEqual([
      { id: 'high', detail: 5, density: 4, distanceRatio: 0.3 },
      { id: 'medium', detail: 2, density: 3, distanceRatio: 0.7 },
      { id: 'low', detail: 1, density: 2, distanceRatio: 0.9 },
      { id: 'veryLow', detail: 1, density: 1, distanceRatio: 0.9 },
    ]);
    expect(GRASSWORKS_SOURCE_PROFILE.runtimeLods).toEqual(GRASSWORKS_SOURCE_PROFILE.sourceLods);
  });

  it('stays disabled without a renderer and reports no legacy vegetation', () => {
    const parent = new THREE.Group();
    const layer = buildGrassworksVegetationLayer(parent, {
      renderer: null,
      graphicsTier: 'balanced',
      seed: 123,
    });

    expect(layer.diagnostics()).toMatchObject({
      source: 'grassworks',
      status: 'disabled',
      loadedAssets: [],
      failedAssets: [],
      tileSizeMeters: 25,
      renderBatchSizeMeters: 50,
      maxGrassDistanceMeters: 180,
      influenceResolution: 0,
      grassInstances: 0,
      grassTiles: 0,
      grassRenderBatches: 0,
      treeInstances: 0,
      legacyFloraInstances: 0,
      legacyScatterInstances: 0,
      legacyGlobalSceneVegetationInstances: 0,
      understoryInstances: 0,
      visibleUnderstoryInstances: 0,
      understoryStatus: 'disabled',
      visible: false,
    });
    expect(parent.children).toContain(layer.group);

    layer.setGraphicsTier('reduced');
    expect(layer.diagnostics().maxGrassDistanceMeters).toBe(108);
    layer.update(new THREE.Vector3(10, 20, 10), new THREE.Vector3());
    layer.dispose();

    expect(layer.diagnostics().status).toBe('disposed');
    expect(parent.children).not.toContain(layer.group);
  });
});
