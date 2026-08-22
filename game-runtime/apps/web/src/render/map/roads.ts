import { MAP_ROUTE_EDGES, MAP_ROUTE_NODES, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';

/**
 * Builds the authored route network as direction-aware ribbons.
 *
 * UV +X follows each route edge and UV +Y spans its width, so packed-earth
 * ruts and stone courses follow travel instead of rotating with world space.
 * A slightly wider earth shoulder sits below every route to blend the hard
 * gameplay width into the surrounding ground. All shoulders merge into one
 * draw call and the three authored road families remain one draw call each.
 */

const MM = 1_000;
const SHOULDER_LIFT = 0.012;
const MAJOR_LIFT = 0.06;
const MINOR_LIFT = 0.035;
const RISK_LIFT = 0.045;
export const MAX_ROAD_SURFACE_Y = Math.max(MAJOR_LIFT, MINOR_LIFT, RISK_LIFT);

const ROAD_RENDER_ORDER = {
  shoulder: 1,
  minor: 2,
  risk: 3,
  major: 4,
} as const;

type VisualClass = 'major' | 'minor' | 'risk';
type RoadLayer = VisualClass | 'shoulder';
type RouteNodeId = (typeof MAP_ROUTE_NODES)[number]['id'];

interface PointMeters {
  readonly x: number;
  readonly z: number;
}

class RibbonGeometryAccumulator {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];

  addSegment(a: PointMeters, b: PointMeters, halfWidth: number, y: number): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length === 0) {
      return;
    }
    const nx = (-dz / length) * halfWidth;
    const nz = (dx / length) * halfWidth;
    const leftA = { x: a.x + nx, z: a.z + nz };
    const rightA = { x: a.x - nx, z: a.z - nz };
    const rightB = { x: b.x - nx, z: b.z - nz };
    const leftB = { x: b.x + nx, z: b.z + nz };
    const width = halfWidth * 2;

    this.pushVertex(leftA, surfaceY(leftA, y), 0, width);
    this.pushVertex(rightB, surfaceY(rightB, y), length, 0);
    this.pushVertex(rightA, surfaceY(rightA, y), 0, 0);
    this.pushVertex(leftA, surfaceY(leftA, y), 0, width);
    this.pushVertex(leftB, surfaceY(leftB, y), length, width);
    this.pushVertex(rightB, surfaceY(rightB, y), length, 0);
  }

  addJoint(centre: PointMeters, radius: number, y: number): void {
    const corners = 12;
    for (let index = 0; index < corners; index += 1) {
      const angleA = (index / corners) * Math.PI * 2;
      const angleB = ((index + 1) / corners) * Math.PI * 2;
      const a = {
        x: centre.x + Math.cos(angleA) * radius,
        z: centre.z + Math.sin(angleA) * radius,
      };
      const b = {
        x: centre.x + Math.cos(angleB) * radius,
        z: centre.z + Math.sin(angleB) * radius,
      };
      this.pushVertex(centre, surfaceY(centre, y), radius, radius);
      this.pushVertex(
        b,
        surfaceY(b, y),
        radius + Math.cos(angleB) * radius,
        radius + Math.sin(angleB) * radius,
      );
      this.pushVertex(
        a,
        surfaceY(a, y),
        radius + Math.cos(angleA) * radius,
        radius + Math.sin(angleA) * radius,
      );
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  get isEmpty(): boolean {
    return this.positions.length === 0;
  }

  private pushVertex(point: PointMeters, y: number, u: number, v: number): void {
    this.positions.push(point.x, y, point.z);
    this.uvs.push(u, v);
  }
}

function surfaceY(point: PointMeters, lift: number): number {
  return terrainHeightMeters(point.x, point.z) + lift;
}

function visualClassOf(roadClass: string): VisualClass {
  switch (roadClass) {
    case 'MAIN':
    case 'COURT':
      return 'major';
    case 'RISK':
    case 'BREACH':
      return 'risk';
    default:
      return 'minor';
  }
}

function shoulderWidth(visual: VisualClass): number {
  switch (visual) {
    case 'major':
      return 1.05;
    case 'minor':
      return 0.75;
    case 'risk':
      return 0.55;
  }
}

function configureRoadOverlay(mesh: THREE.Mesh, layer: RoadLayer): void {
  mesh.name = `map-road-${layer}`;
  mesh.renderOrder = ROAD_RENDER_ORDER[layer];

  // Segments, node caps, and crossing routes intentionally overlap. Keeping
  // these overlays out of the depth buffer makes their fixed draw order win
  // deterministically instead of producing camera-dependent z-fighting.
  const material = mesh.material as THREE.Material;
  material.depthWrite = false;
  material.depthTest = true;
  material.polygonOffset = false;
  material.needsUpdate = true;
}

export function buildRoadRibbons(
  addMesh: (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    options?: { castShadow?: boolean; receiveShadow?: boolean },
  ) => THREE.Mesh,
  materials: MapMaterialLibrary,
): void {
  const nodePositions = new Map(
    MAP_ROUTE_NODES.map((node) => [
      node.id,
      { x: node.position.x / MM, z: node.position.z / MM } satisfies PointMeters,
    ]),
  );
  const accumulators: Record<VisualClass, RibbonGeometryAccumulator> = {
    major: new RibbonGeometryAccumulator(),
    minor: new RibbonGeometryAccumulator(),
    risk: new RibbonGeometryAccumulator(),
  };
  const shoulders = new RibbonGeometryAccumulator();
  const lifts: Record<VisualClass, number> = {
    major: MAJOR_LIFT,
    minor: MINOR_LIFT,
    risk: RISK_LIFT,
  };
  const jointRadius: Record<VisualClass, Map<RouteNodeId, number>> = {
    major: new Map(),
    minor: new Map(),
    risk: new Map(),
  };
  const shoulderJointRadius = new Map<RouteNodeId, number>();

  for (const edge of MAP_ROUTE_EDGES) {
    const a = nodePositions.get(edge.a);
    const b = nodePositions.get(edge.b);
    if (!a || !b) {
      continue;
    }
    const visual = visualClassOf(edge.roadClass);
    const halfWidth = edge.widthMm / 2 / MM;
    const shoulderHalfWidth = halfWidth + shoulderWidth(visual);
    accumulators[visual].addSegment(a, b, halfWidth, lifts[visual]);
    shoulders.addSegment(a, b, shoulderHalfWidth, SHOULDER_LIFT);

    for (const nodeId of [edge.a, edge.b]) {
      jointRadius[visual].set(nodeId, Math.max(jointRadius[visual].get(nodeId) ?? 0, halfWidth));
      shoulderJointRadius.set(
        nodeId,
        Math.max(shoulderJointRadius.get(nodeId) ?? 0, shoulderHalfWidth),
      );
    }
  }

  for (const [nodeId, radius] of shoulderJointRadius) {
    const centre = nodePositions.get(nodeId);
    if (centre) {
      shoulders.addJoint(centre, radius, SHOULDER_LIFT);
    }
  }
  if (!shoulders.isEmpty) {
    configureRoadOverlay(addMesh(shoulders.build(), materials.roadShoulder), 'shoulder');
  }

  const materialOf: Record<VisualClass, THREE.Material> = {
    major: materials.roadMajor,
    minor: materials.roadMinor,
    risk: materials.roadRisk,
  };
  for (const visual of ['minor', 'risk', 'major'] as const) {
    for (const [nodeId, radius] of jointRadius[visual]) {
      const centre = nodePositions.get(nodeId);
      if (centre) {
        accumulators[visual].addJoint(centre, radius, lifts[visual]);
      }
    }
    if (!accumulators[visual].isEmpty) {
      configureRoadOverlay(addMesh(accumulators[visual].build(), materialOf[visual]), visual);
    }
  }
}
