/**
 * Browser-side builders for the 百眼迷城 architecture family.
 *
 * Every building is assembled from three.js primitives in local metres with the
 * ground plane at y = 0 and the front facing +Z, then merged into ONE mesh that
 * carries per-vertex colour. A single vertex-coloured material keeps the whole
 * family at one draw call per building type once the runtime instances it, so
 * the map can gain dozens of buildings without adding dozens of draw calls.
 *
 * Style rules (唐宋 / 西游):
 * - 石台基 + 朱红立柱 + 白墙 + 青灰瓦 + 金饰, matching `map-palette.ts`.
 * - Roofs use the same lifted-corner hipped profile as the procedural props.
 * - 匾额, 灯笼, 经幡 and 石狮 carry the theme without any texture payload.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** sRGB palette sampled from the existing map material library. */
const C = {
  stone: 0xa39c8c,
  stoneDark: 0x8b8578,
  plaster: 0xded7c4,
  plasterShade: 0xc3bca8,
  timber: 0x7c4a32,
  timberDark: 0x54321f,
  lacquer: 0xa74436,
  lacquerDark: 0x7d2f26,
  roof: 0x56646c,
  roofDark: 0x424f57,
  gold: 0xc79a3e,
  cloth: 0xb8462f,
  lamp: 0xffd9a2,
  bronze: 0x8d7b4a,
  soil: 0x6d5c46,
};

function tint(geometry, hex) {
  // THREE.Color stores working-space (linear) values, which is what glTF
  // COLOR_0 expects, so the palette survives the export unchanged.
  const color = new THREE.Color(hex);
  const position = geometry.getAttribute('position');
  const array = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    array[index * 3] = color.r;
    array[index * 3 + 1] = color.g;
    array[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
  return geometry;
}

/**
 * Lifted-corner hipped roof, identical in profile to the procedural landmark
 * roofs so imported and procedural architecture read as one style. The eave
 * line sits at y = 0 and the ridge at y = height.
 */
function hippedRoofGeometry(width, depth, height) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const cornerLift = Math.min(0.3, height * 0.22);
  const ridgeHalf = Math.max(width * 0.17, (width - depth) * 0.32);
  const points = [
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

class Building {
  constructor(id, displayName) {
    this.id = id;
    this.displayName = displayName;
    this.parts = [];
  }

  push(geometry, hex, x = 0, y = 0, z = 0, yaw = 0) {
    const placed = geometry;
    if (yaw !== 0) {
      placed.rotateY(yaw);
    }
    placed.translate(x, y, z);
    this.parts.push(tint(placed, hex));
    return this;
  }

  /** Axis-aligned block; `y` is the centre height. */
  box(hex, width, height, depth, x, y, z, yaw = 0) {
    return this.push(new THREE.BoxGeometry(width, height, depth), hex, x, y, z, yaw);
  }

  cylinder(hex, radiusTop, radiusBottom, height, segments, x, y, z, yaw = 0) {
    return this.push(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
      hex,
      x,
      y,
      z,
      yaw,
    );
  }

  cone(hex, radius, height, segments, x, y, z, yaw = 0) {
    return this.push(new THREE.ConeGeometry(radius, height, segments), hex, x, y, z, yaw);
  }

  sphere(hex, radius, x, y, z, widthSegments = 8, heightSegments = 6) {
    return this.push(new THREE.SphereGeometry(radius, widthSegments, heightSegments), hex, x, y, z);
  }

  torus(hex, radius, tube, arc, x, y, z, yaw = 0) {
    return this.push(new THREE.TorusGeometry(radius, tube, 5, 10, arc), hex, x, y, z, yaw);
  }

  /** Hipped roof whose eave line sits at `y`. */
  roof(hex, width, depth, height, x, y, z, yaw = 0) {
    return this.push(hippedRoofGeometry(width, depth, height), hex, x, y, z, yaw);
  }

  /** Roof plus ridge beam, the standard two-piece cap. */
  roofWithRidge(hex, width, depth, height, x, y, z, yaw = 0) {
    this.roof(hex, width, depth, height, x, y, z, yaw);
    this.box(C.gold, width * 0.34, 0.16, 0.2, x, y + height + 0.06, z, yaw);
    return this;
  }

  /** Pyramidal roof (square when segments = 4). */
  pyramid(hex, radius, height, segments, x, y, z, yaw = 0) {
    return this.cone(hex, radius, height, segments, x, y + height / 2, z, yaw);
  }

  /**
   * 匾额: gold plaque board that gives every gate, hall and paifang its name
   * board without a texture.
   */
  plaque(x, y, z, width = 1.5, yaw = 0) {
    this.box(C.timberDark, width + 0.16, 0.72, 0.1, x, y, z, yaw);
    this.box(C.gold, width, 0.54, 0.08, x, y, z + 0.04, yaw);
    return this;
  }

  /** Hanging lantern: warm body between two dark caps. */
  lantern(x, y, z, scale = 1) {
    this.cylinder(C.timberDark, 0.02, 0.02, 0.34 * scale, 4, x, y + 0.42 * scale, z);
    this.cylinder(
      C.timberDark,
      0.16 * scale,
      0.16 * scale,
      0.06 * scale,
      8,
      x,
      y + 0.24 * scale,
      z,
    );
    this.cylinder(C.lamp, 0.2 * scale, 0.2 * scale, 0.4 * scale, 8, x, y, z);
    this.cylinder(C.timberDark, 0.1 * scale, 0.1 * scale, 0.05 * scale, 8, x, y - 0.22 * scale, z);
    return this;
  }

  /** Vertical banner on a slim mast, the 酒旗 / 经幡 silhouette. */
  banner(x, y, z, width = 0.7, height = 1.9, yaw = 0) {
    this.cylinder(C.timber, 0.05, 0.06, height + 0.5, 5, x, y + (height + 0.5) / 2 - 0.3, z);
    this.box(C.cloth, width, height, 0.04, x + width / 2 + 0.05, y + height / 2 + 0.1, z, yaw);
    this.box(C.gold, width + 0.1, 0.08, 0.06, x + width / 2 + 0.05, y + height + 0.14, z, yaw);
    return this;
  }

  /** Balustrade around a 平座 or 回廊 edge. */
  railing(hex, width, depth, x, y, z, yaw = 0) {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    this.box(hex, width, 0.09, 0.09, x, y + 0.5, z - halfDepth, yaw);
    this.box(hex, width, 0.09, 0.09, x, y + 0.5, z + halfDepth, yaw);
    this.box(hex, 0.09, 0.09, depth, x - halfWidth, y + 0.5, z, yaw);
    this.box(hex, 0.09, 0.09, depth, x + halfWidth, y + 0.5, z, yaw);
    const bays = Math.max(2, Math.round(width / 1.1));
    for (let index = 0; index <= bays; index += 1) {
      const offset = -halfWidth + (width * index) / bays;
      this.box(hex, 0.07, 0.52, 0.07, x + offset, y + 0.26, z - halfDepth, yaw);
      this.box(hex, 0.07, 0.52, 0.07, x + offset, y + 0.26, z + halfDepth, yaw);
    }
    return this;
  }

  /** Stone step flight in front of a platform, descending toward +Z. */
  stairs(hex, width, totalHeight, steps, x, y, z) {
    const rise = totalHeight / steps;
    const run = rise * 1.6;
    for (let index = 0; index < steps; index += 1) {
      this.box(
        hex,
        width - index * 0.06,
        rise,
        run,
        x,
        y + totalHeight - rise * (index + 0.5),
        z + run * (index + 0.5),
      );
    }
    return this;
  }

  /**
   * 石狮 on a plinth: blocky but recognisable at map distance.
   */
  stoneLion(x, y, z, yaw = 0) {
    this.box(C.stoneDark, 0.7, 0.5, 0.7, x, y + 0.25, z, yaw);
    this.box(C.stone, 0.5, 0.6, 0.62, x, y + 0.8, z, yaw);
    this.box(C.stone, 0.42, 0.42, 0.4, x, y + 1.28, z - 0.08, yaw);
    this.box(C.stone, 0.3, 0.26, 0.26, x, y + 1.5, z - 0.24, yaw);
    return this;
  }

  toScene() {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) {
      throw new Error(`buildings: failed to merge ${this.id}`);
    }
    for (const part of this.parts) {
      part.dispose();
    }
    merged.computeBoundingBox();
    // Buildings are authored with the ground plane at y = 0; re-ground after
    // merging so a stray part can never lift the footprint off the terrain.
    const bounds = merged.boundingBox;
    if (bounds && Math.abs(bounds.min.y) > 1e-4) {
      merged.translate(0, -bounds.min.y, 0);
      merged.computeBoundingBox();
    }
    merged.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      name: `${this.id}-body`,
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.04,
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = this.id;
    const scene = new THREE.Scene();
    scene.name = this.id;
    scene.add(mesh);
    return scene;
  }
}

/** 重檐大殿: the map's signature hall, used for 百足城 and 万劫庭. */
function buildHall() {
  const b = new Building('tang-hall', '重檐大殿');
  b.box(C.stone, 12.2, 0.5, 9.0, 0, 0.25, 0);
  b.box(C.stone, 10.8, 0.45, 7.8, 0, 0.72, 0);
  b.stairs(C.stone, 5.0, 0.95, 3, 0, 0, 4.4);
  for (const x of [-4.3, -1.45, 1.45, 4.3]) {
    for (const z of [-2.7, 2.7]) {
      b.cylinder(C.lacquer, 0.26, 0.28, 3.9, 8, x, 2.9, z);
      b.cylinder(C.stoneDark, 0.4, 0.44, 0.3, 8, x, 1.1, z);
    }
  }
  b.box(C.plaster, 8.0, 3.5, 4.9, 0, 2.7, 0);
  b.box(C.lacquer, 2.0, 2.7, 0.18, 0, 2.4, 2.5);
  b.box(C.gold, 1.6, 2.2, 0.1, 0, 2.35, 2.58);
  for (const x of [-2.9, 2.9]) {
    b.box(C.timberDark, 1.3, 1.2, 0.14, x, 3.0, 2.5);
    b.box(C.gold, 1.0, 0.9, 0.08, x, 3.0, 2.56);
  }
  b.roofWithRidge(C.roof, 12.6, 9.4, 2.0, 0, 4.45, 0);
  b.box(C.plasterShade, 7.0, 1.7, 4.0, 0, 7.0, 0);
  b.railing(C.lacquer, 7.4, 4.4, 0, 6.15, 0);
  for (const x of [-3.2, -1.1, 1.1, 3.2]) {
    b.cylinder(C.lacquer, 0.2, 0.22, 1.5, 8, x, 7.2, 1.9);
    b.cylinder(C.lacquer, 0.2, 0.22, 1.5, 8, x, 7.2, -1.9);
  }
  b.roofWithRidge(C.roofDark, 9.4, 6.4, 2.3, 0, 7.85, 0);
  b.plaque(0, 5.7, 2.62, 1.8);
  b.box(C.gold, 0.5, 0.9, 0.34, -4.6, 6.6, 0);
  b.box(C.gold, 0.5, 0.9, 0.34, 4.6, 6.6, 0);
  b.lantern(-3.4, 4.0, 2.9, 1.15);
  b.lantern(3.4, 4.0, 2.9, 1.15);
  return b;
}

/** 五层八角宝塔. */
function buildPagoda() {
  const b = new Building('tang-pagoda', '八角宝塔');
  b.cylinder(C.stone, 3.4, 3.9, 1.0, 8, 0, 0.5, 0);
  b.cylinder(C.stoneDark, 3.0, 3.2, 0.4, 8, 0, 1.2, 0);
  let y = 1.4;
  for (let tier = 0; tier < 5; tier += 1) {
    const radius = 2.25 - tier * 0.3;
    const height = 2.5 - tier * 0.14;
    b.cylinder(C.plaster, radius, radius * 1.02, height, 8, 0, y + height / 2, 0);
    for (let face = 0; face < 4; face += 1) {
      const angle = (face / 4) * Math.PI * 2;
      const x = Math.sin(angle) * radius * 0.98;
      const z = Math.cos(angle) * radius * 0.98;
      b.box(C.lacquerDark, 0.62, 1.3, 0.16, x, y + height * 0.55, z, angle);
      b.box(C.gold, 0.42, 1.0, 0.1, x * 1.01, y + height * 0.55, z * 1.01, angle);
    }
    y += height;
    b.pyramid(C.roof, radius * 1.85, 0.85, 8, 0, y - 0.06, 0);
    b.railing(C.lacquer, radius * 1.5, radius * 1.5, 0, y + 0.12, 0);
    b.cylinder(C.roofDark, radius * 0.42, radius * 0.42, 0.22, 8, 0, y + 1.02, 0);
    y += 0.95;
  }
  b.pyramid(C.roofDark, 1.5, 1.3, 8, 0, y - 0.1, 0);
  b.cylinder(C.gold, 0.16, 0.2, 1.5, 8, 0, y + 1.5, 0);
  for (const ring of [0, 1, 2]) {
    b.cylinder(C.gold, 0.42 - ring * 0.05, 0.42 - ring * 0.05, 0.1, 8, 0, y + 1.05 + ring * 0.4, 0);
  }
  b.sphere(C.gold, 0.3, 0, y + 2.45, 0);
  return b;
}

/** 三门四柱牌坊. */
function buildPaifang() {
  const b = new Building('tang-paifang', '牌坊');
  for (const x of [-3.1, -1.35, 1.35, 3.1]) {
    b.box(C.stoneDark, 1.0, 0.5, 1.0, x, 0.25, 0);
    b.cylinder(C.stone, 0.34, 0.38, 5.2, 8, x, 2.85, 0);
    b.box(C.stone, 0.7, 0.3, 0.7, x, 5.5, 0);
  }
  b.box(C.timber, 7.4, 0.46, 0.55, 0, 5.15, 0);
  b.box(C.lacquer, 7.0, 0.3, 0.6, 0, 4.72, 0);
  for (const x of [-2.2, 2.2]) {
    b.box(C.timber, 2.9, 0.4, 0.5, x, 3.85, 0);
    b.box(C.lacquer, 2.7, 0.26, 0.55, x, 3.5, 0);
  }
  b.roofWithRidge(C.roof, 3.4, 1.5, 0.95, 0, 5.4, 0);
  for (const x of [-2.2, 2.2]) {
    b.roof(C.roof, 3.1, 1.4, 0.9, x, 4.1, 0);
  }
  b.plaque(0, 5.5, 0.34, 1.9);
  b.box(C.gold, 0.34, 0.62, 0.34, -3.1, 5.95, 0);
  b.box(C.gold, 0.34, 0.62, 0.34, 3.1, 5.95, 0);
  b.stoneLion(-4.6, 0, 0.6, 0.3);
  b.stoneLion(4.6, 0, 0.6, -0.3);
  return b;
}

/** 城门楼: wall block, arch passage, crenellations, hall and banners. */
function buildGateTower() {
  const b = new Building('tang-gate-tower', '城门楼');
  b.box(C.stoneDark, 14.0, 0.4, 5.2, 0, 0.2, 0);
  b.box(C.stone, 13.0, 5.4, 4.4, 0, 2.9, 0);
  b.box(C.timberDark, 3.0, 3.4, 4.6, 0, 1.9, 0);
  b.torus(C.stoneDark, 1.5, 0.24, Math.PI, 0, 3.6, 2.24, 0);
  b.torus(C.stoneDark, 1.5, 0.24, Math.PI, 0, 3.6, -2.24, 0);
  b.box(C.lacquer, 3.4, 0.4, 4.7, 0, 5.3, 0);
  for (let index = -3; index <= 3; index += 1) {
    b.box(C.stone, 0.9, 0.85, 0.55, index * 1.8, 6.05, 2.0);
    b.box(C.stone, 0.9, 0.85, 0.55, index * 1.8, 6.05, -2.0);
  }
  b.box(C.timber, 7.6, 0.35, 3.6, 0, 6.75, 0);
  for (const x of [-3.2, -1.1, 1.1, 3.2]) {
    b.cylinder(C.lacquer, 0.22, 0.24, 2.8, 8, x, 8.3, 1.5);
    b.cylinder(C.lacquer, 0.22, 0.24, 2.8, 8, x, 8.3, -1.5);
  }
  b.box(C.plaster, 6.4, 2.6, 2.8, 0, 8.2, 0);
  b.roofWithRidge(C.roof, 9.4, 5.0, 2.0, 0, 9.5, 0);
  b.plaque(0, 9.1, 1.46, 1.7);
  b.lantern(-3.6, 7.0, 2.3, 1.1);
  b.lantern(3.6, 7.0, 2.3, 1.1);
  b.banner(-5.6, 6.9, -1.2, 0.8, 2.1);
  b.banner(5.6, 6.9, -1.2, 0.8, 2.1);
  return b;
}

/** 两层客栈 with 酒旗 and lanterns. */
function buildInn() {
  const b = new Building('tang-inn', '客栈');
  b.box(C.stone, 9.0, 0.55, 7.0, 0, 0.28, 0);
  b.stairs(C.stone, 3.0, 0.55, 2, 0, 0, 3.6);
  b.box(C.plaster, 7.4, 3.2, 5.2, 0, 2.15, 0);
  b.box(C.timber, 8.0, 0.34, 5.8, 0, 3.9, 0);
  b.box(C.lacquer, 2.2, 2.6, 0.16, -2.2, 1.85, 2.62);
  b.box(C.gold, 1.8, 2.2, 0.1, -2.2, 1.85, 2.68);
  for (const x of [0.5, 2.6]) {
    b.box(C.timberDark, 1.5, 1.4, 0.14, x, 2.3, 2.62);
    b.box(C.gold, 1.2, 1.1, 0.08, x, 2.3, 2.68);
  }
  b.roofWithRidge(C.roofDark, 9.6, 7.2, 1.4, 0, 4.1, 0);
  b.box(C.plaster, 6.4, 2.7, 4.2, 0, 6.0, 0);
  b.railing(C.lacquer, 7.0, 4.8, 0, 4.72, 0);
  for (const x of [-2.4, 0, 2.4]) {
    b.box(C.timberDark, 1.4, 1.5, 0.14, x, 6.0, 2.12);
    b.box(C.gold, 1.1, 1.2, 0.08, x, 6.0, 2.18);
  }
  b.roofWithRidge(C.roof, 9.0, 6.4, 2.1, 0, 7.35, 0);
  b.plaque(0, 7.0, 2.2, 1.6);
  b.banner(4.3, 4.4, 2.0, 0.85, 2.3);
  b.lantern(-3.6, 4.05, 2.7, 1.2);
  b.lantern(3.6, 4.05, 2.7, 1.2);
  return b;
}

/** 茶棚: open tea shelter with counter, benches and a streamer. */
function buildTeahouse() {
  const b = new Building('tang-teahouse', '茶棚');
  b.box(C.soil, 6.6, 0.18, 5.4, 0, 0.09, 0);
  for (const x of [-2.9, 2.9]) {
    for (const z of [-2.3, 2.3]) {
      b.box(C.stoneDark, 0.5, 0.3, 0.5, x, 0.33, z);
      b.cylinder(C.timber, 0.17, 0.19, 2.9, 6, x, 1.75, z);
    }
  }
  b.box(C.timber, 6.4, 0.26, 0.28, 0, 3.3, -2.3);
  b.box(C.timber, 6.4, 0.26, 0.28, 0, 3.3, 2.3);
  b.box(C.timber, 0.24, 0.24, 4.8, -2.9, 3.3, 0);
  b.box(C.timber, 0.24, 0.24, 4.8, 2.9, 3.3, 0);
  b.roofWithRidge(C.roof, 7.8, 6.2, 1.5, 0, 3.5, 0);
  b.box(C.timber, 3.0, 0.95, 0.7, -1.2, 0.62, 0.4);
  b.box(C.stone, 3.2, 0.12, 0.9, -1.2, 1.15, 0.4);
  for (const x of [1.6, 2.8]) {
    b.box(C.timber, 0.9, 0.14, 0.9, x, 0.5, -1.4);
    b.box(C.timber, 0.14, 0.4, 0.14, x - 0.32, 0.28, -1.4);
    b.box(C.timber, 0.14, 0.4, 0.14, x + 0.32, 0.28, -1.4);
  }
  b.cylinder(C.bronze, 0.42, 0.34, 0.6, 8, 2.4, 0.4, 1.9);
  b.cylinder(C.lamp, 0.3, 0.3, 0.1, 8, 2.4, 0.75, 1.9);
  b.banner(-3.5, 2.9, 1.4, 0.7, 1.7);
  return b;
}

/** 土地庙: small shrine with incense burner and lion pair. */
function buildShrine() {
  const b = new Building('tang-shrine', '土地庙');
  b.box(C.stone, 4.4, 0.4, 3.8, 0, 0.2, 0);
  b.box(C.plaster, 3.2, 2.1, 2.6, 0, 1.45, 0);
  b.box(C.lacquerDark, 1.2, 1.4, 0.16, 0, 1.1, 1.34);
  b.box(C.lamp, 0.9, 1.0, 0.08, 0, 1.1, 1.4);
  b.box(C.timber, 3.8, 0.28, 3.2, 0, 2.62, 0);
  b.roofWithRidge(C.roof, 4.6, 3.8, 1.2, 0, 2.75, 0);
  b.plaque(0, 3.2, 1.6, 1.0);
  b.cylinder(C.bronze, 0.4, 0.3, 0.55, 8, 0, 0.85, 2.5);
  b.cylinder(C.bronze, 0.46, 0.46, 0.1, 8, 0, 1.15, 2.5);
  b.cylinder(C.timberDark, 0.05, 0.05, 0.5, 5, 0, 1.4, 2.5);
  b.stoneLion(-2.2, 0, 2.3, 0.25);
  b.stoneLion(2.2, 0, 2.3, -0.25);
  return b;
}

/** 钟鼓楼: stone base with arch, open drum storey, tall cap. */
function buildDrumTower() {
  const b = new Building('tang-drum-tower', '钟鼓楼');
  b.box(C.stoneDark, 7.0, 0.5, 7.0, 0, 0.25, 0);
  b.box(C.stone, 6.0, 4.0, 6.0, 0, 2.5, 0);
  b.box(C.timberDark, 2.4, 2.8, 6.3, 0, 1.9, 0);
  b.torus(C.stoneDark, 1.2, 0.2, Math.PI, 0, 3.3, 3.12, 0);
  b.roofWithRidge(C.roofDark, 7.2, 7.2, 1.1, 0, 4.55, 0);
  for (const x of [-2.2, 2.2]) {
    for (const z of [-2.2, 2.2]) {
      b.cylinder(C.lacquer, 0.2, 0.22, 2.6, 8, x, 6.4, z);
    }
  }
  b.box(C.plasterShade, 4.2, 1.0, 4.2, 0, 7.7, 0);
  b.railing(C.lacquer, 5.0, 5.0, 0, 5.7, 0);
  b.cylinder(C.bronze, 0.85, 0.85, 1.3, 10, 0, 7.0, 0);
  b.cylinder(C.gold, 0.9, 0.9, 0.12, 10, 0, 7.68, 0);
  b.roofWithRidge(C.roof, 6.2, 6.2, 1.8, 0, 8.35, 0);
  b.sphere(C.gold, 0.3, 0, 10.5, 0);
  b.plaque(0, 5.35, 3.2, 1.3);
  b.lantern(-2.8, 5.3, 2.6, 1.0);
  b.lantern(2.8, 5.3, 2.6, 1.0);
  return b;
}

/** 回廊: colonnade with a continuous roof, used along courtyards. */
function buildCorridor() {
  const b = new Building('tang-corridor', '回廊');
  b.box(C.stone, 13.0, 0.32, 3.4, 0, 0.16, 0);
  for (let bay = -3; bay <= 3; bay += 1) {
    const x = bay * 2.0;
    for (const z of [-1.3, 1.3]) {
      b.box(C.stoneDark, 0.5, 0.24, 0.5, x, 0.44, z);
      b.cylinder(C.lacquer, 0.17, 0.19, 2.7, 8, x, 1.9, z);
    }
  }
  for (const z of [-1.3, 1.3]) {
    b.box(C.timber, 13.0, 0.26, 0.3, 0, 3.35, z);
    b.box(C.lacquer, 13.0, 0.18, 0.34, 0, 3.1, z);
  }
  b.roofWithRidge(C.roof, 14.0, 4.0, 1.0, 0, 3.55, 0);
  b.railing(C.timber, 12.4, 3.2, 0, 0.42, 0);
  return b;
}

/** 经幢: tiered stone sutra pillar with a lotus finial. */
function buildScripturePillar() {
  const b = new Building('tang-scripture-pillar', '经幢');
  b.cylinder(C.stoneDark, 1.15, 1.35, 0.45, 8, 0, 0.22, 0);
  b.cylinder(C.stone, 0.95, 1.05, 0.4, 8, 0, 0.62, 0);
  let y = 0.82;
  for (let tier = 0; tier < 3; tier += 1) {
    const radius = 0.6 - tier * 0.08;
    b.cylinder(C.stone, radius, radius * 1.05, 1.2, 8, 0, y + 0.6, 0);
    b.pyramid(C.stoneDark, radius * 1.85, 0.34, 8, 0, y + 1.2, 0);
    b.cylinder(C.gold, radius * 0.55, radius * 0.55, 0.12, 8, 0, y + 1.5, 0);
    y += 1.62;
  }
  b.cylinder(C.stone, 0.3, 0.36, 0.9, 8, 0, y + 0.35, 0);
  b.pyramid(C.gold, 0.5, 0.5, 8, 0, y + 0.75, 0);
  b.sphere(C.gold, 0.22, 0, y + 1.45, 0);
  return b;
}

/** 石碑 with a 赑屃 base. */
function buildStele() {
  const b = new Building('tang-stele', '石碑');
  b.box(C.stoneDark, 2.6, 0.32, 1.6, 0, 0.16, 0);
  b.box(C.stone, 2.1, 0.5, 1.2, 0, 0.55, 0);
  b.box(C.stone, 0.8, 0.5, 1.5, 0, 0.85, 0.55);
  b.box(C.stone, 0.56, 0.4, 0.6, 0, 0.95, 1.35);
  b.box(C.stone, 1.3, 2.4, 0.36, 0, 2.15, -0.05);
  b.roof(C.stoneDark, 1.6, 0.8, 0.42, 0, 3.35, -0.05);
  b.box(C.gold, 0.9, 0.5, 0.06, 0, 2.5, 0.15);
  return b;
}

/** 灯柱 with two lanterns and a hanging banner. */
function buildLanternPost() {
  const b = new Building('tang-lantern-post', '灯柱');
  b.box(C.stoneDark, 0.9, 0.35, 0.9, 0, 0.18, 0);
  b.cylinder(C.stone, 0.42, 0.5, 0.3, 8, 0, 0.5, 0);
  b.cylinder(C.timber, 0.12, 0.15, 3.6, 6, 0, 2.45, 0);
  b.box(C.timberDark, 2.0, 0.14, 0.14, 0, 4.2, 0);
  b.box(C.lacquer, 0.5, 0.5, 0.4, 0, 4.05, 0);
  b.lantern(-0.85, 3.55, 0, 1.0);
  b.lantern(0.85, 3.55, 0, 1.0);
  b.box(C.cloth, 0.5, 1.5, 0.04, 0.34, 3.0, 0.2);
  b.box(C.gold, 0.6, 0.1, 0.06, 0.34, 3.8, 0.2);
  return b;
}

/** 井亭: a well under a small roof, a village landmark. */
function buildWell() {
  const b = new Building('tang-well', '井亭');
  b.box(C.stone, 3.0, 0.3, 3.0, 0, 0.15, 0);
  b.cylinder(C.stoneDark, 0.75, 0.8, 0.9, 10, 0, 0.45, 0);
  b.cylinder(C.soil, 0.6, 0.6, 0.12, 10, 0, 0.92, 0);
  for (const x of [-1.0, 1.0]) {
    for (const z of [-1.0, 1.0]) {
      b.cylinder(C.timber, 0.13, 0.15, 2.4, 6, x, 1.5, z);
    }
  }
  b.box(C.timber, 2.4, 0.2, 0.2, 0, 2.6, -1.0);
  b.box(C.timber, 2.4, 0.2, 0.2, 0, 2.6, 1.0);
  b.roofWithRidge(C.roof, 3.6, 3.6, 1.1, 0, 2.75, 0);
  b.cylinder(C.timber, 0.1, 0.1, 1.2, 6, 0, 2.0, 0);
  b.box(C.timberDark, 0.7, 0.5, 0.7, 0, 1.3, 0);
  return b;
}

const BUILDERS = [
  buildHall,
  buildPagoda,
  buildPaifang,
  buildGateTower,
  buildInn,
  buildTeahouse,
  buildShrine,
  buildDrumTower,
  buildCorridor,
  buildScripturePillar,
  buildStele,
  buildLanternPost,
  buildWell,
];

function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

async function buildOne(builder) {
  const building = builder();
  const scene = building.toScene();
  const exporter = new GLTFExporter();
  const buffer = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
  const mesh = scene.children[0];
  const geometry = mesh.geometry;
  const triangles = geometry.index
    ? geometry.index.count / 3
    : geometry.attributes.position.count / 3;
  const boundingBox =
    geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  return {
    id: building.id,
    displayName: building.displayName,
    b64: toBase64(buffer),
    metrics: {
      triangles: Math.round(triangles),
      meshes: 1,
      materials: 1,
      minY: boundingBox.min.y,
      maxY: boundingBox.max.y,
      minX: boundingBox.min.x,
      maxX: boundingBox.max.x,
      minZ: boundingBox.min.z,
      maxZ: boundingBox.max.z,
    },
  };
}

window.buildWuxiaBuildings = async () => {
  const results = [];
  for (const builder of BUILDERS) {
    results.push(await buildOne(builder));
  }
  return results;
};

window.__ready = true;
