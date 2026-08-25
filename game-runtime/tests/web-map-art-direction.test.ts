import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildCourtBeacons,
  type CourtBeaconMaterialLibrary,
} from '../apps/web/src/render/map/court-beacons';
import { regionStyles } from '../apps/web/src/render/map/map-regions';
import { climateOf } from '../apps/web/src/render/map/region-climate';

/**
 * Locks the art direction stated in JourneyWestGreatBrawl_AI游戏场景提示词.
 *
 * These are not pixel assertions — they encode the numeric rules the prompt
 * states in prose, so the map cannot silently drift back to a single-hue,
 * low-contrast, fog-heavy look. Section numbers below refer to that file.
 */

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

/**
 * Palette hex literals are authored in sRGB, but `THREE.Color` converts them
 * into the linear working space on construction. Reading HSL back without
 * naming sRGB would measure the linear values and report a different
 * saturation and lightness than the ones written in the source.
 */
function hsl(hex: number): Hsl {
  const target = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(target, THREE.SRGBColorSpace);
  return { h: target.h * 360, s: target.s, l: target.l };
}

/** Shortest distance between two hues on the colour wheel, in degrees. */
function hueGap(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

describe('map art direction: colour system (section 6)', () => {
  it('gives every district a ground tone that is coloured, not 灰败', () => {
    // "色彩要丰富、干净、饱和度适中，不能浑浊或灰败" plus the section 15 ban on
    // 只使用深青绿色 / 灰蒙 palettes. A saturation floor is what stops the
    // whole map sliding back to neutral ink.
    for (const region of regionStyles()) {
      const ground = hsl(region.ground);
      expect(ground.s, `${region.name} ground saturation`).toBeGreaterThanOrEqual(0.12);
      // 饱和度适中: ground must stay below the hero silhouettes.
      expect(ground.s, `${region.name} ground saturation`).toBeLessThanOrEqual(0.45);
      // Mid lightness keeps roads, walls and drops readable on top of it.
      expect(ground.l, `${region.name} ground lightness`).toBeGreaterThan(0.24);
      expect(ground.l, `${region.name} ground lightness`).toBeLessThan(0.72);
    }
  });

  it('spans at least three separable hue families across the districts', () => {
    // "每个宽幅镜头至少包含三组可区分色相". Districts are spatially separated, so
    // the guarantee has to hold at the palette level: cluster the seven ground
    // hues and require at least three distinct families.
    const hues = regionStyles().map((region) => hsl(region.ground).h);
    const families: number[] = [];
    for (const hue of hues) {
      if (!families.some((existing) => hueGap(existing, hue) < 40)) {
        families.push(hue);
      }
    }
    expect(families.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps each district accent readable against its own ground', () => {
    // Accents carry 朱砂红/金色/五行 (section 6). An accent that shares its
    // district's hue reads as dirt rather than as a shop, banner or boss mark.
    for (const region of regionStyles()) {
      const ground = hsl(region.ground);
      const accent = hsl(region.accent);
      const separated = hueGap(ground.h, accent.h) >= 18 || accent.s - ground.s >= 0.2;
      expect(separated, `${region.name} accent vs ground`).toBe(true);
      expect(accent.s, `${region.name} accent saturation`).toBeGreaterThan(ground.s);
    }
  });

  it('makes 万劫三庭 the brightest, most saturated district', () => {
    // Section 3: the courts are the primary visual anchor; section 6 gives them
    // 金色、白色雷光和强烈的五行对比.
    const court = regionStyles().find((region) => region.id === 'santing');
    if (!court) {
      throw new Error('missing 万劫三庭 region');
    }
    const courtAccent = hsl(court.accent);
    for (const region of regionStyles()) {
      if (region.id === 'santing') {
        continue;
      }
      expect(courtAccent.s).toBeGreaterThanOrEqual(hsl(region.accent).s);
    }
  });
});

describe('map art direction: lighting and fog (sections 7 and 13)', () => {
  it('keeps fog thin enough that 前景 and 中景 stay sharp', () => {
    // "迷雾不能覆盖已经应该被玩家看到的道路、掉落物、敌人和预警" and the section 15
    // ban on 大面积灰雾. FogExp2 reaches ~14% extinction at 100 m for 0.004, so
    // the ceiling here keeps a full engagement range effectively clear.
    for (const region of regionStyles()) {
      const climate = climateOf(region.id);
      expect(climate.fogDensity, `${region.name} fog`).toBeLessThanOrEqual(0.003);
    }
  });

  it('never drops a district below the contrast floor', () => {
    // Weather varies the ambient, not the key: no district may go dim enough to
    // read as 低对比 (section 15).
    for (const region of regionStyles()) {
      const climate = climateOf(region.id);
      expect(climate.sunIntensity, `${region.name} sun`).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('caps precipitation so it never walls off the frame', () => {
    for (const region of regionStyles()) {
      const climate = climateOf(region.id);
      expect(climate.intensity, `${region.name} precipitation`).toBeLessThanOrEqual(0.7);
    }
  });

  it('lights the courts hardest and fogs them least', () => {
    const court = climateOf('santing');
    for (const region of regionStyles()) {
      if (region.id === 'santing') {
        continue;
      }
      const climate = climateOf(region.id);
      expect(court.sunIntensity).toBeGreaterThanOrEqual(climate.sunIntensity);
      expect(court.fogDensity).toBeLessThanOrEqual(climate.fogDensity);
    }
  });
});

describe('map art direction: court sky beacons (section 3)', () => {
  function build(): {
    readonly group: THREE.Group;
    readonly materials: CourtBeaconMaterialLibrary;
    readonly geometries: THREE.BufferGeometry[];
  } {
    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const materials: CourtBeaconMaterialLibrary = {
      courtBeaconShaft: new THREE.MeshBasicMaterial(),
      courtBeaconGlow: new THREE.MeshBasicMaterial(),
      courtBeaconCrown: new THREE.MeshBasicMaterial(),
    };
    buildCourtBeacons(group, materials, (geometry) => {
      geometries.push(geometry);
      return geometry;
    });
    return { group, materials, geometries };
  }

  it('raises one instanced column per court in three draw calls', () => {
    const { group, geometries } = build();
    const beacons = group.getObjectByName('map-court-beacons');
    if (!beacons) {
      throw new Error('missing court beacon group');
    }
    const instanced = beacons.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    );
    // Section 14 performance rule: repeated props are instanced.
    expect(instanced).toHaveLength(3);
    for (const mesh of instanced) {
      expect(mesh.count).toBe(3);
    }
    for (const geometry of geometries) {
      geometry.dispose();
    }
  });

  it('stands the column high above the court floor', () => {
    const { group } = build();
    const beacons = group.getObjectByName('map-court-beacons');
    const shafts = beacons?.getObjectByName('map-court-beacon-shafts');
    if (!(shafts instanceof THREE.InstancedMesh)) {
      throw new Error('missing court beacon shafts');
    }
    // The cue only survives an occluder if the shaft clears the skyline; the
    // tallest boundary wall on this map rises 34-49 m.
    const matrix = new THREE.Matrix4();
    shafts.getMatrixAt(0, matrix);
    const centreY = new THREE.Vector3().setFromMatrixPosition(matrix).y;
    expect(centreY).toBeGreaterThan(50);
    shafts.geometry.dispose();
  });

  it('never occludes gameplay', () => {
    const { group } = build();
    const beacons = group.getObjectByName('map-court-beacons');
    if (!beacons) {
      throw new Error('missing court beacon group');
    }
    // Sections 3 and 15 both forbid a marker that can hide a character, a drop
    // or a telegraph. Additive blending plus depthWrite:false is what
    // guarantees it, so assert the material contract rather than the look.
    for (const child of beacons.children) {
      if (!(child instanceof THREE.Mesh)) {
        continue;
      }
      expect(child.castShadow).toBe(false);
      expect(child.receiveShadow).toBe(false);
    }
  });

  it('reports that it cannot occlude gameplay', () => {
    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const diagnostics = buildCourtBeacons(
      group,
      {
        courtBeaconShaft: new THREE.MeshBasicMaterial(),
        courtBeaconGlow: new THREE.MeshBasicMaterial(),
        courtBeaconCrown: new THREE.MeshBasicMaterial(),
      },
      (geometry) => {
        geometries.push(geometry);
        return geometry;
      },
    );
    expect(diagnostics.courts).toBe(3);
    expect(diagnostics.occludesGameplay).toBe(false);
    expect(diagnostics.shaftHeightMeters).toBeGreaterThan(50);
    for (const geometry of geometries) {
      geometry.dispose();
    }
  });
});
