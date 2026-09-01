import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  shopModelDefinition,
  WEB_SHOP_MODELS,
} from '../apps/web/src/render/models/web-model-catalog';

const repositoryRoot = resolve(import.meta.dirname, '..');
const assetRoot = resolve(repositoryRoot, 'apps/web/public');

const expectedShops = [
  {
    id: 'S001',
    shopKind: 'shoemaker',
    sourceName: '鞋匠',
    displayName: '鞋匠',
    targetHeight: 2.05,
  },
  {
    id: 'S002',
    shopKind: 'taibai',
    sourceName: '太白金星',
    displayName: '太白金星',
    targetHeight: 2.2,
  },
  {
    id: 'S003',
    shopKind: 'land-god',
    sourceName: '土地公',
    displayName: '土地公',
    targetHeight: 1.8,
  },
  {
    id: 'S004',
    shopKind: 'heishan',
    sourceName: '黑山老妖',
    displayName: '黑山老妖',
    targetHeight: 2.6,
  },
] as const;

describe('web shop NPC models', () => {
  it('maps the four supplied assets to the corrected shop identities', () => {
    expect(WEB_SHOP_MODELS).toHaveLength(expectedShops.length);
    expect(new Set(WEB_SHOP_MODELS.map((model) => model.id)).size).toBe(expectedShops.length);

    for (const expected of expectedShops) {
      const definition = shopModelDefinition(expected.shopKind);
      expect(definition).toMatchObject({
        id: expected.id,
        sourceName: expected.sourceName,
        kind: 'shop',
        shopKind: expected.shopKind,
        height: expected.targetHeight,
        assetBase: 'web',
        format: 'glb',
        assetPath: `models/shops/${expected.id}/model.glb`,
        animationStates: ['Idle'],
      });
    }
  });

  it('ships renderable GLBs with truthful idle-only manifests', () => {
    for (const expected of expectedShops) {
      const definition = shopModelDefinition(expected.shopKind);
      expect(definition).not.toBeNull();
      if (!definition) {
        continue;
      }

      const modelPath = resolve(assetRoot, definition.assetPath);
      const manifestPath = resolve(
        assetRoot,
        'models/shops',
        expected.id,
        'manifest.json',
      );
      const modelBytes = readFileSync(modelPath);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        readonly schema: string;
        readonly modelId: string;
        readonly shopKind: string;
        readonly displayName: string;
        readonly deliveryPath: string;
        readonly targetHeight: number;
        readonly animationStates: readonly string[];
        readonly optimized: {
          readonly bytes: number;
          readonly triangles: number;
          readonly materials: number;
          readonly textures: number;
          readonly animations: readonly {
            readonly name: string;
            readonly channels: number;
          }[];
          readonly skins: readonly { readonly joints: number }[];
        };
        readonly errors: readonly string[];
        readonly status: string;
      };

      expect(modelBytes.subarray(0, 4).toString('ascii')).toBe('glTF');
      expect(statSync(modelPath).size).toBe(manifest.optimized.bytes);
      expect(manifest).toMatchObject({
        schema: 'jwgb.shop-npc-model.v1',
        modelId: expected.id,
        shopKind: expected.shopKind,
        displayName: expected.displayName,
        deliveryPath: definition.assetPath,
        targetHeight: expected.targetHeight,
        animationStates: ['Idle'],
        errors: [],
        status: 'passed',
      });
      expect(manifest.optimized.triangles).toBeGreaterThan(0);
      expect(manifest.optimized.triangles).toBeLessThanOrEqual(20_000);
      expect(manifest.optimized.materials).toBeGreaterThan(0);
      expect(manifest.optimized.textures).toBeGreaterThan(0);
      expect(manifest.optimized.animations.map((animation) => animation.name)).toEqual(['Idle']);
      expect(manifest.optimized.animations[0]?.channels).toBeGreaterThan(0);
      expect(manifest.optimized.skins).toHaveLength(1);
      expect(manifest.optimized.skins[0]?.joints).toBeGreaterThan(0);
    }
  });
});
