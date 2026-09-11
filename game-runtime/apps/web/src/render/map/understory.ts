import type { MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { appendAssetVersion, webAssetDirectoryUrl, webAssetUrl } from '../../runtime/asset-url';
import { applyWindSway } from '../shading/wind';
import { mapBuildingClearanceZones } from './map-asset-layer';

/** Woods thin out into the shore apron over the last ~13 m of playfield. */
const RIM_VEGETATION_CLEARANCE_MM = 13_000;
import { regionAt } from './map-regions';
import { dressingSurfaceMeters, isOpenGround } from './map-sampling';
import { isInSpawnPond } from './spawn-ponds';
import { waterSurfaceAt } from './water';

/**
 * Understory: bushes and ferns clustered around the trunks of the tree layer.
 *
 * A canopy over bare grass reads as an orchard. What makes a wood read as a
 * wood is the second storey under it — shrubs at the trunk feet, ferns in the
 * shade — and the massifs need the same to read as overgrown hills rather than
 * as turfed rock. Every anchor comes from a placed tree, so the understory
 * follows the forest exactly and never appears in the open meadow.
 *
 * Three low-poly GLBs already shipped with the web bundle (295–500 triangles
 * each) are instanced per 96 m chunk, one InstancedMesh per material, and
 * culled by distance. Render-only; the sim never sees any of it.
 */

const MM = 1_000;
const CHUNK_METERS = 128;
const VISIBILITY_UPDATE_INTERVAL = 3;
const BALANCED_CULL_DISTANCE = 72;
const REDUCED_CULL_DISTANCE = 58;
const REDUCED_DENSITY = 0.5;
const WIND_STRENGTH = 0.05;
const ALPHA_TEST = 0.4;

export interface UnderstoryAnchor {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  /** On a BOUND massif or VAULT hill: fern-heavy, darker mix. */
  readonly upland: boolean;
}

export interface UnderstoryDiagnostics {
  readonly status: 'loading' | 'ready' | 'failed' | 'disabled' | 'disposed';
  readonly instances: number;
  readonly visibleInstances: number;
  readonly drawCalls: number;
  readonly visibleDrawCalls: number;
  readonly visibleTriangles: number;
  readonly loadedAssets: readonly string[];
  readonly failedAssets: readonly string[];
}

export interface UnderstoryLayer {
  readonly group: THREE.Group;
  setGraphicsTier(tier: 'balanced' | 'reduced'): void;
  update(cameraPosition: THREE.Vector3): void;
  diagnostics(): UnderstoryDiagnostics;
  dispose(): void;
}

interface UnderstoryModel {
  readonly id: 'bush' | 'asia-bush' | 'fern';
  readonly path: string;
  readonly heightMin: number;
  readonly heightMax: number;
  readonly forestWeight: number;
  readonly uplandWeight: number;
}

export const UNDERSTORY_MODELS: readonly UnderstoryModel[] = [
  {
    id: 'bush',
    path: 'models/foliage/bush.glb',
    heightMin: 1.25,
    heightMax: 2.1,
    forestWeight: 0.45,
    uplandWeight: 0.4,
  },
  {
    id: 'asia-bush',
    path: 'models/foliage/asia-bush.glb',
    heightMin: 1.15,
    heightMax: 1.9,
    forestWeight: 0.3,
    uplandWeight: 0.15,
  },
  {
    id: 'fern',
    path: 'models/foliage/fern.glb',
    heightMin: 0.7,
    heightMax: 1.25,
    forestWeight: 0.25,
    uplandWeight: 0.45,
  },
] as const;

export const UNDERSTORY_ASSET_PATHS: readonly string[] = UNDERSTORY_MODELS.map(
  (model) => model.path,
);

export interface UnderstoryPlacement {
  readonly model: UnderstoryModel['id'];
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly height: number;
  readonly colour: THREE.Color;
  readonly order: number;
}

interface TemplatePart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly triangles: number;
}

interface Chunk {
  readonly group: THREE.Group;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly meshes: readonly {
    readonly mesh: THREE.InstancedMesh;
    readonly fullCount: number;
    readonly reducedCount: number;
    readonly trianglesPerInstance: number;
  }[];
  readonly fullCount: number;
  readonly reducedCount: number;
  visible: boolean;
}

const tempMatrix = new THREE.Matrix4();
const tempEuler = new THREE.Euler();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempPosition = new THREE.Vector3();

function hashAt(x: number, z: number, salt: number): number {
  let value = (Math.round(x * MM) ^ Math.imul(Math.round(z * MM), 0x45d9f3b) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function pickModel(roll: number, upland: boolean): UnderstoryModel {
  let cursor = 0;
  for (const model of UNDERSTORY_MODELS) {
    cursor += upland ? model.uplandWeight : model.forestWeight;
    if (roll <= cursor) {
      return model;
    }
  }
  return UNDERSTORY_MODELS[UNDERSTORY_MODELS.length - 1] as UnderstoryModel;
}

const FOREST_TINT = new THREE.Color(0x4f7a3a);
const UPLAND_TINT = new THREE.Color(0x3f6a34);

/**
 * Deterministic shrub and fern positions around every anchor tree. One to
 * three per tree in a wood, one or two on the uplands, each on legal open
 * ground and never in water or on a road.
 */
export function sampleUnderstoryPlacements(
  anchors: readonly UnderstoryAnchor[],
): readonly UnderstoryPlacement[] {
  const placements: UnderstoryPlacement[] = [];
  for (const anchor of anchors) {
    const first = hashAt(anchor.x, anchor.z, 0x1a2b3c);
    const second = hashAt(anchor.x, anchor.z, 0x2b3c4d);
    const count = anchor.upland
      ? 2 + (first < 0.4 ? 1 : 0)
      : 2 + (first < 0.55 ? 1 : 0) + (second < 0.22 ? 1 : 0);
    for (let index = 0; index < count; index += 1) {
      const salt = 0x3c4d5e + index * 0x1013;
      const angle = hashAt(anchor.x, anchor.z, salt) * Math.PI * 2;
      const radius = 1.35 + anchor.height * 0.1 + hashAt(anchor.x, anchor.z, salt + 1) * 2.9;
      const x = anchor.x + Math.cos(angle) * radius;
      const z = anchor.z + Math.sin(angle) * radius;
      const point: MapPointMm = { x: Math.round(x * MM), z: Math.round(z * MM) };
      if (
        !isOpenGround(point, {
          exclusionZones: mapBuildingClearanceZones(),
          rimClearanceMm: RIM_VEGETATION_CLEARANCE_MM,
          roadVergeMm: 1_200,
          landmarkClearanceScale: 0.6,
          includeBoundMassifs: true,
        }) ||
        waterSurfaceAt(x, z) !== null ||
        isInSpawnPond(point)
      ) {
        continue;
      }
      const model = pickModel(hashAt(x, z, 0x4d5e6f), anchor.upland);
      const colour = new THREE.Color(regionAt(x, z).scatter)
        .lerp(anchor.upland ? UPLAND_TINT : FOREST_TINT, 0.55)
        .multiplyScalar(0.88 + hashAt(x, z, 0x5e6f70) * 0.24);
      placements.push({
        model: model.id,
        x,
        z,
        yaw: hashAt(x, z, 0x6f7081) * Math.PI * 2,
        height: model.heightMin + hashAt(x, z, 0x708192) * (model.heightMax - model.heightMin),
        colour,
        order: hashAt(x, z, 0x8192a3),
      });
    }
  }
  return placements;
}

function copyAttribute(
  source: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  const values = new Float32Array(source.count * source.itemSize);
  for (let index = 0; index < source.count; index += 1) {
    for (let component = 0; component < source.itemSize; component += 1) {
      values[index * source.itemSize + component] = source.getComponent(index, component);
    }
  }
  return new THREE.BufferAttribute(values, source.itemSize, false);
}

function prepareMaterial(source: THREE.Material, id: string): THREE.Material {
  const material = source.clone();
  material.name = `understory-${id}-${source.name || 'material'}`;
  material.transparent = false;
  material.alphaTest = ALPHA_TEST;
  material.alphaToCoverage = true;
  material.depthWrite = true;
  material.side = THREE.DoubleSide;
  if (material instanceof THREE.MeshStandardMaterial) {
    material.roughness = Math.max(material.roughness, 0.86);
    material.metalness = Math.min(material.metalness, 0.02);
    material.emissive.setHex(0x0c1408);
    material.emissiveIntensity = 0.35;
  }
  applyWindSway(material, WIND_STRENGTH);
  material.needsUpdate = true;
  return material;
}

/**
 * Bakes a loaded GLB into unit-height parts standing on y = 0, one part per
 * material, so an instance matrix only has to supply position, yaw and height.
 */
function extractTemplate(scene: THREE.Group, id: string): readonly TemplatePart[] {
  scene.updateMatrixWorld(true);
  const baked: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  const bounds = new THREE.Box3();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const attribute = object.geometry.getAttribute(name);
      if (attribute) {
        geometry.setAttribute(name, copyAttribute(attribute));
      }
    }
    if (object.geometry.index) {
      geometry.setIndex(object.geometry.index.clone());
    }
    geometry.applyMatrix4(object.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      bounds.union(geometry.boundingBox);
    }
    const groups =
      object.geometry.groups.length > 0
        ? object.geometry.groups
        : [
            {
              start: 0,
              count: geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0,
              materialIndex: 0,
            },
          ];
    for (const group of groups) {
      const material = sourceMaterials[group.materialIndex ?? 0] ?? sourceMaterials[0];
      if (!material || group.count <= 0) {
        continue;
      }
      const part = geometry.clone();
      part.clearGroups();
      part.setDrawRange(group.start, group.count);
      baked.push({ geometry: part, material });
    }
    geometry.dispose();
  });
  const height = Math.max(0.001, bounds.max.y - bounds.min.y);
  const normalize = new THREE.Matrix4()
    .makeScale(1 / height, 1 / height, 1 / height)
    .multiply(new THREE.Matrix4().makeTranslation(0, -bounds.min.y, 0));
  return baked.map((entry) => {
    entry.geometry.applyMatrix4(normalize);
    entry.geometry.computeBoundingBox();
    entry.geometry.computeBoundingSphere();
    const range = entry.geometry.drawRange;
    const count =
      range.count === Number.POSITIVE_INFINITY
        ? (entry.geometry.index?.count ?? entry.geometry.getAttribute('position')?.count ?? 0)
        : range.count;
    return {
      geometry: entry.geometry,
      material: prepareMaterial(entry.material, id),
      triangles: Math.floor(count / 3),
    };
  });
}

function chunkKey(x: number, z: number): string {
  return `${Math.floor(x / CHUNK_METERS)}:${Math.floor(z / CHUNK_METERS)}`;
}

function squaredDistanceToBounds(reference: THREE.Vector3, chunk: Chunk, padding: number): number {
  const dx =
    reference.x < chunk.minX - padding
      ? chunk.minX - padding - reference.x
      : reference.x > chunk.maxX + padding
        ? reference.x - chunk.maxX - padding
        : 0;
  const dz =
    reference.z < chunk.minZ - padding
      ? chunk.minZ - padding - reference.z
      : reference.z > chunk.maxZ + padding
        ? reference.z - chunk.maxZ - padding
        : 0;
  return dx * dx + dz * dz;
}

export function buildUnderstoryLayer(
  parent: THREE.Group,
  options: {
    readonly renderer: THREE.WebGLRenderer | null;
    readonly graphicsTier: 'balanced' | 'reduced';
    readonly anchors: readonly UnderstoryAnchor[];
  },
): UnderstoryLayer {
  const group = new THREE.Group();
  group.name = 'map-understory';
  group.visible = false;
  parent.add(group);

  let tier = options.graphicsTier;
  let status: UnderstoryDiagnostics['status'] = options.renderer ? 'loading' : 'disabled';
  let disposed = false;
  let frame = VISIBILITY_UPDATE_INTERVAL - 1;
  let chunks: Chunk[] = [];
  let placements: readonly UnderstoryPlacement[] = [];
  const templates = new Map<UnderstoryModel['id'], readonly TemplatePart[]>();
  const loadedAssets = new Set<string>();
  const failedAssets = new Set<string>();
  const reference = new THREE.Vector3();

  const applyTier = (): void => {
    for (const chunk of chunks) {
      for (const entry of chunk.meshes) {
        entry.mesh.count = tier === 'reduced' ? entry.reducedCount : entry.fullCount;
        entry.mesh.visible = entry.mesh.count > 0;
      }
    }
  };

  const updateVisibility = (): void => {
    const cull = tier === 'balanced' ? BALANCED_CULL_DISTANCE : REDUCED_CULL_DISTANCE;
    for (const chunk of chunks) {
      const visible = group.visible && squaredDistanceToBounds(reference, chunk, 6) <= cull * cull;
      chunk.visible = visible;
      chunk.group.visible = visible;
    }
  };

  const buildChunks = (): void => {
    if (disposed || templates.size === 0) {
      return;
    }
    placements = sampleUnderstoryPlacements(options.anchors);
    const byChunk = new Map<string, UnderstoryPlacement[]>();
    for (const placement of placements) {
      if (!templates.has(placement.model)) {
        continue;
      }
      const key = chunkKey(placement.x, placement.z);
      const list = byChunk.get(key);
      if (list) {
        list.push(placement);
      } else {
        byChunk.set(key, [placement]);
      }
    }
    chunks = [];
    for (const [key, chunkPlacements] of byChunk) {
      const chunkGroup = new THREE.Group();
      chunkGroup.name = `understory-chunk-${key.replace(':', '-')}`;
      chunkGroup.visible = false;
      const meshes: Chunk['meshes'][number][] = [];
      let fullCount = 0;
      let reducedCount = 0;
      for (const model of UNDERSTORY_MODELS) {
        const parts = templates.get(model.id);
        // Reduced tier keeps the front of the sorted list, so ordering by the
        // hash makes the survivors a stable random subset.
        const modelPlacements = chunkPlacements
          .filter((placement) => placement.model === model.id)
          .sort((left, right) => left.order - right.order);
        if (!parts || modelPlacements.length === 0) {
          continue;
        }
        const reduced = modelPlacements.filter(
          (placement) => placement.order < REDUCED_DENSITY,
        ).length;
        fullCount += modelPlacements.length;
        reducedCount += reduced;
        for (const [partIndex, part] of parts.entries()) {
          const mesh = new THREE.InstancedMesh(
            part.geometry,
            part.material,
            modelPlacements.length,
          );
          mesh.name = `understory-${model.id}-${key.replace(':', '-')}-${partIndex}`;
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          mesh.frustumCulled = true;
          modelPlacements.forEach((placement, index) => {
            tempEuler.set(0, placement.yaw, 0);
            tempQuaternion.setFromEuler(tempEuler);
            tempScale.setScalar(placement.height);
            tempPosition.set(
              placement.x,
              dressingSurfaceMeters({
                x: Math.round(placement.x * MM),
                z: Math.round(placement.z * MM),
              }) - 0.04,
              placement.z,
            );
            tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
            mesh.setMatrixAt(index, tempMatrix);
            mesh.setColorAt(index, placement.colour);
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
          }
          mesh.computeBoundingSphere();
          chunkGroup.add(mesh);
          meshes.push({
            mesh,
            fullCount: modelPlacements.length,
            reducedCount: reduced,
            trianglesPerInstance: part.triangles,
          });
        }
      }
      group.add(chunkGroup);
      chunks.push({
        group: chunkGroup,
        minX: Math.min(...chunkPlacements.map((placement) => placement.x)),
        maxX: Math.max(...chunkPlacements.map((placement) => placement.x)),
        minZ: Math.min(...chunkPlacements.map((placement) => placement.z)),
        maxZ: Math.max(...chunkPlacements.map((placement) => placement.z)),
        meshes,
        fullCount,
        reducedCount,
        visible: false,
      });
    }
    group.visible = chunks.length > 0;
    applyTier();
    updateVisibility();
  };

  let transcoder: KTX2Loader | null = null;
  if (options.renderer) {
    // bush.glb and fern.glb carry KTX2/Basis textures, so the loader needs the
    // same transcoder the flora layer uses; without it both silently fail.
    const manager = new THREE.LoadingManager();
    transcoder = new KTX2Loader(manager);
    transcoder.setTranscoderPath(webAssetDirectoryUrl('basis/'));
    transcoder.detectSupport(options.renderer);
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setKTX2Loader(transcoder);
    void Promise.all(
      UNDERSTORY_MODELS.map((model) =>
        loader
          .loadAsync(appendAssetVersion(webAssetUrl(model.path)))
          .then((gltf) => {
            if (disposed) {
              return;
            }
            templates.set(model.id, extractTemplate(gltf.scene, model.id));
            loadedAssets.add(model.path);
          })
          .catch((error) => {
            if (disposed) {
              return;
            }
            failedAssets.add(model.path);
            console.warn(`JWGB understory asset ${model.path} failed to load`, error);
          }),
      ),
    ).then(() => {
      if (disposed) {
        return;
      }
      buildChunks();
      status = failedAssets.size === 0 && templates.size > 0 ? 'ready' : 'failed';
    });
  }

  return {
    group,
    setGraphicsTier(nextTier): void {
      if (tier === nextTier) {
        return;
      }
      tier = nextTier;
      applyTier();
      updateVisibility();
    },
    update(cameraPosition): void {
      if (disposed) {
        return;
      }
      reference.copy(cameraPosition);
      frame = (frame + 1) % VISIBILITY_UPDATE_INTERVAL;
      if (frame === 0) {
        updateVisibility();
      }
    },
    diagnostics(): UnderstoryDiagnostics {
      const visible = chunks.filter((chunk) => chunk.visible);
      const countOf = (chunk: Chunk): number =>
        tier === 'reduced' ? chunk.reducedCount : chunk.fullCount;
      return {
        status,
        instances: chunks.reduce((sum, chunk) => sum + countOf(chunk), 0),
        visibleInstances: visible.reduce((sum, chunk) => sum + countOf(chunk), 0),
        drawCalls: chunks.reduce(
          (sum, chunk) => sum + chunk.meshes.filter((entry) => entry.mesh.visible).length,
          0,
        ),
        visibleDrawCalls: visible.reduce(
          (sum, chunk) => sum + chunk.meshes.filter((entry) => entry.mesh.visible).length,
          0,
        ),
        visibleTriangles: visible.reduce(
          (sum, chunk) =>
            sum +
            chunk.meshes.reduce(
              (partSum, entry) => partSum + entry.trianglesPerInstance * entry.mesh.count,
              0,
            ),
          0,
        ),
        loadedAssets: [...loadedAssets].sort(),
        failedAssets: [...failedAssets].sort(),
      };
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      status = 'disposed';
      for (const chunk of chunks) {
        for (const entry of chunk.meshes) {
          entry.mesh.dispose();
        }
      }
      chunks = [];
      const textures = new Set<THREE.Texture>();
      for (const parts of templates.values()) {
        for (const part of parts) {
          part.geometry.dispose();
          part.material.dispose();
          for (const value of Object.values(part.material as unknown as Record<string, unknown>)) {
            if (value instanceof THREE.Texture) {
              textures.add(value);
            }
          }
        }
      }
      for (const texture of textures) {
        texture.dispose();
      }
      templates.clear();
      transcoder?.dispose();
      transcoder = null;
      group.removeFromParent();
      group.clear();
    },
  };
}
