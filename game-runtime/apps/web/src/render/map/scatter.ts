import type { MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import { regionAt } from './map-regions';
import { createRandomStream, isOpenGround, sampleOpenGround } from './map-sampling';

const MM = 1_000;
const GRASS_TUFT_TARGET = 9_600;
const PEBBLE_TARGET = 840;
const GROUND_COVER_TARGET = 1_120;

interface ScatterMaterials {
  readonly grass: THREE.Material;
  readonly grassDark: THREE.Material;
  readonly pebble: THREE.Material;
  readonly groundMoss: THREE.Material;
  readonly groundSoil: THREE.Material;
  readonly groundLeaves: THREE.Material;
}

type GroundCoverKind = 'moss' | 'soil' | 'leaves';

/**
 * Deterministic low-profile dressing. The map used to distribute individual
 * tufts over the whole playfield, which leaves every camera view looking like
 * an empty test field. These clustered passes keep roads and gameplay anchors
 * open while creating readable grass banks, worn soil and debris pockets.
 */
export function buildScatter(
  group: THREE.Group,
  materials: ScatterMaterials,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  seed: number,
): void {
  const nextRandom = createRandomStream(seed);

  const grassAnchors = sampleOpenGround(980, 22_000, nextRandom, { roadVergeMm: 780 });
  const grassPoints = expandClusters(grassAnchors, GRASS_TUFT_TARGET, nextRandom, {
    minPerAnchor: 6,
    maxPerAnchor: 11,
    minRadiusMeters: 0.25,
    maxRadiusMeters: 3.8,
    roadVergeMm: 500,
  });
  const grassGeometry = track(buildGrassTuftGeometry());
  const brightGrassCount = Math.ceil(grassPoints.length * 0.58);
  placeGrassInstances(
    group,
    'scatter-grass-bright',
    grassGeometry,
    materials.grass,
    grassPoints.slice(0, brightGrassCount),
    nextRandom,
    true,
  );
  placeGrassInstances(
    group,
    'scatter-grass-shade',
    grassGeometry,
    materials.grassDark,
    grassPoints.slice(brightGrassCount),
    nextRandom,
    false,
  );

  const pebbleAnchors = sampleOpenGround(155, 5_000, nextRandom, { roadVergeMm: 750 });
  const pebblePoints = expandClusters(pebbleAnchors, PEBBLE_TARGET, nextRandom, {
    minPerAnchor: 4,
    maxPerAnchor: 8,
    minRadiusMeters: 0.15,
    maxRadiusMeters: 2.9,
    roadVergeMm: 400,
  });
  placePebbleInstances(
    group,
    track(new THREE.DodecahedronGeometry(0.26, 0)),
    materials.pebble,
    pebblePoints,
    nextRandom,
  );

  const coverAnchors = sampleOpenGround(290, 9_000, nextRandom, { roadVergeMm: 900 });
  const coverPoints = expandClusters(coverAnchors, GROUND_COVER_TARGET, nextRandom, {
    minPerAnchor: 3,
    maxPerAnchor: 7,
    minRadiusMeters: 0.35,
    maxRadiusMeters: 5.4,
    roadVergeMm: 650,
  });
  const coverGeometry = track(buildGroundCoverGeometry());
  const mossEnd = Math.floor(coverPoints.length * 0.5);
  const soilEnd = Math.floor(coverPoints.length * 0.82);
  placeGroundCoverInstances(
    group,
    'scatter-ground-moss',
    coverGeometry,
    materials.groundMoss,
    coverPoints.slice(0, mossEnd),
    nextRandom,
    'moss',
  );
  placeGroundCoverInstances(
    group,
    'scatter-ground-soil',
    coverGeometry,
    materials.groundSoil,
    coverPoints.slice(mossEnd, soilEnd),
    nextRandom,
    'soil',
  );
  placeGroundCoverInstances(
    group,
    'scatter-ground-leaves',
    coverGeometry,
    materials.groundLeaves,
    coverPoints.slice(soilEnd),
    nextRandom,
    'leaves',
  );
}

function expandClusters(
  anchors: readonly MapPointMm[],
  target: number,
  nextRandom: () => number,
  options: {
    readonly minPerAnchor: number;
    readonly maxPerAnchor: number;
    readonly minRadiusMeters: number;
    readonly maxRadiusMeters: number;
    readonly roadVergeMm: number;
  },
): MapPointMm[] {
  const points: MapPointMm[] = [];
  for (const anchor of anchors) {
    const count =
      options.minPerAnchor +
      Math.floor(nextRandom() * (options.maxPerAnchor - options.minPerAnchor + 1));
    for (let index = 0; index < count && points.length < target; index += 1) {
      const angle = nextRandom() * Math.PI * 2;
      const radius =
        options.minRadiusMeters +
        Math.sqrt(nextRandom()) * (options.maxRadiusMeters - options.minRadiusMeters);
      const candidate: MapPointMm = {
        x: Math.round(anchor.x + Math.cos(angle) * radius * MM),
        z: Math.round(anchor.z + Math.sin(angle) * radius * MM),
      };
      if (isOpenGround(candidate, { roadVergeMm: options.roadVergeMm })) {
        points.push(candidate);
      }
    }
    if (points.length >= target) {
      return points;
    }
  }

  const remaining = target - points.length;
  if (remaining > 0) {
    points.push(
      ...sampleOpenGround(remaining, Math.max(remaining * 12, 2_000), nextRandom, {
        roadVergeMm: options.roadVergeMm,
      }),
    );
  }
  return points;
}

function buildGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const blades = [
    { angle: 0.08, x: -0.16, z: 0.08, height: 0.52, width: 0.08, lean: 0.14 },
    { angle: 0.72, x: 0.1, z: -0.12, height: 0.68, width: 0.07, lean: -0.12 },
    { angle: 1.42, x: 0.04, z: 0.16, height: 0.46, width: 0.085, lean: 0.1 },
    { angle: 2.14, x: -0.1, z: -0.16, height: 0.61, width: 0.075, lean: -0.12 },
    { angle: 2.84, x: 0.18, z: 0.1, height: 0.43, width: 0.09, lean: 0.1 },
    { angle: 3.54, x: -0.02, z: -0.02, height: 0.66, width: 0.07, lean: -0.1 },
    { angle: 4.22, x: 0.15, z: -0.02, height: 0.5, width: 0.075, lean: 0.12 },
    { angle: 4.92, x: -0.18, z: 0.02, height: 0.58, width: 0.07, lean: -0.08 },
    { angle: 5.62, x: 0.02, z: 0.2, height: 0.4, width: 0.085, lean: 0.09 },
  ] as const;
  for (const blade of blades) {
    const halfX = Math.cos(blade.angle) * blade.width * 0.5;
    const halfZ = Math.sin(blade.angle) * blade.width * 0.5;
    const leanX = -Math.sin(blade.angle) * blade.lean;
    const leanZ = Math.cos(blade.angle) * blade.lean;
    positions.push(
      blade.x - halfX,
      0,
      blade.z - halfZ,
      blade.x + halfX,
      0,
      blade.z + halfZ,
      blade.x + leanX,
      blade.height,
      blade.z + leanZ,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildGroundCoverGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CircleGeometry(1, 24);
  const position = geometry.getAttribute('position');
  for (let index = 1; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const angle = Math.atan2(y, x);
    const radius = 0.82 + Math.sin(angle * 3 + 0.7) * 0.11 + Math.sin(angle * 7 - 0.45) * 0.07;
    position.setXY(index, x * radius, y * radius);
  }
  position.needsUpdate = true;
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function placeGrassInstances(
  group: THREE.Group,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  points: readonly MapPointMm[],
  nextRandom: () => number,
  bright: boolean,
): void {
  if (points.length === 0) {
    return;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, points.length);
  mesh.name = name;
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const colour = new THREE.Color();
  const grassBase = new THREE.Color(bright ? 0x779b50 : 0x506d39);
  points.forEach((point, index) => {
    const uniformScale = (bright ? 0.72 : 0.64) + nextRandom() * (bright ? 0.72 : 0.62);
    rotation.set(0, nextRandom() * Math.PI * 2, 0);
    quaternion.setFromEuler(rotation);
    scale.setScalar(uniformScale);
    position.set(point.x / MM, 0.018 * uniformScale, point.z / MM);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    colour.setHex(regionAt(point.x / MM, point.z / MM).scatter);
    colour.lerp(grassBase, bright ? 0.56 : 0.64);
    colour.multiplyScalar(0.86 + nextRandom() * 0.26);
    mesh.setColorAt(index, colour);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
  group.add(mesh);
}

function placePebbleInstances(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  points: readonly MapPointMm[],
  nextRandom: () => number,
): void {
  if (points.length === 0) {
    return;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, points.length);
  mesh.name = 'scatter-pebbles';
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const colour = new THREE.Color();
  const neutralStone = new THREE.Color(0x77766c);
  points.forEach((point, index) => {
    const size = 0.46 + nextRandom() * 1.1;
    rotation.set(nextRandom() * 0.32, nextRandom() * Math.PI * 2, nextRandom() * 0.32);
    quaternion.setFromEuler(rotation);
    scale.set(size * (0.72 + nextRandom() * 0.5), size * 0.65, size);
    position.set(point.x / MM, size * 0.075, point.z / MM);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    colour.setHex(regionAt(point.x / MM, point.z / MM).groundAlt);
    colour.lerp(neutralStone, 0.52);
    colour.multiplyScalar(0.82 + nextRandom() * 0.22);
    mesh.setColorAt(index, colour);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
  group.add(mesh);
}

function placeGroundCoverInstances(
  group: THREE.Group,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  points: readonly MapPointMm[],
  nextRandom: () => number,
  kind: GroundCoverKind,
): void {
  if (points.length === 0) {
    return;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, points.length);
  mesh.name = name;
  mesh.receiveShadow = false;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const colour = new THREE.Color();
  const mossBase = new THREE.Color(0x4f692d);
  const soilBase = new THREE.Color(0x6c4a2d);
  const leafBase = new THREE.Color(0x875a2f);
  points.forEach((point, index) => {
    const region = regionAt(point.x / MM, point.z / MM);
    const base = kind === 'moss' ? mossBase : kind === 'soil' ? soilBase : leafBase;
    const minScale = kind === 'moss' ? 0.82 : kind === 'soil' ? 0.72 : 0.48;
    const maxScale = kind === 'moss' ? 2.65 : kind === 'soil' ? 2.3 : 1.5;
    const xScale = minScale + nextRandom() * (maxScale - minScale);
    const zScale = xScale * (0.52 + nextRandom() * 0.65);
    rotation.set(0, nextRandom() * Math.PI * 2, 0);
    quaternion.setFromEuler(rotation);
    scale.set(xScale, 1, zScale);
    const lift = kind === 'moss' ? 0.014 : kind === 'soil' ? 0.018 : 0.022;
    position.set(point.x / MM, lift + nextRandom() * 0.004, point.z / MM);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    if (kind === 'soil') {
      colour.setHex(region.soil).lerp(base, 0.34);
    } else if (kind === 'leaves') {
      colour.setHex(region.accent).lerp(base, 0.7);
    } else {
      colour.setHex(region.scatter).lerp(base, 0.54);
    }
    colour.multiplyScalar(0.66 + nextRandom() * 0.2);
    mesh.setColorAt(index, colour);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
  group.add(mesh);
}
