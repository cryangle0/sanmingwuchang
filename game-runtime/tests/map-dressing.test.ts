import { MAP_CHOKES, MAP_COURTS, MAP_NESTS, MAP_WALL_PIECES } from '@jwgb/content';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildRegionDressing,
  type DressingMaterialLibrary,
  type RegionDressingSummary,
} from '../apps/web/src/render/map/dressing/region-dressing';
import { convexContains, isOnRoad, ringContains } from '../apps/web/src/render/map/map-sampling';
import { MAP_BOUNDARY } from '../packages/content/src';

interface BuiltDressing {
  readonly parent: THREE.Group;
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: DressingMaterialLibrary;
  readonly summary: RegionDressingSummary;
}

function build(seed = 0xdc80a9ec): BuiltDressing {
  const parent = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: DressingMaterialLibrary = {
    wallTrim: new THREE.MeshStandardMaterial(),
    timber: new THREE.MeshStandardMaterial(),
    lacquer: new THREE.MeshStandardMaterial(),
    roofTile: new THREE.MeshStandardMaterial(),
    courtInlay: new THREE.MeshStandardMaterial(),
    rock: new THREE.MeshStandardMaterial(),
    bone: new THREE.MeshStandardMaterial(),
    charred: new THREE.MeshStandardMaterial(),
    straw: new THREE.MeshStandardMaterial(),
    cloth: new THREE.MeshStandardMaterial(),
    web: new THREE.MeshBasicMaterial(),
    soil: new THREE.MeshStandardMaterial(),
    clay: new THREE.MeshStandardMaterial(),
    iron: new THREE.MeshStandardMaterial(),
  };
  const summary = buildRegionDressing(
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

function dispose(built: BuiltDressing): void {
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
  const root = parent.getObjectByName('map-dressing');
  if (!(root instanceof THREE.Group)) {
    throw new Error('missing map-dressing group');
  }
  return root.children.map((child) => {
    if (!(child instanceof THREE.Mesh)) {
      throw new Error('dressing layer contains a non-mesh child');
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
    return { name: child.name, vertices: position.count, checksum };
  });
}

describe('district dressing', () => {
  it('dresses every district, choke and nest within the draw budget', () => {
    const built = build();

    for (const [region, clusters] of Object.entries(built.summary.clustersByRegion)) {
      expect(clusters, `${region} clusters`).toBeGreaterThanOrEqual(14);
    }
    expect(built.summary.chokeGates).toBe(MAP_CHOKES.length);
    expect(built.summary.courtArrays).toBe(MAP_COURTS.length);
    const expectedPoles = MAP_COURTS.reduce((sum, court) => sum + court.gates.length, 0) * 2;
    expect(built.summary.courtBannerPoles).toBe(expectedPoles);

    const expectedNests = { MEL: 0, RNG: 0, FLY: 0 };
    for (const nest of MAP_NESTS) {
      expectedNests[nest.kind as 'MEL' | 'RNG' | 'FLY'] += 1;
    }
    expect(built.summary.nestMarkers).toEqual(expectedNests);
    expect(
      built.summary.nestMarkers.MEL + built.summary.nestMarkers.RNG + built.summary.nestMarkers.FLY,
    ).toBe(MAP_NESTS.length);

    expect(built.summary.drawCalls).toBeLessThanOrEqual(14);
    const root = built.parent.getObjectByName('map-dressing');
    expect(root).toBeInstanceOf(THREE.Group);
    expect(root?.children).toHaveLength(built.summary.drawCalls);

    let totalVertices = 0;
    for (const geometry of built.geometries) {
      expect(geometry.boundingBox).not.toBeNull();
      expect(geometry.boundingSphere).not.toBeNull();
      const position = geometry.getAttribute('position');
      expect(position.count).toBeGreaterThan(0);
      expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
      totalVertices += position.count;
    }
    expect(totalVertices).toBeLessThanOrEqual(260_000);

    dispose(built);
  });

  it('keeps every sampled cluster on legal open ground', () => {
    const built = build();
    expect(built.summary.clusterSites.length).toBeGreaterThan(80);
    for (const site of built.summary.clusterSites) {
      const point = { x: Math.round(site.x * 1_000), z: Math.round(site.z * 1_000) };
      expect(ringContains(MAP_BOUNDARY, point), 'inside boundary').toBe(true);
      for (const piece of MAP_WALL_PIECES) {
        expect(convexContains(piece.vertices, point), `outside wall ${piece.pieceId}`).toBe(false);
      }
      for (const court of MAP_COURTS) {
        expect(convexContains(court.hexVertices, point), `outside court ${court.id}`).toBe(false);
      }
      expect(isOnRoad(point, 2_000), 'clear of roads').toBe(false);
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
