import { MAP_CHOKES, MAP_ROUTE_EDGES, MAP_ROUTE_NODES } from '@jwgb/content';
import type { MapRoofOccluderSource } from '../map-occlusion';
import { roofOccluderSource } from '../map-occlusion';
import { addBox, addCylinder, addRoof, type GeometryBag, type Site } from './prop-kit';
import type { DressingBags } from './region-dressing';

const MM = 1_000;

/**
 * 窄关 G1-G4 gates: the 真源 calls these choke points "卡位/陷阱/封路热点",
 * yet they had no visual identity at all. Each choke gets a timber pass gate
 * spanning its road — posts planted on the shoulders, twin beams, a small
 * tiled roof and hanging banners — with the opening kept at least as wide as
 * the road itself so nothing reads as blocked that the sim allows.
 */
export function buildChokeGates(
  bags: DressingBags,
  roofOccluders: MapRoofOccluderSource[],
): number {
  for (const choke of MAP_CHOKES) {
    const nearest = nearestRoadSegment(choke.position.x, choke.position.z);
    const site: Site = {
      x: choke.position.x / MM,
      z: choke.position.z / MM,
      yaw: nearest.yaw,
    };
    const halfSpan = nearest.widthMm / 2 / MM + 1.05;
    const roofs: GeometryBag = [];
    addPassGate(bags, roofs, site, halfSpan);
    roofOccluders.push(roofOccluderSource(`choke-${choke.id}`, roofs));
  }
  return MAP_CHOKES.length;
}

function addPassGate(bags: DressingBags, roofs: GeometryBag, site: Site, halfSpan: number): void {
  const height = 4.3;
  for (const side of [-1, 1]) {
    const x = side * halfSpan;
    addBox(bags.stone, site, x, 0.22, 0, 1.0, 0.44, 1.0);
    addCylinder(bags.timber, site, x, height / 2, 0, 0.16, 0.22, height, 7);
    // Brace and hanging banner on each post.
    addBox(bags.timber, site, x - side * 0.5, height * 0.62, 0, 1.0, 0.09, 0.09, side * 0.45);
    addBox(bags.cloth, site, x - side * 0.28, height - 1.85, 0, 0.44, 2.1, 0.03);
  }
  // Twin lintel beams and the lattice between them.
  addBox(bags.timber, site, 0, height - 0.18, 0, halfSpan * 2 + 0.9, 0.24, 0.3);
  addBox(bags.timber, site, 0, height - 0.78, 0, halfSpan * 2 + 0.5, 0.16, 0.22);
  const struts = Math.max(3, Math.round(halfSpan));
  for (let index = 0; index < struts; index += 1) {
    const x = (index / (struts - 1) - 0.5) * (halfSpan * 2 - 1.2);
    addBox(bags.timber, site, x, height - 0.48, 0, 0.1, 0.46, 0.16);
  }
  // Name plaque and tiled cap.
  addBox(bags.lacquer, site, 0, height + 0.28, 0, 1.5, 0.5, 0.14);
  addBox(bags.gold, site, 0, height + 0.28, 0.08, 1.0, 0.08, 0.02);
  addRoof(roofs, site, 0, height + 0.62, 0, halfSpan * 2 + 1.6, 1.9, 0.72);
}

interface NearestSegment {
  readonly yaw: number;
  readonly widthMm: number;
}

const NODE_POSITIONS = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node.position]));

function nearestRoadSegment(xMm: number, zMm: number): NearestSegment {
  let bestDistance = Number.POSITIVE_INFINITY;
  let best: NearestSegment = { yaw: 0, widthMm: 7_000 };
  for (const edge of MAP_ROUTE_EDGES) {
    const a = NODE_POSITIONS.get(edge.a);
    const b = NODE_POSITIONS.get(edge.b);
    if (!a || !b) {
      continue;
    }
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((xMm - a.x) * dx + (zMm - a.z) * dz) / lengthSquared));
    const offX = xMm - (a.x + t * dx);
    const offZ = zMm - (a.z + t * dz);
    const distance = offX * offX + offZ * offZ;
    if (distance < bestDistance) {
      bestDistance = distance;
      // The gate spans the road, so its yaw faces along the segment.
      best = { yaw: Math.atan2(dx, dz) + Math.PI / 2, widthMm: edge.widthMm };
    }
  }
  return best;
}
