import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildGlobalSceneLayer,
  createGlobalScenePlacementPlan,
  GLOBAL_SCENE_ASSET_CATALOG,
  type GlobalSceneSourceId,
  placementsForGlobalSceneTier,
} from '../apps/web/src/render/map/global-scene-layer';
import { regionAt, regionStyles } from '../apps/web/src/render/map/map-regions';
import { isOpenGround } from '../apps/web/src/render/map/map-sampling';
import { waterSurfaceAt } from '../apps/web/src/render/map/water';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceIds: readonly GlobalSceneSourceId[] = [
  'overgrown',
  'forest-road-night',
  'forest-mountains',
];

describe('web global scene layer', () => {
  it('ships all three source packs as optimized runtime assets', () => {
    const manifest = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, 'apps/web/public/models/global-scenes/manifest.json'),
        'utf8',
      ),
    ) as {
      readonly sources: readonly string[];
      readonly assets: readonly {
        readonly id: string;
        readonly path: string;
        readonly bytes: number;
      }[];
    };

    expect(manifest.sources).toEqual([
      'an-overgrown-japanese-style-location.zip',
      'a-forest-3-with-a-road-at-night-for-game.zip',
      'landscape-forest-mountains.zip',
    ]);
    expect(GLOBAL_SCENE_ASSET_CATALOG).toHaveLength(11);
    expect(manifest.assets).toHaveLength(GLOBAL_SCENE_ASSET_CATALOG.length);

    for (const catalog of GLOBAL_SCENE_ASSET_CATALOG) {
      const entry = manifest.assets.find((asset) => asset.id === catalog.id);
      const file = resolve(
        repositoryRoot,
        'apps/web/public/models/global-scenes',
        catalog.fileName,
      );
      expect(entry).toBeDefined();
      expect(entry?.path).toBe(`models/global-scenes/${catalog.fileName}`);
      expect(statSync(file).size).toBe(entry?.bytes);
    }
  });

  it('builds a deterministic whole-map plan with every source in every region', () => {
    const first = createGlobalScenePlacementPlan(0x08b3d5a4);
    const second = createGlobalScenePlacementPlan(0x08b3d5a4);
    const regions = regionStyles().map((region) => region.id);

    expect(first).toEqual(second);
    expect(first).toHaveLength(regions.length * sourceIds.length * 3 + 16);
    expect(new Set(first.map((placement) => placement.id)).size).toBe(first.length);

    for (const regionId of regions) {
      const regionPlacements = first.filter((placement) => placement.regionId === regionId);
      expect(regionPlacements).toHaveLength(sourceIds.length * 3);
      for (const sourceId of sourceIds) {
        expect(
          regionPlacements.filter((placement) => placement.sourceId === sourceId),
        ).toHaveLength(3);
      }
    }

    for (const sourceId of sourceIds) {
      expect(
        new Set(
          first
            .filter((placement) => placement.sourceId === sourceId)
            .map((placement) => placement.regionId),
        ).size,
      ).toBeGreaterThanOrEqual(regions.length);
    }
  });

  it('keeps near scenery inside its region and clear of roads, water, and gameplay sites', () => {
    const placements = createGlobalScenePlacementPlan(0x08b3d5a4);
    const near = placements.filter((placement) => placement.role !== 'backdrop');
    const perimeter = placements.filter((placement) => placement.role === 'backdrop');

    for (const placement of near) {
      const point = {
        x: Math.round(placement.x * 1_000),
        z: Math.round(placement.z * 1_000),
      };
      expect(regionAt(placement.x, placement.z).id).toBe(placement.regionId);
      expect(isOpenGround(point, { roadVergeMm: 5_500 })).toBe(true);
      expect(waterSurfaceAt(placement.x, placement.z)).toBeNull();
      expect(Number.isFinite(placement.y)).toBe(true);
      expect(placement.scale).toBeGreaterThan(0);
    }

    expect(perimeter).toHaveLength(16);
    expect(
      perimeter.every(
        (placement) =>
          placement.regionId === 'perimeter' &&
          placement.sourceId === 'forest-mountains' &&
          placement.role === 'backdrop',
      ),
    ).toBe(true);
  });

  it('retains all three sources across all seven regions in reduced quality', () => {
    const regions = regionStyles().map((region) => region.id);
    const reduced = placementsForGlobalSceneTier(
      createGlobalScenePlacementPlan(0x08b3d5a4),
      'reduced',
    );

    expect(reduced).toHaveLength(regions.length * sourceIds.length + 8);
    for (const regionId of regions) {
      for (const sourceId of sourceIds) {
        expect(
          reduced.filter(
            (placement) => placement.regionId === regionId && placement.sourceId === sourceId,
          ),
        ).toHaveLength(1);
      }
    }
  });

  it('stays disabled without a renderer and disposes cleanly', () => {
    const parent = new THREE.Group();
    const layer = buildGlobalSceneLayer(parent, {
      renderer: null,
      graphicsTier: 'balanced',
      seed: 123,
    });

    expect(layer.diagnostics()).toMatchObject({
      status: 'disabled',
      loadedAssets: [],
      failedAssets: [],
      placements: 0,
      visible: false,
    });
    expect(parent.children).toContain(layer.group);

    layer.setGraphicsTier('reduced');
    layer.update(new THREE.Vector3(10, 20, 10), new THREE.Vector3(0, 0, 0));
    layer.dispose();

    expect(layer.diagnostics().status).toBe('disposed');
    expect(parent.children).not.toContain(layer.group);
  });
});
