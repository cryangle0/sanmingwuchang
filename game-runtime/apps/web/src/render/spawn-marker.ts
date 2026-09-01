import * as THREE from 'three';
import { webAssetUrl } from '../runtime/asset-url';

export const SPAWN_MARKER_DISMISS_DISTANCE_MM = 80;
export const SPAWN_MARKER_HEIGHT = 20;
export const SPAWN_AURA_HEIGHT = 4.8;
export const SPAWN_MARKER_WRAP_RADIUS = 1.28;
export const SPAWN_BASE_DIAMETER_SCALE = 3.8;
export const SPAWN_BASE_RING_SCALE = 4.6;
export const SPAWN_CIRCLE_RIM_FILL = 0.9;
export const SPAWN_AURA_SHEET = {
  columns: 8,
  rows: 3,
  frames: 22,
  fps: 16,
} as const;

const AURA_PLANE_COUNT = 3;
const RAY_PLANE_COUNT = 3;
const SPARK_SIZE = 32;
const PILLAR_TEXTURE_WIDTH = 64;
const PILLAR_TEXTURE_HEIGHT = 256;

export interface SpawnMarkerVisual {
  readonly group: THREE.Group;
  readonly circle: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly ring: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly auras: readonly THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];
  readonly planes: readonly THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];
  readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly core: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly motes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  readonly pillarTexture: THREE.Texture;
  readonly sparkTexture: THREE.Texture;
  readonly auraTexture: THREE.Texture;
  readonly circleTexture: THREE.Texture;
  readonly ringTexture: THREE.Texture;
}

function markerMaterial(
  color: number,
  opacity: number,
  map?: THREE.Texture,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    map,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
}

function configureTexture(texture: THREE.Texture, wrapT: THREE.Wrapping): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = wrapT;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

function createPillarTexture(): THREE.DataTexture {
  const data = new Uint8Array(PILLAR_TEXTURE_WIDTH * PILLAR_TEXTURE_HEIGHT * 4);
  const color = new THREE.Color();
  for (let y = 0; y < PILLAR_TEXTURE_HEIGHT; y += 1) {
    const v = y / (PILLAR_TEXTURE_HEIGHT - 1);
    for (let x = 0; x < PILLAR_TEXTURE_WIDTH; x += 1) {
      const u = x / (PILLAR_TEXTURE_WIDTH - 1);
      const edge = Math.max(0, 1 - Math.abs(u - 0.5) * 2) ** 1.35;
      color.setHSL(0.08 + v * 0.04, 0.92, 0.62);
      const alpha = edge * Math.min(1, (1 - v) / 0.18) * Math.min(1, v / 0.03);
      const index = (y * PILLAR_TEXTURE_WIDTH + x) * 4;
      data[index] = Math.round(color.r * 255);
      data[index + 1] = Math.round(color.g * 255);
      data[index + 2] = Math.round(color.b * 255);
      data[index + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, PILLAR_TEXTURE_WIDTH, PILLAR_TEXTURE_HEIGHT);
  configureTexture(texture, THREE.ClampToEdgeWrapping);
  texture.name = 'player-spawn-marker-pillar-fallback';
  return texture;
}

function createSparkTexture(): THREE.DataTexture {
  const data = new Uint8Array(SPARK_SIZE * SPARK_SIZE * 4);
  const color = new THREE.Color();
  const center = (SPARK_SIZE - 1) / 2;
  for (let y = 0; y < SPARK_SIZE; y += 1) {
    for (let x = 0; x < SPARK_SIZE; x += 1) {
      const radius = Math.min(1, Math.hypot((x - center) / center, (y - center) / center));
      const falloff = (1 - radius) ** 2.2;
      color.setHSL(0.08 + (1 - radius) * 0.12, 0.9, 0.72);
      const index = (y * SPARK_SIZE + x) * 4;
      data[index] = Math.round(color.r * 255);
      data[index + 1] = Math.round(color.g * 255);
      data[index + 2] = Math.round(color.b * 255);
      data[index + 3] = Math.round(falloff * 255);
    }
  }
  const texture = new THREE.DataTexture(data, SPARK_SIZE, SPARK_SIZE);
  configureTexture(texture, THREE.ClampToEdgeWrapping);
  texture.name = 'player-spawn-marker-spark-fallback';
  return texture;
}

function createSolidFallback(name: string, r: number, g: number, b: number): THREE.DataTexture {
  const data = new Uint8Array([r, g, b, 220, r, g, b, 160, r, g, b, 160, r, g, b, 80]);
  const texture = new THREE.DataTexture(data, 2, 2);
  configureTexture(texture, THREE.ClampToEdgeWrapping);
  texture.name = name;
  return texture;
}

function loadSpawnTexture(
  file: string,
  fallback: THREE.Texture,
  wrapS: THREE.Wrapping = THREE.ClampToEdgeWrapping,
): THREE.Texture {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const texture = new THREE.TextureLoader().load(webAssetUrl(`vfx/spawn/${file}`), (loaded) => {
    configureTexture(loaded, THREE.ClampToEdgeWrapping);
    loaded.wrapS = wrapS;
  });
  configureTexture(texture, THREE.ClampToEdgeWrapping);
  texture.wrapS = wrapS;
  texture.name = `player-spawn-${file}`;
  return texture;
}

function setSpriteFrame(texture: THREE.Texture, frame: number): void {
  const col = frame % SPAWN_AURA_SHEET.columns;
  const row = Math.floor(frame / SPAWN_AURA_SHEET.columns);
  texture.repeat.set(1 / SPAWN_AURA_SHEET.columns, 1 / SPAWN_AURA_SHEET.rows);
  texture.offset.set(col / SPAWN_AURA_SHEET.columns, 1 - (row + 1) / SPAWN_AURA_SHEET.rows);
}

function wrapRadiusFor(innerRadius: number, outerRadius: number): number {
  return Math.max(SPAWN_MARKER_WRAP_RADIUS, innerRadius * 1.7, outerRadius * 1.28);
}

function addCrossPlanes(
  group: THREE.Group,
  name: string,
  count: number,
  width: number,
  height: number,
  y: number,
  material: THREE.MeshBasicMaterial,
  renderOrder: number,
  spin: number,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] {
  const planes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  for (let index = 0; index < count; index += 1) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      index === 0 ? material : material.clone(),
    );
    plane.name = `${name}-${index}`;
    plane.position.y = y;
    plane.rotation.y = (index * Math.PI) / count;
    plane.renderOrder = renderOrder;
    plane.frustumCulled = false;
    plane.userData.baseRotation = plane.rotation.y;
    plane.userData.spin = spin * (index % 2 === 0 ? 1 : -1);
    planes.push(plane);
    group.add(plane);
  }
  return planes;
}

export function hasMovedFromSpawn(
  spawnX: number,
  spawnZ: number,
  currentX: number,
  currentZ: number,
): boolean {
  return Math.hypot(currentX - spawnX, currentZ - spawnZ) >= SPAWN_MARKER_DISMISS_DISTANCE_MM;
}

export function createSpawnMarkerVisual(
  innerRadius: number,
  outerRadius: number,
  groundY: number,
): SpawnMarkerVisual {
  const group = new THREE.Group();
  group.name = 'player-spawn-marker';
  group.frustumCulled = false;
  const wrapRadius = wrapRadiusFor(innerRadius, outerRadius);
  const baseDiameter = wrapRadius * SPAWN_BASE_DIAMETER_SCALE;
  const paintedDiameter = baseDiameter * SPAWN_CIRCLE_RIM_FILL;
  const rimRadius = paintedDiameter / 2;

  const pillarTexture = loadSpawnTexture(
    'ray-pillar.png',
    createPillarTexture(),
    THREE.RepeatWrapping,
  );
  pillarTexture.repeat.set(8, 1);
  const sparkTexture = loadSpawnTexture('spark-star.png', createSparkTexture());
  const auraTexture = loadSpawnTexture(
    'aura-sheet.png',
    createSolidFallback('player-spawn-marker-aura-fallback', 72, 220, 196),
  );
  const circleTexture = loadSpawnTexture(
    'circle-rainbow.png',
    createSolidFallback('player-spawn-marker-circle-fallback', 255, 96, 210),
  );
  const ringTexture = loadSpawnTexture(
    'ring-rainbow.png',
    createSolidFallback('player-spawn-marker-ring-fallback', 96, 210, 255),
  );
  setSpriteFrame(auraTexture, 0);

  const circle = new THREE.Mesh(
    new THREE.PlaneGeometry(baseDiameter, baseDiameter),
    markerMaterial(0xffffff, 0.92, circleTexture),
  );
  circle.name = 'player-spawn-marker-circle';
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = groundY + 0.04;
  circle.renderOrder = 4;
  group.add(circle);

  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(wrapRadius * SPAWN_BASE_RING_SCALE, wrapRadius * SPAWN_BASE_RING_SCALE),
    markerMaterial(0xffffff, 0.82, ringTexture),
  );
  ring.name = 'player-spawn-marker-ring';
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = groundY + 0.07;
  ring.renderOrder = 5;
  group.add(ring);

  const auras = addCrossPlanes(
    group,
    'player-spawn-marker-aura',
    AURA_PLANE_COUNT,
    paintedDiameter,
    SPAWN_AURA_HEIGHT,
    groundY + SPAWN_AURA_HEIGHT / 2,
    markerMaterial(0xffffff, 0.46, auraTexture),
    3,
    0.12,
  );
  const planes = addCrossPlanes(
    group,
    'player-spawn-marker-plane',
    RAY_PLANE_COUNT,
    paintedDiameter,
    SPAWN_MARKER_HEIGHT,
    groundY + SPAWN_MARKER_HEIGHT / 2,
    markerMaterial(0xffe0b8, 0.22, pillarTexture),
    2,
    0.05,
  );

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(rimRadius * 0.96, rimRadius, SPAWN_MARKER_HEIGHT, 32, 1, true),
    markerMaterial(0xfff1d0, 0.48, pillarTexture),
  );
  beam.name = 'player-spawn-marker-beam';
  beam.position.y = groundY + SPAWN_MARKER_HEIGHT / 2;
  beam.renderOrder = 1;
  beam.frustumCulled = false;
  group.add(beam);

  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(
      rimRadius * 0.08,
      rimRadius * 0.12,
      SPAWN_MARKER_HEIGHT,
      12,
      1,
      true,
    ),
    markerMaterial(0xfff6dc, 0.22),
  );
  core.name = 'player-spawn-marker-core';
  core.position.y = groundY + SPAWN_MARKER_HEIGHT / 2;
  core.renderOrder = 2;
  core.frustumCulled = false;
  group.add(core);

  const moteCount = 16;
  const motePositions = new Float32Array(moteCount * 3);
  const motePhases = new Float32Array(moteCount);
  for (let index = 0; index < moteCount; index += 1) {
    const angle = (index / moteCount) * Math.PI * 2;
    const radius = rimRadius * (0.86 + (index % 4) * 0.04);
    motePositions[index * 3] = Math.cos(angle) * radius;
    motePositions[index * 3 + 1] = groundY + 0.2 + (index % 7) * 1.4;
    motePositions[index * 3 + 2] = Math.sin(angle) * radius;
    motePhases[index] = index * 0.51;
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const motes = new THREE.Points(
    moteGeometry,
    new THREE.PointsMaterial({
      map: sparkTexture,
      color: 0xffe6a8,
      size: 0.14,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      alphaTest: 0.12,
      fog: false,
    }),
  );
  motes.name = 'player-spawn-marker-motes';
  motes.frustumCulled = false;
  motes.userData.phases = motePhases;
  motes.userData.groundY = groundY;
  motes.userData.rimRadius = rimRadius;
  motes.renderOrder = 7;
  group.add(motes);

  return {
    group,
    circle,
    ring,
    auras,
    planes,
    beam,
    core,
    motes,
    pillarTexture,
    sparkTexture,
    auraTexture,
    circleTexture,
    ringTexture,
  };
}

export function updateSpawnMarkerVisual(visual: SpawnMarkerVisual, elapsedSeconds: number): void {
  const pulse = 0.5 + Math.sin(elapsedSeconds * 3.1) * 0.5;
  const slowPulse = 0.5 + Math.sin(elapsedSeconds * 1.3 + 0.4) * 0.5;
  setSpriteFrame(
    visual.auraTexture,
    Math.floor(elapsedSeconds * SPAWN_AURA_SHEET.fps) % SPAWN_AURA_SHEET.frames,
  );

  visual.circle.rotation.z = elapsedSeconds * 0.55;
  visual.ring.rotation.z = -elapsedSeconds * 0.8;

  for (const aura of visual.auras) {
    const baseRotation = Number(aura.userData.baseRotation ?? 0);
    const spin = Number(aura.userData.spin ?? 0.16);
    aura.rotation.y = baseRotation + elapsedSeconds * spin;
    aura.material.opacity = 0.38 + pulse * 0.16;
  }
  for (const plane of visual.planes) {
    const baseRotation = Number(plane.userData.baseRotation ?? 0);
    const spin = Number(plane.userData.spin ?? 0.08);
    plane.rotation.y = baseRotation + elapsedSeconds * spin;
    plane.material.opacity = 0.14 + pulse * 0.1;
  }

  visual.circle.material.opacity = 0.68 + pulse * 0.18;
  visual.ring.material.opacity = 0.58 + slowPulse * 0.18;
  visual.beam.material.opacity = 0.4 + pulse * 0.16;
  visual.core.material.opacity = 0.22 + slowPulse * 0.1;
  visual.motes.material.opacity = 0.42 + pulse * 0.22;

  const positions = visual.motes.geometry.getAttribute('position');
  const phases = visual.motes.userData.phases as Float32Array;
  const groundY = Number(visual.motes.userData.groundY ?? 0);
  const rimRadius = Number(
    visual.motes.userData.rimRadius ?? SPAWN_MARKER_WRAP_RADIUS * SPAWN_BASE_DIAMETER_SCALE * 0.5,
  );
  for (let index = 0; index < positions.count; index += 1) {
    const phase = phases[index] ?? 0;
    const travel = (((elapsedSeconds * 0.36 + phase) % 1) + 1) % 1;
    const angle = elapsedSeconds * 0.58 + phase;
    const radius = rimRadius * (0.88 + (index % 3) * 0.04);
    positions.setX(index, Math.cos(angle) * radius);
    positions.setY(index, groundY + 0.12 + travel * SPAWN_MARKER_HEIGHT);
    positions.setZ(index, Math.sin(angle) * radius);
  }
  positions.needsUpdate = true;
}
