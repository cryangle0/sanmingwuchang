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
const lushTreeDelivery = {
  id: 'mission-lush-tree',
  fileName: 'mission-lush-tree.glb',
  targetHeight: WORLD_SCALE_PROFILE.flora.treeTargetHeights.lush,
} as const;
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
  it('uses the lush live tree and keeps optimized dead trees in both quality tiers', () => {
    const balanced = floraModelAssetPaths('balanced');
    const reduced = floraModelAssetPaths('reduced');
    const deadTrees = ['dead-beech-poly.glb', 'dead-cypress-poly.glb'];

    expect(balanced.core).toEqual(expect.arrayContaining(['mission-lush-tree.glb', ...deadTrees]));
    expect(balanced.dressing).toEqual(
      expect.arrayContaining([
        'asia-bush.glb',
        'burdock-poly.glb',
        'reed-big.glb',
        'small-plant-1.glb',
        'small-plant-2.glb',
      ]),
    );
    expect(reduced.core).toEqual(expect.arrayContaining(['mission-lush-tree.glb', ...deadTrees]));
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

  it('keeps the lush forest tree extracted, compressed, and represented in the manifest', () => {
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
        readonly optimized: { readonly triangles: number; readonly materials: number };
      }[];
    };
    const entry = manifest.floraAssets.find((asset) => asset.id === lushTreeDelivery.id);
    const file = resolve(
      repositoryRoot,
      'apps/web/public/models/foliage',
      lushTreeDelivery.fileName,
    );

    expect(entry).toBeDefined();
    expect(entry?.path).toBe(`models/foliage/${lushTreeDelivery.fileName}`);
    expect(entry?.targetHeight).toBe(lushTreeDelivery.targetHeight);
    expect(entry?.optimized.triangles).toBeLessThanOrEqual(3_000);
    expect(entry?.optimized.materials).toBe(2);
    expect(statSync(file).size).toBe(entry?.bytes);
    expect(statSync(file).size).toBeLessThan(180_000);
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
