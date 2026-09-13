import * as THREE from 'three';
import { buildSkillShape, skillShapeMaterials } from './hero-skill-shapes';

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
    castDurationSeconds: options.castDurationSeconds ?? 1.1,
    impactDurationSeconds: options.impactDurationSeconds ?? 0.8,
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
    // Additive glows have to bypass ACES: filmic tone mapping compresses the
    // stacked highlights into pastel, which is most of why every cast read
    // as translucent plastic rather than as light.
    toneMapped: false,
  });
  material.userData.baseOpacity = opacity;
  return material;
}

/**
 * Shared soft-edge textures, painted once per page.
 *
 * Hard-edged primitives are what made the skills read as geometry. A radial
 * falloff on the same shapes turns a disc into a glow and a ring into a
 * shockwave. Both are null outside a browser so the module stays testable.
 */
let softDiscTexture: THREE.Texture | null | undefined;
let softRingTexture: THREE.Texture | null | undefined;

function paintRadial(stops: readonly (readonly [number, number])[]): THREE.Texture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  for (const [offset, alpha] of stops) {
    gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function softDisc(): THREE.Texture | null {
  softDiscTexture ??= paintRadial([
    [0, 1],
    [0.3, 0.8],
    [0.62, 0.28],
    [1, 0],
  ]);
  return softDiscTexture;
}

export function softRing(): THREE.Texture | null {
  softRingTexture ??= paintRadial([
    [0, 0],
    [0.62, 0],
    [0.8, 0.55],
    [0.9, 1],
    [1, 0],
  ]);
  return softRingTexture;
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
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, radius), material);
    mesh.position.set(Math.sin(angle) * radius * 0.5, y, Math.cos(angle) * radius * 0.5);
    mesh.rotation.y = angle;
    group.add(mesh);
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
  // One bespoke silhouette per skill (see hero-skill-shapes.ts) over a thin
  // ground ring. Nothing else: no flash, no sparks, no ribbons, no card.
  const shapeMaterials = skillShapeMaterials(profile, stage);
  const materials = [
    shapeMaterials.primary,
    shapeMaterials.secondary,
    shapeMaterials.core,
  ] as const;
  group.userData.heroSkillMaterials = materials;
  buildSkillShape(group, profile.motif, stage, shapeMaterials);
  if (stage !== 'status') {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.62, 48), shapeMaterials.core);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.userData.shockRing = true;
    ring.userData.ringDelay = 0;
    ring.userData.ringReach = stage === 'impact' ? 2.6 : 1.4;
    group.add(ring);
    group.userData.shockRings = [ring];
  }
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
export function placeHeroSkillVisual(group: THREE.Group, x: number, y: number, z: number): void {
  const anchor =
    (group.userData.heroSkillWorldPosition as THREE.Vector3 | undefined) ?? new THREE.Vector3();
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

  const spinRate = motion === 'spiral' ? 1.6 : motion === 'aura' ? 0.8 : 0;
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

  updateShockRings(group, progress);

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
    const rise = Number(child.userData.rise ?? 0);
    const riseSpan = Number(child.userData.riseSpan ?? 0);
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
    if (basePosition && rise !== 0 && riseSpan > 0) {
      const travelled = (((elapsedSeconds * rise) % riseSpan) + riseSpan) % riseSpan;
      child.position.set(basePosition.x, basePosition.y + travelled, basePosition.z);
    }
    if (baseChildScale && pulse > 0) {
      const amount = 1 + Math.sin(elapsedSeconds * 9 + orbitPhase) * pulse;
      child.scale.copy(baseChildScale).multiplyScalar(amount);
    }
  }
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
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 40), secondary);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015;
  sigil.add(ring);
  addSpokes(sigil, primary, count, 1.2, 0.045, 0.02);
  sigil.userData.materials = [primary, secondary];
  return sigil;
}

export function heroSkillSigilMaterials(group: THREE.Group): readonly THREE.MeshBasicMaterial[] {
  return (group.userData.materials as readonly THREE.MeshBasicMaterial[] | undefined) ?? [];
}
