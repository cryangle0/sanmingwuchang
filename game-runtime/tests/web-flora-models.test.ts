import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildFloraModelLayer,
  floraModelAssetPaths,
} from '../apps/web/src/render/map/flora-models';
import { WORLD_SCALE_PROFILE } from '../apps/web/src/render/world-scale-profile';

const repositoryRoot = resolve(import.meta.dirname, '..');
const polyNatureDelivery = [
  {
    id: 'poly-nature-beech',
    fileName: 'beech-poly.glb',
    targetHeight: WORLD_SCALE_PROFILE.flora.treeTargetHeights.beech,
  },
  {
    id: 'poly-nature-willow',
    fileName: 'willow-poly.glb',
    targetHeight: WORLD_SCALE_PROFILE.flora.treeTargetHeights.willow,
  },
  {
    id: 'poly-nature-cypress',
    fileName: 'cypress-poly.glb',
    targetHeight: WORLD_SCALE_PROFILE.flora.treeTargetHeights.cypress,
  },
  {
    id: 'poly-nature-dead-beech',
    fileName: 'dead-beech-poly.glb',
    targetHeight: WORLD_SCALE_PROFILE.flora.treeTargetHeights.dead,
  },
  {
    id: 'poly-nature-dead-cypress',
    fileName: 'dead-cypress-poly.glb',
    targetHeight: WORLD_SCALE_PROFILE.flora.treeTargetHeights.dead,
  },
  {
    id: 'poly-nature-burdock',
    fileName: 'burdock-poly.glb',
    targetHeight: WORLD_SCALE_PROFILE.flora.burdockTargetHeight,
  },
] as const;

describe('web flora model layer', () => {
  it('includes the purchased lowpoly and Blender variants in both quality tiers', () => {
    const balanced = floraModelAssetPaths('balanced');
    const reduced = floraModelAssetPaths('reduced');
    const polyNatureTrees = [
      'beech-poly.glb',
      'cypress-poly.glb',
      'dead-beech-poly.glb',
      'dead-cypress-poly.glb',
      'willow-poly.glb',
    ];

    expect(balanced.core).toEqual(
      expect.arrayContaining(['asia-tree.glb', 'red-maple.glb', ...polyNatureTrees]),
    );
    expect(balanced.dressing).toEqual(
      expect.arrayContaining([
        'asia-bush.glb',
        'burdock-poly.glb',
        'reed-big.glb',
        'small-plant-1.glb',
        'small-plant-2.glb',
      ]),
    );
    expect(reduced.core).toEqual(
      expect.arrayContaining(['asia-tree.glb', 'red-maple.glb', ...polyNatureTrees]),
    );
    expect(reduced.dressing).toEqual(['burdock-poly.glb']);
  });

  it('keeps the renderer-free fallback path disabled and disposable', () => {
    const parent = new THREE.Group();
    const layer = buildFloraModelLayer(parent, {
      renderer: null,
      graphicsTier: 'balanced',
      trees: [],
      rocks: [],
      dressing: [],
    });

    expect(layer.diagnostics()).toMatchObject({
      status: 'disabled',
      loadedAssets: [],
      failedAssets: [],
      treeInstances: 0,
      rockInstances: 0,
      dressingInstances: 0,
      visible: false,
    });
    layer.dispose();
    expect(layer.diagnostics().status).toBe('disposed');
  });

  it('keeps the Blender delivery small, normalized, and represented in the manifest', () => {
    const manifest = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, 'apps/web/public/models/map-assets/manifest.json'),
        'utf8',
      ),
    ) as {
      readonly floraAssets: readonly {
        readonly id: string;
        readonly path: string;
        readonly targetHeight: number;
        readonly bytes: number;
        readonly optimized: { readonly triangles: number };
      }[];
    };

    let totalBytes = 0;
    for (const expected of polyNatureDelivery) {
      const entry = manifest.floraAssets.find((asset) => asset.id === expected.id);
      expect(entry).toBeDefined();
      expect(entry?.path).toBe(`models/foliage/${expected.fileName}`);
      expect(entry?.targetHeight).toBe(expected.targetHeight);
      expect(entry?.optimized.triangles).toBeLessThanOrEqual(2_200);
      const file = resolve(repositoryRoot, 'apps/web/public/models/foliage', expected.fileName);
      expect(statSync(file).size).toBe(entry?.bytes);
      totalBytes += entry?.bytes ?? 0;
    }
    expect(totalBytes).toBeLessThan(200_000);
  });
});
