import {
  AUTHORITATIVE_MAP_SHOPS,
  MAP_COURTS,
  MAP_DRAGONS,
  MAP_ELITES,
  MAP_PIGS,
} from '@jwgb/content';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildMapLandmarks,
  type LandmarkBuildSummary,
  type LandmarkMaterialLibrary,
} from '../apps/web/src/render/map/landmarks';

interface BuiltLandmarks {
  readonly parent: THREE.Group;
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: LandmarkMaterialLibrary;
  readonly summary: LandmarkBuildSummary;
}

function build(seed = 0xdc80a9ec): BuiltLandmarks {
  const parent = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: LandmarkMaterialLibrary = {
    courtInlay: new THREE.MeshStandardMaterial(),
    dragonPalace: new THREE.MeshStandardMaterial(),
    dragonWater: new THREE.MeshPhysicalMaterial(),
    eliteArena: new THREE.MeshStandardMaterial(),
    lacquer: new THREE.MeshStandardMaterial(),
    pigDen: new THREE.MeshStandardMaterial(),
    rock: new THREE.MeshStandardMaterial(),
    roofTile: new THREE.MeshStandardMaterial(),
    shopAnchor: new THREE.MeshStandardMaterial(),
    timber: new THREE.MeshStandardMaterial(),
    wallTrim: new THREE.MeshStandardMaterial(),
  };
  const summary = buildMapLandmarks(
    parent,
    materials,
    <T extends THREE.BufferGeometry>(geometry: T): T => {
      geometries.push(geometry);
      return geometry;
    },
    seed,
  );
  return { parent, geometries, materials, summary };
}

function dispose(built: BuiltLandmarks): void {
  for (const geometry of built.geometries) {
    geometry.dispose();
  }
  for (const material of Object.values(built.materials)) {
    material.dispose();
  }
}

function signature(parent: THREE.Group): readonly {
  readonly name: string;
  readonly vertices: number;
  readonly checksum: number;
}[] {
  const root = parent.getObjectByName('map-landmarks');
  if (!(root instanceof THREE.Group)) {
    throw new Error('missing map-landmarks group');
  }
  return root.children.map((child) => {
    if (!(child instanceof THREE.Mesh)) {
      throw new Error('landmark layer contains a non-mesh child');
    }
    const position = child.geometry.getAttribute('position');
    let checksum = 0;
    for (let index = 0; index < position.array.length; index += 1) {
      const value = position.array[index] ?? Number.NaN;
      if (!Number.isFinite(value)) {
        throw new Error(`${child.name} contains a non-finite vertex`);
      }
      checksum += Math.round(value * 1_000) * ((index % 17) + 1);
    }
    return {
      name: child.name,
      vertices: position.count,
      checksum,
    };
  });
}

describe('map landmark dressing', () => {
  it('covers every authoritative landmark anchor with a bounded merged layer', () => {
    const built = build();
    const expectedCourtGates = MAP_COURTS.reduce((sum, court) => sum + court.gates.length, 0);
    const expectedCourtShops = MAP_COURTS.reduce((sum, court) => sum + court.finalShops.length, 0);
    const expectedRevivePads = MAP_COURTS.reduce(
      (sum, court) => sum + court.revivePoints.length,
      0,
    );
    const expectedRockMarkers = MAP_COURTS.reduce((sum, court) => sum + court.rockPoints.length, 0);

    expect(built.summary).toEqual({
      shopMarkets: new Set(AUTHORITATIVE_MAP_SHOPS.map((shop) => shop.zone)).size,
      shopStalls: AUTHORITATIVE_MAP_SHOPS.length,
      pigDens: MAP_PIGS.length,
      dragonPalaces: MAP_DRAGONS.length,
      dragonApproachGates: MAP_DRAGONS.length * 3,
      eliteArenas: MAP_ELITES.length,
      courtGates: expectedCourtGates,
      courtShopPavilions: expectedCourtShops,
      courtRevivePads: expectedRevivePads,
      courtRockMarkers: expectedRockMarkers,
      drawCalls: 11,
    });

    const root = built.parent.getObjectByName('map-landmarks');
    expect(root).toBeInstanceOf(THREE.Group);
    expect(root?.children).toHaveLength(built.summary.drawCalls);
    expect(built.geometries).toHaveLength(built.summary.drawCalls);
    for (const geometry of built.geometries) {
      expect(geometry.boundingBox).not.toBeNull();
      expect(geometry.boundingSphere).not.toBeNull();
      expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    }
    dispose(built);
  });

  it('rebuilds identical geometry for the same compiled-map seed', () => {
    const first = build();
    const second = build();
    expect(signature(first.parent)).toEqual(signature(second.parent));
    dispose(first);
    dispose(second);
  });
});
