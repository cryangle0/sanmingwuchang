import {
  MAP_CHESTS,
  MAP_COURTS,
  MAP_GEOMETRY_HASH,
  MAP_HIGHLANDS,
  MAP_ROCKS,
  MAP_SPAWN_POINTS,
  MAP_WALL_PIECES,
  type MapPointMm,
} from '@jwgb/content';
import * as THREE from 'three';
import { buildBeyond } from './beyond';
import { buildRegionDressing } from './dressing/region-dressing';
import { buildFlora } from './flora';
import type { FloraModelLayerDiagnostics } from './flora-models';
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
import { buildRoadRibbons } from './roads';
import { buildScatter } from './scatter';

const MM = 1_000;

export interface MapEnvironment {
  readonly group: THREE.Group;
  setGraphicsTier(tier: 'balanced' | 'reduced'): void;
  updateOcclusion(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void;
  getOcclusionDiagnostics(): MapOcclusionDiagnostics;
  getFloraModelDiagnostics(): FloraModelLayerDiagnostics;
  getMapAssetDiagnostics(): MapAssetLayerDiagnostics;
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
  const materials = createMapMaterials(surfaceSeed);
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
  const roads = layer('map-roads');
  const walls = layer('map-walls');
  const highlands = layer('map-highlands');
  const courts = layer('map-courts');
  const spawnPads = layer('map-spawn-pads');
  const props = layer('map-props');
  const landmarks = layer('map-landmarks-layer');
  const dressing = layer('map-dressing-layer');
  const flora = layer('map-flora');
  const scatter = layer('map-scatter');
  const beyond = layer('map-beyond');
  const importedAssets = layer('map-imported-assets-host');

  buildGround(
    (geometry, material, options) => addMesh(ground, geometry, material, options),
    materials.ground,
  );
  buildRoadRibbons(
    (geometry, material, options) => addMesh(roads, geometry, material, options),
    materials,
  );
  buildWalls(
    (geometry, material, options) => addMesh(walls, geometry, material, options),
    materials,
  );
  buildHighlands(
    highlands,
    (geometry, material, options) => addMesh(highlands, geometry, material, options),
    materials,
    track,
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
  const floraOcclusion = buildFlora(flora, materials, track, surfaceSeed, renderer, graphicsTier);
  buildScatter(scatter, materials, track, surfaceSeed);
  buildBeyond(beyond, materials, track, surfaceSeed);
  const proceduralRockMarkers = props.getObjectByName('map-procedural-rock-markers');
  const importedAssetLayer = buildMapAssetLayer(importedAssets, {
    renderer,
    graphicsTier,
    seed: surfaceSeed,
    ...(proceduralRockMarkers ? { fallbackRockGroup: proceduralRockMarkers } : {}),
  });
  const occlusion = new MapOcclusionController(roofBatches);

  return {
    group,
    setGraphicsTier(tier): void {
      const reduced = tier === 'reduced';
      scatter.visible = !reduced;
      floraOcclusion.setEnabled(!reduced);
      floraOcclusion.setGraphicsTier(tier);
      importedAssetLayer.setGraphicsTier(tier);
    },
    updateOcclusion(cameraPosition, focusPosition): void {
      occlusion.update(cameraPosition, focusPosition);
      floraOcclusion.update(cameraPosition, focusPosition);
      importedAssetLayer.update(cameraPosition, focusPosition);
    },
    getOcclusionDiagnostics(): MapOcclusionDiagnostics {
      const roofDiagnostics = occlusion.diagnostics();
      const floraDiagnostics = floraOcclusion.diagnostics();
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
    getFloraModelDiagnostics(): FloraModelLayerDiagnostics {
      return floraOcclusion.modelDiagnostics();
    },
    getMapAssetDiagnostics(): MapAssetLayerDiagnostics {
      return importedAssetLayer.diagnostics();
    },
    dispose(): void {
      occlusion.dispose();
      floraOcclusion.dispose();
      importedAssetLayer.dispose();
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

function buildWalls(addMesh: AddMesh, materials: ReturnType<typeof createMapMaterials>): void {
  const cliffs = new PrismGeometryAccumulator();
  const vaultCaps = new PrismGeometryAccumulator();
  const vaultSides = new PrismGeometryAccumulator();
  for (const piece of MAP_WALL_PIECES) {
    const heightMeters = piece.heightMm / MM;
    if (piece.wallClass === 'BOUND') {
      cliffs.addConvexPrism(piece.vertices, 0, heightMeters);
    } else {
      // Large VAULT polygons are terrain-scale collision volumes rather than
      // narrow walls. A quiet rock cap keeps the top from reading as a giant
      // tiled platform, while the darker masonry remains on the vertical
      // faces.
      vaultCaps.addConvexCap(piece.vertices, heightMeters);
      vaultSides.addSides(piece.vertices, 0, heightMeters);
    }
  }
  if (!cliffs.isEmpty) {
    addMesh(cliffs.build(), materials.boundaryCliff, { castShadow: true });
  }
  if (!vaultCaps.isEmpty) {
    addMesh(vaultCaps.build(), materials.boundaryCliff, { castShadow: true });
  }
  if (!vaultSides.isEmpty) {
    addMesh(vaultSides.build(), materials.vaultWall, { castShadow: true });
  }
}

function buildHighlands(
  group: THREE.Group,
  addMesh: AddMesh,
  materials: ReturnType<typeof createMapMaterials>,
  track: Track,
): void {
  const plateauTops = new PrismGeometryAccumulator();
  const plateauSides = new PrismGeometryAccumulator();
  for (const highland of MAP_HIGHLANDS) {
    plateauTops.addTriangulatedCap(
      highland.vertices,
      highland.triangles,
      highland.topHeightMm / MM,
    );
    plateauSides.addSides(highland.vertices, 0, highland.topHeightMm / MM);
  }
  addMesh(plateauTops.build(), materials.highlandTop, { castShadow: true });
  addMesh(plateauSides.build(), materials.highland, { castShadow: true });

  const rampGeometry = track(new THREE.BoxGeometry(1, 0.4, 6));
  for (const highland of MAP_HIGHLANDS) {
    const centroid = ringCentroidMeters(highland.vertices);
    for (const ramp of highland.ramps) {
      const ax = ramp.a.x / MM;
      const az = ramp.a.z / MM;
      const bx = ramp.b.x / MM;
      const bz = ramp.b.z / MM;
      // The endpoint nearer the plateau centroid is the top of the ramp.
      const aIsTop =
        (ax - centroid.x) ** 2 + (az - centroid.z) ** 2 <
        (bx - centroid.x) ** 2 + (bz - centroid.z) ** 2;
      const length = Math.hypot(bx - ax, bz - az);
      const topMeters = highland.topHeightMm / MM;
      const mesh = new THREE.Mesh(rampGeometry, materials.ramp);
      mesh.scale.x = Math.max(1, Math.hypot(length, topMeters));
      mesh.position.set((ax + bx) / 2, topMeters / 2, (az + bz) / 2);
      mesh.rotation.y = Math.atan2(-(bz - az), bx - ax);
      mesh.rotation.z = (aIsTop ? -1 : 1) * Math.atan2(topMeters, length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

function ringCentroidMeters(ring: readonly MapPointMm[]): { x: number; z: number } {
  let sumX = 0;
  let sumZ = 0;
  for (const point of ring) {
    sumX += point.x;
    sumZ += point.z;
  }
  return { x: sumX / ring.length / MM, z: sumZ / ring.length / MM };
}

function buildCourts(
  group: THREE.Group,
  addMesh: AddMesh,
  materials: ReturnType<typeof createMapMaterials>,
  track: Track,
): void {
  const floors = new PrismGeometryAccumulator();
  for (const court of MAP_COURTS) {
    floors.addConvexPrism(court.hexVertices, 0, 0.28);
  }
  addMesh(floors.build(), materials.courtFloor, { castShadow: true });

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
      inlayMatrix.setPosition(court.center.x / MM, 0.3, court.center.z / MM);
      inlays.setMatrixAt(inlayIndex, inlayMatrix);
      inlayIndex += 1;
    }
  }
  inlays.instanceMatrix.needsUpdate = true;
  group.add(inlays);

  for (const court of MAP_COURTS) {
    const points = court.hexVertices.map(
      (vertex) => new THREE.Vector3(vertex.x / MM, 0.42, vertex.z / MM),
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

  const rockGeometry = track(new THREE.CylinderGeometry(1, 1.15, 1.7, 7));
  const rocks = new THREE.InstancedMesh(rockGeometry, materials.rock, MAP_ROCKS.length);
  rocks.name = 'map-procedural-rock-markers';
  rocks.castShadow = true;
  const rockMatrix = new THREE.Matrix4();
  MAP_ROCKS.forEach((record, index) => {
    const radius = record.radiusMm / MM;
    rockMatrix.makeScale(radius, 1, radius);
    rockMatrix.setPosition(record.position.x / MM, 0.85, record.position.z / MM);
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
    matrix.makeTranslation(position.x / MM, yMeters, position.z / MM);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}
