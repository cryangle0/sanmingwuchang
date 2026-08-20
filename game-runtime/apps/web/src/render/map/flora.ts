import { MAP_BOUNDARY, MAP_WALL_PIECES, type MapPointMm } from '@jwgb/content';
import * as THREE from 'three';
import { mergeMixedParts } from './dressing/prop-kit';
import {
  buildFloraModelLayer,
  type DressingModelKind,
  type FloraModelDressingPlacement,
  type FloraModelLayerDiagnostics,
  type FloraModelTreePlacement,
} from './flora-models';
import {
  FloraOcclusionController,
  type FloraOcclusionDiagnostics,
  type FloraTreeOccluderPart,
  type FloraTreeOccluderTarget,
  floraTreeOccluderTarget,
} from './flora-occlusion';
import type { MapMaterialLibrary } from './map-palette';
import { regionAt } from './map-regions';
import { createRandomStream, isOpenGround, sampleOpenGround } from './map-sampling';

/**
 * Region-tinted vegetation and rock dressing for 百眼迷城.
 *
 * Three instanced families — ink-wash trees (trunk + canopy), bamboo clusters
 * and boulders — placed by deterministic rejection sampling on open ground,
 * clear of walls, courts and the road network. Every instance takes its tint
 * from the district it stands in, so 龙脊渊 reads teal-green while 烬水市
 * reads scorched umber from a single glance. Six draw calls total.
 */

const MM = 1_000;

const TREE_COUNT = 360;
const BAMBOO_CLUSTERS = 112;
const BOULDER_COUNT = 196;
const MODEL_DRESSING_MAX = 360;

export interface FloraController {
  setGraphicsTier(tier: 'balanced' | 'reduced'): void;
  setEnabled(enabled: boolean): void;
  update(cameraPosition: THREE.Vector3, focusPosition: THREE.Vector3): void;
  diagnostics(): FloraOcclusionDiagnostics;
  modelDiagnostics(): FloraModelLayerDiagnostics;
  dispose(): void;
}

interface TreePlacement {
  readonly id: string;
  readonly trunkIndex: number;
  readonly trunkMatrix: THREE.Matrix4;
  readonly shadowIndex: number;
  readonly shadowMatrix: THREE.Matrix4;
  readonly x: number;
  readonly z: number;
  readonly size: number;
  readonly yaw: number;
  readonly canopyTiltX: number;
  readonly canopyTiltZ: number;
  readonly canopyX: number;
  readonly canopyZ: number;
  readonly colour: THREE.Color;
  readonly dead: boolean;
  readonly regionId: ReturnType<typeof regionAt>['id'];
}

export function buildFlora(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  seed: number,
  renderer: THREE.WebGLRenderer | null = null,
  graphicsTier: 'balanced' | 'reduced' = 'balanced',
): FloraController {
  const nextRandom = createRandomStream(seed ^ 0x9e3779b9);

  const treePoints = sampleClusteredOpenGround(TREE_COUNT, 72, nextRandom, 5_500, 3_500, 1.4, 9.4);
  const proceduralTrees = new THREE.Group();
  proceduralTrees.name = 'flora-procedural-trees';
  group.add(proceduralTrees);
  const treeBuild = buildTrees(proceduralTrees, materials, track, treePoints, nextRandom);

  const bambooAnchors = sampleOpenGround(280, 7_000, nextRandom, {
    roadVergeMm: 2_400,
  }).filter((point) => {
    const regionId = regionAt(point.x / MM, point.z / MM).id;
    return regionId === 'longji' || regionId === 'baizu';
  });
  const bambooPoints = expandClusteredPoints(
    bambooAnchors,
    BAMBOO_CLUSTERS,
    nextRandom,
    2_000,
    1.2,
    5.8,
  );
  buildBamboo(group, materials, track, bambooPoints, nextRandom);

  const boulderPoints = sampleClusteredOpenGround(
    BOULDER_COUNT,
    90,
    nextRandom,
    2_000,
    1_500,
    0.4,
    6.8,
  );
  const proceduralBoulders = new THREE.Group();
  proceduralBoulders.name = 'flora-procedural-boulders';
  group.add(proceduralBoulders);
  buildBoulders(proceduralBoulders, materials, track, boulderPoints, nextRandom);

  let activeOcclusion = new FloraOcclusionController(treeBuild.targets);
  let enabled = true;
  let disposed = false;
  const modelDressing = sampleModelDressing(nextRandom);
  const modelLayer = buildFloraModelLayer(group, {
    renderer,
    graphicsTier,
    trees: treeBuild.placements,
    rocks: boulderPoints,
    dressing: modelDressing,
    onTreeTargetsChanged(modelTargets): void {
      if (disposed || modelTargets.length === 0) {
        return;
      }
      proceduralTrees.visible = false;
      proceduralBoulders.visible = false;
      activeOcclusion.dispose();
      activeOcclusion = new FloraOcclusionController(modelTargets);
      activeOcclusion.setEnabled(enabled);
    },
  });

  return {
    setGraphicsTier(tier): void {
      modelLayer.setGraphicsTier(tier);
    },
    setEnabled(nextEnabled): void {
      enabled = nextEnabled;
      activeOcclusion.setEnabled(nextEnabled);
    },
    update(cameraPosition, focusPosition): void {
      modelLayer.update(cameraPosition, focusPosition);
      activeOcclusion.update(cameraPosition, focusPosition);
    },
    diagnostics(): FloraOcclusionDiagnostics {
      return activeOcclusion.diagnostics();
    },
    modelDiagnostics(): FloraModelLayerDiagnostics {
      return modelLayer.diagnostics();
    },
    dispose(): void {
      disposed = true;
      activeOcclusion.dispose();
      modelLayer.dispose();
    },
  };
}

function sampleClusteredOpenGround(
  count: number,
  anchorCount: number,
  nextRandom: () => number,
  anchorRoadVergeMm: number,
  pointRoadVergeMm: number,
  minRadiusMeters: number,
  maxRadiusMeters: number,
): MapPointMm[] {
  const anchors = sampleOpenGround(anchorCount, anchorCount * 18, nextRandom, {
    roadVergeMm: anchorRoadVergeMm,
  });
  return expandClusteredPoints(
    anchors,
    count,
    nextRandom,
    pointRoadVergeMm,
    minRadiusMeters,
    maxRadiusMeters,
  );
}

function expandClusteredPoints(
  anchors: readonly MapPointMm[],
  target: number,
  nextRandom: () => number,
  roadVergeMm: number,
  minRadiusMeters: number,
  maxRadiusMeters: number,
): MapPointMm[] {
  const points: MapPointMm[] = [];
  for (const anchor of anchors) {
    const count = 2 + Math.floor(nextRandom() * 4);
    for (let index = 0; index < count && points.length < target; index += 1) {
      const angle = nextRandom() * Math.PI * 2;
      const radius =
        minRadiusMeters + Math.sqrt(nextRandom()) * (maxRadiusMeters - minRadiusMeters);
      const candidate: MapPointMm = {
        x: Math.round(anchor.x + Math.cos(angle) * radius * MM),
        z: Math.round(anchor.z + Math.sin(angle) * radius * MM),
      };
      if (isOpenGround(candidate, { roadVergeMm })) {
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
      ...sampleOpenGround(remaining, Math.max(remaining * 14, 2_000), nextRandom, {
        roadVergeMm,
      }),
    );
  }
  return points;
}

function sampleModelDressing(nextRandom: () => number): readonly FloraModelDressingPlacement[] {
  const placements: FloraModelDressingPlacement[] = [];
  const chooseKind = (x: number, z: number, wallFoot: boolean): DressingModelKind => {
    const regionId = regionAt(x, z).id;
    const choice = nextRandom();
    const asiaBiome = regionId === 'longji' || regionId === 'baizu';
    if (asiaBiome) {
      if (choice < (wallFoot ? 0.42 : 0.28)) {
        return 'asiaBush';
      }
      if (choice < (wallFoot ? 0.62 : 0.46)) {
        return 'reed';
      }
      if (choice < (wallFoot ? 0.82 : 0.7)) {
        return 'smallPlant1';
      }
      if (choice < (wallFoot ? 0.9 : 0.8)) {
        return 'smallPlant2';
      }
    } else if (regionId === 'jinshui' && choice < 0.24) {
      return choice < 0.12 ? 'smallPlant2' : 'reed';
    } else if (wallFoot && choice < 0.18) {
      return 'asiaBush';
    }
    if (wallFoot) {
      return choice < 0.12
        ? 'burdock'
        : choice < 0.72
          ? 'bush'
          : choice < 0.96
            ? 'fern'
            : 'mushroom';
    }
    return choice < 0.18 ? 'burdock' : choice < 0.6 ? 'bush' : choice < 0.92 ? 'fern' : 'mushroom';
  };
  const canPlace = (point: MapPointMm, roadVergeMm: number, minDistance: number): boolean => {
    if (placements.length >= MODEL_DRESSING_MAX || !isOpenGround(point, { roadVergeMm })) {
      return false;
    }
    const x = point.x / MM;
    const z = point.z / MM;
    return placements.every((placement) => {
      const dx = placement.x - x;
      const dz = placement.z - z;
      return dx * dx + dz * dz >= minDistance * minDistance;
    });
  };
  const scaleFor = (kind: DressingModelKind, wallFoot: boolean): number => {
    switch (kind) {
      case 'asiaBush':
        return wallFoot ? 0.62 + nextRandom() * 0.32 : 0.7 + nextRandom() * 0.42;
      case 'reed':
        return wallFoot ? 0.42 + nextRandom() * 0.28 : 0.5 + nextRandom() * 0.34;
      case 'smallPlant1':
        return wallFoot ? 0.72 + nextRandom() * 0.32 : 0.82 + nextRandom() * 0.38;
      case 'smallPlant2':
        return wallFoot ? 0.64 + nextRandom() * 0.34 : 0.72 + nextRandom() * 0.42;
      case 'bush':
        return wallFoot ? 0.62 + nextRandom() * 0.38 : 0.7 + nextRandom() * 0.55;
      case 'fern':
        return wallFoot ? 0.68 + nextRandom() * 0.38 : 0.76 + nextRandom() * 0.52;
      case 'mushroom':
        return wallFoot ? 0.44 + nextRandom() * 0.26 : 0.5 + nextRandom() * 0.34;
      case 'burdock':
        return wallFoot ? 0.72 + nextRandom() * 0.28 : 0.88 + nextRandom() * 0.34;
    }
  };
  const addPlacement = (point: MapPointMm, wallFoot: boolean): void => {
    const x = point.x / MM;
    const z = point.z / MM;
    const kind = chooseKind(x, z, wallFoot);
    const scale = scaleFor(kind, wallFoot);
    placements.push({
      x,
      z,
      scale,
      yaw: nextRandom() * Math.PI * 2,
      kind,
      regionId: regionAt(x, z).id,
    });
  };
  const tryAddPlacement = (
    point: MapPointMm,
    wallFoot: boolean,
    roadVergeMm: number,
    minDistance: number,
  ): boolean => {
    if (!canPlace(point, roadVergeMm, minDistance)) {
      return false;
    }
    addPlacement(point, wallFoot);
    return true;
  };
  const tryAddWallFootPlacement = (point: MapPointMm): boolean => {
    return tryAddPlacement(point, true, 350, 4.2);
  };

  // Keep the open combat lanes readable, then reserve the remaining budget
  // for the wall-foot and landmark perimeter bands below.
  for (const point of sampleOpenGround(150, 7_000, nextRandom, { roadVergeMm: 950 })) {
    tryAddPlacement(point, false, 950, 3.2);
  }
  let regionalAdded = 0;
  for (const point of sampleOpenGround(1_200, 18_000, nextRandom, { roadVergeMm: 700 })) {
    const regionId = regionAt(point.x / MM, point.z / MM).id;
    if (
      (regionId === 'longji' || regionId === 'baizu' || regionId === 'jinshui') &&
      nextRandom() < 0.72 &&
      regionalAdded < 78 &&
      tryAddPlacement(point, false, 700, 3.6)
    ) {
      regionalAdded += 1;
    }
  }

  // Give imported structures a planted silhouette instead of leaving them as
  // isolated meshes. The rejection sampler still keeps these render-only
  // points outside authoritative collision and combat areas.
  const scenicAnchors = [
    { x: -342, z: -68, radius: 15, count: 24 },
    { x: -365, z: 36, radius: 17, count: 20 },
    { x: 333, z: 166, radius: 17, count: 18 },
    { x: -70, z: -56, radius: 14, count: 12 },
  ] as const;
  for (const anchor of scenicAnchors) {
    let added = 0;
    for (let attempt = 0; attempt < anchor.count * 8 && added < anchor.count; attempt += 1) {
      const angle = nextRandom() * Math.PI * 2;
      const radius = anchor.radius + nextRandom() * 9;
      const point: MapPointMm = {
        x: Math.round((anchor.x + Math.cos(angle) * radius) * MM),
        z: Math.round((anchor.z + Math.sin(angle) * radius) * MM),
      };
      if (tryAddPlacement(point, true, 450, 3.8)) {
        added += 1;
      }
    }
  }

  // VAULT pieces are the maze's internal raised terrain and wall volumes.
  // Sample their actual collision edges so vegetation follows the authored
  // silhouette. Alternating the tested side dresses both faces of narrow
  // walls, while the open-ground check naturally rejects the inside of broad
  // terrain islands. W034 surrounds the default spawn, so it gets a denser
  // pass before the rest of the map.
  const vaultPieces = MAP_WALL_PIECES.filter((piece) => piece.wallClass === 'VAULT');
  const prioritizedVaultPieces = [
    ...vaultPieces.filter((piece) => piece.wallId === 'W034'),
    ...vaultPieces.filter((piece) => piece.wallId !== 'W034'),
  ];
  for (const [pieceIndex, piece] of prioritizedVaultPieces.entries()) {
    const dense = piece.wallId === 'W034';
    const spacing = dense ? 8 : 20;
    for (let edgeIndex = 0; edgeIndex < piece.vertices.length; edgeIndex += 1) {
      const a = piece.vertices[edgeIndex] as MapPointMm;
      const b = piece.vertices[(edgeIndex + 1) % piece.vertices.length] as MapPointMm;
      const ax = a.x / MM;
      const az = a.z / MM;
      const bx = b.x / MM;
      const bz = b.z / MM;
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      if (length < (dense ? 4 : 7)) {
        continue;
      }
      const steps = Math.max(1, Math.floor(length / spacing));
      const tangentX = dx / length;
      const tangentZ = dz / length;
      const normalX = -tangentZ;
      const normalZ = tangentX;
      for (let step = 0; step < steps; step += 1) {
        const t = (step + 0.34 + nextRandom() * 0.32) / steps;
        const edgeX = ax + dx * t;
        const edgeZ = az + dz * t;
        const offset = (dense ? 2.9 : 3.3) + nextRandom() * (dense ? 2.3 : 2.7);
        const tangentJitter = (nextRandom() - 0.5) * (dense ? 1.8 : 2.8);
        const preferredSide = (pieceIndex + edgeIndex + step) % 2 === 0 ? 1 : -1;
        for (const side of [preferredSide, -preferredSide]) {
          const candidate: MapPointMm = {
            x: Math.round((edgeX + tangentX * tangentJitter + normalX * offset * side) * MM),
            z: Math.round((edgeZ + tangentZ * tangentJitter + normalZ * offset * side) * MM),
          };
          if (tryAddWallFootPlacement(candidate)) {
            break;
          }
        }
      }
    }
  }

  // A sparse inner wall-foot band breaks the hard cliff silhouette without
  // touching the wall geometry or the authoritative walkable boundary.
  let centroidX = 0;
  let centroidZ = 0;
  for (const point of MAP_BOUNDARY) {
    centroidX += point.x / MM;
    centroidZ += point.z / MM;
  }
  centroidX /= MAP_BOUNDARY.length;
  centroidZ /= MAP_BOUNDARY.length;
  for (let index = 0; index < MAP_BOUNDARY.length; index += 1) {
    const a = MAP_BOUNDARY[index] as MapPointMm;
    const b = MAP_BOUNDARY[(index + 1) % MAP_BOUNDARY.length] as MapPointMm;
    const ax = a.x / MM;
    const az = a.z / MM;
    const bx = b.x / MM;
    const bz = b.z / MM;
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.floor(length / 20));
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps;
      const edgeX = ax + (bx - ax) * t;
      const edgeZ = az + (bz - az) * t;
      const towardCenterX = centroidX - edgeX;
      const towardCenterZ = centroidZ - edgeZ;
      const centerLength = Math.hypot(towardCenterX, towardCenterZ) || 1;
      const offset = 10 + nextRandom() * 8;
      const candidate: MapPointMm = {
        x: Math.round((edgeX + (towardCenterX / centerLength) * offset) * MM),
        z: Math.round((edgeZ + (towardCenterZ / centerLength) * offset) * MM),
      };
      tryAddWallFootPlacement(candidate);
    }
  }
  return placements;
}

function buildTrees(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  points: readonly MapPointMm[],
  nextRandom: () => number,
): {
  readonly targets: readonly FloraTreeOccluderTarget[];
  readonly placements: readonly FloraModelTreePlacement[];
} {
  if (points.length === 0) {
    return { targets: [], placements: [] };
  }
  const trunkGeometry = track(buildTreeTrunkGeometry());
  const canopyGeometry = track(buildTreeCanopyGeometry());
  const deadCanopyGeometry = track(buildDeadTreeCanopyGeometry());
  const shadowGeometry = track(new THREE.CircleGeometry(1, 32));
  shadowGeometry.rotateX(-Math.PI / 2);

  const trunks = new THREE.InstancedMesh(trunkGeometry, materials.floraTrunk, points.length);
  trunks.name = 'flora-trunks';
  trunks.castShadow = false;
  const shadows = new THREE.InstancedMesh(shadowGeometry, materials.floraShadow, points.length);
  shadows.name = 'flora-tree-shadows';
  shadows.castShadow = false;
  shadows.receiveShadow = false;
  shadows.renderOrder = 1;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const districtColour = new THREE.Color();
  const leafyPlacements: TreePlacement[] = [];
  const deadPlacements: TreePlacement[] = [];
  points.forEach((point, index) => {
    const x = point.x / MM;
    const z = point.z / MM;
    const size = 0.96 + nextRandom() * 0.94;
    const yaw = nextRandom() * Math.PI * 2;
    const trunkTilt = (nextRandom() - 0.5) * 0.14;
    const canopyTiltX = (nextRandom() - 0.5) * 0.3;
    const canopyTiltZ = (nextRandom() - 0.5) * 0.3;

    euler.set(0, yaw, trunkTilt);
    quaternion.setFromEuler(euler);
    scale.set(size, size, size);
    position.set(x, 0, z);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(index, matrix);
    const trunkMatrix = matrix.clone();

    const lean = 0.45 * size;
    euler.set(0, yaw, 0);
    quaternion.setFromEuler(euler);
    scale.set(size * 2.25, 1, size * 1.7);
    position.set(x + Math.cos(yaw) * lean * 0.32, 0.021, z + Math.sin(yaw) * lean * 0.32);
    matrix.compose(position, quaternion, scale);
    shadows.setMatrixAt(index, matrix);
    const shadowMatrix = matrix.clone();

    const region = regionAt(x, z);
    districtColour.setHex(region.scatter);
    const shade = 0.6 + nextRandom() * 0.16;
    const dead = region.id === 'jinshui' && nextRandom() < 0.36;
    const colour = new THREE.Color(dead ? 0x614735 : 0x4a6842)
      .lerp(districtColour, dead ? 0.16 : 0.18)
      .multiplyScalar(shade);
    const placement: TreePlacement = {
      id: `tree-${index.toString().padStart(3, '0')}`,
      trunkIndex: index,
      trunkMatrix,
      shadowIndex: index,
      shadowMatrix,
      x,
      z,
      size,
      yaw,
      canopyTiltX,
      canopyTiltZ,
      canopyX: x + Math.cos(yaw) * lean * 0.4,
      canopyZ: z + Math.sin(yaw) * lean * 0.4,
      colour,
      dead,
      regionId: region.id,
    };
    (dead ? deadPlacements : leafyPlacements).push(placement);
  });
  trunks.instanceMatrix.needsUpdate = true;
  shadows.instanceMatrix.needsUpdate = true;
  group.add(trunks);
  group.add(shadows);
  const treeOccluders: FloraTreeOccluderTarget[] = [];

  const buildCanopyInstances = (
    placements: readonly TreePlacement[],
    geometry: THREE.BufferGeometry,
  ): THREE.InstancedMesh | null => {
    if (placements.length === 0) {
      return null;
    }
    const canopies = new THREE.InstancedMesh(geometry, materials.floraCanopy, placements.length);
    canopies.name = 'flora-canopies';
    canopies.castShadow = false;
    placements.forEach((placement, index) => {
      euler.set(
        placement.dead ? placement.canopyTiltX * 0.45 : placement.canopyTiltX,
        placement.yaw,
        placement.dead ? placement.canopyTiltZ * 0.45 : placement.canopyTiltZ,
      );
      quaternion.setFromEuler(euler);
      scale.setScalar(placement.size);
      position.set(
        placement.canopyX,
        (placement.dead ? 3.48 : 3.92) * placement.size,
        placement.canopyZ,
      );
      matrix.compose(position, quaternion, scale);
      canopies.setMatrixAt(index, matrix);
      canopies.setColorAt(index, placement.colour);
      const parts: FloraTreeOccluderPart[] = [
        {
          id: 'shadow',
          mesh: shadows,
          instanceIndex: placement.shadowIndex,
          matrix: placement.shadowMatrix,
          colour: null,
        },
        {
          id: 'trunk',
          mesh: trunks,
          instanceIndex: placement.trunkIndex,
          matrix: placement.trunkMatrix,
          colour: null,
        },
        {
          id: 'canopy',
          mesh: canopies,
          instanceIndex: index,
          matrix: matrix.clone(),
          colour: placement.colour.clone(),
        },
      ];
      treeOccluders.push(floraTreeOccluderTarget(placement.id, parts));
    });
    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) {
      canopies.instanceColor.needsUpdate = true;
    }
    return canopies;
  };

  const leafyCanopies = buildCanopyInstances(leafyPlacements, canopyGeometry);
  const deadCanopies = buildCanopyInstances(deadPlacements, deadCanopyGeometry);
  if (leafyCanopies) {
    group.add(leafyCanopies);
  }
  if (deadCanopies) {
    group.add(deadCanopies);
  }
  return {
    targets: treeOccluders,
    placements: [...leafyPlacements, ...deadPlacements],
  };
}

function buildTreeTrunkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.14, 0.34, 4.35, 7);
  trunk.translate(0, 2.175, 0);
  parts.push(trunk);

  const branchA = new THREE.CylinderGeometry(0.065, 0.15, 1.75, 6);
  branchA.rotateZ(-0.8);
  branchA.translate(0.56, 3.15, 0.08);
  parts.push(branchA);

  const branchB = new THREE.CylinderGeometry(0.055, 0.13, 1.5, 6);
  branchB.rotateZ(0.9);
  branchB.rotateY(1.1);
  branchB.translate(-0.42, 3.42, -0.16);
  parts.push(branchB);

  const branchC = new THREE.CylinderGeometry(0.045, 0.105, 1.18, 5);
  branchC.rotateX(0.62);
  branchC.rotateZ(-0.48);
  branchC.translate(0.1, 3.68, 0.42);
  parts.push(branchC);

  return mergePlainParts(parts, 'tree trunk');
}

function buildTreeCanopyGeometry(): THREE.BufferGeometry {
  const specs = [
    { x: 0, y: 0, z: 0, sx: 1.72, sy: 0.64, sz: 1.48 },
    { x: 1.12, y: 0.16, z: 0.12, sx: 1.18, sy: 0.5, sz: 1.0 },
    { x: -1.02, y: 0.12, z: 0.46, sx: 1.12, sy: 0.48, sz: 1.1 },
    { x: -0.2, y: 0.4, z: -0.94, sx: 1.2, sy: 0.48, sz: 1.0 },
    { x: 0.18, y: 0.72, z: 0.12, sx: 0.98, sy: 0.44, sz: 0.86 },
  ] as const;
  const parts = specs.map((spec) => {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    geometry.scale(spec.sx, spec.sy, spec.sz);
    geometry.translate(spec.x, spec.y, spec.z);
    return geometry;
  });
  return mergePlainParts(parts, 'tree canopy');
}

function buildDeadTreeCanopyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const branchA = new THREE.CylinderGeometry(0.08, 0.15, 1.2, 5);
  branchA.rotateZ(-0.68);
  branchA.translate(0.38, 0.42, 0.02);
  parts.push(branchA);

  const branchB = new THREE.CylinderGeometry(0.06, 0.12, 1.05, 5);
  branchB.rotateZ(0.72);
  branchB.rotateY(1.05);
  branchB.translate(-0.32, 0.56, -0.08);
  parts.push(branchB);

  const branchC = new THREE.CylinderGeometry(0.045, 0.09, 0.8, 5);
  branchC.rotateX(0.52);
  branchC.rotateZ(-0.42);
  branchC.translate(0.08, 0.78, 0.36);
  parts.push(branchC);

  const seedHead = new THREE.DodecahedronGeometry(0.28, 0);
  seedHead.scale(1.1, 0.72, 1.1);
  seedHead.translate(0, 1.04, 0);
  parts.push(seedHead);

  // A few sparse burnt leaf clumps preserve a finished silhouette at gameplay
  // distance. Pure branch sticks made every Jingshui stand read as placeholder
  // geometry instead of a scorched grove.
  for (const spec of [
    { x: 0.56, y: 0.76, z: 0.04, scale: 0.24 },
    { x: -0.45, y: 0.92, z: -0.12, scale: 0.21 },
    { x: 0.06, y: 1.18, z: 0.3, scale: 0.19 },
  ]) {
    const foliage = new THREE.IcosahedronGeometry(spec.scale, 0);
    foliage.scale(1.1, 0.55, 0.9);
    foliage.translate(spec.x, spec.y, spec.z);
    parts.push(foliage);
  }
  return mergePlainParts(parts, 'dead tree canopy');
}

function buildBamboo(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  points: readonly MapPointMm[],
  nextRandom: () => number,
): void {
  if (points.length === 0) {
    return;
  }
  const merged = buildBambooGeometry();
  track(merged);

  const clusters = new THREE.InstancedMesh(merged, materials.floraBamboo, points.length);
  clusters.name = 'flora-bamboo';
  clusters.castShadow = false;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const colour = new THREE.Color();
  const districtColour = new THREE.Color();
  const bambooBase = new THREE.Color(0x586d4b);
  points.forEach((point, index) => {
    const x = point.x / MM;
    const z = point.z / MM;
    const size = 0.9 + nextRandom() * 0.68;
    euler.set(0, nextRandom() * Math.PI * 2, 0);
    quaternion.setFromEuler(euler);
    scale.set(size, size, size);
    position.set(x, 0, z);
    matrix.compose(position, quaternion, scale);
    clusters.setMatrixAt(index, matrix);
    districtColour.setHex(regionAt(x, z).scatter);
    colour.copy(bambooBase).lerp(districtColour, 0.11);
    colour.lerp(new THREE.Color(0x6e725d), 0.16);
    colour.offsetHSL(0.01, -0.025, nextRandom() * 0.02);
    clusters.setColorAt(index, colour);
  });
  clusters.instanceMatrix.needsUpdate = true;
  if (clusters.instanceColor) {
    clusters.instanceColor.needsUpdate = true;
  }
  group.add(clusters);
}

function buildBambooGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const canes = [
    { x: 0, z: 0, height: 4.8, tiltX: 0.03, tiltZ: 0.04 },
    { x: 0.46, z: 0.18, height: 4.2, tiltX: -0.04, tiltZ: -0.08 },
    { x: -0.38, z: 0.42, height: 4.5, tiltX: 0.06, tiltZ: 0.1 },
    { x: 0.12, z: -0.45, height: 3.85, tiltX: -0.08, tiltZ: 0.05 },
    { x: -0.5, z: -0.2, height: 4.05, tiltX: 0.04, tiltZ: -0.06 },
  ] as const;
  canes.forEach((cane, caneIndex) => {
    const stem = new THREE.CylinderGeometry(0.068, 0.105, cane.height, 6);
    stem.rotateX(cane.tiltX);
    stem.rotateZ(cane.tiltZ);
    stem.translate(cane.x, cane.height / 2, cane.z);
    parts.push(stem);

    for (const fraction of [0.24, 0.43, 0.62, 0.8]) {
      const node = new THREE.TorusGeometry(0.098, 0.014, 4, 8);
      node.rotateX(Math.PI / 2);
      node.translate(cane.x, cane.height * fraction, cane.z);
      parts.push(node);
    }

    for (const [leafIndex, fraction] of [0.58, 0.7, 0.81, 0.91].entries()) {
      const angle = caneIndex * 1.37 + leafIndex * 1.71;
      for (const side of [-1, 1] as const) {
        const leaf = new THREE.PlaneGeometry(0.96 + leafIndex * 0.1, 0.21, 1, 1);
        leaf.rotateZ(side * (0.12 + leafIndex * 0.035));
        leaf.rotateX(-0.34 + leafIndex * 0.08);
        leaf.rotateY(angle + (side < 0 ? Math.PI : 0));
        leaf.translate(
          cane.x + Math.cos(angle) * 0.29 * side,
          cane.height * fraction,
          cane.z + Math.sin(angle) * 0.24 * side,
        );
        parts.push(leaf);
      }
    }
  });
  return mergePlainParts(parts, 'bamboo cluster');
}

function mergePlainParts(parts: THREE.BufferGeometry[], label: string): THREE.BufferGeometry {
  for (const geometry of parts) {
    for (const attribute of Object.keys(geometry.attributes)) {
      if (attribute !== 'position' && attribute !== 'normal') {
        geometry.deleteAttribute(attribute);
      }
    }
  }
  // Parts mix indexed cylinders with non-indexed polyhedra, which plain
  // mergeGeometries rejects; the kit helper normalizes the mix first.
  const merged = mergeMixedParts(parts, label);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function buildBoulders(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  points: readonly MapPointMm[],
  nextRandom: () => number,
): void {
  if (points.length === 0) {
    return;
  }
  const geometry = track(new THREE.DodecahedronGeometry(0.9, 0));
  geometry.scale(1, 0.72, 1);
  const boulders = new THREE.InstancedMesh(geometry, materials.floraBoulder, points.length);
  boulders.name = 'flora-boulders';
  boulders.castShadow = true;
  boulders.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const colour = new THREE.Color();
  points.forEach((point, index) => {
    const x = point.x / MM;
    const z = point.z / MM;
    const size = 0.5 + nextRandom() * 1.3;
    euler.set(nextRandom() * 0.4, nextRandom() * Math.PI * 2, nextRandom() * 0.4);
    quaternion.setFromEuler(euler);
    scale.set(size * (0.8 + nextRandom() * 0.5), size, size);
    position.set(x, size * 0.18, z);
    matrix.compose(position, quaternion, scale);
    boulders.setMatrixAt(index, matrix);
    // Boulders lean toward neutral stone but keep a whisper of the district.
    colour.setHex(regionAt(x, z).groundAlt);
    colour.lerp(new THREE.Color(0x777d80), 0.55);
    colour.multiplyScalar(0.9 + nextRandom() * 0.3);
    boulders.setColorAt(index, colour);
  });
  boulders.instanceMatrix.needsUpdate = true;
  if (boulders.instanceColor) {
    boulders.instanceColor.needsUpdate = true;
  }
  group.add(boulders);
}
