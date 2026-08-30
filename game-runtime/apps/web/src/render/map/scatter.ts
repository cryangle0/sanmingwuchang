import type { MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import { regionAt } from './map-regions';
import { createRandomStream, dressingSurfaceMeters, sampleGroundLattice } from './map-sampling';
import { waterSurfaceAt } from './water';

const MM = 1_000;
/**
 * Ground cover spacing, in metres between lattice cells.
 *
 * These are spacings rather than instance budgets because coverage is what
 * matters: a budget spread over a 500,000 m2 playfield says nothing about
 * whether any given square metre has grass on it. At 1.6 m the grass layer
 * lands roughly 190,000 clumps, which is dense enough that open ground reads
 * as meadow instead of as a test field.
 *
 * The whole layer is five instanced draw calls and the reduced graphics tier
 * hides it wholesale, so the cost is vertex throughput on the balanced tier
 * only.
 */
const GRASS_SPACING_METERS = 1.45;
const GROUND_COVER_SPACING_METERS = 4.5;
const PEBBLE_SPACING_METERS = 11;
const BLOOM_SPACING_METERS = 4.5;

interface ScatterMaterials {
  readonly grass: THREE.Material;
  readonly grassDark: THREE.Material;
  readonly pebble: THREE.Material;
  readonly groundMoss: THREE.Material;
  readonly groundSoil: THREE.Material;
  readonly groundLeaves: THREE.Material;
  readonly bloom: THREE.Material;
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
  // Ponds are solved from the same compiled terrain, so this veto is
  // deterministic and costs one cell lookup per candidate.
  const inWater = (point: { readonly x: number; readonly z: number }): boolean =>
    waterSurfaceAt(point.x / MM, point.z / MM) !== null;

  const grassPoints = sampleGroundLattice(GRASS_SPACING_METERS, nextRandom, {
    roadVergeMm: 500,
    reject: inWater,
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

  const pebblePoints = sampleGroundLattice(PEBBLE_SPACING_METERS, nextRandom, {
    roadVergeMm: 750,
    reject: inWater,
  });
  placePebbleInstances(
    group,
    track(new THREE.DodecahedronGeometry(0.26, 0)),
    materials.pebble,
    pebblePoints,
    nextRandom,
  );

  const coverPoints = sampleGroundLattice(GROUND_COVER_SPACING_METERS, nextRandom, {
    roadVergeMm: 900,
    reject: inWater,
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

  // Wildflowers keep a wider verge than the grass so a bloom never sits on the
  // edge of a route a player is reading.
  const bloomPoints = sampleGroundLattice(BLOOM_SPACING_METERS, nextRandom, {
    roadVergeMm: 1_100,
    reject: inWater,
  });
  placeBloomInstances(group, track(buildBloomGeometry()), materials.bloom, bloomPoints, nextRandom);
}

/**
 * A five-petal bloom on a short stem: six triangles, small enough that the
 * silhouette is all that reads at the gameplay camera.
 */
function buildBloomGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const stemHeight = 0.46;
  const petalLength = 0.17;
  const petalWidth = 0.085;

  // Stem: one narrow upright triangle, enough to root the bloom visually.
  positions.push(-0.008, 0, 0, 0.008, 0, 0, 0, stemHeight, 0);

  for (let petal = 0; petal < 5; petal += 1) {
    const angle = (petal / 5) * Math.PI * 2;
    const outX = Math.cos(angle);
    const outZ = Math.sin(angle);
    const sideX = -outZ * petalWidth;
    const sideZ = outX * petalWidth;
    // Petals tilt up so the flower reads as a cup from the overhead camera.
    positions.push(
      sideX,
      stemHeight,
      sideZ,
      -sideX,
      stemHeight,
      -sideZ,
      outX * petalLength,
      stemHeight + 0.05,
      outZ * petalLength,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Blooms take their hue from the district accent, which is where the palette
 * keeps 朱砂红 / 金色 / 五行 colour. Mixing each one part-way toward white
 * keeps a meadow from turning into a solid sheet of the accent.
 */
function placeBloomInstances(
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
  mesh.name = 'scatter-blooms';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const colour = new THREE.Color();
  const pale = new THREE.Color(0xfdf6e4);
  points.forEach((point, index) => {
    const uniformScale = 0.88 + nextRandom() * 0.46;
    rotation.set(0, nextRandom() * Math.PI * 2, 0);
    quaternion.setFromEuler(rotation);
    scale.setScalar(uniformScale);
    position.set(point.x / MM, dressingSurfaceMeters(point), point.z / MM);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);

    colour.setHex(regionAt(point.x / MM, point.z / MM).accent);
    // Roughly a third of any meadow is pale, which reads as species variety
    // instead of one dyed field.
    colour.lerp(pale, nextRandom() < 0.34 ? 0.62 + nextRandom() * 0.24 : nextRandom() * 0.3);
    colour.multiplyScalar(0.88 + nextRandom() * 0.24);
    mesh.setColorAt(index, colour);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
  group.add(mesh);
}

function buildGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  /**
   * Seven blades, each a tapered strip rather than a triangle.
   *
   * The previous blade was one triangle — a base edge meeting a single apex —
   * which is a needle however it is coloured or scaled. A blade keeps a
   * finite width at the tip and bends over as it rises, so the silhouette
   * reads as a leaf. Two triangles per blade buys that, and the blade count
   * comes down from nine to seven to keep the clump near its old cost.
   */
  const blades = [
    { angle: 0.32, x: 0.1, z: -0.18, height: 0.92, width: 0.15, lean: 0.3 },
    { angle: 1.02, x: -0.2, z: -0.06, height: 0.78, width: 0.155, lean: 0.26 },
    { angle: 1.86, x: 0.16, z: 0.16, height: 0.99, width: 0.145, lean: 0.34 },
    { angle: 2.72, x: -0.08, z: 0.2, height: 0.72, width: 0.16, lean: 0.24 },
    { angle: 3.5, x: -0.05, z: -0.04, height: 1.06, width: 0.15, lean: 0.36 },
    { angle: 4.36, x: 0.22, z: -0.1, height: 0.83, width: 0.155, lean: 0.28 },
    { angle: 5.24, x: -0.18, z: 0.12, height: 0.95, width: 0.15, lean: 0.32 },
  ] as const;
  /** Tip width as a share of the base, so the blade narrows without pointing. */
  const TIP_TAPER = 0.34;

  for (const blade of blades) {
    const halfX = Math.cos(blade.angle) * blade.width * 0.5;
    const halfZ = Math.sin(blade.angle) * blade.width * 0.5;
    // The blade bends away from its own facing, so a clump fans outward
    // instead of every blade leaning the same way.
    const leanX = -Math.sin(blade.angle) * blade.lean;
    const leanZ = Math.cos(blade.angle) * blade.lean;
    const tipHalfX = halfX * TIP_TAPER;
    const tipHalfZ = halfZ * TIP_TAPER;
    const tipX = blade.x + leanX;
    const tipZ = blade.z + leanZ;
    // Tip sits slightly below the nominal height because the blade curves
    // over rather than standing straight up.
    const tipY = blade.height * 0.94;

    const baseLeftX = blade.x - halfX;
    const baseLeftZ = blade.z - halfZ;
    const baseRightX = blade.x + halfX;
    const baseRightZ = blade.z + halfZ;
    const tipLeftX = tipX - tipHalfX;
    const tipLeftZ = tipZ - tipHalfZ;
    const tipRightX = tipX + tipHalfX;
    const tipRightZ = tipZ + tipHalfZ;

    positions.push(baseLeftX, 0, baseLeftZ, baseRightX, 0, baseRightZ, tipRightX, tipY, tipRightZ);
    positions.push(baseLeftX, 0, baseLeftZ, tipRightX, tipY, tipRightZ, tipLeftX, tipY, tipLeftZ);
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
    const uniformScale = (bright ? 0.98 : 0.88) + nextRandom() * (bright ? 0.86 : 0.78);
    rotation.set(0, nextRandom() * Math.PI * 2, 0);
    quaternion.setFromEuler(rotation);
    scale.setScalar(uniformScale);
    position.set(point.x / MM, dressingSurfaceMeters(point) + 0.018 * uniformScale, point.z / MM);
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
    position.set(point.x / MM, dressingSurfaceMeters(point) + size * 0.075, point.z / MM);
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
    position.set(
      point.x / MM,
      dressingSurfaceMeters(point) + lift + nextRandom() * 0.004,
      point.z / MM,
    );
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
