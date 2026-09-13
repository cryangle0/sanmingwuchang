import * as THREE from 'three';
import type { HeroSkillMotif, HeroSkillStage } from './hero-skill-vfx';

/**
 * One bespoke shape per hero skill.
 *
 * The earlier VFX composed every skill from the same kit — orbiting balls,
 * stacked rings, cones, a flash, a ground pool, sparks, ribbons and a painted
 * card — all spinning at once, so from the chase lens the thirty-eight skills
 * read as one bright tangle. Each builder here draws a single readable
 * silhouette with two or three solid-coloured meshes and one deliberate
 * motion, sized so it fills a few metres around the hero. Materials are
 * normal-blended and mostly opaque so shapes have edges instead of blooming
 * into each other.
 */

export interface SkillShapePalette {
  readonly primary: number;
  readonly secondary: number;
  readonly core: number;
}

export interface SkillShapeMaterials {
  readonly primary: THREE.MeshBasicMaterial;
  readonly secondary: THREE.MeshBasicMaterial;
  readonly core: THREE.MeshBasicMaterial;
}

export function skillShapeMaterials(
  palette: SkillShapePalette,
  stage: HeroSkillStage,
): SkillShapeMaterials {
  const make = (color: number, opacity: number): THREE.MeshBasicMaterial => {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    material.userData.baseOpacity = opacity;
    return material;
  };
  const dim = stage === 'status' ? 0.55 : 1;
  return {
    primary: make(palette.primary, 0.9 * dim),
    secondary: make(palette.secondary, 0.85 * dim),
    core: make(palette.core, 1 * dim),
  };
}

interface Place {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
  readonly sx?: number;
  readonly sy?: number;
  readonly sz?: number;
  /** Radians per second about each local axis. */
  readonly spinX?: number;
  readonly spinY?: number;
  readonly spinZ?: number;
  /** Scale breathing amplitude. */
  readonly pulse?: number;
  /** Metres per second the part climbs, wrapping over `riseSpan`. */
  readonly rise?: number;
  readonly riseSpan?: number;
}

function put(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  place: Place = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(place.x ?? 0, place.y ?? 0, place.z ?? 0);
  mesh.rotation.set(place.rx ?? 0, place.ry ?? 0, place.rz ?? 0);
  mesh.scale.set(place.sx ?? 1, place.sy ?? 1, place.sz ?? 1);
  mesh.userData.basePosition = mesh.position.clone();
  mesh.userData.baseScale = mesh.scale.clone();
  mesh.userData.baseRotation = mesh.rotation.clone();
  mesh.userData.spinX = place.spinX ?? 0;
  mesh.userData.spinY = place.spinY ?? 0;
  mesh.userData.spinZ = place.spinZ ?? 0;
  mesh.userData.pulse = place.pulse ?? 0;
  mesh.userData.rise = place.rise ?? 0;
  mesh.userData.riseSpan = place.riseSpan ?? 0;
  mesh.userData.skillShape = true;
  group.add(mesh);
  return mesh;
}

const HALF = Math.PI / 2;
const TAU = Math.PI * 2;

/** Tall curved wall in front of the caster, height h, arc a (radians), radius r. */
function wall(
  group: THREE.Group,
  material: THREE.Material,
  radius: number,
  height: number,
  arc: number,
  extra: Place = {},
): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    24,
    1,
    true,
    -arc / 2 + Math.PI,
    arc,
  );
  return put(group, geometry, material, { y: height / 2, ...extra });
}

/** Flat ground ring with inner/outer radii. */
function floorRing(
  group: THREE.Group,
  material: THREE.Material,
  inner: number,
  outer: number,
  extra: Place = {},
): THREE.Mesh {
  return put(group, new THREE.RingGeometry(inner, outer, 48), material, {
    rx: -HALF,
    y: 0.06,
    ...extra,
  });
}

/** Upright column: a tapered tube from the ground. */
function column(
  group: THREE.Group,
  material: THREE.Material,
  radiusBottom: number,
  radiusTop: number,
  height: number,
  extra: Place = {},
): THREE.Mesh {
  return put(
    group,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 20, 1, true),
    material,
    { y: height / 2, ...extra },
  );
}

/** Forward spear along +z. */
function spear(
  group: THREE.Group,
  material: THREE.Material,
  radius: number,
  length: number,
  extra: Place = {},
): THREE.Mesh {
  return put(group, new THREE.ConeGeometry(radius, length, 12), material, {
    rx: HALF,
    y: 1.1,
    z: length / 2,
    ...extra,
  });
}

/** Ring of `count` copies of a geometry at radius r. */
function ringOf(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  radius: number,
  y: number,
  place: (angle: number, index: number) => Place = () => ({}),
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * TAU;
    put(group, geometry.clone(), material, {
      x: Math.sin(angle) * radius,
      y,
      z: Math.cos(angle) * radius,
      ry: angle,
      ...place(angle, index),
    });
  }
}

export function buildSkillShape(
  group: THREE.Group,
  motif: HeroSkillMotif,
  stage: HeroSkillStage,
  materials: SkillShapeMaterials,
): void {
  const { primary, secondary, core } = materials;
  switch (motif) {
    // 铁扇公主 芭蕉风墙: one wide translucent wall of wind with three streaks.
    case 'fan-gale':
      wall(group, primary, 2.6, 2.4, 1.5, { z: 1.2 });
      for (const dy of [0.6, 1.2, 1.8]) {
        put(group, new THREE.TorusGeometry(2.6, 0.05, 6, 40, 1.5), core, {
          y: dy,
          z: 1.2,
          rx: 0,
          ry: Math.PI - 0.75,
        });
      }
      break;
    // 红孩儿 三昧真火: a single tall pillar of flame with a bright core.
    case 'samadhi-flame':
      column(group, primary, 1.2, 0.3, 4.2, { pulse: 0.08 });
      column(group, core, 0.55, 0.12, 3.2, { pulse: 0.12 });
      floorRing(group, secondary, 0.8, 1.5);
      break;
    // 蜘蛛精 盘丝阵: a flat web on the ground: spokes + two rings.
    case 'spider-web':
      floorRing(group, primary, 2.1, 2.25);
      floorRing(group, primary, 1.2, 1.32);
      ringOf(group, new THREE.BoxGeometry(0.06, 0.02, 2.3), core, 8, 1.15, 0.07);
      break;
    // 蝎子精 倒马毒: one big curved stinger tail striking forward.
    case 'venom-stinger':
      put(group, new THREE.TorusGeometry(1.4, 0.18, 8, 24, 2.2), primary, {
        y: 1.6,
        rx: 0,
        ry: HALF,
        rz: -0.4,
      });
      spear(group, core, 0.28, 1.4, { y: 0.9, z: 1.6, rx: HALF + 0.5 });
      break;
    // 多目怪 金光: one huge eye disc facing forward that blinks open.
    case 'thousand-eyes':
      put(group, new THREE.CircleGeometry(1.4, 40), primary, { y: 1.6, z: 0.6 });
      put(group, new THREE.CircleGeometry(0.75, 32), core, { y: 1.6, z: 0.62, pulse: 0.15 });
      put(group, new THREE.CircleGeometry(0.3, 24), secondary, { y: 1.6, z: 0.64 });
      break;
    // 九头虫 毒雾: a wide low dome of miasma.
    case 'nine-head-miasma':
      put(group, new THREE.SphereGeometry(2.4, 24, 12, 0, TAU, 0, HALF), primary, { pulse: 0.06 });
      floorRing(group, secondary, 2.3, 2.6, { spinZ: 0.6 });
      break;
    // 黄风怪 三昧神风: a forward-leaning cone of wind, open at the front.
    case 'divine-gale':
      put(group, new THREE.ConeGeometry(2.2, 4.5, 24, 1, true), primary, {
        rx: -HALF,
        y: 1.2,
        z: 2.8,
        spinZ: 4,
      });
      put(group, new THREE.ConeGeometry(0.9, 4.5, 16, 1, true), core, {
        rx: -HALF,
        y: 1.2,
        z: 2.8,
        spinZ: -6,
      });
      break;
    // 太上老君 八卦炉火: a squat furnace ring with eight trigram tabs, fire above.
    case 'trigram-furnace':
      put(group, new THREE.TorusGeometry(1.6, 0.22, 10, 40), secondary, {
        y: 0.3,
        rx: HALF,
        spinZ: 0.8,
      });
      ringOf(group, new THREE.BoxGeometry(0.5, 0.12, 0.2), core, 8, 1.6, 0.6);
      column(group, primary, 1.1, 0.2, 3.0, { y: 1.9, pulse: 0.1 });
      break;
    // 孙悟空 大闹天宫: a golden staff spinning flat overhead.
    case 'golden-staff':
      put(group, new THREE.CylinderGeometry(0.08, 0.08, 5.2, 8), primary, {
        y: 2.2,
        rz: HALF,
        spinY: 9,
      });
      put(group, new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), core, {
        y: 2.2,
        x: 2.5,
        rz: HALF,
      });
      floorRing(group, secondary, 2.3, 2.5);
      break;
    // 二郎神 天眼: a vertical eye-slit beam forward from the brow.
    case 'celestial-eye':
      put(group, new THREE.BoxGeometry(0.18, 0.6, 6), core, { y: 1.9, z: 3 });
      put(group, new THREE.BoxGeometry(0.5, 1.2, 6), primary, { y: 1.9, z: 3 });
      break;
    // 哪吒 风火轮: two big wheels flanking the hero, spinning.
    case 'fire-wheels':
      for (const side of [-1, 1]) {
        put(group, new THREE.TorusGeometry(0.9, 0.12, 8, 32), primary, {
          x: side * 1.1,
          y: 0.9,
          ry: HALF,
          spinX: 12,
        });
        ringOf(group, new THREE.ConeGeometry(0.12, 0.5, 6), core, 6, 1.05, 0.9, (a) => ({
          x: side * 1.1,
          y: 0.9 + Math.sin(a) * 1.05,
          z: Math.cos(a) * 1.05,
          rx: -a,
          ry: 0,
        }));
      }
      break;
    // 六耳猕猴 镜像: three flat silhouette cards fanning out.
    case 'mirror-clones':
      for (const angle of [-0.9, 0, 0.9]) {
        put(group, new THREE.CapsuleGeometry(0.42, 1.2, 4, 10), primary, {
          x: Math.sin(angle) * 2.0,
          y: 1.0,
          z: Math.cos(angle) * 2.0,
          ry: angle,
        });
      }
      break;
    // 金翅大鹏 金翅: two huge swept wings.
    case 'golden-wings':
      for (const side of [-1, 1]) {
        put(group, new THREE.ConeGeometry(1.1, 4.0, 4, 1, true), primary, {
          x: side * 2.2,
          y: 1.8,
          rz: side * HALF,
          ry: 0.3,
          sy: 0.35,
        });
        put(group, new THREE.ConeGeometry(0.4, 3.6, 4, 1, true), core, {
          x: side * 2.0,
          y: 1.9,
          rz: side * HALF,
          sy: 0.3,
        });
      }
      break;
    // 白骨精 骨魂: a tall skeletal spine rising with a skull top.
    case 'bone-soul':
      ringOf(group, new THREE.BoxGeometry(0.6, 0.12, 0.25), primary, 7, 0, 0, (_a, i) => ({
        x: 0,
        y: 0.5 + i * 0.4,
        z: 0,
        ry: i * 0.35,
        rise: 0.8,
        riseSpan: 3.2,
      }));
      put(group, new THREE.SphereGeometry(0.5, 14, 10), core, { y: 3.4, pulse: 0.05 });
      break;
    // 猪八戒 九齿钉耙: nine parallel ground gouges forward.
    case 'nine-tooth-rake':
      for (let index = 0; index < 9; index += 1) {
        put(group, new THREE.BoxGeometry(0.12, 0.08, 3.4), primary, {
          x: (index - 4) * 0.34,
          y: 0.08,
          z: 2.0,
        });
      }
      put(group, new THREE.BoxGeometry(3.2, 0.3, 0.3), core, { y: 0.25, z: 0.3 });
      break;
    // 白龙马 白龙: a long serpentine body lunging forward.
    case 'white-dragon':
      put(group, new THREE.TorusGeometry(2.2, 0.32, 10, 36, 2.6), primary, {
        y: 1.8,
        ry: HALF,
        rz: 0.3,
        rx: 0,
      });
      put(group, new THREE.ConeGeometry(0.55, 1.4, 10), core, {
        rx: HALF,
        y: 1.2,
        z: 4.2,
      });
      break;
    // 狮驼王 狮吼: three expanding sound arcs forward.
    case 'lion-roar':
      for (const [r, y] of [
        [1.4, 1.1],
        [2.2, 1.1],
        [3.0, 1.1],
      ] as const) {
        put(group, new THREE.TorusGeometry(r, 0.09, 6, 30, 1.6), primary, {
          y,
          ry: Math.PI - 0.8,
          pulse: 0.05,
        });
      }
      put(group, new THREE.SphereGeometry(0.45, 12, 8), core, { y: 1.1, z: 0.6 });
      break;
    // 牛魔王 魔焰旋风: one tall twisted tornado.
    case 'demon-cyclone':
      column(group, primary, 0.7, 2.2, 4.6, { spinY: 6 });
      put(group, new THREE.TorusGeometry(1.5, 0.12, 6, 32), core, {
        y: 3.2,
        rx: HALF,
        spinZ: 7,
      });
      put(group, new THREE.TorusGeometry(0.9, 0.1, 6, 32), core, {
        y: 1.6,
        rx: HALF,
        spinZ: -7,
      });
      break;
    // 青牛精 金刚琢: one large bracelet ring thrown forward, tilted.
    case 'vajra-ring':
      put(group, new THREE.TorusGeometry(1.6, 0.26, 12, 48), primary, {
        y: 1.6,
        z: 1.0,
        rx: 0.4,
        spinY: 5,
      });
      put(group, new THREE.TorusGeometry(1.6, 0.08, 8, 48), core, {
        y: 1.6,
        z: 1.0,
        rx: 0.4,
        spinY: 5,
      });
      break;
    // 石罗汉: a stone dome that rises around the hero.
    case 'stone-arhat':
      put(group, new THREE.SphereGeometry(1.9, 8, 6, 0, TAU, 0, HALF), primary, {
        pulse: 0.02,
      });
      ringOf(group, new THREE.BoxGeometry(0.5, 0.9, 0.5), secondary, 6, 1.75, 0.45, () => ({
        rise: 0.6,
        riseSpan: 0.9,
      }));
      break;
    // 银角大王 紫金葫芦: a big gourd overhead pouring a beam down.
    case 'purple-gourd':
      put(group, new THREE.SphereGeometry(0.75, 16, 12), primary, { y: 3.6 });
      put(group, new THREE.SphereGeometry(0.55, 16, 12), primary, { y: 4.5 });
      column(group, core, 0.35, 0.9, 3.0, { y: 1.5, pulse: 0.08 });
      break;
    // 金角大王 金币风暴: a fountain of coins on a spiral.
    case 'coin-storm':
      ringOf(group, new THREE.CylinderGeometry(0.22, 0.22, 0.05, 12), core, 12, 1.4, 0, (a, i) => ({
        y: 0.3 + i * 0.28,
        rx: HALF + Math.sin(a),
        rise: 1.6,
        riseSpan: 3.6,
      }));
      floorRing(group, primary, 1.2, 1.6);
      break;
    // 玉兔精 月链: three chain hoops circling the target low.
    case 'moon-chains':
      for (const [y, r] of [
        [0.5, 1.5],
        [1.2, 1.3],
        [1.9, 1.1],
      ] as const) {
        put(group, new THREE.TorusGeometry(r, 0.09, 6, 12), primary, {
          y,
          rx: HALF,
          spinZ: y > 1 ? -2.5 : 2.5,
        });
      }
      put(group, new THREE.TorusGeometry(0.5, 0.06, 6, 24), core, { y: 2.6, spinY: 3 });
      break;
    // 虎力大仙 虎啸箭: one huge arrow forward.
    case 'tiger-arrow':
      spear(group, core, 0.35, 2.0, { z: 3.4 });
      put(group, new THREE.CylinderGeometry(0.08, 0.08, 3.0, 6), primary, {
        rx: HALF,
        y: 1.1,
        z: 1.2,
      });
      for (const side of [-1, 1]) {
        put(group, new THREE.BoxGeometry(0.05, 0.5, 0.7), primary, {
          x: side * 0.28,
          y: 1.1,
          z: 0.1,
          rz: side * 0.6,
        });
      }
      break;
    // 鹿力大仙 鹿血: a crimson aura dome with antler spikes.
    case 'deer-blood':
      put(group, new THREE.SphereGeometry(1.6, 20, 10, 0, TAU, 0, HALF), primary, {
        pulse: 0.05,
      });
      ringOf(group, new THREE.ConeGeometry(0.12, 1.4, 5), core, 6, 1.2, 1.5, (a) => ({
        rz: Math.sin(a) * 0.5,
        rx: Math.cos(a) * 0.5,
      }));
      break;
    // 文殊/智慧封印: one large flat seal square with a diamond inside.
    case 'wisdom-seal':
      put(group, new THREE.RingGeometry(1.7, 1.95, 4), primary, {
        rx: -HALF,
        y: 0.08,
        rz: Math.PI / 4,
      });
      put(group, new THREE.RingGeometry(1.0, 1.15, 4), core, { rx: -HALF, y: 0.1, spinZ: 1.2 });
      put(group, new THREE.CircleGeometry(0.4, 24), secondary, { rx: -HALF, y: 0.12 });
      break;
    // 誓愿莲台: a lotus of eight petals opening from the ground.
    case 'vow-lotus':
      ringOf(group, new THREE.ConeGeometry(0.55, 1.7, 4), primary, 8, 0.9, 0.85, () => ({
        rx: -0.9,
        sz: 0.35,
      }));
      put(group, new THREE.SphereGeometry(0.42, 12, 8), core, { y: 0.9, pulse: 0.1 });
      break;
    // 乾坤袖: a huge sleeve cone sweeping forward and down.
    case 'universe-sleeve':
      put(group, new THREE.ConeGeometry(2.6, 3.6, 28, 1, true), primary, {
        rx: -HALF + 0.35,
        y: 1.8,
        z: 1.8,
        spinZ: 1.5,
      });
      break;
    // 五行山: a stone mountain slab slamming down.
    case 'five-element-mountain':
      put(group, new THREE.ConeGeometry(2.0, 3.6, 5), primary, { y: 1.8 });
      put(group, new THREE.ConeGeometry(1.0, 1.8, 5), core, { y: 3.4 });
      floorRing(group, secondary, 1.9, 2.4);
      break;
    // 杨柳露: a willow-drop dome of green rain.
    case 'willow-dew':
      ringOf(group, new THREE.CapsuleGeometry(0.07, 0.5, 3, 6), core, 14, 1.4, 2.6, () => ({
        rise: -1.8,
        riseSpan: 2.8,
      }));
      put(group, new THREE.TorusGeometry(1.5, 0.1, 6, 32), primary, { y: 3.0, rx: HALF });
      break;
    // 托塔天王 玲珑塔: a pagoda of stacked shrinking tiers.
    case 'heavenly-pagoda':
      for (let tier = 0; tier < 4; tier += 1) {
        put(group, new THREE.ConeGeometry(1.3 - tier * 0.25, 0.7, 6, 1, true), primary, {
          y: 0.5 + tier * 0.75,
        });
        put(
          group,
          new THREE.CylinderGeometry(0.55 - tier * 0.1, 0.55 - tier * 0.1, 0.35, 6),
          core,
          {
            y: 0.2 + tier * 0.75,
          },
        );
      }
      break;
    // 唐僧 锦襕袈裟: a golden cloak dome with a raised collar.
    case 'golden-kasaya':
      put(group, new THREE.SphereGeometry(1.7, 20, 10, 0, TAU, 0, HALF), primary, {
        pulse: 0.03,
      });
      put(group, new THREE.TorusGeometry(1.7, 0.14, 8, 40), core, { y: 0.15, rx: HALF });
      break;
    // 沙僧 流沙: a wide flat whirlpool of sand.
    case 'quicksand':
      put(group, new THREE.RingGeometry(0.4, 2.6, 48, 1), primary, {
        rx: -HALF,
        y: 0.06,
        spinZ: 2.4,
      });
      ringOf(group, new THREE.BoxGeometry(0.08, 0.02, 2.2), core, 6, 1.3, 0.09, () => ({
        spinY: 0,
      }));
      put(group, new THREE.CircleGeometry(0.4, 24), secondary, { rx: -HALF, y: 0.1 });
      break;
    // 黑风怪 黑风: a dark spinning wall around the hero.
    case 'black-wind':
      put(group, new THREE.CylinderGeometry(2.0, 1.4, 3.6, 24, 1, true), primary, {
        y: 1.8,
        spinY: 5,
      });
      put(group, new THREE.TorusGeometry(1.9, 0.08, 6, 32), core, { y: 3.4, rx: HALF, spinZ: 5 });
      break;
    // 象王 缚: a thick rope loop that pulls tight forward.
    case 'elephant-bind':
      put(group, new THREE.TorusGeometry(1.2, 0.2, 10, 32), primary, {
        y: 1.0,
        z: 2.0,
        rx: HALF,
        pulse: 0.08,
      });
      put(group, new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8), core, {
        rx: HALF,
        y: 1.0,
        z: 0.9,
      });
      break;
    // 冻河: a flat sheet of ice forward with three upright shards.
    case 'frozen-river':
      put(group, new THREE.BoxGeometry(3.0, 0.1, 5.0), primary, { y: 0.06, z: 2.6 });
      for (const [x, z, h] of [
        [-0.9, 1.6, 1.4],
        [0.6, 2.8, 2.0],
        [-0.2, 4.0, 1.6],
      ] as const) {
        put(group, new THREE.ConeGeometry(0.35, h, 5), core, { x, y: h / 2, z });
      }
      break;
    // 羊力大仙 羊灵: two curled horns and a charge line.
    case 'ram-spirit':
      for (const side of [-1, 1]) {
        put(group, new THREE.TorusGeometry(0.7, 0.16, 8, 20, 4.2), primary, {
          x: side * 0.9,
          y: 1.8,
          ry: side * HALF,
          rz: side * 0.6,
        });
      }
      put(group, new THREE.BoxGeometry(1.6, 0.08, 3.2), core, { y: 0.06, z: 1.8 });
      break;
    // 紫烟: a wide low spiral of purple smoke.
    case 'purple-smoke':
      for (let index = 0; index < 3; index += 1) {
        put(group, new THREE.TorusGeometry(1.4 + index * 0.5, 0.35, 8, 36), primary, {
          y: 0.4 + index * 0.55,
          rx: HALF,
          spinZ: 1.2 + index * 0.4,
          pulse: 0.05,
        });
      }
      break;
    default:
      column(group, primary, 1.0, 0.4, 3.0);
      break;
  }
}
