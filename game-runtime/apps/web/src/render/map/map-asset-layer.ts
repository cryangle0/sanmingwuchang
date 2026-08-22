import { MAP_HIGHLANDS, MAP_ROCKS, type MapPointMm, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { appendAssetVersion, webAssetUrl } from '../../runtime/asset-url';
import { normalizedAssetScale, WORLD_SCALE_PROFILE } from '../world-scale-profile';
import { yawToward } from './dressing/prop-kit';
import { regionAt } from './map-regions';

const MM = 1_000;
const ASSET_DIR = 'models/map-assets/';
const LANDMARK_CULL_DISTANCE = 210;
const ROCK_CULL_DISTANCE = 165;
const LANDMARK_PREFETCH_DISTANCE = LANDMARK_CULL_DISTANCE + 34;
const ROCK_PREFETCH_DISTANCE = ROCK_CULL_DISTANCE + 24;
const OCCLUSION_UPDATE_INTERVAL_FRAMES = 3;

export type MapAssetGraphicsTier = 'balanced' | 'reduced';

export interface MapAssetCatalogEntry {
  readonly id: string;
  readonly fileName: string;
  readonly kind: 'landmark' | 'rock';
  readonly targetHeight: number;
  readonly source: string;
}

/**
 * Runtime catalog for the converted assets only. Source packages stay outside
 * the web bundle; this list is the small, optimized delivery surface.
 */
export const MAP_ASSET_CATALOG: readonly MapAssetCatalogEntry[] = [
  {
    id: 'wuxia-gate-court',
    fileName: 'wuxia-gate-court.glb',
    kind: 'landmark',
    targetHeight: 30,
    source: '80 wuxia scene pack / 51.FBX',
  },
  {
    id: 'wuxia-citadel',
    fileName: 'wuxia-citadel.glb',
    kind: 'landmark',
    targetHeight: 34,
    source: '80 wuxia scene pack / 45.FBX',
  },
  {
    id: 'wuxia-east-asia-hall',
    fileName: 'wuxia-east-asia-hall.glb',
    kind: 'landmark',
    targetHeight: 32,
    source: '80 wuxia scene pack / 54.FBX',
  },
  {
    id: 'wuxia-mountain-gate',
    fileName: 'wuxia-mountain-gate.glb',
    kind: 'landmark',
    targetHeight: 34,
    source: '80 wuxia scene pack / 60.FBX',
  },
  {
    id: 'lowpoly-asian-village',
    fileName: 'lowpoly-asian-village.glb',
    kind: 'landmark',
    targetHeight: 18,
    source: '0072 Lowpoly Style Ultra Pack 1.2 / precomposed Asian village',
  },
  {
    id: 'lowpoly-asian-house',
    fileName: 'asia-house.glb',
    kind: 'landmark',
    targetHeight: 12,
    source: '0072 Lowpoly Style Ultra Pack 1.2 / AsianHouse_2.fbx',
  },
  {
    id: 'lowpoly-torii',
    fileName: 'torii-2.glb',
    kind: 'landmark',
    targetHeight: 10,
    source: '0072 Lowpoly Style Ultra Pack 1.2 / Torii2.fbx',
  },
  {
    id: 'lowpoly-rock-formation',
    fileName: 'rock-formation-2.glb',
    kind: 'landmark',
    targetHeight: 5.2,
    source: '0072 Lowpoly Style Ultra Pack 1.2 / RockFormation2.fbx',
  },
  {
    id: 'desert-rock-01',
    fileName: 'desert-rock-01.glb',
    kind: 'rock',
    targetHeight: 2.8,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-02',
    fileName: 'desert-rock-02.glb',
    kind: 'rock',
    targetHeight: 3.4,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-03',
    fileName: 'desert-rock-03.glb',
    kind: 'rock',
    targetHeight: 4.1,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-04',
    fileName: 'desert-rock-04.glb',
    kind: 'rock',
    targetHeight: 2.3,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-05',
    fileName: 'desert-rock-05.glb',
    kind: 'rock',
    targetHeight: 3.1,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-06',
    fileName: 'desert-rock-06.glb',
    kind: 'rock',
    targetHeight: 2.6,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-07',
    fileName: 'desert-rock-07.glb',
    kind: 'rock',
    targetHeight: 3.8,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-08',
    fileName: 'desert-rock-08.glb',
    kind: 'rock',
    targetHeight: 2.2,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-09',
    fileName: 'desert-rock-09.glb',
    kind: 'rock',
    targetHeight: 1.9,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-10',
    fileName: 'desert-rock-10.glb',
    kind: 'rock',
    targetHeight: 1.6,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-11',
    fileName: 'desert-rock-11.glb',
    kind: 'rock',
    targetHeight: 1.7,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-12',
    fileName: 'desert-rock-12.glb',
    kind: 'rock',
    targetHeight: 1.8,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-13',
    fileName: 'desert-rock-13.glb',
    kind: 'rock',
    targetHeight: 1.5,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-14',
    fileName: 'desert-rock-14.glb',
    kind: 'rock',
    targetHeight: 1.4,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'desert-rock-15',
    fileName: 'desert-rock-15.glb',
    kind: 'rock',
    targetHeight: 1.3,
    source: 'C1524 rock pack / Desert Rocks',
  },
  {
    id: 'stylized-rock-01',
    fileName: 'stylized-rock-01.glb',
    kind: 'rock',
    targetHeight: 3.2,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-02',
    fileName: 'stylized-rock-02.glb',
    kind: 'rock',
    targetHeight: 2.1,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-03',
    fileName: 'stylized-rock-03.glb',
    kind: 'rock',
    targetHeight: 2.6,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-04',
    fileName: 'stylized-rock-04.glb',
    kind: 'rock',
    targetHeight: 3.3,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-05',
    fileName: 'stylized-rock-05.glb',
    kind: 'rock',
    targetHeight: 3.8,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-06',
    fileName: 'stylized-rock-06.glb',
    kind: 'rock',
    targetHeight: 4.1,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-07',
    fileName: 'stylized-rock-07.glb',
    kind: 'rock',
    targetHeight: 4.6,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-08',
    fileName: 'stylized-rock-08.glb',
    kind: 'rock',
    targetHeight: 4.2,
    source: 'C1524 stone01 / ST-PaCK',
  },
  {
    id: 'stylized-rock-09',
    fileName: 'stylized-rock-09.glb',
    kind: 'rock',
    targetHeight: 4.6,
    source: 'C1524 stone01 / ST-PaCK',
  },
] as const;

const CATALOG_BY_ID = new Map(MAP_ASSET_CATALOG.map((entry) => [entry.id, entry]));
const ROCK_ASSET_IDS = MAP_ASSET_CATALOG.filter((entry) => entry.kind === 'rock').map(
  (entry) => entry.id,
);
const REDUCED_LANDMARK_ASSET_IDS = ['lowpoly-asian-village', 'wuxia-gate-court'] as const;
const REDUCED_ROCK_ASSET_IDS = [
  'desert-rock-01',
  'desert-rock-05',
  'desert-rock-09',
  'desert-rock-13',
  'stylized-rock-01',
  'stylized-rock-04',
  'stylized-rock-07',
] as const;
const REDUCED_LANDMARK_ASSET_SET = new Set<string>(REDUCED_LANDMARK_ASSET_IDS);

export interface MapAssetPlacement {
  readonly id: string;
  readonly assetId: string;
  readonly kind: 'landmark' | 'rock';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly worldHeight: number;
  readonly scale: number;
  readonly maxDistance: number;
}

export interface MapAssetLayerDiagnostics {
  readonly status: 'disabled' | 'loading' | 'ready' | 'failed' | 'disposed';
  readonly loadedAssets: readonly string[];
  readonly failedAssets: readonly string[];
  readonly landmarks: readonly MapAssetLandmarkDiagnostics[];
  readonly landmarkInstances: number;
  readonly visibleLandmarkInstances: number;
  readonly rockInstances: number;
  readonly visibleRockInstances: number;
  readonly instancedBatches: number;
  readonly triangles: number;
  readonly drawCalls: number;
  readonly visible: boolean;
}

export interface MapAssetLandmarkDiagnostics {
  readonly id: string;
  readonly assetId: string;
  readonly position: readonly [number, number, number];
  readonly worldHeight: number;
  readonly scale: number;
  readonly visible: boolean;
  readonly meshCount: number;
  readonly triangles: number;
  readonly bounds: readonly [number, number, number, number, number, number];
}

export interface MapAssetLayer {
  readonly group: THREE.Group;
  setGraphicsTier(tier: MapAssetGraphicsTier): void;
  update(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void;
  diagnostics(): MapAssetLayerDiagnostics;
  dispose(): void;
}

interface AssetPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly triangles: number;
}

interface AssetTemplate {
  readonly id: string;
  readonly path: string;
  readonly parts: readonly AssetPart[];
  readonly triangles: number;
}

interface LandmarkRuntime {
  readonly placement: MapAssetPlacement;
  readonly group: THREE.Group;
  readonly bounds: THREE.Box3;
}

interface RockBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly trianglesPerInstance: number;
  readonly placements: readonly MapAssetPlacement[];
  readonly matrices: readonly THREE.Matrix4[];
  readonly colours: readonly THREE.Color[];
}

interface FallbackRockMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly matricesByPlacementId: ReadonlyMap<string, THREE.Matrix4>;
  readonly originalMatrices: readonly THREE.Matrix4[];
  readonly originalCount: number;
}

const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();
const tempScale = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const tempColour = new THREE.Color();
const neutralRock = new THREE.Color(0x7c776c);

function hashAt(x: number, z: number, salt: number, seed: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7 + seed * 0.0001) * 43_758.5453123;
  return value - Math.floor(value);
}

function averagePoint(points: readonly MapPointMm[]): { readonly x: number; readonly z: number } {
  if (points.length === 0) {
    return { x: 0, z: 0 };
  }
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length / MM,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length / MM,
  };
}

function catalogEntry(assetId: string): MapAssetCatalogEntry {
  const entry = CATALOG_BY_ID.get(assetId);
  if (!entry) {
    throw new Error(`map assets: unknown asset ${assetId}`);
  }
  return entry;
}

function landmarkPlacement(
  id: string,
  assetId: string,
  point: { readonly x: number; readonly z: number },
  worldHeight: number,
  yaw: number,
  lift = 0.08,
): MapAssetPlacement {
  const targetHeight = catalogEntry(assetId).targetHeight;
  return {
    id,
    assetId,
    kind: 'landmark',
    x: point.x,
    y: terrainHeightMeters(point.x, point.z) + lift,
    z: point.z,
    yaw,
    worldHeight,
    scale: normalizedAssetScale(targetHeight, worldHeight),
    maxDistance: LANDMARK_CULL_DISTANCE,
  };
}

/**
 * Places imported scenery on authored highland/edge anchors instead of
 * walkable combat lanes. The plan is render-only and never enters collision.
 */
export function createMapAssetPlacementPlan(seed = 1): readonly MapAssetPlacement[] {
  const highlandEast = averagePoint(MAP_HIGHLANDS[0]?.vertices ?? []);
  const highlandNorth = averagePoint(MAP_HIGHLANDS[2]?.vertices ?? []);
  // Keep the large compounds on authored plateaus, but bring one gate into
  // the western approach so the first viewport has an architectural anchor.
  const eastHighlandSite = { x: highlandEast.x - 5, z: highlandEast.z - 4 };
  const centralHallSite = { x: -70, z: -56 };
  const northHighlandSite = { x: highlandNorth.x + 4, z: highlandNorth.z - 5 };
  const westVillageSite = { x: -342, z: -68 };
  const westGateSite = { x: -365, z: 36 };
  const westHouseSite = { x: westVillageSite.x - 18, z: westVillageSite.z - 25 };

  const landmarks: MapAssetPlacement[] = [
    landmarkPlacement(
      'imported-landmark-east-highland',
      'wuxia-citadel',
      eastHighlandSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['wuxia-citadel'],
      yawToward(eastHighlandSite.x, eastHighlandSite.z, highlandEast.x, highlandEast.z) + 0.12,
    ),
    landmarkPlacement(
      'imported-landmark-central-hall',
      'wuxia-east-asia-hall',
      centralHallSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['wuxia-east-asia-hall'],
      yawToward(centralHallSite.x, centralHallSite.z, -12.3, -58.6) - 0.18,
      0.06,
    ),
    landmarkPlacement(
      'imported-landmark-north-highland',
      'wuxia-mountain-gate',
      northHighlandSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['wuxia-mountain-gate'],
      yawToward(northHighlandSite.x, northHighlandSite.z, highlandNorth.x, highlandNorth.z) + 0.2,
    ),
    landmarkPlacement(
      'imported-landmark-west-village',
      'lowpoly-asian-village',
      westVillageSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['lowpoly-asian-village'],
      yawToward(westVillageSite.x, westVillageSite.z, -330.7, -82) + 0.12,
    ),
    landmarkPlacement(
      'imported-landmark-west-gate',
      'wuxia-gate-court',
      westGateSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['wuxia-gate-court'],
      yawToward(westGateSite.x, westGateSite.z, 0, 0),
    ),
    landmarkPlacement(
      'imported-landmark-west-house',
      'lowpoly-asian-house',
      westHouseSite,
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['lowpoly-asian-house'],
      yawToward(westHouseSite.x, westHouseSite.z, westVillageSite.x, westVillageSite.z) + 0.18,
    ),
    landmarkPlacement(
      'imported-landmark-west-torii',
      'lowpoly-torii',
      { x: westVillageSite.x - 3, z: westVillageSite.z + 19 },
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['lowpoly-torii'],
      yawToward(westVillageSite.x - 3, westVillageSite.z + 19, -330.7, -82),
    ),
    landmarkPlacement(
      'imported-landmark-north-rock-formation',
      'lowpoly-rock-formation',
      { x: northHighlandSite.x + 13, z: northHighlandSite.z + 8 },
      WORLD_SCALE_PROFILE.map.landmarkWorldHeights['lowpoly-rock-formation'],
      yawToward(
        northHighlandSite.x + 13,
        northHighlandSite.z + 8,
        highlandNorth.x,
        highlandNorth.z,
      ),
    ),
  ];

  const rocks = MAP_ROCKS.map((record): MapAssetPlacement => {
    const x = record.position.x / MM;
    const z = record.position.z / MM;
    const assetId = ROCK_ASSET_IDS[
      Math.floor(hashAt(record.position.x, record.position.z, 17, seed) * ROCK_ASSET_IDS.length)
    ] as string;
    return {
      id: `imported-rock-${record.id}`,
      assetId,
      kind: 'rock',
      x,
      y: terrainHeightMeters(x, z) + 0.04,
      z,
      yaw: hashAt(record.position.x, record.position.z, 19, seed) * Math.PI * 2,
      worldHeight: Math.min(
        WORLD_SCALE_PROFILE.map.rockMaxWorldHeight,
        Math.max(
          WORLD_SCALE_PROFILE.map.rockMinWorldHeight,
          WORLD_SCALE_PROFILE.map.rockBaseWorldHeight +
            (record.radiusMm / MM - 2) * 0.22 +
            hashAt(record.position.x, record.position.z, 23, seed) *
              WORLD_SCALE_PROFILE.map.rockVariationWorldHeight,
        ),
      ),
      scale: 1,
      maxDistance: ROCK_CULL_DISTANCE,
    };
  });
  const normalizedRocks = rocks.map((placement) => ({
    ...placement,
    scale: normalizedAssetScale(
      catalogEntry(placement.assetId).targetHeight,
      placement.worldHeight,
    ),
  }));
  return [...landmarks, ...normalizedRocks];
}

function assetUrl(assetId: string): string {
  return appendAssetVersion(webAssetUrl(`${ASSET_DIR}${catalogEntry(assetId).fileName}`));
}

function copyMaterial(source: THREE.Material, assetId: string): THREE.Material {
  const material = source.clone();
  material.name = `${assetId}-${source.name || 'material'}`;
  material.side = THREE.FrontSide;
  if (
    material instanceof THREE.MeshStandardMaterial &&
    (assetId === 'lowpoly-asian-house' || assetId === 'lowpoly-torii') &&
    /roof|tile/i.test(source.name)
  ) {
    // Older converted deliveries may still contain the source package's
    // black BLEND roof material. Keep the runtime resilient while the
    // converter produces the corrected opaque, tinted roof.
    material.color.set(0xa84d35);
    material.transparent = false;
    material.opacity = 1;
    material.alphaTest = 0;
    material.depthWrite = true;
    material.roughness = Math.max(material.roughness, 0.84);
    material.metalness = Math.min(material.metalness, 0.04);
    material.emissive.set(0x2a0b06);
    material.emissiveIntensity = 0.12;
    material.needsUpdate = true;
  }
  material.needsUpdate = true;
  return material;
}

function materializeGeometryAttributes(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.clone();
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name);
    const values = new Float32Array(attribute.count * attribute.itemSize);
    for (let index = 0; index < attribute.count; index += 1) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        values[index * attribute.itemSize + component] = attribute.getComponent(index, component);
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, false));
  }
  return geometry;
}

function extractTemplate(assetId: string, scene: THREE.Group): AssetTemplate {
  scene.updateMatrixWorld(true);
  const parts: AssetPart[] = [];
  const sourceGeometries = new Set<THREE.BufferGeometry>();
  const sourceMaterials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    sourceGeometries.add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      sourceMaterials.add(material);
    });
    const groups =
      object.geometry.groups.length > 0
        ? object.geometry.groups
        : [
            {
              start: 0,
              count:
                object.geometry.index?.count ??
                object.geometry.getAttribute('position')?.count ??
                0,
              materialIndex: 0,
            },
          ];
    for (const group of groups) {
      const sourceMaterial = materials[group.materialIndex ?? 0] ?? materials[0];
      if (!sourceMaterial || group.count <= 0) {
        continue;
      }
      // GLTF meshopt/quantized assets commonly expose normalized
      // InterleavedBufferAttributes. BufferGeometry.applyMatrix4() cannot
      // write transformed values back into those integer buffers without
      // clamping them to [-1, 1], which collapses imported landmarks to tiny
      // invisible dots. Materialize to float attributes before baking the
      // node transform.
      const geometry = materializeGeometryAttributes(object.geometry);
      geometry.clearGroups();
      geometry.setDrawRange(group.start, group.count);
      geometry.applyMatrix4(object.matrixWorld);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const position = geometry.getAttribute('position');
      const triangles = Math.floor((geometry.index?.count ?? position?.count ?? 0) / 3);
      parts.push({
        geometry,
        material: copyMaterial(sourceMaterial, assetId),
        triangles,
      });
    }
  });
  for (const geometry of sourceGeometries) {
    geometry.dispose();
  }
  for (const material of sourceMaterials) {
    material.dispose();
  }
  if (parts.length === 0) {
    throw new Error(`map assets: ${assetId} has no renderable parts`);
  }
  return {
    id: assetId,
    path: assetUrl(assetId),
    parts,
    triangles: parts.reduce((sum, part) => sum + part.triangles, 0),
  };
}

async function loadTemplate(loader: GLTFLoader, assetId: string): Promise<AssetTemplate> {
  const gltf = await loader.loadAsync(assetUrl(assetId));
  return extractTemplate(assetId, gltf.scene);
}

function disposeTemplate(template: AssetTemplate): void {
  const textures = new Set<THREE.Texture>();
  for (const part of template.parts) {
    part.geometry.dispose();
    for (const value of Object.values(part.material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) {
        textures.add(value);
      }
    }
    part.material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
  }
}

function disposeRockBatches(batches: readonly RockBatch[]): void {
  for (const batch of batches) {
    batch.mesh.removeFromParent();
  }
}

function colorForRock(placement: MapAssetPlacement): THREE.Color {
  const region = regionAt(placement.x, placement.z);
  tempColour.setHex(region.groundAlt).lerp(neutralRock, 0.64);
  tempColour.offsetHSL(
    (hashAt(placement.x, placement.z, 31, 1) - 0.5) * 0.025,
    (hashAt(placement.x, placement.z, 37, 1) - 0.5) * 0.07,
    (hashAt(placement.x, placement.z, 41, 1) - 0.5) * 0.06,
  );
  return tempColour.clone();
}

function makeRockMatrix(placement: MapAssetPlacement): THREE.Matrix4 {
  tempEuler.set(
    (hashAt(placement.x, placement.z, 47, 1) - 0.5) * 0.12,
    placement.yaw,
    (hashAt(placement.x, placement.z, 53, 1) - 0.5) * 0.12,
  );
  tempQuaternion.setFromEuler(tempEuler);
  tempScale.setScalar(placement.scale);
  tempPosition.set(placement.x, placement.y, placement.z);
  tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
  return tempMatrix.clone();
}

function placementsForTier(
  placements: readonly MapAssetPlacement[],
  tier: MapAssetGraphicsTier,
): {
  readonly landmarks: readonly MapAssetPlacement[];
  readonly rocks: readonly MapAssetPlacement[];
} {
  const landmarks = placements.filter(
    (placement) =>
      placement.kind === 'landmark' &&
      (tier === 'balanced' || REDUCED_LANDMARK_ASSET_SET.has(placement.assetId)),
  );
  const rockPlacements = placements
    .filter((placement) => placement.kind === 'rock')
    .filter((_, index) => tier === 'balanced' || index % 2 === 0);
  const rocks =
    tier === 'balanced'
      ? rockPlacements
      : rockPlacements.map((placement, index) => {
          const assetId =
            REDUCED_ROCK_ASSET_IDS[
              Math.floor(
                hashAt(placement.x, placement.z, 67 + index, 1) * REDUCED_ROCK_ASSET_IDS.length,
              )
            ] ?? REDUCED_ROCK_ASSET_IDS[0];
          return {
            ...placement,
            assetId,
            scale: normalizedAssetScale(catalogEntry(assetId).targetHeight, placement.worldHeight),
          };
        });
  return { landmarks, rocks };
}

function createLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export function buildMapAssetLayer(
  parent: THREE.Group,
  options: {
    readonly renderer: THREE.WebGLRenderer | null;
    readonly graphicsTier: MapAssetGraphicsTier;
    readonly seed: number;
    readonly fallbackRockGroup?: THREE.Object3D | null;
  },
): MapAssetLayer {
  const group = new THREE.Group();
  group.name = 'map-imported-assets';
  group.visible = false;
  const landmarkGroup = new THREE.Group();
  landmarkGroup.name = 'map-imported-landmarks';
  const rockGroup = new THREE.Group();
  rockGroup.name = 'map-imported-rocks';
  group.add(landmarkGroup, rockGroup);
  parent.add(group);

  let tier = options.graphicsTier;
  let status: MapAssetLayerDiagnostics['status'] = options.renderer ? 'loading' : 'disabled';
  let disposed = false;
  let frameCounter = OCCLUSION_UPDATE_INTERVAL_FRAMES - 1;
  let visibleLandmarkInstances = 0;
  let visibleRockInstances = 0;
  let batches: RockBatch[] = [];
  let landmarkRuntimes: LandmarkRuntime[] = [];
  const templates = new Map<string, AssetTemplate>();
  const failedAssets: string[] = [];
  const requestedLoads = new Map<string, Promise<void>>();
  const placements = createMapAssetPlacementPlan(options.seed);
  const rockPlacementById = new Map(
    placements
      .filter((placement) => placement.kind === 'rock')
      .map((placement) => [placement.id, placement]),
  );
  const fallbackRockMeshes: FallbackRockMesh[] = [];
  options.fallbackRockGroup?.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh)) {
      return;
    }
    const originalMatrices: THREE.Matrix4[] = [];
    for (let index = 0; index < object.count; index += 1) {
      const source = new THREE.Matrix4();
      object.getMatrixAt(index, source);
      originalMatrices.push(source);
    }
    const matricesByPlacementId = new Map<string, THREE.Matrix4>();
    for (const [index, placement] of [...rockPlacementById.values()].entries()) {
      const source = originalMatrices[index];
      if (source) {
        matricesByPlacementId.set(placement.id, source);
      }
    }
    fallbackRockMeshes.push({
      mesh: object,
      matricesByPlacementId,
      originalMatrices,
      originalCount: object.count,
    });
  });

  const rebuild = (): void => {
    if (disposed) {
      return;
    }
    for (const runtime of landmarkRuntimes) {
      runtime.group.removeFromParent();
    }
    disposeRockBatches(batches);
    batches = [];
    landmarkRuntimes = [];
    const selected = placementsForTier(placements, tier);

    for (const placement of selected.landmarks) {
      const template = templates.get(placement.assetId);
      if (!template) {
        continue;
      }
      const instanceGroup = new THREE.Group();
      instanceGroup.name = placement.id;
      instanceGroup.position.set(placement.x, placement.y, placement.z);
      instanceGroup.rotation.y = placement.yaw;
      instanceGroup.scale.setScalar(placement.scale);
      instanceGroup.userData.mapAssetId = placement.assetId;
      for (const [partIndex, part] of template.parts.entries()) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.name = `${placement.id}-part-${partIndex}`;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        instanceGroup.add(mesh);
      }
      landmarkGroup.add(instanceGroup);
      instanceGroup.updateMatrixWorld(true);
      landmarkRuntimes.push({
        placement,
        group: instanceGroup,
        bounds: new THREE.Box3().setFromObject(instanceGroup),
      });
    }

    const byAsset = new Map<string, MapAssetPlacement[]>();
    for (const placement of selected.rocks) {
      const list = byAsset.get(placement.assetId);
      if (list) {
        list.push(placement);
      } else {
        byAsset.set(placement.assetId, [placement]);
      }
    }
    for (const [assetId, list] of byAsset) {
      const template = templates.get(assetId);
      if (!template) {
        continue;
      }
      for (const [partIndex, part] of template.parts.entries()) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        mesh.name = `map-imported-rock-${assetId}-${partIndex}`;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        const matrices = list.map((placement) => makeRockMatrix(placement));
        const colours = list.map((placement) => colorForRock(placement));
        for (const [index, matrix] of matrices.entries()) {
          mesh.setMatrixAt(index, matrix);
          mesh.setColorAt(index, colours[index] as THREE.Color);
        }
        mesh.count = 0;
        mesh.visible = false;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true;
        }
        rockGroup.add(mesh);
        batches.push({
          mesh,
          geometry: part.geometry,
          material: part.material,
          trianglesPerInstance: part.triangles,
          placements: list,
          matrices,
          colours,
        });
      }
    }
    const hasRocks = batches.length > 0;
    group.visible = landmarkRuntimes.length > 0 || hasRocks;
    const reference = visibilityReference ?? new THREE.Vector3();
    updateVisibility(reference, reference);
  };

  const loadIds = async (ids: readonly string[]): Promise<void> => {
    if (!options.renderer || disposed) {
      return;
    }
    const loader = createLoader();
    const jobs = ids.map((assetId) => {
      if (templates.has(assetId) || failedAssets.includes(assetUrl(assetId))) {
        return Promise.resolve();
      }
      const existing = requestedLoads.get(assetId);
      if (existing) {
        return existing;
      }
      const job = loadTemplate(loader, assetId)
        .then((template) => {
          if (!disposed) {
            templates.set(assetId, template);
          } else {
            disposeTemplate(template);
          }
        })
        .catch((error: unknown) => {
          failedAssets.push(assetUrl(assetId));
          console.warn(`JWGB map asset failed to load: ${assetId}`, error);
        });
      requestedLoads.set(assetId, job);
      return job;
    });
    await Promise.all(jobs);
  };

  let visibilityReference: THREE.Vector3 | null = null;
  let focusLoadPromise: Promise<void> | null = null;
  let queuedLoadReference: THREE.Vector3 | null = null;
  let lastLoadSignature = '';

  const placementsForRequest = (reference: THREE.Vector3): readonly MapAssetPlacement[] => {
    const selected = placementsForTier(placements, tier);
    return [...selected.landmarks, ...selected.rocks].filter((placement) => {
      const dx = placement.x - reference.x;
      const dz = placement.z - reference.z;
      const distanceSquared = dx * dx + dz * dz;
      const prefetchDistance =
        placement.kind === 'landmark' ? LANDMARK_PREFETCH_DISTANCE : ROCK_PREFETCH_DISTANCE;
      return distanceSquared <= prefetchDistance * prefetchDistance;
    });
  };

  const loadForFocus = (reference: THREE.Vector3): Promise<void> => {
    if (!options.renderer || disposed) {
      return Promise.resolve();
    }
    queuedLoadReference ??= new THREE.Vector3();
    queuedLoadReference.copy(reference);
    if (focusLoadPromise) {
      return focusLoadPromise;
    }
    focusLoadPromise = (async () => {
      try {
        while (queuedLoadReference && !disposed) {
          const requestedReference = queuedLoadReference.clone();
          queuedLoadReference = null;
          const ids = [
            ...new Set(
              placementsForRequest(requestedReference).map((placement) => placement.assetId),
            ),
          ].sort();
          const signature = `${tier}|${ids.join('|')}`;
          if (signature === lastLoadSignature) {
            continue;
          }
          status = templates.size > 0 ? 'ready' : 'loading';
          await loadIds(ids);
          if (disposed) {
            return;
          }
          rebuild();
          lastLoadSignature = signature;
          status = templates.size > 0 ? 'ready' : ids.length > 0 ? 'failed' : 'loading';
        }
      } catch (error) {
        status = 'failed';
        failedAssets.push(`loader: ${String(error)}`);
        console.warn(
          'JWGB imported map asset layer unavailable; procedural fallback remains active',
          error,
        );
      } finally {
        focusLoadPromise = null;
      }
    })();
    return focusLoadPromise;
  };

  function updateFallbackRocks(reference: THREE.Vector3): void {
    if (!options.renderer || fallbackRockMeshes.length === 0) {
      return;
    }
    const uncoveredPlacementIds = placementsForTier(placements, tier)
      .rocks.filter((placement) => {
        const dx = placement.x - reference.x;
        const dz = placement.z - reference.z;
        return (
          dx * dx + dz * dz <= placement.maxDistance * placement.maxDistance &&
          !templates.has(placement.assetId)
        );
      })
      .map((placement) => placement.id);
    for (const fallback of fallbackRockMeshes) {
      let slot = 0;
      for (const placementId of uncoveredPlacementIds) {
        const source = fallback.matricesByPlacementId.get(placementId);
        if (!source) {
          continue;
        }
        fallback.mesh.setMatrixAt(slot, source);
        slot += 1;
      }
      fallback.mesh.count = slot;
      fallback.mesh.visible = slot > 0;
      if (slot > 0) {
        fallback.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  function updateVisibility(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void {
    const reference = focusPosition.lengthSq() > 0 ? focusPosition : cameraPosition;
    visibilityReference ??= new THREE.Vector3();
    visibilityReference.copy(reference);
    visibleLandmarkInstances = 0;
    for (const runtime of landmarkRuntimes) {
      const dx = runtime.placement.x - reference.x;
      const dz = runtime.placement.z - reference.z;
      const visible =
        group.visible &&
        dx * dx + dz * dz <= runtime.placement.maxDistance * runtime.placement.maxDistance;
      runtime.group.visible = visible;
      if (visible) {
        visibleLandmarkInstances += 1;
      }
    }
    const visibleRockPlacementIds = new Set<string>();
    for (const batch of batches) {
      const visibleIndices: number[] = [];
      for (const [index, placement] of batch.placements.entries()) {
        const dx = placement.x - reference.x;
        const dz = placement.z - reference.z;
        const visible =
          group.visible && dx * dx + dz * dz <= placement.maxDistance * placement.maxDistance;
        if (visible) {
          visibleIndices.push(index);
          visibleRockPlacementIds.add(placement.id);
        }
      }
      for (const [slot, sourceIndex] of visibleIndices.entries()) {
        const matrix = batch.matrices[sourceIndex];
        const colour = batch.colours[sourceIndex];
        if (matrix) {
          batch.mesh.setMatrixAt(slot, matrix);
        }
        if (colour) {
          batch.mesh.setColorAt(slot, colour);
        }
      }
      batch.mesh.count = visibleIndices.length;
      batch.mesh.visible = visibleIndices.length > 0;
      if (visibleIndices.length > 0) {
        batch.mesh.instanceMatrix.needsUpdate = true;
        if (batch.mesh.instanceColor) {
          batch.mesh.instanceColor.needsUpdate = true;
        }
      }
    }
    visibleRockInstances = visibleRockPlacementIds.size;
    landmarkGroup.visible = visibleLandmarkInstances > 0;
    rockGroup.visible = visibleRockInstances > 0;
    updateFallbackRocks(reference);
  }

  return {
    group,
    setGraphicsTier(nextTier): void {
      tier = nextTier;
      if (!options.renderer || disposed) {
        return;
      }
      const reference = visibilityReference ?? new THREE.Vector3();
      void loadForFocus(reference);
    },
    update(cameraPosition, focusPosition): void {
      frameCounter = (frameCounter + 1) % OCCLUSION_UPDATE_INTERVAL_FRAMES;
      if (frameCounter === 0) {
        updateVisibility(cameraPosition, focusPosition);
        if (options.renderer) {
          void loadForFocus(focusPosition.lengthSq() > 0 ? focusPosition : cameraPosition);
        }
      }
    },
    diagnostics(): MapAssetLayerDiagnostics {
      const visibleBatches = batches.filter((batch) => batch.mesh.visible && batch.mesh.count > 0);
      const visibleLandmarks = landmarkRuntimes.filter((runtime) => runtime.group.visible);
      const triangles =
        visibleBatches.reduce(
          (sum, batch) => sum + batch.trianglesPerInstance * batch.mesh.count,
          0,
        ) +
        visibleLandmarks.reduce(
          (sum, runtime) =>
            sum +
            runtime.group.children.reduce((partSum, child) => {
              if (!(child instanceof THREE.Mesh)) {
                return partSum;
              }
              const position = child.geometry.getAttribute('position');
              const index = child.geometry.getIndex();
              return partSum + Math.floor((index?.count ?? position?.count ?? 0) / 3);
            }, 0),
          0,
        );
      const drawCalls =
        visibleBatches.length +
        visibleLandmarks.reduce((sum, runtime) => sum + runtime.group.children.length, 0);
      return {
        status,
        loadedAssets: [...templates.values()].map((template) => template.path).sort(),
        failedAssets: [...failedAssets].sort(),
        landmarks: landmarkRuntimes.flatMap(({ placement, group, bounds }) => [
          {
            id: placement.id,
            assetId: placement.assetId,
            position: [placement.x, placement.y, placement.z] as const,
            worldHeight: placement.worldHeight,
            scale: placement.scale,
            visible: group.visible,
            meshCount: group.children.length,
            triangles: group.children.reduce((sum, child) => {
              if (!(child instanceof THREE.Mesh)) {
                return sum;
              }
              const position = child.geometry.getAttribute('position');
              const index = child.geometry.getIndex();
              return sum + Math.floor((index?.count ?? position?.count ?? 0) / 3);
            }, 0),
            bounds: [
              bounds.min.x,
              bounds.min.y,
              bounds.min.z,
              bounds.max.x,
              bounds.max.y,
              bounds.max.z,
            ] as const,
          },
        ]),
        landmarkInstances: landmarkRuntimes.length,
        visibleLandmarkInstances,
        rockInstances: new Set(batches.flatMap((batch) => batch.placements.map((p) => p.id))).size,
        visibleRockInstances,
        instancedBatches: batches.length,
        triangles,
        drawCalls,
        visible: group.visible,
      };
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      status = 'disposed';
      group.removeFromParent();
      for (const runtime of landmarkRuntimes) {
        runtime.group.removeFromParent();
      }
      disposeRockBatches(batches);
      batches = [];
      for (const template of templates.values()) {
        disposeTemplate(template);
      }
      templates.clear();
      for (const fallback of fallbackRockMeshes) {
        for (const [index, source] of fallback.originalMatrices.entries()) {
          fallback.mesh.setMatrixAt(index, source);
        }
        fallback.mesh.count = fallback.originalCount;
        fallback.mesh.visible = true;
        fallback.mesh.instanceMatrix.needsUpdate = true;
      }
      options.fallbackRockGroup?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.visible = true;
        }
      });
    },
  };
}
