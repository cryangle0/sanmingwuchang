import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Shared primitive kit for procedural map props.
 *
 * Builders compose these into world-space baked parts collected in geometry
 * bags (one bag per material), then merge every bag into a single mesh, so a
 * whole prop family costs one draw call per material. Extracted from the
 * landmark builder so district dressing, chokes and nests reuse the same
 * pipeline; the transforms are byte-identical to the original.
 */

export interface Site {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export type GeometryBag = THREE.BufferGeometry[];

export interface BagRenderSpec {
  readonly name: string;
  readonly geometries: GeometryBag;
  readonly material: THREE.Material;
  readonly castShadow: boolean;
}

/**
 * Merges parts that may mix indexed and non-indexed geometries: three's
 * mergeGeometries refuses such a mix, so when both kinds are present the
 * indexed parts are expanded first. Homogeneous bags merge byte-identically
 * to a plain mergeGeometries call.
 */
export function mergeMixedParts(parts: GeometryBag, label: string): THREE.BufferGeometry {
  const hasIndexed = parts.some((geometry) => geometry.index !== null);
  const hasNonIndexed = parts.some((geometry) => geometry.index === null);
  const compatible =
    hasIndexed && hasNonIndexed
      ? parts.map((geometry) => {
          if (geometry.index === null) {
            return geometry;
          }
          const expanded = geometry.toNonIndexed();
          geometry.dispose();
          return expanded;
        })
      : parts;
  const merged = mergeGeometries(compatible, false);
  if (!merged) {
    throw new Error(`map props: failed to merge ${label}`);
  }
  for (const geometry of compatible) {
    geometry.dispose();
  }
  return merged;
}

/**
 * Merges every non-empty bag into one named mesh under `root` and returns the
 * resulting draw-call count. Source part geometries are disposed; merged
 * geometries are handed to `track` for centralized disposal.
 */
export function mergeBagsIntoGroup(
  root: THREE.Group,
  specs: readonly BagRenderSpec[],
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): number {
  let drawCalls = 0;
  for (const spec of specs) {
    if (spec.geometries.length === 0) {
      continue;
    }
    const merged = mergeMixedParts(spec.geometries, spec.name);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(track(merged), spec.material);
    mesh.name = spec.name;
    mesh.castShadow = spec.castShadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    drawCalls += 1;
  }
  return drawCalls;
}

export function addBox(
  bag: GeometryBag,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  width: number,
  height: number,
  depth: number,
  localYaw = 0,
): void {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  transformAtSite(geometry, site, localX, y, localZ, localYaw);
  bag.push(geometry);
}

export function addCylinder(
  bag: GeometryBag,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
): void {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  transformAtSite(geometry, site, localX, y, localZ);
  bag.push(geometry);
}

export function addCone(
  bag: GeometryBag,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  radius: number,
  height: number,
  segments: number,
): void {
  const geometry = new THREE.ConeGeometry(radius, height, segments);
  transformAtSite(geometry, site, localX, y, localZ);
  bag.push(geometry);
}

export function addHemisphere(
  bag: GeometryBag,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  width: number,
  height: number,
  depth: number,
): void {
  const geometry = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  geometry.scale(width, height, depth);
  transformAtSite(geometry, site, localX, y, localZ);
  bag.push(geometry);
}

export function addFacingDisc(
  bag: GeometryBag,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  width: number,
  height: number,
): void {
  const geometry = new THREE.CircleGeometry(1, 20);
  geometry.scale(width / 2, height / 2, 1);
  transformAtSite(geometry, site, localX, y, localZ);
  bag.push(geometry);
}

export function addDisc(
  bag: GeometryBag,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  width: number,
  depth: number,
  segments: number,
): void {
  const geometry = new THREE.CircleGeometry(0.5, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.scale(width, 1, depth);
  transformAtSite(geometry, site, localX, y, localZ);
  bag.push(geometry);
}

export function addEllipsoid(
  bag: GeometryBag,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  width: number,
  height: number,
  depth: number,
  localYaw = 0,
): void {
  const geometry = new THREE.SphereGeometry(1, 8, 5);
  geometry.scale(width, height, depth);
  transformAtSite(geometry, site, localX, y, localZ, localYaw);
  bag.push(geometry);
}

export function addDodecahedron(
  bag: GeometryBag,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  width: number,
  height: number,
  depth: number,
  localYaw: number,
): void {
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  geometry.scale(width, height, depth);
  transformAtSite(geometry, site, localX, y, localZ, localYaw);
  bag.push(geometry);
}

export function addBeamBetween(
  bag: GeometryBag,
  site: Site,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
  segments: number,
): void {
  const direction = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const length = direction.length();
  if (length === 0) {
    return;
  }
  const geometry = new THREE.CylinderGeometry(radius, radius, length, segments);
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
  );
  geometry.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  transformAtSite(geometry, site, 0, 0, 0);
  bag.push(geometry);
}

export function addHorizontalTorus(
  bag: GeometryBag,
  x: number,
  y: number,
  z: number,
  radius: number,
  tube: number,
  segments: number,
): void {
  const geometry = new THREE.TorusGeometry(radius, tube, 7, segments);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z);
  bag.push(geometry);
}

export function addHorizontalArcTorus(
  bag: GeometryBag,
  site: Site,
  radius: number,
  tube: number,
  start: number,
  arc: number,
  segments: number,
  y: number,
): void {
  const geometry = new THREE.TorusGeometry(radius, tube, 7, segments, arc);
  geometry.rotateX(Math.PI / 2);
  transformAtSite(geometry, site, 0, y, 0, start);
  bag.push(geometry);
}

export function addHorizontalRing(
  bag: GeometryBag,
  x: number,
  y: number,
  z: number,
  innerRadius: number,
  outerRadius: number,
  segments: number,
): void {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(x, y, z);
  bag.push(geometry);
}

/** Hipped roof cap plus eave boxes and a ridge beam, all in one bag. */
export function addRoof(
  bag: GeometryBag,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  width: number,
  depth: number,
  height: number,
): void {
  const geometry = createHippedRoofGeometry(width, depth, height);
  transformAtSite(geometry, site, localX, y, localZ);
  bag.push(geometry);

  const eaveDepth = Math.max(0.12, Math.min(width, depth) * 0.055);
  addBox(bag, site, localX, y + 0.02, localZ - depth / 2, width * 1.02, eaveDepth, eaveDepth);
  addBox(bag, site, localX, y + 0.02, localZ + depth / 2, width * 1.02, eaveDepth, eaveDepth);
  addBox(bag, site, localX - width / 2, y + 0.02, localZ, eaveDepth, eaveDepth, depth);
  addBox(bag, site, localX + width / 2, y + 0.02, localZ, eaveDepth, eaveDepth, depth);
  const ridgeHalf = Math.max(width * 0.17, (width - depth) * 0.32);
  addBeamBetween(
    bag,
    site,
    localX - ridgeHalf,
    y + height + 0.04,
    localZ,
    localX + ridgeHalf,
    y + height + 0.04,
    localZ,
    Math.max(0.07, eaveDepth * 0.48),
    8,
  );
}

export function createHippedRoofGeometry(
  width: number,
  depth: number,
  height: number,
): THREE.BufferGeometry {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const cornerLift = Math.min(0.28, height * 0.2);
  const ridgeHalf = Math.max(width * 0.17, (width - depth) * 0.32);
  const points: readonly [number, number, number][] = [
    [-halfWidth, cornerLift, -halfDepth],
    [0, 0, -halfDepth * 1.04],
    [halfWidth, cornerLift, -halfDepth],
    [halfWidth * 1.04, 0, 0],
    [halfWidth, cornerLift, halfDepth],
    [0, 0, halfDepth * 1.04],
    [-halfWidth, cornerLift, halfDepth],
    [-halfWidth * 1.04, 0, 0],
    [-ridgeHalf, height, 0],
    [ridgeHalf, height, 0],
  ];
  const positions = points.flat();
  const uvs = points.flatMap(([x, _y, z]) => [x / width + 0.5, z / depth + 0.5]);
  const indices = [
    0, 1, 8, 1, 9, 8, 1, 2, 9, 2, 3, 9, 3, 4, 9, 4, 5, 9, 5, 8, 9, 5, 6, 8, 6, 7, 8, 7, 0, 8,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function transformAtSite(
  geometry: THREE.BufferGeometry,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  localYaw = 0,
): void {
  const position = offsetFromSite(site, localX, localZ);
  geometry.rotateY(site.yaw + localYaw);
  geometry.translate(position.x, y, position.z);
}

export function shiftedSite(site: Site, localX: number, localZ: number): Site {
  const position = offsetFromSite(site, localX, localZ);
  return { ...position, yaw: site.yaw };
}

export function offsetFromSite(
  site: Site,
  localX: number,
  localZ: number,
): { x: number; z: number } {
  const cosine = Math.cos(site.yaw);
  const sine = Math.sin(site.yaw);
  return {
    x: site.x + localX * cosine + localZ * sine,
    z: site.z - localX * sine + localZ * cosine,
  };
}

export function siteTowardOrigin(x: number, z: number): Site {
  return { x, z, yaw: yawToward(x, z, 0, 0) };
}

export function yawToward(x: number, z: number, targetX: number, targetZ: number): number {
  return Math.atan2(targetX - x, targetZ - z);
}
