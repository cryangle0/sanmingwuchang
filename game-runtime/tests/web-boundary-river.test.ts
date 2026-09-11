import { MAP_BOUNDARY, MAP_SPAWN_POINTS } from '@jwgb/content';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BANK_WIDTH_METERS,
  buildBoundaryRiver,
  FALL_DROP_METERS,
  RIVER_WIDTH_METERS,
  sampleRim,
} from '../apps/web/src/render/map/boundary-river';
import { ringContains } from '../apps/web/src/render/map/map-sampling';
import { buildOcean } from '../apps/web/src/render/map/ocean';
import { isInSpawnPond, spawnPonds } from '../apps/web/src/render/map/spawn-ponds';
import { createFlowWaterMaterial } from '../apps/web/src/render/shading/flow-water';
import { windTimeUniform } from '../apps/web/src/render/shading/wind';

const MM = 1_000;

describe('boundary river and waterfall', () => {
  it('keeps the whole river outside the walkable boundary', () => {
    expect(BANK_WIDTH_METERS).toBeGreaterThan(1);
    expect(RIVER_WIDTH_METERS).toBeGreaterThan(3);
    expect(FALL_DROP_METERS).toBeGreaterThan(20);
    for (const sample of sampleRim()) {
      const inside = {
        x: Math.round((sample.x + sample.outX * BANK_WIDTH_METERS) * MM),
        z: Math.round((sample.z + sample.outZ * BANK_WIDTH_METERS) * MM),
      };
      expect(ringContains(MAP_BOUNDARY, inside)).toBe(false);
    }
  });

  it('builds grass bank, rock faces, river sheet and both mists', () => {
    const group = new THREE.Group();
    const materials = {
      boundaryCliffFace: new THREE.MeshStandardMaterial(),
      riverBank: new THREE.MeshStandardMaterial(),
    } as unknown as Parameters<typeof buildBoundaryRiver>[1];
    const tracked: THREE.BufferGeometry[] = [];
    buildBoundaryRiver(group, materials, (geometry) => {
      tracked.push(geometry);
      return geometry;
    });
    const names = group.children.map((child) => child.name);
    expect(names).toEqual([
      // Shore apron and its boulder/driftwood scatter soften the grass-to-water
      // seam; the rest is the original bank, cliff, river and mists.
      'boundary-shore-apron',
      'boundary-shore-scatter',
      'boundary-river-bank-top',
      'boundary-river-bank',
      'boundary-river-cliff',
      'boundary-river',
      'boundary-river-mist',
      'boundary-river-plunge-mist',
    ]);
    const bankTop = group.getObjectByName('boundary-river-bank-top') as THREE.Mesh;
    expect(bankTop.material).toBe(materials.riverBank);
    expect(bankTop.geometry.getAttribute('color')).toBeDefined();
    const river = group.getObjectByName('boundary-river') as THREE.Mesh;
    expect(river.geometry.getAttribute('aFlow')).toBeDefined();
    expect(river.geometry.getAttribute('aKind')).toBeDefined();
    const material = river.material as THREE.ShaderMaterial;
    expect(material.uniforms.uTime).toBe(windTimeUniform());
    expect(material.transparent).toBe(true);
    for (const geometry of tracked) {
      geometry.dispose();
    }
  });

  it('shares the wind clock so the water animates without a new hook', () => {
    const material = createFlowWaterMaterial();
    expect(material.uniforms.uTime).toBe(windTimeUniform());
    expect(material.fragmentShader).toContain('uTime');
    material.dispose();
  });
});

describe('sea beyond the falls', () => {
  it('builds a swell sheet, wet apron and coastal rocks', () => {
    const group = new THREE.Group();
    const tracked: THREE.BufferGeometry[] = [];
    const mesh = buildOcean(group, (geometry) => {
      tracked.push(geometry);
      return geometry;
    });
    expect(mesh?.name).toBe('beyond-ocean');
    expect(group.getObjectByName('beyond-ocean-apron')).toBeDefined();
    expect(group.getObjectByName('beyond-ocean-skerries')).toBeDefined();
    // The simulated cone islands were removed: they read as mountains floating
    // in the water rather than open sea. Coastal rocks stay.
    expect(group.getObjectByName('beyond-horizon-isles')).toBeUndefined();
    expect(group.getObjectByName('beyond-ocean-skerries')).toBeDefined();
    const sea = mesh as THREE.Mesh;
    expect(sea.geometry.getAttribute('aSea')).toBeDefined();
    for (const geometry of tracked) {
      geometry.dispose();
    }
  });
});

describe('spawn ponds', () => {
  it('lays a pool beside every spawn, inside the map and off the spawn pad', () => {
    const ponds = spawnPonds();
    expect(ponds).toHaveLength(MAP_SPAWN_POINTS.length);
    for (const pond of ponds) {
      const spawn = MAP_SPAWN_POINTS.find((record) => record.id === pond.spawnId);
      expect(spawn).toBeDefined();
      if (!spawn) {
        continue;
      }
      const distance = Math.hypot(
        pond.xMeters - spawn.position.x / MM,
        pond.zMeters - spawn.position.z / MM,
      );
      expect(distance).toBeGreaterThan(pond.radiusMeters + 1.5);
      expect(distance).toBeLessThan(12);
      expect(
        ringContains(MAP_BOUNDARY, {
          x: Math.round(pond.xMeters * MM),
          z: Math.round(pond.zMeters * MM),
        }),
      ).toBe(true);
      expect(
        isInSpawnPond({ x: Math.round(pond.xMeters * MM), z: Math.round(pond.zMeters * MM) }),
      ).toBe(true);
      expect(isInSpawnPond(spawn.position)).toBe(false);
    }
  });
});
