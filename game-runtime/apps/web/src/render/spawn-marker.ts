import * as THREE from 'three';

export const SPAWN_MARKER_DISMISS_DISTANCE_MM = 80;
const SPAWN_MARKER_BLADE_COUNT = 6;

export interface SpawnMarkerVisual {
  readonly group: THREE.Group;
  readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly ringGlow: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly innerRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly core: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly crest: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  readonly blades: readonly THREE.Group[];
  readonly bladeMaterials: readonly [
    THREE.MeshBasicMaterial,
    THREE.MeshBasicMaterial,
  ];
  readonly sigil: THREE.Group;
  readonly sigilMaterials: readonly [
    THREE.MeshBasicMaterial,
    THREE.MeshBasicMaterial,
  ];
}

function markerMaterial(
  color: number,
  opacity: number,
  blending: THREE.Blending = THREE.AdditiveBlending,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending,
  });
  material.userData.baseOpacity = opacity;
  return material;
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

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(innerRadius, outerRadius, 64),
    markerMaterial(0x9b6412, 0.18, THREE.NormalBlending),
  );
  ring.name = 'player-spawn-marker-ring';
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = groundY;
  ring.renderOrder = 3;
  group.add(ring);

  const ringThickness = Math.max(0.04, (outerRadius - innerRadius) * 0.2);
  const ringGlow = new THREE.Mesh(
    new THREE.TorusGeometry(
      Math.max(innerRadius + ringThickness, outerRadius - ringThickness * 1.1),
      ringThickness,
      8,
      64,
    ),
    markerMaterial(0xe09a1b, 0.72, THREE.NormalBlending),
  );
  ringGlow.name = 'player-spawn-marker-outer-ring';
  ringGlow.rotation.x = Math.PI / 2;
  ringGlow.position.y = groundY + 0.012;
  ringGlow.renderOrder = 4;
  group.add(ringGlow);

  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(
      Math.max(0.12, innerRadius + ringThickness * 0.7),
      Math.max(0.025, ringThickness * 0.72),
      8,
      64,
    ),
    markerMaterial(0xf2bd3e, 0.62, THREE.NormalBlending),
  );
  innerRing.name = 'player-spawn-marker-inner-ring';
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = groundY + 0.028;
  innerRing.renderOrder = 5;
  group.add(innerRing);

  const sigil = new THREE.Group();
  sigil.name = 'player-spawn-marker-sigil';
  sigil.position.y = groundY + 0.04;
  sigil.renderOrder = 5;
  const sigilPrimary = markerMaterial(0xffe09a, 0.68, THREE.NormalBlending);
  const sigilSecondary = markerMaterial(0xd89018, 0.6, THREE.NormalBlending);

  const sigilRing = new THREE.Mesh(
    new THREE.TorusGeometry(Math.max(0.18, innerRadius * 0.34), 0.018, 6, 24),
    sigilSecondary,
  );
  sigilRing.rotation.x = Math.PI / 2;
  sigil.add(sigilRing);

  const sigilBarWidth = Math.max(0.28, innerRadius * 0.74);
  const sigilBar = new THREE.Mesh(
    new THREE.BoxGeometry(sigilBarWidth, 0.026, 0.032),
    sigilPrimary,
  );
  sigilBar.position.y = 0.02;
  sigilBar.rotation.y = Math.PI / 6;
  sigil.add(sigilBar);

  const sigilBarSecondary = new THREE.Mesh(
    new THREE.BoxGeometry(sigilBarWidth * 0.72, 0.022, 0.026),
    sigilSecondary,
  );
  sigilBarSecondary.position.y = 0.022;
  sigilBarSecondary.rotation.y = -Math.PI / 3;
  sigil.add(sigilBarSecondary);

  const sigilPoint = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.22, 4, 1, true),
    sigilPrimary,
  );
  sigilPoint.position.y = 0.13;
  sigilPoint.rotation.y = Math.PI / 4;
  sigil.add(sigilPoint);
  group.add(sigil);

  const bladePrimary = markerMaterial(0xffe39a, 0.74, THREE.NormalBlending);
  const bladeSecondary = markerMaterial(0xd99118, 0.64, THREE.NormalBlending);
  const bladeRadius = (innerRadius + outerRadius) / 2;
  const bladeHeights = [1.35, 1.72, 1.48, 1.92, 1.48, 1.72];
  const blades: THREE.Group[] = [];

  for (let index = 0; index < SPAWN_MARKER_BLADE_COUNT; index += 1) {
    const angle = (index / SPAWN_MARKER_BLADE_COUNT) * Math.PI * 2;
    const height = bladeHeights[index] ?? 1.5;
    const bladeThickness = Math.max(0.17, outerRadius * 0.24);
    const blade = new THREE.Group();
    blade.name = `player-spawn-marker-blade-${index}`;
    blade.position.set(Math.cos(angle) * bladeRadius, groundY, Math.sin(angle) * bladeRadius);
    blade.rotation.y = angle;
    blade.frustumCulled = false;
    blade.userData.phase = index * 0.83;
    blade.userData.baseHeight = height;
    blade.userData.baseY = groundY;

    const bladeStem = new THREE.Mesh(
      new THREE.CylinderGeometry(
        bladeThickness * 0.16,
        bladeThickness * 0.3,
        height * 0.62,
        6,
        1,
        true,
      ),
      bladePrimary,
    );
    bladeStem.position.y = height * 0.31;
    bladeStem.renderOrder = 5;
    blade.add(bladeStem);

    const bladeTip = new THREE.Mesh(
      new THREE.ConeGeometry(bladeThickness * 0.55, height * 0.48, 4, 1, true),
      bladePrimary,
    );
    bladeTip.position.y = height * 0.78;
    bladeTip.rotation.y = Math.PI / 4;
    bladeTip.renderOrder = 6;
    blade.add(bladeTip);

    const bladeCrossbar = new THREE.Mesh(
      new THREE.BoxGeometry(bladeThickness * 1.5, bladeThickness * 0.12, bladeThickness * 0.16),
      bladeSecondary,
    );
    bladeCrossbar.position.y = height * 0.43;
    bladeCrossbar.rotation.y = Math.PI / 2;
    bladeCrossbar.renderOrder = 6;
    blade.add(bladeCrossbar);

    blades.push(blade);
    group.add(blade);
  }

  const beamHeight = Math.max(2.2, outerRadius * 2.45);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, outerRadius * 0.2, beamHeight, 12, 1, true),
    markerMaterial(0xc78316, 0.035, THREE.AdditiveBlending),
  );
  beam.name = 'player-spawn-marker-beam';
  beam.position.y = groundY + beamHeight / 2;
  beam.renderOrder = 2;
  group.add(beam);

  const coreHeight = Math.max(1.25, outerRadius * 1.65);
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, outerRadius * 0.1, coreHeight, 8, 1, true),
    markerMaterial(0xffd66a, 0.12, THREE.AdditiveBlending),
  );
  core.name = 'player-spawn-marker-core';
  core.position.y = groundY + coreHeight / 2;
  core.renderOrder = 3;
  group.add(core);

  const crest = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.48, 4, 1, true),
    markerMaterial(0xffe3a0, 0.44, THREE.AdditiveBlending),
  );
  crest.name = 'player-spawn-marker-crest';
  crest.position.y = groundY + beamHeight + 0.12;
  crest.rotation.y = Math.PI / 4;
  crest.renderOrder = 6;
  crest.userData.baseY = crest.position.y;
  group.add(crest);

  return {
    group,
    ring,
    ringGlow,
    innerRing,
    beam,
    core,
    crest,
    blades,
    bladeMaterials: [bladePrimary, bladeSecondary],
    sigil,
    sigilMaterials: [sigilPrimary, sigilSecondary],
  };
}

export function updateSpawnMarkerVisual(visual: SpawnMarkerVisual, elapsedSeconds: number): void {
  const pulse = 0.5 + Math.sin(elapsedSeconds * 5.2) * 0.5;
  const slowPulse = 0.5 + Math.sin(elapsedSeconds * 2.35 + 0.8) * 0.5;

  visual.ring.scale.setScalar(1 + pulse * 0.04);
  visual.ringGlow.scale.setScalar(1 + slowPulse * 0.08);
  visual.innerRing.scale.setScalar(1 + pulse * 0.12);
  visual.sigil.rotation.y = elapsedSeconds * 0.85;
  visual.sigil.scale.setScalar(0.96 + slowPulse * 0.08);
  visual.beam.scale.x = 0.94 + pulse * 0.1;
  visual.beam.scale.z = 0.94 + pulse * 0.1;
  visual.core.scale.x = 0.92 + slowPulse * 0.14;
  visual.core.scale.z = 0.92 + slowPulse * 0.14;

  const crestBaseY = Number(visual.crest.userData.baseY ?? visual.crest.position.y);
  visual.crest.position.y = crestBaseY + Math.sin(elapsedSeconds * 2.2) * 0.08;
  visual.crest.rotation.y = elapsedSeconds * 1.8 + Math.PI / 4;

  for (const blade of visual.blades) {
    const phase = Number(blade.userData.phase ?? 0);
    const bladePulse = 0.5 + Math.sin(elapsedSeconds * 4.4 + phase) * 0.5;
    blade.scale.y = 0.86 + bladePulse * 0.2;
    blade.scale.x = 0.92 + bladePulse * 0.08;
    blade.scale.z = 0.92 + bladePulse * 0.08;
    blade.position.y = Number(blade.userData.baseY ?? 0) + Math.sin(elapsedSeconds * 2.8 + phase) * 0.025;
  }

  visual.ring.material.opacity = 0.12 + pulse * 0.08;
  visual.ringGlow.material.opacity = 0.56 + slowPulse * 0.2;
  visual.innerRing.material.opacity = 0.46 + pulse * 0.16;
  visual.beam.material.opacity = 0.02 + pulse * 0.025;
  visual.core.material.opacity = 0.07 + slowPulse * 0.07;
  visual.crest.material.opacity = 0.36 + pulse * 0.2;

  const [bladePrimary, bladeSecondary] = visual.bladeMaterials;
  bladePrimary && (bladePrimary.opacity = 0.58 + pulse * 0.18);
  bladeSecondary && (bladeSecondary.opacity = 0.46 + slowPulse * 0.16);
  const [sigilPrimary, sigilSecondary] = visual.sigilMaterials;
  sigilPrimary && (sigilPrimary.opacity = 0.5 + pulse * 0.18);
  sigilSecondary && (sigilSecondary.opacity = 0.42 + slowPulse * 0.16);
}
