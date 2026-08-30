import {
  MAP_CHESTS,
  MAP_COURTS,
  MAP_GEOMETRY_HASH,
  MAP_HIGHLANDS,
  MAP_ROCKS,
  MAP_SPAWN_POINTS,
  type MapPointMm,
  terrainHeightMeters,
} from '@jwgb/content';
import * as THREE from 'three';
import { buildBeyond } from './beyond';
import { buildBoundaryCliffs } from './boundary-cliffs';
import { buildRegionDressing } from './dressing/region-dressing';
import { buildGlobalSceneLayer, type GlobalSceneLayerDiagnostics } from './global-scene-layer';
import {
  buildGrassworksVegetationLayer,
  type GrassworksVegetationDiagnostics,
} from './grassworks-vegetation';
import { buildGroundGeometry } from './ground';
import { buildMapLandmarks } from './landmarks';
import { buildMapAssetLayer, type MapAssetLayerDiagnostics } from './map-asset-layer';
import {
  MapOcclusionController,
  type MapOcclusionDiagnostics,
  type MapRoofOcclusionBatch,
} from './map-occlusion';
import { createMapMaterials } from './map-palette';
import { PrismGeometryAccumulator } from './prism-geometry';
import { buildWaterGeometry } from './water';

const MM = 1_000;

export interface MapEnvironment {
  readonly group: THREE.Group;
  setGraphicsTier(tier: 'balanced' | 'reduced'): void;
  updateOcclusion(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void;
  getOcclusionDiagnostics(): MapOcclusionDiagnostics;
  getFloraModelDiagnostics(): GrassworksVegetationDiagnostics;
  getMapAssetDiagnostics(): MapAssetLayerDiagnostics;
  getGlobalSceneDiagnostics(): GlobalSceneLayerDiagnostics;
  dispose(): void;
}

/**
 * Builds the whole 百眼迷城 static environment as one Group.
 *
 * Everything derives from the compiled map geometry package, so the visual
 * world and the authoritative collision field share a single source of
 * truth. Meshes are merged per material; repeated props use InstancedMesh.
 */
export function buildMapEnvironment(
  renderer: THREE.WebGLRenderer | null = null,
  graphicsTier: 'balanced' | 'reduced' = 'balanced',
): MapEnvironment {
  // Same derivation as the decorative scatter: textures stay deterministic
  // per compiled map, and any geometry change repaints the world with it.
  const surfaceSeed = Number.parseInt(MAP_GEOMETRY_HASH.slice(0, 8), 16) >>> 0 || 1;
  const materials = createMapMaterials(surfaceSeed, graphicsTier);
  const group = new THREE.Group();
  group.name = 'map-environment';
  const geometries: THREE.BufferGeometry[] = [];
  const roofBatches: MapRoofOcclusionBatch[] = [];

  const track = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.push(geometry);
    return geometry;
  };
  const addMesh = (
    parent: THREE.Group,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    options: { castShadow?: boolean; receiveShadow?: boolean } = {},
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(track(geometry), material);
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = options.receiveShadow ?? true;
    parent.add(mesh);
    return mesh;
  };

  const layer = (name: string): THREE.Group => {
    const child = new THREE.Group();
    child.name = name;
    group.add(child);
    return child;
  };
  const ground = layer('map-ground');
  const highlands = layer('map-highlands');
  const courts = layer('map-courts');
  const spawnPads = layer('map-spawn-pads');
  const props = layer('map-props');
  const landmarks = layer('map-landmarks-layer');
  const dressing = layer('map-dressing-layer');
  const vegetation = layer('map-grassworks-vegetation-host');
  const beyond = layer('map-beyond');
  const importedAssets = layer('map-imported-assets-host');
  const globalScenes = layer('map-global-scenes-host');

  buildGround(
    (geometry, material, options) => addMesh(ground, geometry, material, options),
    materials.ground,
  );
  buildWater(materials.valleyWater, (geometry, material, options) =>
    addMesh(ground, geometry, material, options),
  );
  buildHighlands(
    (geometry, material, options) => addMesh(highlands, geometry, material, options),
    materials,
  );
  buildCourts(
    courts,
    (geometry, material, options) => addMesh(courts, geometry, material, options),
    materials,
    track,
  );
  buildSpawnPads(spawnPads, materials, track);
  buildProps(props, materials, track);
  buildMapLandmarks(landmarks, materials, track, surfaceSeed, (batch) => {
    roofBatches.push(batch);
  });
  buildRegionDressing(dressing, materials, track, surfaceSeed, (batch) => {
    roofBatches.push(batch);
  });
  const grassworksVegetation = buildGrassworksVegetationLayer(vegetation, {
    renderer,
    graphicsTier,
    seed: surfaceSeed,
  });
  buildBoundaryCliffs(beyond, materials, track);
  buildBeyond(beyond, materials, track, surfaceSeed);
  const proceduralRockMarkers = props.getObjectByName('map-procedural-rock-markers');
  const importedAssetLayer = buildMapAssetLayer(importedAssets, {
    renderer,
    graphicsTier,
    seed: surfaceSeed,
    ...(proceduralRockMarkers ? { fallbackRockGroup: proceduralRockMarkers } : {}),
  });
  const globalSceneLayer = buildGlobalSceneLayer(globalScenes, {
    // The previous three scene packs contained their own trees and foliage.
    // Keep the diagnostics contract, but prevent that legacy vegetation from
    // loading now that Grassworks is the sole runtime vegetation source.
    renderer: null,
    graphicsTier,
    seed: surfaceSeed,
  });
  const occlusion = new MapOcclusionController(roofBatches);

  return {
    group,
    setGraphicsTier(tier): void {
      materials.setGraphicsTier(tier);
      grassworksVegetation.setGraphicsTier(tier);
      importedAssetLayer.setGraphicsTier(tier);
      globalSceneLayer.setGraphicsTier(tier);
    },
    updateOcclusion(cameraPosition, focusPosition): void {
      occlusion.update(cameraPosition, focusPosition);
      grassworksVegetation.update(cameraPosition, focusPosition);
      importedAssetLayer.update(cameraPosition, focusPosition);
      globalSceneLayer.update(cameraPosition, focusPosition);
    },
    getOcclusionDiagnostics(): MapOcclusionDiagnostics {
      const roofDiagnostics = occlusion.diagnostics();
      const floraDiagnostics = grassworksVegetation.occlusionDiagnostics();
      return {
        ...roofDiagnostics,
        active: roofDiagnostics.active || floraDiagnostics.active,
        treeOpacity: floraDiagnostics.treeOpacity,
        treeIntersections: floraDiagnostics.treeIntersections,
        treeCount: floraDiagnostics.treeCount,
        activeTreeCount: floraDiagnostics.activeTreeCount,
        fadingTreeCount: floraDiagnostics.fadingTreeCount,
        activeTreeIds: floraDiagnostics.activeTreeIds,
        occluderCount: roofDiagnostics.occluderCount + floraDiagnostics.treeCount,
        activeOccluderCount: roofDiagnostics.activeOccluderCount + floraDiagnostics.activeTreeCount,
        fadingOccluderCount: roofDiagnostics.fadingOccluderCount + floraDiagnostics.fadingTreeCount,
        activeOccluderIds: [
          ...roofDiagnostics.activeOccluderIds,
          ...floraDiagnostics.activeTreeIds,
        ].sort(),
      };
    },
    getFloraModelDiagnostics(): GrassworksVegetationDiagnostics {
      return grassworksVegetation.diagnostics();
    },
    getMapAssetDiagnostics(): MapAssetLayerDiagnostics {
      return importedAssetLayer.diagnostics();
    },
    getGlobalSceneDiagnostics(): GlobalSceneLayerDiagnostics {
      return globalSceneLayer.diagnostics();
    },
    dispose(): void {
      occlusion.dispose();
      grassworksVegetation.dispose();
      importedAssetLayer.dispose();
      globalSceneLayer.dispose();
      for (const geometry of geometries) {
        geometry.dispose();
      }
      materials.dispose();
    },
  };
}

type AddMesh = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options?: { castShadow?: boolean; receiveShadow?: boolean },
) => THREE.Mesh;
type Track = <T extends THREE.BufferGeometry>(geometry: T) => T;

function buildGround(addMesh: AddMesh, material: THREE.Material): void {
  // Grid ground with per-vertex district colours; UVs are world-space /24 to
  // match the ground texture density chosen in the palette.
  addMesh(buildGroundGeometry(), material);
}

function buildWater(material: THREE.Material, addMesh: AddMesh): void {
  const geometry = buildWaterGeometry();
  if (!geometry) {
    return;
  }
  const mesh = addMesh(geometry, material);
  mesh.name = 'map-water';
  mesh.receiveShadow = false;
}

function buildHighlands(addMesh: AddMesh, materials: ReturnType<typeof createMapMaterials>): void {
  const skirts = new PrismGeometryAccumulator();
  for (const highland of MAP_HIGHLANDS) {
    const skirt = expandRingMeters(highland.vertices, 8);
    skirts.addPlateauSkirt(skirt, highland.topHeightMm / MM, terrainHeightMeters);
  }
  if (!skirts.isEmpty) {
    addMesh(skirts.build(), materials.highland, { castShadow: true });
  }
}

function expandRingMeters(ring: readonly MapPointMm[], meters: number): MapPointMm[] {
  let cx = 0;
  let cz = 0;
  for (const point of ring) {
    cx += point.x;
    cz += point.z;
  }
  cx /= ring.length;
  cz /= ring.length;
  const extraMm = meters * MM;
  return ring.map((point) => {
    const dx = point.x - cx;
    const dz = point.z - cz;
    const length = Math.hypot(dx, dz) || 1;
    return {
      x: Math.round(point.x + (dx / length) * extraMm),
      z: Math.round(point.z + (dz / length) * extraMm),
    };
  });
}

function buildCourts(
  group: THREE.Group,
  addMesh: AddMesh,
  materials: ReturnType<typeof createMapMaterials>,
  track: Track,
): void {
  const floors = new PrismGeometryAccumulator();
  for (const court of MAP_COURTS) {
    floors.addDrapedCap(court.hexVertices, 0.05, terrainHeightMeters);
  }
  addMesh(floors.build(), materials.courtFloor, { castShadow: true, receiveShadow: true });

  // Ceremonial gold inlay: three concentric rings on each court floor.
  const inlay = track(new THREE.RingGeometry(0.975, 1, 64));
  inlay.rotateX(-Math.PI / 2);
  const inlayRadii = [4, 8.5, 13];
  const inlays = new THREE.InstancedMesh(
    inlay,
    materials.courtInlay,
    MAP_COURTS.length * inlayRadii.length,
  );
  const inlayMatrix = new THREE.Matrix4();
  let inlayIndex = 0;
  for (const court of MAP_COURTS) {
    for (const radius of inlayRadii) {
      inlayMatrix.makeScale(radius, 1, radius);
      inlayMatrix.setPosition(
        court.center.x / MM,
        terrainHeightMeters(court.center.x / MM, court.center.z / MM) + 0.07,
        court.center.z / MM,
      );
      inlays.setMatrixAt(inlayIndex, inlayMatrix);
      inlayIndex += 1;
    }
  }
  inlays.instanceMatrix.needsUpdate = true;
  group.add(inlays);

  for (const court of MAP_COURTS) {
    const courtY = terrainHeightMeters(court.center.x / MM, court.center.z / MM);
    const points = court.hexVertices.map(
      (vertex) => new THREE.Vector3(vertex.x / MM, courtY + 0.09, vertex.z / MM),
    );
    points.push(points[0] as THREE.Vector3);
    const ring = new THREE.Line(
      track(new THREE.BufferGeometry().setFromPoints(points)),
      materials.courtRing,
    );
    group.add(ring);
  }
}

function buildSpawnPads(
  group: THREE.Group,
  materials: ReturnType<typeof createMapMaterials>,
  track: Track,
): void {
  const pad = track(new THREE.CylinderGeometry(1.4, 1.6, 0.12, 20));
  const instanced = new THREE.InstancedMesh(pad, materials.spawnPad, MAP_SPAWN_POINTS.length);
  instanced.receiveShadow = true;
  placeInstances(
    instanced,
    MAP_SPAWN_POINTS.map((spawn) => spawn.position),
    0.06,
  );
  group.add(instanced);
}

function buildProps(
  group: THREE.Group,
  materials: ReturnType<typeof createMapMaterials>,
  track: Track,
): void {
  const chestGeometry = track(new THREE.BoxGeometry(0.62, 0.5, 0.46));
  const chests = new THREE.InstancedMesh(chestGeometry, materials.chest, MAP_CHESTS.length);
  chests.castShadow = true;
  placeInstances(
    chests,
    MAP_CHESTS.map((chest) => chest.position),
    0.25,
  );
  group.add(chests);

  const rockGeometry = track(new THREE.CylinderGeometry(1.08, 1.22, 0.26, 10));
  const rocks = new THREE.InstancedMesh(rockGeometry, materials.rock, MAP_ROCKS.length);
  rocks.name = 'map-procedural-rock-markers';
  rocks.castShadow = true;
  const rockMatrix = new THREE.Matrix4();
  MAP_ROCKS.forEach((record, index) => {
    const radius = record.radiusMm / MM;
    rockMatrix.makeScale(radius, 1, radius);
    rockMatrix.setPosition(
      record.position.x / MM,
      terrainHeightMeters(record.position.x / MM, record.position.z / MM) + 0.13,
      record.position.z / MM,
    );
    rocks.setMatrixAt(index, rockMatrix);
  });
  rocks.instanceMatrix.needsUpdate = true;
  group.add(rocks);
}

function placeInstances(
  mesh: THREE.InstancedMesh,
  positions: readonly MapPointMm[],
  yMeters: number,
): void {
  const matrix = new THREE.Matrix4();
  positions.forEach((position, index) => {
    matrix.makeTranslation(
      position.x / MM,
      terrainHeightMeters(position.x / MM, position.z / MM) + yMeters,
      position.z / MM,
    );
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}
