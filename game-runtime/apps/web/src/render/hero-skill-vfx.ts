import * as THREE from 'three';
import { attachSkillTextureLayer, updateSkillTextureLayer } from './skill-texture-vfx';

export type HeroSkillMotif =
  | 'fan-gale'
  | 'samadhi-flame'
  | 'spider-web'
  | 'venom-stinger'
  | 'thousand-eyes'
  | 'nine-head-miasma'
  | 'divine-gale'
  | 'trigram-furnace'
  | 'golden-staff'
  | 'celestial-eye'
  | 'fire-wheels'
  | 'mirror-clones'
  | 'golden-wings'
  | 'bone-soul'
  | 'nine-tooth-rake'
  | 'white-dragon'
  | 'lion-roar'
  | 'demon-cyclone'
  | 'vajra-ring'
  | 'stone-arhat'
  | 'purple-gourd'
  | 'coin-storm'
  | 'moon-chains'
  | 'tiger-arrow'
  | 'deer-blood'
  | 'wisdom-seal'
  | 'vow-lotus'
  | 'universe-sleeve'
  | 'five-element-mountain'
  | 'willow-dew'
  | 'heavenly-pagoda'
  | 'golden-kasaya'
  | 'quicksand'
  | 'black-wind'
  | 'elephant-bind'
  | 'frozen-river'
  | 'ram-spirit'
  | 'purple-smoke';

export type HeroSkillMotion = 'burst' | 'forward' | 'spiral' | 'rise' | 'aura' | 'collapse';
export type HeroSkillStage = 'cast' | 'impact' | 'status';
export type HeroSkillAudioPhase = 'cast' | 'impact' | 'end' | 'loop';

export interface HeroSkillVfxProfile {
  readonly heroId: string;
  readonly textureKey: string;
  readonly motif: HeroSkillMotif;
  readonly primary: number;
  readonly secondary: number;
  readonly core: number;
  readonly motion: HeroSkillMotion;
  readonly scale: number;
  readonly castDurationSeconds: number;
  readonly impactDurationSeconds: number;
  readonly statusDurationSeconds: number;
  readonly targetPreview: boolean;
  readonly persistentAura: boolean;
  readonly audioPhases: readonly HeroSkillAudioPhase[];
}

export interface HeroSkillVisual {
  readonly group: THREE.Group;
  readonly materials: readonly THREE.MeshBasicMaterial[];
  readonly durationSeconds: number;
}

const IMPACT_AUDIO_HEROES = new Set(
  Array.from({ length: 38 }, (_, index) => `H${String(index + 1).padStart(3, '0')}`).filter(
    (id) => id !== 'H009' && id !== 'H010' && id !== 'H034',
  ),
);
const END_AUDIO_HEROES = new Set([
  'H001',
  'H002',
  'H003',
  'H004',
  'H005',
  'H006',
  'H007',
  'H009',
  'H012',
  'H014',
  'H015',
  'H018',
  'H019',
  'H020',
  'H023',
  'H025',
  'H026',
  'H028',
  'H030',
  'H031',
  'H032',
  'H033',
  'H034',
  'H035',
  'H036',
  'H037',
  'H038',
]);
const LOOP_AUDIO_HEROES = new Set([
  'H002',
  'H003',
  'H006',
  'H007',
  'H018',
  'H030',
  'H031',
  'H033',
  'H036',
  'H038',
]);

function audioPhases(heroId: string): readonly HeroSkillAudioPhase[] {
  return [
    'cast',
    ...(IMPACT_AUDIO_HEROES.has(heroId) ? (['impact'] as const) : []),
    ...(END_AUDIO_HEROES.has(heroId) ? (['end'] as const) : []),
    ...(LOOP_AUDIO_HEROES.has(heroId) ? (['loop'] as const) : []),
  ];
}

function profile(
  heroId: string,
  motif: HeroSkillMotif,
  primary: number,
  secondary: number,
  core: number,
  motion: HeroSkillMotion,
  options: Partial<
    Pick<
      HeroSkillVfxProfile,
      | 'scale'
      | 'castDurationSeconds'
      | 'impactDurationSeconds'
      | 'statusDurationSeconds'
      | 'targetPreview'
      | 'persistentAura'
    >
  > = {},
): HeroSkillVfxProfile {
  return {
    heroId,
    textureKey: heroId,
    motif,
    primary,
    secondary,
    core,
    motion,
    scale: options.scale ?? 1,
    castDurationSeconds: options.castDurationSeconds ?? 0.72,
    impactDurationSeconds: options.impactDurationSeconds ?? 0.58,
    statusDurationSeconds: options.statusDurationSeconds ?? 1.5,
    targetPreview: options.targetPreview ?? false,
    persistentAura: options.persistentAura ?? false,
    audioPhases: audioPhases(heroId),
  };
}

export const HERO_SKILL_VFX_PROFILES: readonly HeroSkillVfxProfile[] = [
  profile('H001', 'fan-gale', 0x82e6e7, 0xffd16e, 0xffffff, 'forward', { scale: 1.15 }),
  profile('H002', 'samadhi-flame', 0xff3b20, 0xffa52f, 0xfff0a0, 'rise', { scale: 1.18 }),
  profile('H003', 'spider-web', 0x83e6a2, 0xdaf6c6, 0xffffff, 'spiral', { scale: 1.12 }),
  profile('H004', 'venom-stinger', 0xb7dd45, 0x7b3ab5, 0xf1ff7a, 'burst', {
    targetPreview: false,
    statusDurationSeconds: 2.2,
  }),
  profile('H005', 'thousand-eyes', 0xffcf42, 0x7bea65, 0xffffff, 'collapse', {
    targetPreview: true,
    statusDurationSeconds: 1.6,
  }),
  profile('H006', 'nine-head-miasma', 0x49b790, 0x7951b8, 0xaaffdd, 'spiral', {
    scale: 1.2,
  }),
  profile('H007', 'divine-gale', 0xd7c46d, 0x7fd5a1, 0xfaffc9, 'forward', { scale: 1.22 }),
  profile('H008', 'trigram-furnace', 0xff5d28, 0xffd24e, 0xffffff, 'rise', {
    scale: 1.25,
  }),
  profile('H009', 'golden-staff', 0xffc83d, 0xe74d2e, 0xffffff, 'aura', {
    scale: 1.2,
    castDurationSeconds: 0.9,
    persistentAura: true,
  }),
  profile('H010', 'celestial-eye', 0xffdc57, 0x5aa8ff, 0xffffff, 'forward', {
    targetPreview: false,
    persistentAura: true,
  }),
  profile('H011', 'fire-wheels', 0xff4b22, 0xffd13d, 0xffffff, 'forward', {
    scale: 1.18,
    targetPreview: false,
  }),
  profile('H012', 'mirror-clones', 0xe9c765, 0x73d9ff, 0xffffff, 'burst', {
    scale: 1.15,
  }),
  profile('H013', 'golden-wings', 0xffd35d, 0xf4f1d0, 0xffffff, 'forward', {
    scale: 1.28,
    targetPreview: true,
  }),
  profile('H014', 'bone-soul', 0xdcc9a5, 0x8a65c9, 0xffffff, 'collapse', {
    scale: 1.15,
  }),
  profile('H015', 'nine-tooth-rake', 0x62c8f0, 0xe7c36a, 0xffffff, 'forward', {
    scale: 1.2,
    targetPreview: false,
  }),
  profile('H016', 'white-dragon', 0x75ddff, 0xf7ffff, 0x4f8cff, 'forward', {
    scale: 1.3,
    targetPreview: false,
  }),
  profile('H017', 'lion-roar', 0xe8b654, 0xff774a, 0xffffff, 'burst', {
    scale: 1.32,
  }),
  profile('H018', 'demon-cyclone', 0xff4f25, 0x9d2e20, 0xffd565, 'spiral', {
    scale: 1.28,
    castDurationSeconds: 0.9,
    persistentAura: true,
  }),
  profile('H019', 'vajra-ring', 0xf6d269, 0x84d9ee, 0xffffff, 'spiral', { scale: 1.18 }),
  profile('H020', 'stone-arhat', 0xc6a46c, 0x8d7a61, 0xffe6a7, 'rise', { scale: 1.25 }),
  profile('H021', 'purple-gourd', 0xb25dd6, 0xffc85a, 0xffffff, 'collapse', {
    scale: 1.2,
  }),
  profile('H022', 'coin-storm', 0xffd447, 0x63cbea, 0xffffff, 'burst', {
    scale: 1.16,
    targetPreview: false,
  }),
  profile('H023', 'moon-chains', 0x91d66f, 0xffd058, 0xd8fff0, 'collapse', {
    targetPreview: false,
    statusDurationSeconds: 2.3,
  }),
  profile('H024', 'tiger-arrow', 0xff7138, 0xffd76a, 0xffffff, 'forward', {
    scale: 1.22,
    targetPreview: false,
  }),
  profile('H025', 'deer-blood', 0xd74f67, 0x79dc91, 0xffd7dd, 'aura', {
    persistentAura: true,
  }),
  profile('H026', 'wisdom-seal', 0xffdd75, 0x74a9ef, 0xffffff, 'collapse', {
    targetPreview: false,
    statusDurationSeconds: 1.7,
  }),
  profile('H027', 'vow-lotus', 0xf0c56b, 0xe68bbf, 0xffffff, 'rise', {
    targetPreview: false,
  }),
  profile('H028', 'universe-sleeve', 0x5bc57a, 0xe7d179, 0xffffff, 'collapse', {
    targetPreview: false,
    statusDurationSeconds: 2.4,
  }),
  profile('H029', 'five-element-mountain', 0xd1a45f, 0xff6d42, 0xffffff, 'rise', {
    scale: 1.35,
  }),
  profile('H030', 'willow-dew', 0x72e39a, 0x8edaff, 0xffffff, 'rise', {
    scale: 1.18,
  }),
  profile('H031', 'heavenly-pagoda', 0xf2c55f, 0xb14c3d, 0xffffff, 'rise', {
    scale: 1.3,
  }),
  profile('H032', 'golden-kasaya', 0xffd967, 0xe56a42, 0xffffff, 'aura', {
    scale: 1.15,
    persistentAura: true,
  }),
  profile('H033', 'quicksand', 0xc69a58, 0x65b9d6, 0xffe5aa, 'spiral', {
    scale: 1.2,
  }),
  profile('H034', 'black-wind', 0x284c3a, 0x7ed47e, 0xc8ffd2, 'spiral', {
    scale: 1.22,
    persistentAura: true,
  }),
  profile('H035', 'elephant-bind', 0x79d6ed, 0xe8ddc2, 0xffffff, 'forward', {
    scale: 1.2,
    targetPreview: false,
  }),
  profile('H036', 'frozen-river', 0x67cfff, 0xd8fbff, 0xffffff, 'rise', {
    scale: 1.28,
  }),
  profile('H037', 'ram-spirit', 0xa4e15f, 0xffe276, 0xffffff, 'collapse', {
    scale: 1.18,
    targetPreview: true,
    statusDurationSeconds: 1.6,
  }),
  profile('H038', 'purple-smoke', 0x9d63c7, 0xe46c70, 0xffe0af, 'spiral', {
    scale: 1.22,
  }),
];

const PROFILE_BY_ID = new Map(HERO_SKILL_VFX_PROFILES.map((entry) => [entry.heroId, entry]));

export function heroSkillVfxProfile(id: string): HeroSkillVfxProfile | null {
  return PROFILE_BY_ID.get(id) ?? null;
}

export function isHeroSkillId(id: string): boolean {
  return PROFILE_BY_ID.has(id);
}

export function heroSkillAudioAssetId(activeId: string, phase: HeroSkillAudioPhase): string | null {
  const profile = heroSkillVfxProfile(activeId);
  if (!profile?.audioPhases.includes(phase)) {
    return null;
  }
  return `sfx_skill_${activeId.toLowerCase()}_${phase}`;
}

function glowMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.userData.baseOpacity = opacity;
  return material;
}

/**
 * Radial spark burst.
 *
 * The design prototype throws sixteen `fx-particle` spans out from the cast
 * point on fixed 22.5 degree spokes; this is that idea in three dimensions and
 * is what the motifs were missing. A motif alone reads as a shape appearing —
 * geometry that grows and spins. What makes a cast feel struck rather than
 * switched on is debris leaving the point of impact, and there was none.
 *
 * One Points object per visual, so the whole burst is a single draw call. The
 * per-spark velocity lives in the geometry's own arrays rather than in objects
 * the updater would have to walk, and nothing allocates per frame.
 */
function addSparkBurst(
  group: THREE.Group,
  profile: HeroSkillVfxProfile,
  stage: HeroSkillStage,
  reduced: boolean,
): void {
  // A persistent aura is not an event; sparks there would fire every frame the
  // buff is up and never read as an impact.
  if (stage === 'status') {
    return;
  }

  const count = reduced ? 16 : stage === 'impact' ? 42 : 28;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const origins = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const spoke = (index / count) * Math.PI * 2;
    const wobble = ((index * 2654435761) % 1000) / 1000;
    const angle = spoke + (wobble - 0.5) * 0.22;
    const start = stage === 'impact' ? 0.1 : 0.22;
    let originX = Math.sin(angle) * start;
    let originY = 0.28 + wobble * 0.28;
    let originZ = Math.cos(angle) * start;
    let velocityX = Math.sin(angle);
    let velocityY = stage === 'impact' ? 0.7 + wobble * 1.1 : 0.4 + wobble * 0.7;
    let velocityZ = Math.cos(angle);
    const speed = (stage === 'impact' ? 3.4 : 2.2) * (0.7 + wobble * 0.6);
    switch (profile.motion) {
      case 'forward':
        velocityX *= 0.42;
        velocityZ = 1.35 + wobble * 0.8;
        originZ = 0.35;
        break;
      case 'rise':
        velocityX *= 0.55;
        velocityZ *= 0.55;
        velocityY = 2.4 + wobble * 1.6;
        break;
      case 'spiral':
        velocityX = Math.cos(angle) * 1.6;
        velocityZ = Math.sin(angle) * 1.6;
        velocityY = 1.1 + wobble;
        break;
      case 'collapse':
        velocityX *= -1.8;
        velocityZ *= -1.8;
        velocityY = 0.25;
        originX = Math.sin(angle) * 1.15;
        originZ = Math.cos(angle) * 1.15;
        break;
      case 'aura':
        velocityX *= 0.35;
        velocityZ *= 0.35;
        velocityY = 0.15;
        break;
      default:
        break;
    }
    origins[index * 3] = originX;
    origins[index * 3 + 1] = originY;
    origins[index * 3 + 2] = originZ;
    positions[index * 3] = originX;
    positions[index * 3 + 1] = originY;
    positions[index * 3 + 2] = originZ;
    velocities[index * 3] = velocityX * speed;
    velocities[index * 3 + 1] = velocityY * (0.7 + wobble * 0.5);
    velocities[index * 3 + 2] = velocityZ * speed;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: profile.core,
    size: reduced ? 0.2 : 0.28,
    sizeAttenuation: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.userData.baseOpacity = 0.95;
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.userData.sparkVelocities = velocities;
  points.userData.sparkOrigins = origins;
  group.add(points);
  group.userData.sparks = points;
}

/**
 * Expanding shock rings on the ground.
 *
 * The prototype fires two rings, `r1` and `r2`, on a short stagger. Two rather
 * than one is the whole trick: a single ring reads as a circle being drawn,
 * while a pair chasing each other reads as a wave leaving a point. They lie
 * flat on the ground because that is the plane a player judges range on.
 */
function addShockRings(
  group: THREE.Group,
  profile: HeroSkillVfxProfile,
  stage: HeroSkillStage,
  reduced: boolean,
): void {
  if (stage === 'status') {
    return;
  }

  const rings: THREE.Mesh[] = [];
  const segments = reduced ? 24 : 48;
  const count = stage === 'impact' ? 3 : 2;
  const crescent =
    profile.motion === 'forward' ||
    profile.motif === 'fan-gale' ||
    profile.motif === 'divine-gale' ||
    profile.motif === 'golden-wings';
  for (let index = 0; index < count; index += 1) {
    const geometry = crescent
      ? new THREE.RingGeometry(0.72, 1, segments, 1, -1.2, 2.4)
      : new THREE.RingGeometry(0.78, 1, segments);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: index === 0 ? profile.primary : index === 1 ? profile.secondary : profile.core,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    material.userData.baseOpacity = 0.88;
    const ring = new THREE.Mesh(geometry, material);
    ring.position.y = 0.06;
    // The second ring starts later AND stops shorter. Starting later alone is
    // not enough: give the follower a longer reach and it overtakes the leader
    // mid-flight, which reads as two rings crossing rather than as one wave
    // with a trailing edge.
    ring.userData.ringDelay = index * 0.16;
    ring.userData.ringReach = (stage === 'impact' ? 3.1 : 2.1) - index * 0.38;
    ring.userData.shockRing = true;
    rings.push(ring);
    group.add(ring);
  }

  group.userData.shockRings = rings;
}

function addCoreFlare(
  group: THREE.Group,
  profile: HeroSkillVfxProfile,
  stage: HeroSkillStage,
  materials: readonly [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial],
): void {
  const [, secondary, core] = materials;
  addMesh(group, new THREE.OctahedronGeometry(0.22, 1), core, {
    y: 0.62,
    pulse: 0.22,
    spinY: 4.8,
  });
  addMesh(group, new THREE.SphereGeometry(0.38, 14, 10), secondary, {
    y: 0.62,
    pulse: 0.12,
  });
  if (stage === 'status') {
    return;
  }
  if (profile.motion === 'rise' || profile.motion === 'aura' || profile.motion === 'burst') {
    addMesh(group, new THREE.CylinderGeometry(0.05, 0.18, 2.4, 10, 1, true), core, {
      y: 1.35,
      pulse: 0.1,
    });
  }
}

function addMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.MeshBasicMaterial,
  options: {
    readonly x?: number;
    readonly y?: number;
    readonly z?: number;
    readonly rx?: number;
    readonly ry?: number;
    readonly rz?: number;
    readonly sx?: number;
    readonly sy?: number;
    readonly sz?: number;
    readonly spinX?: number;
    readonly spinY?: number;
    readonly spinZ?: number;
    readonly orbitRadius?: number;
    readonly orbitSpeed?: number;
    readonly orbitPhase?: number;
    readonly pulse?: number;
  } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0);
  mesh.rotation.set(options.rx ?? 0, options.ry ?? 0, options.rz ?? 0);
  mesh.scale.set(options.sx ?? 1, options.sy ?? 1, options.sz ?? 1);
  mesh.userData.basePosition = mesh.position.clone();
  mesh.userData.baseScale = mesh.scale.clone();
  mesh.userData.baseRotation = mesh.rotation.clone();
  mesh.userData.spinX = options.spinX ?? 0;
  mesh.userData.spinY = options.spinY ?? 0;
  mesh.userData.spinZ = options.spinZ ?? 0;
  mesh.userData.orbitRadius = options.orbitRadius ?? 0;
  mesh.userData.orbitSpeed = options.orbitSpeed ?? 0;
  mesh.userData.orbitPhase = options.orbitPhase ?? 0;
  mesh.userData.pulse = options.pulse ?? 0;
  group.add(mesh);
  return mesh;
}

function addHorizontalRing(
  group: THREE.Group,
  material: THREE.MeshBasicMaterial,
  inner: number,
  outer: number,
  y: number,
  options: Parameters<typeof addMesh>[3] = {},
): THREE.Mesh {
  return addMesh(group, new THREE.RingGeometry(inner, outer, 40), material, {
    ...options,
    y,
    rx: -Math.PI / 2,
  });
}

function addOrbit(
  group: THREE.Group,
  material: THREE.MeshBasicMaterial,
  count: number,
  radius: number,
  size: number,
  y: number,
  geometry: 'orb' | 'coin' | 'shard' = 'orb',
): void {
  for (let index = 0; index < count; index += 1) {
    const phase = (index / count) * Math.PI * 2;
    const shape =
      geometry === 'coin'
        ? new THREE.TorusGeometry(size * 0.62, size * 0.18, 5, 14)
        : geometry === 'shard'
          ? new THREE.ConeGeometry(size * 0.45, size * 1.8, 5)
          : new THREE.IcosahedronGeometry(size, 0);
    addMesh(group, shape, material, {
      y,
      orbitRadius: radius,
      orbitSpeed: index % 2 === 0 ? 4.2 : -3.5,
      orbitPhase: phase,
      spinX: 2 + index * 0.15,
      spinY: 3.4,
      pulse: 0.08,
    });
  }
}

function addSpokes(
  group: THREE.Group,
  material: THREE.MeshBasicMaterial,
  count: number,
  radius: number,
  width: number,
  y: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    addMesh(group, new THREE.BoxGeometry(width, 0.035, radius), material, {
      x: Math.sin(angle) * radius * 0.5,
      y,
      z: Math.cos(angle) * radius * 0.5,
      ry: angle,
    });
  }
}

function addPetals(
  group: THREE.Group,
  material: THREE.MeshBasicMaterial,
  count: number,
  radius: number,
  y: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    addMesh(group, new THREE.SphereGeometry(0.24, 10, 6), material, {
      x: Math.sin(angle) * radius,
      y,
      z: Math.cos(angle) * radius,
      ry: angle,
      sx: 0.55,
      sy: 0.18,
      sz: 1.25,
      pulse: 0.1,
    });
  }
}

function addStackedRings(
  group: THREE.Group,
  material: THREE.MeshBasicMaterial,
  count: number,
  radius: number,
  height: number,
  tilt = 0,
): void {
  for (let index = 0; index < count; index += 1) {
    const progress = count <= 1 ? 0 : index / (count - 1);
    addMesh(
      group,
      new THREE.TorusGeometry(radius * (1 - progress * 0.42), 0.045, 6, 32),
      material,
      {
        y: progress * height,
        rx: Math.PI / 2 + tilt * (index % 2 === 0 ? 1 : -1),
        spinZ: index % 2 === 0 ? 3.5 : -3,
        pulse: 0.06,
      },
    );
  }
}

function populateMotif(
  group: THREE.Group,
  profile: HeroSkillVfxProfile,
  stage: HeroSkillStage,
  reduced: boolean,
  materials: readonly [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial],
): void {
  const [primary, secondary, core] = materials;
  const detail = reduced ? 0.68 : 1;
  const orbitCount = reduced ? 3 : 5;
  const spokeCount = reduced ? 6 : 10;

  switch (profile.motif) {
    case 'fan-gale':
      addMesh(group, new THREE.RingGeometry(0.45, 1.6, 36, 1, -1.15, 2.3), primary, {
        y: 0.15,
        rx: -Math.PI / 2,
        rz: Math.PI / 2,
        spinZ: 1.5,
      });
      for (let index = -2; index <= 2; index += 1) {
        addMesh(group, new THREE.BoxGeometry(0.035, 0.035, 1.7), secondary, {
          x: index * 0.18,
          y: 0.18,
          z: 0.55,
          ry: index * 0.13,
        });
      }
      break;
    case 'samadhi-flame':
      addHorizontalRing(group, secondary, 0.4, 1.25, 0.08, { spinZ: 3.8 });
      for (let index = 0; index < (reduced ? 5 : 8); index += 1) {
        const angle = (index / (reduced ? 5 : 8)) * Math.PI * 2;
        addMesh(group, new THREE.ConeGeometry(0.22, 1.2 + (index % 3) * 0.2, 7), primary, {
          x: Math.sin(angle) * 0.78,
          y: 0.55,
          z: Math.cos(angle) * 0.78,
          rz: Math.sin(angle) * 0.16,
          pulse: 0.12,
        });
      }
      break;
    case 'spider-web':
      addHorizontalRing(group, primary, 0.9, 0.96, 0.08, { spinZ: 0.9 });
      addHorizontalRing(group, secondary, 0.5, 0.55, 0.09, { spinZ: -1.2 });
      addSpokes(group, core, spokeCount, 1.9, 0.025, 0.1);
      break;
    case 'venom-stinger':
      addMesh(group, new THREE.ConeGeometry(0.28, 2.2, 8), primary, {
        y: 0.9,
        rx: Math.PI / 2,
        rz: -0.28,
        z: 0.7,
        spinY: 2.4,
      });
      addOrbit(group, secondary, orbitCount, 1.05, 0.16, 0.62, 'shard');
      break;
    case 'thousand-eyes':
      for (let index = 0; index < (reduced ? 5 : 9); index += 1) {
        const angle = (index / (reduced ? 5 : 9)) * Math.PI * 2;
        addMesh(group, new THREE.TorusGeometry(0.16, 0.045, 6, 18), primary, {
          x: Math.sin(angle) * 0.9,
          y: 0.45 + (index % 3) * 0.28,
          z: Math.cos(angle) * 0.9,
          rx: Math.PI / 2,
          ry: angle,
          spinZ: 2.2,
        });
      }
      addMesh(group, new THREE.OctahedronGeometry(0.28, 0), core, { y: 0.82, pulse: 0.16 });
      break;
    case 'nine-head-miasma':
      addOrbit(group, primary, reduced ? 5 : 9, 0.95, 0.24, 0.62);
      addStackedRings(group, secondary, reduced ? 3 : 5, 1.15, 1.45, 0.18);
      break;
    case 'divine-gale':
      addStackedRings(group, primary, reduced ? 3 : 5, 1.28, 1.3, 0.32);
      addOrbit(group, secondary, orbitCount, 1.1, 0.12, 0.8, 'shard');
      break;
    case 'trigram-furnace':
      addHorizontalRing(group, primary, 0.72, 0.82, 0.08, { spinZ: 1.6 });
      addSpokes(group, secondary, 8, 1.65, 0.12, 0.12);
      addMesh(group, new THREE.CylinderGeometry(0.42, 0.58, 1.05, 12), primary, {
        y: 0.58,
        spinY: 2.1,
      });
      addMesh(group, new THREE.ConeGeometry(0.32, 1.25, 8), core, { y: 1.35, pulse: 0.14 });
      break;
    case 'golden-staff':
      addMesh(group, new THREE.CylinderGeometry(0.09, 0.09, 3.1, 10), primary, {
        y: 1.25,
        rz: 0.28,
        spinY: 3.6,
      });
      addOrbit(group, secondary, orbitCount, 1.05, 0.14, 0.8);
      addHorizontalRing(group, core, 0.42, 1.35, 0.1, { spinZ: 3.2 });
      break;
    case 'celestial-eye':
      addMesh(group, new THREE.TorusGeometry(0.62, 0.09, 8, 36), primary, {
        y: 1.15,
        rx: Math.PI / 2,
        spinZ: 1.8,
      });
      addMesh(group, new THREE.OctahedronGeometry(0.3, 1), core, {
        y: 1.15,
        pulse: 0.18,
      });
      addMesh(group, new THREE.ConeGeometry(0.22, 2.2, 10), secondary, {
        y: 1.15,
        z: 1.25,
        rx: Math.PI / 2,
        sy: 1.4,
      });
      break;
    case 'fire-wheels':
      for (const x of [-0.58, 0.58]) {
        addMesh(group, new THREE.TorusGeometry(0.5, 0.11, 8, 28), primary, {
          x,
          y: 0.42,
          rx: Math.PI / 2,
          spinZ: x < 0 ? 9 : -9,
        });
      }
      for (let index = 0; index < (reduced ? 4 : 7); index += 1) {
        addMesh(group, new THREE.ConeGeometry(0.13, 0.8, 6), secondary, {
          x: (index - (reduced ? 1.5 : 3)) * 0.22,
          y: 0.35,
          z: -0.75 - (index % 2) * 0.28,
          rx: -Math.PI / 2,
        });
      }
      break;
    case 'mirror-clones':
      for (let index = -1; index <= 1; index += 1) {
        addMesh(group, new THREE.CapsuleGeometry(0.24, 0.75, 4, 8), index === 0 ? core : primary, {
          x: index * 0.72,
          y: 0.72,
          z: Math.abs(index) * 0.22,
          spinY: index * 1.4,
          pulse: 0.08,
        });
      }
      addHorizontalRing(group, secondary, 0.55, 1.3, 0.08, { spinZ: -2.5 });
      break;
    case 'golden-wings':
      for (const side of [-1, 1]) {
        for (let index = 0; index < (reduced ? 3 : 5); index += 1) {
          addMesh(group, new THREE.ConeGeometry(0.16, 1.3 - index * 0.12, 5), primary, {
            x: side * (0.42 + index * 0.22),
            y: 0.95 - index * 0.08,
            z: -0.05,
            rz: side * (0.75 + index * 0.12),
            pulse: 0.06,
          });
        }
      }
      addMesh(group, new THREE.ConeGeometry(0.22, 2.2, 7), secondary, {
        y: 0.85,
        z: 1.05,
        rx: Math.PI / 2,
      });
      break;
    case 'bone-soul':
      addOrbit(group, primary, orbitCount, 0.92, 0.2, 0.78);
      for (let index = 0; index < (reduced ? 3 : 5); index += 1) {
        addMesh(group, new THREE.BoxGeometry(0.08, 0.08, 1.1), secondary, {
          y: 0.35 + index * 0.22,
          ry: index * 1.25,
          rz: index % 2 === 0 ? 0.4 : -0.4,
          spinY: 2.2,
        });
      }
      addMesh(group, new THREE.SphereGeometry(0.34, 12, 8), core, {
        y: 1.1,
        sy: 0.75,
        pulse: 0.15,
      });
      break;
    case 'nine-tooth-rake':
      addMesh(group, new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), secondary, {
        y: 0.6,
        z: 0.55,
        rx: Math.PI / 2,
      });
      for (let index = 0; index < (reduced ? 5 : 9); index += 1) {
        addMesh(group, new THREE.ConeGeometry(0.09, 0.82, 5), primary, {
          x: (index - (reduced ? 2 : 4)) * 0.2,
          y: 0.58,
          z: 1.55,
          rx: Math.PI / 2,
        });
      }
      break;
    case 'white-dragon':
      for (let index = 0; index < (reduced ? 5 : 8); index += 1) {
        addMesh(group, new THREE.SphereGeometry(0.26 - index * 0.018, 10, 7), primary, {
          x: Math.sin(index * 0.9) * 0.26,
          y: 0.72 + Math.sin(index * 0.7) * 0.18,
          z: index * 0.38 - 1.2,
          pulse: 0.05,
        });
      }
      addMesh(group, new THREE.ConeGeometry(0.35, 0.9, 7), core, {
        y: 0.78,
        z: 1.65,
        rx: Math.PI / 2,
      });
      break;
    case 'lion-roar':
      for (let index = 0; index < (reduced ? 3 : 5); index += 1) {
        addMesh(group, new THREE.TorusGeometry(0.42 + index * 0.28, 0.055, 6, 32), primary, {
          y: 0.88,
          z: index * 0.34,
          rx: Math.PI / 2,
          pulse: 0.09,
        });
      }
      addMesh(group, new THREE.IcosahedronGeometry(0.36, 1), secondary, {
        y: 0.88,
        pulse: 0.18,
      });
      break;
    case 'demon-cyclone':
      addStackedRings(group, primary, reduced ? 4 : 7, 1.25, 1.8, 0.08);
      addMesh(group, new THREE.ConeGeometry(0.85, 2.2, 16, 1, true), secondary, {
        y: 0.9,
        spinY: 5.5,
        pulse: 0.09,
      });
      break;
    case 'vajra-ring':
      addMesh(group, new THREE.TorusGeometry(0.82, 0.13, 8, 36), primary, {
        y: 0.85,
        rx: Math.PI / 2,
        spinZ: 5.2,
      });
      addOrbit(group, secondary, reduced ? 4 : 6, 1.05, 0.14, 0.85, 'shard');
      break;
    case 'stone-arhat':
      addMesh(group, new THREE.BoxGeometry(0.9, 1.55, 0.72), primary, {
        y: 0.85,
        pulse: 0.05,
      });
      addMesh(group, new THREE.SphereGeometry(0.42, 12, 8), secondary, { y: 1.85 });
      addHorizontalRing(group, core, 0.62, 0.7, 0.12, { spinZ: 1.1 });
      break;
    case 'purple-gourd':
      addMesh(group, new THREE.SphereGeometry(0.52, 14, 10), primary, {
        y: 0.58,
        sy: 1.18,
        pulse: 0.08,
      });
      addMesh(group, new THREE.SphereGeometry(0.34, 12, 8), secondary, {
        y: 1.26,
        sy: 1.15,
      });
      addStackedRings(group, core, reduced ? 3 : 5, 0.95, 1.35, 0.2);
      break;
    case 'coin-storm':
      addOrbit(group, primary, reduced ? 6 : 10, 1.08, 0.22, 0.72, 'coin');
      addHorizontalRing(group, secondary, 0.35, 1.3, 0.1, { spinZ: 4.5 });
      break;
    case 'moon-chains':
      addOrbit(group, primary, reduced ? 4 : 7, 0.96, 0.2, 0.75, 'coin');
      addStackedRings(group, secondary, reduced ? 3 : 5, 0.9, 1.45, 0.28);
      addMesh(group, new THREE.SphereGeometry(0.3, 12, 8), core, { y: 1.02, pulse: 0.15 });
      break;
    case 'tiger-arrow':
      addMesh(group, new THREE.ConeGeometry(0.32, 2.4, 6), primary, {
        y: 0.75,
        z: 1.0,
        rx: Math.PI / 2,
      });
      for (const side of [-1, 1]) {
        addMesh(group, new THREE.ConeGeometry(0.13, 1.1, 5), secondary, {
          x: side * 0.38,
          y: 0.75,
          z: 0.05,
          rx: Math.PI / 2,
          rz: side * 0.3,
        });
      }
      break;
    case 'deer-blood':
      addHorizontalRing(group, primary, 0.52, 1.22, 0.1, { spinZ: 2.5 });
      for (const side of [-1, 1]) {
        for (let index = 0; index < (reduced ? 2 : 3); index += 1) {
          addMesh(group, new THREE.CylinderGeometry(0.035, 0.06, 0.8, 6), secondary, {
            x: side * (0.28 + index * 0.2),
            y: 0.9 + index * 0.28,
            rz: side * (0.35 + index * 0.18),
          });
        }
      }
      addMesh(group, new THREE.SphereGeometry(0.28, 12, 8), core, { y: 0.72, pulse: 0.2 });
      break;
    case 'wisdom-seal':
      addHorizontalRing(group, primary, 0.48, 1.18, 0.1, { spinZ: 1.8 });
      addSpokes(group, secondary, 8, 1.55, 0.08, 0.12);
      addMesh(group, new THREE.OctahedronGeometry(0.38, 1), core, { y: 0.9, spinY: 2.8 });
      break;
    case 'vow-lotus':
      addPetals(group, primary, reduced ? 6 : 10, 0.72, 0.24);
      addPetals(group, secondary, reduced ? 4 : 7, 0.42, 0.48);
      addMesh(group, new THREE.SphereGeometry(0.25, 12, 8), core, { y: 0.82, pulse: 0.18 });
      break;
    case 'universe-sleeve':
      for (let index = 0; index < (reduced ? 3 : 6); index += 1) {
        addMesh(
          group,
          new THREE.RingGeometry(0.42 + index * 0.12, 0.5 + index * 0.12, 32, 1, 0, 4.7),
          index % 2 === 0 ? primary : secondary,
          {
            y: 0.2 + index * 0.18,
            rx: -Math.PI / 2,
            ry: index * 0.34,
            spinZ: index % 2 === 0 ? 2.8 : -2.4,
          },
        );
      }
      addMesh(group, new THREE.SphereGeometry(0.28, 12, 8), core, { y: 1.1, pulse: 0.16 });
      break;
    case 'five-element-mountain':
      for (let index = 0; index < 5; index += 1) {
        const angle = (index / 5) * Math.PI * 2;
        addMesh(group, new THREE.ConeGeometry(0.36, 1.4 + (index % 2) * 0.4, 5), primary, {
          x: Math.sin(angle) * 0.72,
          y: 0.7,
          z: Math.cos(angle) * 0.72,
          pulse: 0.06,
        });
      }
      addMesh(group, new THREE.ConeGeometry(0.58, 2.1, 6), secondary, {
        y: 1.0,
        spinY: 0.8,
      });
      break;
    case 'willow-dew':
      addPetals(group, primary, reduced ? 6 : 9, 0.74, 0.2);
      for (let index = 0; index < (reduced ? 4 : 7); index += 1) {
        const angle = (index / (reduced ? 4 : 7)) * Math.PI * 2;
        addMesh(group, new THREE.SphereGeometry(0.12, 8, 6), secondary, {
          x: Math.sin(angle) * 0.6,
          y: 0.65 + (index % 3) * 0.28,
          z: Math.cos(angle) * 0.6,
          sy: 1.6,
          pulse: 0.16,
        });
      }
      break;
    case 'heavenly-pagoda':
      for (let index = 0; index < (reduced ? 3 : 5); index += 1) {
        addMesh(
          group,
          new THREE.CylinderGeometry(0.3 + index * 0.1, 0.45 + index * 0.12, 0.24, 8),
          primary,
          {
            y: 0.35 + index * 0.32,
            spinY: index % 2 === 0 ? 1.1 : -1.1,
          },
        );
        addMesh(group, new THREE.ConeGeometry(0.5 + index * 0.11, 0.2, 8), secondary, {
          y: 0.52 + index * 0.32,
        });
      }
      addMesh(group, new THREE.OctahedronGeometry(0.22, 0), core, { y: 2.05, spinY: 3.2 });
      break;
    case 'golden-kasaya':
      addMesh(group, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), primary, {
        y: 0.15,
        sy: 1.25,
        pulse: 0.08,
      });
      addHorizontalRing(group, secondary, 0.75, 1.05, 0.12, { spinZ: 2.1 });
      addOrbit(group, core, orbitCount, 0.82, 0.1, 0.82);
      break;
    case 'quicksand':
      for (let index = 0; index < (reduced ? 3 : 6); index += 1) {
        addHorizontalRing(
          group,
          index % 2 === 0 ? primary : secondary,
          0.25 + index * 0.16,
          0.32 + index * 0.16,
          0.08 + index * 0.02,
          {
            spinZ: index % 2 === 0 ? 3.5 : -3,
          },
        );
      }
      addOrbit(group, core, orbitCount, 0.9, 0.11, 0.35, 'shard');
      break;
    case 'black-wind':
      addStackedRings(group, primary, reduced ? 4 : 7, 1.05, 1.55, 0.3);
      addOrbit(group, secondary, orbitCount, 0.92, 0.16, 0.75, 'shard');
      addMesh(group, new THREE.SphereGeometry(0.32, 12, 8), core, { y: 0.92, pulse: 0.2 });
      break;
    case 'elephant-bind':
      for (const side of [-1, 1]) {
        addMesh(group, new THREE.TorusGeometry(0.62, 0.1, 8, 28, Math.PI * 1.3), primary, {
          x: side * 0.38,
          y: 0.82,
          ry: side * 0.35,
          rz: side * 0.62,
          spinZ: side * 1.5,
        });
      }
      addMesh(group, new THREE.ConeGeometry(0.22, 1.8, 8), secondary, {
        y: 0.75,
        z: 0.95,
        rx: Math.PI / 2,
      });
      break;
    case 'frozen-river':
      for (let index = 0; index < (reduced ? 6 : 10); index += 1) {
        const angle = (index / (reduced ? 6 : 10)) * Math.PI * 2;
        addMesh(group, new THREE.ConeGeometry(0.16, 1.05 + (index % 3) * 0.35, 5), primary, {
          x: Math.sin(angle) * 0.78,
          y: 0.48,
          z: Math.cos(angle) * 0.78,
          rz: Math.sin(angle) * 0.24,
          pulse: 0.07,
        });
      }
      addMesh(group, new THREE.OctahedronGeometry(0.42, 1), core, { y: 0.94, spinY: 2.1 });
      break;
    case 'ram-spirit':
      for (const side of [-1, 1]) {
        addMesh(group, new THREE.TorusGeometry(0.52, 0.09, 8, 28, Math.PI * 1.45), primary, {
          x: side * 0.35,
          y: 0.88,
          ry: side * 0.25,
          rz: side * 0.85,
          spinZ: side * 1.8,
        });
      }
      addMesh(group, new THREE.ConeGeometry(0.22, 1.65, 8), secondary, {
        y: 0.85,
        z: 0.92,
        rx: Math.PI / 2,
      });
      addMesh(group, new THREE.SphereGeometry(0.22, 10, 8), core, { y: 0.85, pulse: 0.2 });
      break;
    case 'purple-smoke':
      addOrbit(group, primary, reduced ? 5 : 9, 0.88, 0.28, 0.68);
      addStackedRings(group, secondary, reduced ? 3 : 5, 1.05, 1.45, 0.24);
      addMesh(group, new THREE.SphereGeometry(0.34, 12, 8), core, {
        y: 0.78,
        sy: 1.4,
        pulse: 0.16,
      });
      break;
  }

  if (stage === 'impact') {
    addHorizontalRing(group, core, 0.25, 1.12 * detail, 0.08, {
      spinZ: profile.motion === 'spiral' ? 5 : 2.2,
      pulse: 0.12,
    });
  } else if (stage === 'status') {
    addHorizontalRing(group, secondary, 0.72, 0.82, 0.12, {
      spinZ: profile.motion === 'spiral' ? 2.6 : 1.2,
    });
  }
}

export function createHeroSkillVisual(
  profile: HeroSkillVfxProfile,
  stage: HeroSkillStage,
  reduced: boolean,
): HeroSkillVisual {
  const group = new THREE.Group();
  group.name = `hero-skill-${profile.heroId.toLowerCase()}-${stage}-${profile.motif}`;
  group.userData.heroSkillMotion = profile.motion;
  group.userData.heroSkillStage = stage;
  group.userData.baseScale = profile.scale * (stage === 'impact' ? 1.12 : 1);
  group.renderOrder = 8;
  const materials = [
    glowMaterial(profile.primary, stage === 'status' ? 0.58 : 0.92),
    glowMaterial(profile.secondary, stage === 'status' ? 0.5 : 0.82),
    glowMaterial(profile.core, stage === 'status' ? 0.66 : 1),
  ] as const;
  group.userData.heroSkillMaterials = materials;
  populateMotif(group, profile, stage, reduced, materials);
  addCoreFlare(group, profile, stage, materials);
  addShockRings(group, profile, stage, reduced);
  addSparkBurst(group, profile, stage, reduced);
  attachSkillTextureLayer(group, profile.textureKey, stage, reduced);
  cacheAnimatedMeshes(group);
  const durationSeconds =
    stage === 'cast'
      ? profile.castDurationSeconds
      : stage === 'impact'
        ? profile.impactDurationSeconds
        : profile.statusDurationSeconds;
  return { group, materials, durationSeconds };
}

/**
 * Store the world-space anchor separately from the animation envelope.
 * Envelope motion is local to the skill, so it must never replace the
 * position assigned by the combat layer.
 */
export function placeHeroSkillVisual(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
): void {
  const anchor = (group.userData.heroSkillWorldPosition as THREE.Vector3 | undefined) ??
    new THREE.Vector3();
  anchor.set(x, y, z);
  group.userData.heroSkillWorldPosition = anchor;
  group.position.copy(anchor);
}

function cacheAnimatedMeshes(group: THREE.Group): readonly THREE.Mesh[] {
  const cached = group.userData.animatedMeshes;
  if (Array.isArray(cached)) {
    return cached as readonly THREE.Mesh[];
  }
  const meshes: THREE.Mesh[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      meshes.push(child);
    }
  });
  group.userData.animatedMeshes = meshes;
  return meshes;
}

interface SkillEnvelope {
  /** Multiplier on the profile's base scale. */
  readonly scale: number;
  /** Height offset in metres. */
  readonly lift: number;
  /** Offset along the cast direction in metres; negative recoils. */
  readonly push: number;
  /** Multiplier on the family's spin rate. */
  readonly spin: number;
  /** Multiplier on every material's base opacity. */
  readonly opacity: number;
}

/**
 * The rhythm of a cast, per motion family.
 *
 * Every motif used to share one ease, so a detonation, a thrust and an implosion
 * all grew at the same rate and only differed in the shapes involved. What
 * separates them is timing: an anticipation that loads the action, a release
 * that overshoots, and a settle that lets it land.
 *
 * The families are the axis with real data behind them — the roster spreads
 * across all six, nine heroes forward, eight rise, seven each spiral and
 * collapse. Duration is not: 35 of the 38 profiles take the default 0.72 s, so
 * an envelope derived from it would be the same curve for almost everyone.
 *
 * Anticipation belongs to the cast alone. An impact has already happened by the
 * time it is drawn, so winding up there would show the recoil after the hit.
 */
function skillEnvelope(
  motion: HeroSkillMotion,
  stage: HeroSkillStage,
  progress: number,
): SkillEnvelope {
  const clamped = Math.max(0, Math.min(1, progress));

  if (stage === 'status') {
    // A state, not an event: no anticipation, no overshoot, just presence.
    return { scale: 1, lift: 0, push: 0, spin: 1, opacity: 1 };
  }

  if (stage === 'impact') {
    // Pop and decay. The hit already landed; this is the flash it leaves.
    const pop = clamped < 0.14 ? clamped / 0.14 : 1;
    const decay = clamped < 0.14 ? 0 : (clamped - 0.14) / 0.86;
    return {
      scale: 0.55 + pop * 0.75 + decay * 0.35,
      lift: decay * 0.12,
      push: 0,
      spin: 1.6 - decay * 0.7,
      opacity: 1 - decay ** 1.6,
    };
  }

  const windup =
    motion === 'aura' ? 0 : motion === 'collapse' ? 0.34 : motion === 'burst' ? 0.08 : 0.2;
  if (clamped < windup) {
    const load = clamped / windup;
    switch (motion) {
      case 'collapse':
        // Gathers wide and bright before it crushes inward.
        return {
          scale: 1.1 + load * 0.4,
          lift: 0.1,
          push: 0,
          spin: 0.4 + load,
          opacity: 0.5 + load * 0.5,
        };
      case 'forward':
        // Recoils before the thrust. The pull-back is what sells the lunge.
        return {
          scale: 0.6 - load * 0.14,
          lift: 0,
          push: -0.22 * load,
          spin: 0.5,
          opacity: 0.35 + load * 0.5,
        };
      case 'rise':
        // Crouches before the eruption.
        return {
          scale: 0.62 - load * 0.16,
          lift: -0.14 * load,
          push: 0,
          spin: 0.6,
          opacity: 0.35 + load * 0.5,
        };
      case 'spiral':
        // Stays small and winds the spin up; the coil is stored in rotation.
        return {
          scale: 0.5 + load * 0.1,
          lift: 0,
          push: 0,
          spin: 0.6 + load * 2.6,
          opacity: 0.4 + load * 0.45,
        };
      default:
        return {
          scale: 0.55 + load * 0.2,
          lift: 0,
          push: 0,
          spin: 0.8,
          opacity: 0.45 + load * 0.45,
        };
    }
  }

  const after = (clamped - windup) / Math.max(0.05, 1 - windup);
  // Overshoot then settle: a damped curve that crosses 1 and comes back, which
  // is the shape an eye reads as "released" rather than "faded in".
  const released = 1 - (1 - after) ** 3;
  const overshoot = Math.sin(after * Math.PI) * (1 - after * 0.45);

  switch (motion) {
    case 'burst':
      return {
        scale: 0.75 + released * 0.95 + overshoot * 0.28,
        lift: released * 0.08,
        push: 0,
        spin: 1 + overshoot * 0.8,
        opacity: 1 - Math.max(0, after - 0.62) / 0.38,
      };
    case 'forward':
      return {
        scale: 0.46 + released * 0.92 + overshoot * 0.14,
        lift: released * 0.05,
        push: -0.22 + released * 1.05 + overshoot * 0.18,
        spin: 0.9 + overshoot * 0.5,
        opacity: 1 - Math.max(0, after - 0.68) / 0.32,
      };
    case 'rise':
      return {
        scale: 0.46 + released * 0.9 + overshoot * 0.16,
        lift: -0.14 + released * 0.72 + overshoot * 0.12,
        push: 0,
        spin: 1 + overshoot * 0.4,
        opacity: 1 - Math.max(0, after - 0.7) / 0.3,
      };
    case 'spiral':
      return {
        scale: 0.6 + released * 0.85,
        lift: released * 0.16,
        push: 0,
        // Unwinds: the stored coil spends itself, so the spin falls off from a
        // peak instead of running at one rate for the whole cast.
        spin: 3.2 - released * 1.9,
        opacity: 1 - Math.max(0, after - 0.66) / 0.34,
      };
    case 'collapse':
      return {
        // Crosses below its target and rebounds, so the crush has a floor.
        scale: 1.5 - released * 1.05 + overshoot * -0.12,
        lift: 0.1 - released * 0.1,
        push: 0,
        spin: 1.4 + released * 1.4,
        opacity: 1 - Math.max(0, after - 0.74) / 0.26,
      };
    default:
      return {
        scale: 0.7 + released * 0.5,
        lift: 0,
        push: 0,
        spin: 1,
        opacity: Math.min(1, after / 0.25),
      };
  }
}

export function updateHeroSkillVisual(
  group: THREE.Group,
  progress: number,
  elapsedSeconds: number,
): void {
  const motion = (group.userData.heroSkillMotion as HeroSkillMotion | undefined) ?? 'burst';
  const stage = (group.userData.heroSkillStage as HeroSkillStage | undefined) ?? 'cast';
  const baseScale = Number(group.userData.baseScale ?? 1);
  const envelope = skillEnvelope(motion, stage, progress);

  const breathing = stage === 'status' ? 0.96 + Math.sin(elapsedSeconds * 7) * 0.04 : 1;
  group.scale.setScalar(baseScale * envelope.scale * breathing);

  const spinRate = motion === 'spiral' ? 3.8 : motion === 'aura' ? 1.8 : 0.45;
  group.rotation.y =
    Number(group.userData.baseRotationY ?? 0) + elapsedSeconds * spinRate * envelope.spin;

  const anchor =
    (group.userData.heroSkillWorldPosition as THREE.Vector3 | undefined) ??
    (() => {
      const fallback = group.position.clone();
      group.userData.heroSkillWorldPosition = fallback;
      return fallback;
    })();
  const baseRotationY = Number(group.userData.baseRotationY ?? 0);
  // The cast direction is the group's authored forward; pushing along it keeps
  // a lunge pointed wherever the caster aimed without losing the world anchor.
  group.position.set(
    anchor.x + Math.sin(baseRotationY) * envelope.push,
    anchor.y + envelope.lift,
    anchor.z + Math.cos(baseRotationY) * envelope.push,
  );

  for (const material of (group.userData.heroSkillMaterials as
    | readonly THREE.Material[]
    | undefined) ?? []) {
    const base = Number(material.userData.baseOpacity ?? 1);
    material.opacity = base * Math.max(0, Math.min(1, envelope.opacity));
  }

  updateSparkBurst(group, progress, elapsedSeconds);
  updateShockRings(group, progress);
  updateSkillTextureLayer(group, progress, elapsedSeconds);

  for (const child of cacheAnimatedMeshes(group)) {
    const basePosition = child.userData.basePosition as THREE.Vector3 | undefined;
    const baseChildScale = child.userData.baseScale as THREE.Vector3 | undefined;
    const baseRotation = child.userData.baseRotation as THREE.Euler | undefined;
    const spinX = Number(child.userData.spinX ?? 0);
    const spinY = Number(child.userData.spinY ?? 0);
    const spinZ = Number(child.userData.spinZ ?? 0);
    const orbitRadius = Number(child.userData.orbitRadius ?? 0);
    const orbitSpeed = Number(child.userData.orbitSpeed ?? 0);
    const orbitPhase = Number(child.userData.orbitPhase ?? 0);
    const pulse = Number(child.userData.pulse ?? 0);
    if (baseRotation) {
      child.rotation.set(
        baseRotation.x + spinX * elapsedSeconds,
        baseRotation.y + spinY * elapsedSeconds,
        baseRotation.z + spinZ * elapsedSeconds,
      );
    }
    if (basePosition && orbitRadius > 0) {
      const angle = orbitPhase + elapsedSeconds * orbitSpeed;
      child.position.set(
        basePosition.x + Math.sin(angle) * orbitRadius,
        basePosition.y + Math.sin(angle * 1.7) * orbitRadius * 0.15,
        basePosition.z + Math.cos(angle) * orbitRadius,
      );
    }
    if (baseChildScale && pulse > 0) {
      const amount = 1 + Math.sin(elapsedSeconds * 9 + orbitPhase) * pulse;
      child.scale.copy(baseChildScale).multiplyScalar(amount);
    }
  }
}

/**
 * Advance the burst.
 *
 * Ballistic rather than linear: sparks decelerate through drag and fall, which
 * is what separates thrown debris from a shape being scaled outward. Opacity
 * holds for the first third and then drops, so the burst is bright while it is
 * still tight and gone before it can litter the ground.
 */
function updateSparkBurst(group: THREE.Group, progress: number, elapsedSeconds: number): void {
  const points = group.userData.sparks as THREE.Points | undefined;
  if (!points) {
    return;
  }

  const velocities = points.userData.sparkVelocities as Float32Array | undefined;
  const origins = points.userData.sparkOrigins as Float32Array | undefined;
  const attribute = points.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!velocities || !origins || !attribute) {
    return;
  }

  const time = Math.max(0, elapsedSeconds);
  // Exponential drag in closed form, so a spark's position depends only on the
  // elapsed time and never on how many frames have been drawn.
  const travel = (1 - Math.exp(-time * 3.2)) / 3.2;
  const fall = time * time * 1.55;
  const array = attribute.array as Float32Array;
  for (let index = 0; index < array.length; index += 3) {
    const originX = origins[index] ?? 0;
    const originY = origins[index + 1] ?? 0;
    const originZ = origins[index + 2] ?? 0;
    const velocityX = velocities[index] ?? 0;
    const velocityY = velocities[index + 1] ?? 0;
    const velocityZ = velocities[index + 2] ?? 0;
    array[index] = originX + velocityX * travel;
    array[index + 1] = Math.max(0.02, originY + velocityY * travel - fall);
    array[index + 2] = originZ + velocityZ * travel;
  }
  attribute.needsUpdate = true;

  const material = points.material as THREE.PointsMaterial;
  const base = Number(material.userData.baseOpacity ?? 0.95);
  const fade = progress < 0.34 ? 1 : 1 - (progress - 0.34) / 0.66;
  material.opacity = base * Math.max(0, fade);
}

/** Push each ring out along its own delayed curve and thin it as it goes. */
function updateShockRings(group: THREE.Group, progress: number): void {
  const rings = group.userData.shockRings as readonly THREE.Mesh[] | undefined;
  if (!rings) {
    return;
  }

  for (const ring of rings) {
    const delay = Number(ring.userData.ringDelay ?? 0);
    const reach = Number(ring.userData.ringReach ?? 2);
    const local = (progress - delay) / Math.max(0.05, 1 - delay);
    if (local <= 0) {
      ring.visible = false;
      continue;
    }

    ring.visible = true;
    const eased = 1 - (1 - Math.min(1, local)) ** 2;
    ring.scale.setScalar(0.35 + eased * reach);
    const material = ring.material as THREE.MeshBasicMaterial;
    const base = Number(material.userData.baseOpacity ?? 0.75);
    material.opacity = base * Math.max(0, 1 - eased) ** 1.4;
  }
}

export function createHeroSkillZoneSigil(
  profile: HeroSkillVfxProfile,
  reduced: boolean,
): THREE.Group {
  const sigil = new THREE.Group();
  sigil.name = `hero-skill-zone-sigil-${profile.heroId.toLowerCase()}`;
  const primary = glowMaterial(profile.primary, 0.32);
  const secondary = glowMaterial(profile.secondary, 0.44);
  const count = reduced ? 5 : 8;
  addHorizontalRing(sigil, secondary, 0.5, 0.58, 0.015, { spinZ: 0.8 });
  addSpokes(sigil, primary, count, 1.2, 0.045, 0.02);
  sigil.userData.materials = [primary, secondary];
  return sigil;
}

export function heroSkillSigilMaterials(group: THREE.Group): readonly THREE.MeshBasicMaterial[] {
  return (group.userData.materials as readonly THREE.MeshBasicMaterial[] | undefined) ?? [];
}
