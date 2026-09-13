import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAP_CHESTS, MAP_SPAWN_POINTS } from '@jwgb/content';
import { describe, expect, it } from 'vitest';
import {
  createMapAssetPlacementPlan,
  MAP_ASSET_CATALOG,
} from '../apps/web/src/render/map/map-asset-layer';
import { regionAt } from '../apps/web/src/render/map/map-regions';
import { isOnRoad } from '../apps/web/src/render/map/map-sampling';
import { WORLD_SCALE_PROFILE } from '../apps/web/src/render/world-scale-profile';

const repositoryRoot = resolve(import.meta.dirname, '..');
const assetDirectory = resolve(repositoryRoot, 'apps/web/public/models/map-assets');

interface ManifestAsset {
  readonly id: string;
  readonly path: string;
  readonly bytes: number;
  readonly targetHeight: number;
  readonly optimized: {
    readonly triangles: number;
    readonly materials: number;
    readonly meshes: number;
    readonly drawCalls: number;
  };
}

const manifest = JSON.parse(readFileSync(resolve(assetDirectory, 'manifest.json'), 'utf8')) as {
  readonly assets: readonly ManifestAsset[];
  readonly budgets: Readonly<Record<string, number>>;
};

const buildingCatalog = MAP_ASSET_CATALOG.filter((entry) => entry.kind === 'structure');

describe('唐宋 procedural building family', () => {
  it('ships a manifest entry, file and world height for every catalogued building', () => {
    expect(buildingCatalog.length).toBe(13);
    for (const entry of buildingCatalog) {
      const asset = manifest.assets.find((candidate) => candidate.id === entry.id);
      expect(asset, `${entry.id} manifest entry`).toBeDefined();
      expect(asset?.path).toBe(`models/map-assets/${entry.fileName}`);
      expect(asset?.targetHeight).toBe(entry.targetHeight);
      expect(statSync(resolve(assetDirectory, entry.fileName)).size).toBe(asset?.bytes);
      expect(
        WORLD_SCALE_PROFILE.map.structureWorldHeights[entry.id],
        `${entry.id} world height`,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps the imported landmarks inside the tightened triangle budget', () => {
    const landmarks = manifest.assets.filter((asset) =>
      MAP_ASSET_CATALOG.some((entry) => entry.id === asset.id && entry.kind === 'landmark'),
    );
    expect(landmarks.length).toBeGreaterThanOrEqual(10);
    const heaviest = landmarks.reduce((max, asset) => Math.max(max, asset.optimized.triangles), 0);
    expect(heaviest).toBeLessThanOrEqual(manifest.budgets.landmarkMaxTriangles ?? 40_000);
  });

  it('keeps every building inside the triangle, material and draw-call budget', () => {
    for (const entry of buildingCatalog) {
      const asset = manifest.assets.find((candidate) => candidate.id === entry.id);
      expect(asset?.optimized.triangles, `${entry.id} triangles`).toBeLessThanOrEqual(
        manifest.budgets.buildingMaxTriangles ?? 3_000,
      );
      // One vertex-coloured material per building keeps the instanced layer at
      // a single draw call per building type.
      expect(asset?.optimized.materials, `${entry.id} materials`).toBe(1);
      expect(asset?.optimized.meshes, `${entry.id} meshes`).toBe(1);
      expect(asset?.optimized.drawCalls, `${entry.id} draw calls`).toBe(1);
    }
  });

  it('spreads buildings across every district with a stable count', () => {
    const plan = createMapAssetPlacementPlan(0x08b3d5a4);
    const buildings = plan.filter((placement) => placement.kind === 'structure');
    // 73 with the 80-spawn table: one former site now sits inside a spawn clearing.
    expect(buildings.length).toBe(72);
    const perRegion = new Map<string, number>();
    for (const placement of buildings) {
      const region = regionAt(placement.x, placement.z).id;
      perRegion.set(region, (perRegion.get(region) ?? 0) + 1);
    }
    for (const region of ['duanjin', 'zhusi', 'longji', 'baizu', 'jinshui', 'mihun', 'santing']) {
      expect(perRegion.get(region) ?? 0, `${region} buildings`).toBeGreaterThanOrEqual(6);
    }
    // Every catalogued building is actually used somewhere on the map.
    const used = new Set(buildings.map((placement) => placement.assetId));
    for (const entry of buildingCatalog) {
      expect(used.has(entry.id), `${entry.id} placed`).toBe(true);
    }
  });

  it('never drops a building on a road, chest, spawn pad, landmark or peer', () => {
    const plan = createMapAssetPlacementPlan(0x08b3d5a4);
    const buildings = plan.filter((placement) => placement.kind === 'structure');
    const landmarks = plan.filter((placement) => placement.kind === 'landmark');
    for (const placement of buildings) {
      for (const landmark of landmarks) {
        expect(
          Math.hypot(landmark.x - placement.x, landmark.z - placement.z),
          `${placement.id} clear of ${landmark.id}`,
        ).toBeGreaterThan(30);
      }
    }
    for (const placement of buildings) {
      const point = { x: Math.round(placement.x * 1_000), z: Math.round(placement.z * 1_000) };
      expect(isOnRoad(point, 3_000), `${placement.id} clear of roads`).toBe(false);
      for (const chest of MAP_CHESTS) {
        expect(
          Math.hypot(chest.position.x - point.x, chest.position.z - point.z),
          `${placement.id} clear of ${chest.id}`,
        ).toBeGreaterThan(3_400);
      }
      for (const spawn of MAP_SPAWN_POINTS) {
        expect(
          Math.hypot(spawn.position.x - point.x, spawn.position.z - point.z),
          `${placement.id} clear of a spawn pad`,
        ).toBeGreaterThan(4_600);
      }
    }
    for (let first = 0; first < buildings.length; first += 1) {
      for (let second = first + 1; second < buildings.length; second += 1) {
        const a = buildings[first];
        const b = buildings[second];
        if (!a || !b) {
          continue;
        }
        const distance = Math.hypot(a.x - b.x, a.z - b.z);
        // Spacing is sampled per district, so only same-district pairs are
        // guaranteed to be 26 m apart.
        if (regionAt(a.x, a.z).id === regionAt(b.x, b.z).id) {
          expect(distance, `${a.id} vs ${b.id}`).toBeGreaterThan(25);
        }
      }
    }
  });

  it('scales each building uniformly and reuses one instanced batch per model', () => {
    const buildings = createMapAssetPlacementPlan(1).filter(
      (placement) => placement.kind === 'structure',
    );
    for (const placement of buildings) {
      const entry = MAP_ASSET_CATALOG.find((candidate) => candidate.id === placement.assetId);
      const ratio = placement.scale * (entry?.targetHeight ?? 1);
      expect(ratio, `${placement.id} scale band`).toBeGreaterThan(
        placement.worldHeight * 0.9 - 0.001,
      );
      expect(ratio).toBeLessThan(placement.worldHeight * 1.1 + 0.001);
    }
    const assetIds = new Set(buildings.map((placement) => placement.assetId));
    expect(assetIds.size).toBe(buildingCatalog.length);
  });
});
