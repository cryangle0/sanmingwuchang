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
} from '../apps/web/src/render/map/grassworks-vegetation';

const repositoryRoot = resolve(import.meta.dirname, '..');
const assetRoot = resolve(repositoryRoot, 'apps/web/public');

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('web Grassworks vegetation', () => {
  it('ships the adapted tree and watermark-free grass assets with matching metadata', () => {
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
        readonly grassAtlasLicense: string;
      };
      readonly variants: readonly {
        readonly variant: number;
        readonly sourceHighTriangles: number;
        readonly sourceLowTriangles: number;
      }[];
    };

    expect(manifest.schema).toBe('jwgb.grassworks-vegetation.v1');
    expect(manifest.source.license).toContain('No license file');
    expect(manifest.source.excludedGrassAtlas.included).toBe(false);
    expect(manifest.source.excludedGrassAtlas.reason).toContain('watermark');
    expect(manifest.runtime.grassAtlasLicense).toContain('CC0');
    expect(manifest.runtime.grassAtlasWidth).toBe(1_024);
    expect(manifest.runtime.grassAtlasHeight).toBe(1_024);
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

  it('keeps whole-map grass placement deterministic', () => {
    const first = sampleGrassworksGrassPoints(0x08b3d5a4);
    const second = sampleGrassworksGrassPoints(0x08b3d5a4);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(250_000);
  });

  it('preserves the source profile in the WebGL adaptation', () => {
    expect(GRASSWORKS_SOURCE_PROFILE).toMatchObject({
      tileSizeMeters: 25,
      renderBatchSizeMeters: 50,
      maxDistanceMeters: 150,
      atlasColumns: 2,
      atlasRows: 2,
      influenceResolution: 256,
      runtimeSpacingMeters: 1.25,
      runtimeMaxDistanceMeters: 180,
      runtimeReducedMaxDistanceMeters: 108,
      runtimeRoadVergeMm: -1,
    });
    expect(GRASSWORKS_SOURCE_PROFILE.sourceLods).toEqual([
      { id: 'high', detail: 5, density: 4, distanceRatio: 0.3 },
      { id: 'medium', detail: 2, density: 3, distanceRatio: 0.7 },
      { id: 'low', detail: 1, density: 2, distanceRatio: 0.9 },
      { id: 'veryLow', detail: 1, density: 1, distanceRatio: 0.9 },
    ]);
    expect(GRASSWORKS_SOURCE_PROFILE.runtimeLods).toEqual([
      { id: 'high', detail: 5, density: 4, distanceRatio: 0.3 },
      { id: 'medium', detail: 3, density: 4, distanceRatio: 0.7 },
      { id: 'low', detail: 2, density: 4, distanceRatio: 0.9 },
      { id: 'veryLow', detail: 2, density: 4, distanceRatio: 1 },
    ]);
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
      influenceResolution: 256,
      grassInstances: 0,
      grassTiles: 0,
      grassRenderBatches: 0,
      treeInstances: 0,
      legacyFloraInstances: 0,
      legacyScatterInstances: 0,
      legacyGlobalSceneVegetationInstances: 0,
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
