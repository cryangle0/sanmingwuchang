import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildMapAssetLayer,
  createMapAssetPlacementPlan,
  MAP_ASSET_CATALOG,
  mapAssetVertexGroundingOffset,
} from '../apps/web/src/render/map/map-asset-layer';

const repositoryRoot = resolve(import.meta.dirname, '..');

describe('web imported map asset layer', () => {
  it('keeps the delivery catalog relative, optimized, and source-free', () => {
    expect(MAP_ASSET_CATALOG.length).toBe(36);
    expect(MAP_ASSET_CATALOG.every((entry) => entry.fileName.endsWith('.glb'))).toBe(true);
    expect(MAP_ASSET_CATALOG.every((entry) => !entry.fileName.includes('\\'))).toBe(true);
    expect(MAP_ASSET_CATALOG.every((entry) => !entry.fileName.includes(':'))).toBe(true);
    expect(MAP_ASSET_CATALOG.filter((entry) => entry.kind === 'landmark')).toHaveLength(12);
    expect(MAP_ASSET_CATALOG.filter((entry) => entry.kind === 'rock')).toHaveLength(24);
    expect(MAP_ASSET_CATALOG.filter((entry) => entry.id.startsWith('stylized-rock-'))).toHaveLength(
      9,
    );
    expect(
      MAP_ASSET_CATALOG.filter((entry) =>
        ['lowpoly-asian-house', 'lowpoly-torii', 'lowpoly-rock-formation'].includes(entry.id),
      ),
    ).toHaveLength(3);
  });

  it('ships the four free converted landmarks with matching manifest metadata', () => {
    const manifest = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, 'apps/web/public/models/map-assets/manifest.json'),
        'utf8',
      ),
    ) as {
      readonly assets: readonly {
        readonly id: string;
        readonly path: string;
        readonly bytes: number;
        readonly optimized: { readonly triangles: number };
      }[];
    };
    const expected = [
      ['free-pagoda-niko313', 'free-pagoda-niko313.glb', 11_201],
      ['free-stone-cart', 'free-stone-cart.glb', 1_920],
      ['free-stone-lion', 'free-stone-lion.glb', 31_438],
      ['free-pagoda-ruin', 'free-pagoda-ruin.glb', 1_527],
    ] as const;

    for (const [id, fileName, triangles] of expected) {
      const entry = manifest.assets.find((asset) => asset.id === id);
      const file = resolve(repositoryRoot, 'apps/web/public/models/map-assets', fileName);
      expect(entry).toBeDefined();
      expect(entry?.path).toBe(`models/map-assets/${fileName}`);
      expect(entry?.optimized.triangles).toBe(triangles);
      expect(statSync(file).size).toBe(entry?.bytes);
    }
  });

  it('builds a deterministic plan with authored landmark and rock budgets', () => {
    const first = createMapAssetPlacementPlan(0x08b3d5a4);
    const second = createMapAssetPlacementPlan(0x08b3d5a4);
    expect(first).toEqual(second);
    expect(first.filter((placement) => placement.kind === 'landmark')).toHaveLength(12);
    expect(first.filter((placement) => placement.kind === 'rock')).toHaveLength(24);
    expect(
      first.every(
        (placement) =>
          Number.isFinite(placement.x) &&
          Number.isFinite(placement.y) &&
          Number.isFinite(placement.z) &&
          Number.isFinite(placement.scale) &&
          placement.scale > 0,
      ),
    ).toBe(true);
    expect(new Set(first.map((placement) => placement.id)).size).toBe(first.length);

    const house = first.find((placement) => placement.id === 'imported-landmark-west-house');
    expect(house).toBeDefined();
    const houseCatalog = MAP_ASSET_CATALOG.find((entry) => entry.id === house?.assetId);
    expect(house?.worldHeight).toBe(8.5);
    expect(houseCatalog?.targetHeight).toBe(12);
    expect(house?.scale).toBeCloseTo((house?.worldHeight ?? 0) / (houseCatalog?.targetHeight ?? 1));
    expect(Math.hypot((house?.x ?? 0) + 330.7, (house?.z ?? 0) + 82)).toBeGreaterThan(24);

    const rocks = first.filter((placement) => placement.kind === 'rock');
    expect(Math.min(...rocks.map((placement) => placement.worldHeight))).toBeGreaterThanOrEqual(
      1.45,
    );
    expect(Math.max(...rocks.map((placement) => placement.worldHeight))).toBeLessThanOrEqual(4.25);
    for (const placement of rocks) {
      const catalog = MAP_ASSET_CATALOG.find((entry) => entry.id === placement.assetId);
      expect(catalog).toBeDefined();
      expect(placement.scale).toBeCloseTo(
        placement.worldHeight / (catalog?.targetHeight ?? Number.NaN),
      );
    }
  });

  it('grounds each optimized citadel pavilion at its original source-terrain step', () => {
    expect(
      mapAssetVertexGroundingOffset('wuxia-citadel', '3005_Building_05', -30.148, 26.741),
    ).toBeCloseTo(-0.954);
    expect(
      mapAssetVertexGroundingOffset('wuxia-citadel', '3005_Building_05', 21.219, -33.078),
    ).toBeCloseTo(-12.472);
    expect(
      mapAssetVertexGroundingOffset('wuxia-citadel', '3005_Building_05', 25.638, -59.043),
    ).toBeCloseTo(-7.756);
    expect(
      mapAssetVertexGroundingOffset('wuxia-citadel', '3005_Item_15', -30.148, 26.741),
    ).toBeCloseTo(-4.925);
    expect(
      mapAssetVertexGroundingOffset('wuxia-citadel', '3005_Item_15', 11.621, -47.11),
    ).toBeCloseTo(-19.965);
    expect(mapAssetVertexGroundingOffset('wuxia-gate-court', '3004_Item_12', 0, 0)).toBe(0);
  });

  it('does not require a renderer for the procedural fallback path and disposes cleanly', () => {
    const parent = new THREE.Group();
    const fallbackGeometry = new THREE.BoxGeometry(1, 1, 1);
    const fallbackMaterial = new THREE.MeshBasicMaterial();
    const fallback = new THREE.Mesh(fallbackGeometry, fallbackMaterial);
    fallback.name = 'map-procedural-rock-markers';
    parent.add(fallback);

    const layer = buildMapAssetLayer(parent, {
      renderer: null,
      graphicsTier: 'balanced',
      seed: 123,
      fallbackRockGroup: fallback,
    });
    expect(layer.diagnostics()).toMatchObject({
      status: 'disabled',
      loadedAssets: [],
      failedAssets: [],
      visible: false,
    });

    layer.setGraphicsTier('reduced');
    layer.update(new THREE.Vector3(10, 20, 10), new THREE.Vector3(0, 0, 0));
    layer.dispose();
    expect(layer.diagnostics().status).toBe('disposed');
    expect(fallback.visible).toBe(true);

    fallbackGeometry.dispose();
    fallbackMaterial.dispose();
  });
});
