import type { MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import { applyWindSway } from '../shading/wind';
import { regionAt } from './map-regions';
import { dressingSurfaceMeters } from './map-sampling';

const MM = 1_000;

export interface AutumnGroundDressingLayer {
  setGraphicsTier(tier: 'balanced' | 'reduced'): void;
  diagnostics(): {
    readonly flowerInstances: number;
    readonly leafLitterInstances: number;
    readonly drawCalls: number;
  };
  dispose(): void;
}

interface Candidate {
  readonly point: MapPointMm;
  readonly order: number;
}

interface DressingInstanceMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly fullCount: number;
  readonly reducedCount: number;
}

interface DressingBatch {
  readonly meshes: readonly DressingInstanceMesh[];
  readonly fullCount: number;
  readonly reducedCount: number;
}

const FLOWER_THRESHOLD = 0.14;
const LEAF_THRESHOLD = 0.08;
const REDUCED_DENSITY = 0.52;

/**
 * Small autumn ground details scattered over the Grassworks grass points.
 *
 * Only wildflowers and leaf litter remain. This layer used to add two more
 * batches — solid flat-shaded grass blades as far ground cover, and canvas
 * drawn tuft cards — and both read as pale, hard-edged paper slats standing
 * in the photographic grass. The Grassworks clumps are the only grass now;
 * anything that looks like a blade has to come from the atlas.
 */
export function buildAutumnGroundDressing(
  parent: THREE.Group,
  grassPoints: readonly MapPointMm[],
  initialTier: 'balanced' | 'reduced',
): AutumnGroundDressingLayer {
  const root = new THREE.Group();
  root.name = 'map-autumn-ground-dressing';

  const flowerTexture = createFlowerTexture();
  const leafTexture = createLeafTexture();
  const flowerMaterial = createCutoutMaterial(flowerTexture, 0.032, 0.34);
  const leafMaterial = createCutoutMaterial(leafTexture, 0, 0.32);

  const flowers = createFlowerBatch(root, flowerMaterial, grassPoints);
  const leafLitter = createLeafBatch(root, leafMaterial, grassPoints);
  const batches = [flowers, leafLitter] as const;

  parent.add(root);
  let tier = initialTier;

  const applyTier = (): void => {
    const reduced = tier === 'reduced';
    for (const batch of batches) {
      for (const part of batch.meshes) {
        part.mesh.count = reduced ? part.reducedCount : part.fullCount;
        part.mesh.visible = part.mesh.count > 0;
      }
    }
  };
  applyTier();

  return {
    setGraphicsTier(nextTier): void {
      tier = nextTier;
      applyTier();
    },
    diagnostics(): {
      readonly flowerInstances: number;
      readonly leafLitterInstances: number;
      readonly drawCalls: number;
    } {
      return {
        flowerInstances: tier === 'reduced' ? flowers.reducedCount : flowers.fullCount,
        leafLitterInstances: tier === 'reduced' ? leafLitter.reducedCount : leafLitter.fullCount,
        drawCalls: batches.reduce(
          (count, batch) =>
            count + batch.meshes.filter((part) => part.mesh.visible && part.mesh.count > 0).length,
          0,
        ),
      };
    },
    dispose(): void {
      root.removeFromParent();
      root.clear();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      for (const batch of batches) {
        for (const part of batch.meshes) {
          geometries.add(part.mesh.geometry);
          const material = part.mesh.material as THREE.Material;
          materials.add(material);
          for (const value of Object.values(material as unknown as Record<string, unknown>)) {
            if (value instanceof THREE.Texture) {
              textures.add(value);
            }
          }
        }
      }
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of materials) {
        material.dispose();
      }
      for (const texture of textures) {
        texture.dispose();
      }
    },
  };
}

function createFlowerBatch(
  parent: THREE.Group,
  material: THREE.MeshBasicMaterial,
  points: readonly MapPointMm[],
): DressingBatch {
  const candidates = selectCandidates(points, FLOWER_THRESHOLD, 0x20b7c4d3);
  const geometry = createCrossSpriteGeometry(0.62, 0.62);
  const mesh = new THREE.InstancedMesh(geometry, material, candidates.length);
  mesh.name = 'autumn-wildflowers';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  fillFlowerInstances(mesh, candidates);
  parent.add(mesh);
  return {
    meshes: [
      {
        mesh,
        fullCount: candidates.length,
        reducedCount: reducedCount(candidates.length),
      },
    ],
    fullCount: candidates.length,
    reducedCount: reducedCount(candidates.length),
  };
}

function createLeafBatch(
  parent: THREE.Group,
  material: THREE.MeshBasicMaterial,
  points: readonly MapPointMm[],
): DressingBatch {
  const candidates = selectCandidates(points, LEAF_THRESHOLD, 0xb19f5e47);
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geometry, material, candidates.length);
  mesh.name = 'autumn-ground-leaf-litter';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  fillLeafInstances(mesh, candidates);
  parent.add(mesh);
  return {
    meshes: [
      {
        mesh,
        fullCount: candidates.length,
        reducedCount: reducedCount(candidates.length),
      },
    ],
    fullCount: candidates.length,
    reducedCount: reducedCount(candidates.length),
  };
}

function selectCandidates(
  points: readonly MapPointMm[],
  threshold: number,
  salt: number,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const point of points) {
    const order = hashPoint(point, salt);
    if (order < threshold) {
      candidates.push({ point, order });
    }
  }
  // Prefix reduction must remain spatially distributed on mobile/reduced
  // graphics, so the retained prefix is a deterministic hash order rather
  // than the row-major lattice order.
  candidates.sort((left, right) => left.order - right.order);
  return candidates;
}

function reducedCount(fullCount: number): number {
  return fullCount === 0 ? 0 : Math.max(1, Math.floor(fullCount * REDUCED_DENSITY));
}

function fillFlowerInstances(mesh: THREE.InstancedMesh, candidates: readonly Candidate[]): void {
  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();
  const pale = new THREE.Color(0xfff4d6);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index] as Candidate;
    const point = candidate.point;
    const x = point.x / MM;
    const z = point.z / MM;
    const scale = 0.72 + hashPoint(point, 0x9f5d30a7) * 0.62;
    dummy.position.set(x, dressingSurfaceMeters(point) + 0.028, z);
    dummy.rotation.set(0, hashPoint(point, 0x1be0a58d) * Math.PI * 2, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    const kind = hashPoint(point, 0x5d2c7e19);
    const petal =
      kind < 0.22
        ? 0xf2e6c8 // white daisies
        : kind < 0.46
          ? 0xe9c23a // yellow chrysanthemum
          : kind < 0.64
            ? 0x9a6fc4 // purple aster
            : kind < 0.8
              ? 0xd9622f // orange marigold
              : kind < 0.92
                ? 0xe08aa6 // pink cosmos
                : regionAt(x, z).accent;
    colour.setHex(petal);
    colour.lerp(pale, hashPoint(point, 0x77a16419) * 0.28);
    colour.multiplyScalar(0.86 + hashPoint(point, 0x44bc2f81) * 0.22);
    mesh.setColorAt(index, colour);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

function fillLeafInstances(mesh: THREE.InstancedMesh, candidates: readonly Candidate[]): void {
  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();
  const leafColours = [0xb56b27, 0xd09a39, 0x8d4729, 0x725030] as const;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index] as Candidate;
    const point = candidate.point;
    const x = point.x / MM;
    const z = point.z / MM;
    const scale = 0.28 + hashPoint(point, 0x3b7d2f1a) * 0.48;
    dummy.position.set(x, dressingSurfaceMeters(point) + 0.026, z);
    dummy.rotation.set(0, hashPoint(point, 0x4f5bca22) * Math.PI * 2, 0);
    dummy.scale.set(scale * 1.65, scale, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    const colourIndex = Math.min(
      leafColours.length - 1,
      Math.floor(hashPoint(point, 0x6734e08b) * leafColours.length),
    );
    colour.setHex(leafColours[colourIndex] as number);
    colour.multiplyScalar(0.82 + hashPoint(point, 0xf22e17c9) * 0.22);
    mesh.setColorAt(index, colour);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

function createCutoutMaterial(
  texture: THREE.CanvasTexture,
  windStrength: number,
  alphaTest: number,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
    vertexColors: true,
    alphaTest,
    // These are alpha-tested cutouts, not translucent decals. Opaque depth
    // handling keeps the foliage rooted to the terrain and prevents the
    // transparent canvas texels from sorting through other map geometry.
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  material.alphaToCoverage = false;
  if (windStrength > 0) {
    applyWindSway(material, windStrength);
  }
  return material;
}

function createCrossSpriteGeometry(width: number, height: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const angle of [0, Math.PI / 2]) {
    const halfX = Math.cos(angle) * width * 0.5;
    const halfZ = Math.sin(angle) * width * 0.5;
    positions.push(
      -halfX,
      0,
      -halfZ,
      halfX,
      0,
      halfZ,
      halfX,
      height,
      halfZ,
      -halfX,
      height,
      -halfZ,
    );
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createFlowerTexture(): THREE.CanvasTexture {
  const canvas = createTransparentCanvas(96);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('autumn flower canvas unavailable');
  }
  context.strokeStyle = 'rgba(255,255,255,1)';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(48, 90);
  context.lineTo(48, 45);
  context.stroke();
  context.fillStyle = 'rgba(255,255,255,1)';
  for (let petal = 0; petal < 5; petal += 1) {
    const angle = (petal / 5) * Math.PI * 2;
    context.beginPath();
    context.ellipse(
      48 + Math.cos(angle) * 14,
      42 + Math.sin(angle) * 14,
      11,
      15,
      angle,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.beginPath();
  context.arc(48, 42, 8, 0, Math.PI * 2);
  context.fill();
  return configureSpriteTexture(canvas, 'autumn-wildflower');
}

function createLeafTexture(): THREE.CanvasTexture {
  const canvas = createTransparentCanvas(96);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('autumn leaf canvas unavailable');
  }
  context.fillStyle = 'rgba(255,255,255,1)';
  context.translate(48, 48);
  context.rotate(-0.32);
  context.beginPath();
  context.moveTo(0, -34);
  context.bezierCurveTo(28, -20, 31, 12, 0, 34);
  context.bezierCurveTo(-31, 12, -28, -20, 0, -34);
  context.closePath();
  context.fill();
  context.strokeStyle = 'rgba(255,255,255,0.72)';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, -28);
  context.lineTo(0, 28);
  context.stroke();
  return configureSpriteTexture(canvas, 'autumn-leaf-litter');
}

function createTransparentCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function configureSpriteTexture(canvas: HTMLCanvasElement, name: string): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function hashPoint(point: MapPointMm, salt: number): number {
  let value = (Math.imul(point.x, 0x45d9f3b) ^ Math.imul(point.z, 0x27d4eb2d) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}
