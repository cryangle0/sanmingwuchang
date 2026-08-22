import { denCentreMm, MAP_NESTS } from '@jwgb/content';
import * as THREE from 'three';
import {
  addBox,
  addCylinder,
  addDisc,
  addDodecahedron,
  addHemisphere,
  addHorizontalArcTorus,
  type Site,
  siteTowardOrigin,
  transformAtSite,
} from './prop-kit';
import type { DressingBags } from './region-dressing';

/**
 * 48 authoritative nests as readable dens, not map pins: melee dens are
 * trampled hollows with a bone-ring mouth, ranged dens are cairn shrines,
 * flyers roost on poles around a nest bowl. Inner-band dens build larger.
 */
export function buildNestMarkers(
  bags: DressingBags,
  nextRandom: () => number,
): Record<'MEL' | 'RNG' | 'FLY', number> {
  const counts = { MEL: 0, RNG: 0, FLY: 0 };
  for (const nest of MAP_NESTS) {
    // The hollow is dug beside the route, not at the anchor, so the dressing
    // has to follow it or the den props end up standing next to their own pit.
    const floorRadiusMm = nest.band === '内' ? 8_000 : nest.band === '中' ? 7_000 : 6_000;
    const centre = denCentreMm(nest.base, floorRadiusMm);
    const site = siteTowardOrigin(centre.x / 1_000, centre.z / 1_000);
    const scale = nest.band === '内' ? 1.22 : nest.band === '中' ? 1.06 : 0.9;
    if (nest.kind === 'MEL') {
      addMeleeDen(bags, site, scale, nextRandom);
      counts.MEL += 1;
    } else if (nest.kind === 'RNG') {
      addRangedShrine(bags, site, scale, nextRandom);
      counts.RNG += 1;
    } else {
      addFlyerRoost(bags, site, scale, nextRandom);
      counts.FLY += 1;
    }
  }
  return counts;
}

function addMeleeDen(
  bags: DressingBags,
  site: Site,
  scale: number,
  nextRandom: () => number,
): void {
  addDisc(bags.soil, site, 0, 0.02, 0, 7.4 * scale, 6.4 * scale, 16);
  addDisc(bags.bone, site, 0, 0.028, 0.35 * scale, 3.4 * scale, 2.8 * scale, 12);
  addHemisphere(bags.soil, site, 0, 0, -1.85 * scale, 4.6 * scale, 1.55 * scale, 3.4 * scale);
  addHemisphere(
    bags.soil,
    site,
    -2.35 * scale,
    0,
    -0.55 * scale,
    2.4 * scale,
    1.15 * scale,
    2.1 * scale,
  );
  addHemisphere(
    bags.soil,
    site,
    2.4 * scale,
    0,
    -0.6 * scale,
    2.3 * scale,
    1.1 * scale,
    2.05 * scale,
  );
  addHorizontalArcTorus(
    bags.rock,
    site,
    3.35 * scale,
    0.28 * scale,
    Math.PI * 0.18,
    Math.PI * 1.64,
    14,
    0.32 * scale,
  );

  const bones = 5 + Math.floor(nextRandom() * 3);
  for (let index = 0; index < bones; index += 1) {
    const angle = (index / bones) * Math.PI * 1.6 + 0.35;
    const radius = (2.1 + nextRandom() * 0.7) * scale;
    addDodecahedron(
      bags.bone,
      site,
      Math.sin(angle) * radius,
      0.16 * scale,
      Math.cos(angle) * radius * 0.72 - 0.2 * scale,
      (0.22 + nextRandom() * 0.16) * scale,
      (0.12 + nextRandom() * 0.08) * scale,
      (0.34 + nextRandom() * 0.2) * scale,
      nextRandom() * Math.PI,
    );
  }

  for (const x of [-1.55, 1.55]) {
    addCylinder(
      bags.timber,
      site,
      x * scale,
      0.85 * scale,
      2.45 * scale,
      0.08,
      0.12,
      1.7 * scale,
      6,
    );
  }
  addBox(bags.timber, site, 0, 1.55 * scale, 2.45 * scale, 3.3 * scale, 0.12, 0.16);
  addBox(
    bags.straw,
    site,
    2.6 * scale,
    0.28 * scale,
    0.4 * scale,
    1.35 * scale,
    0.42 * scale,
    0.85 * scale,
    -0.2,
  );
}

function addRangedShrine(
  bags: DressingBags,
  site: Site,
  scale: number,
  nextRandom: () => number,
): void {
  addDisc(bags.soil, site, 0, 0.02, 0, 6.4 * scale, 6.4 * scale, 16);
  addCylinder(bags.rock, site, 0, 0.08 * scale, 0, 1.55 * scale, 1.7 * scale, 0.16 * scale, 10);
  addDodecahedron(
    bags.rock,
    site,
    0,
    0.42 * scale,
    0,
    1.15 * scale,
    0.55 * scale,
    0.95 * scale,
    0.2,
  );
  addDodecahedron(
    bags.rock,
    site,
    0,
    0.92 * scale,
    0,
    0.72 * scale,
    0.42 * scale,
    0.62 * scale,
    0.7,
  );
  addDodecahedron(
    bags.rock,
    site,
    0,
    1.28 * scale,
    0,
    0.42 * scale,
    0.32 * scale,
    0.38 * scale,
    1.1,
  );

  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2 + 0.12;
    const radius = 2.85 * scale;
    addCylinder(
      bags.rock,
      site,
      Math.sin(angle) * radius,
      0.95 * scale,
      Math.cos(angle) * radius,
      0.16 * scale,
      0.22 * scale,
      1.9 * scale,
      6,
    );
    addDodecahedron(
      bags.rock,
      site,
      Math.sin(angle) * radius,
      1.95 * scale,
      Math.cos(angle) * radius,
      0.38 * scale,
      0.28 * scale,
      0.32 * scale,
      nextRandom() * Math.PI,
    );
  }

  addCylinder(
    bags.timber,
    site,
    0.85 * scale,
    1.15 * scale,
    0.2 * scale,
    0.04,
    0.055,
    2.3 * scale,
    5,
  );
  addBox(
    bags.cloth,
    site,
    0.95 * scale,
    2.05 * scale,
    0.2 * scale,
    0.42 * scale,
    0.55 * scale,
    0.02,
    0.35,
  );
  addBox(
    bags.charred,
    site,
    -0.85 * scale,
    0.18 * scale,
    0.55 * scale,
    0.55 * scale,
    0.22 * scale,
    0.38,
    0.4,
  );
}

function addFlyerRoost(
  bags: DressingBags,
  site: Site,
  scale: number,
  nextRandom: () => number,
): void {
  addDisc(bags.soil, site, 0, 0.02, 0, 5.6 * scale, 5.6 * scale, 14);
  addHemisphere(bags.straw, site, 0, 0.12 * scale, 0, 1.55 * scale, 0.55 * scale, 1.55 * scale);
  addSiteTorus(bags.straw, site, 0, 0.55 * scale, 0, 0.85 * scale, 0.16 * scale);

  const poles = [
    [0, 0],
    [-1.65, 1.15],
    [1.7, 1.05],
    [0.15, -1.85],
  ] as const;
  for (const [x, z] of poles) {
    const height = (3.4 + nextRandom() * 0.55) * scale;
    addCylinder(bags.timber, site, x * scale, height / 2, z * scale, 0.07, 0.11, height, 6);
    addBox(
      bags.timber,
      site,
      x * scale,
      height - 0.12 * scale,
      z * scale,
      1.35 * scale,
      0.07,
      0.07,
      0.15,
    );
    addSiteTorus(
      bags.straw,
      site,
      x * scale,
      height + 0.06 * scale,
      z * scale,
      0.32 * scale,
      0.09 * scale,
    );
  }
  addDisc(bags.bone, site, 0, 0.018, 0, 1.7 * scale, 1.5 * scale, 8);
}

function addSiteTorus(
  bag: DressingBags['straw'],
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  radius: number,
  tube: number,
): void {
  const geometry = new THREE.TorusGeometry(radius, tube, 6, 8);
  geometry.rotateX(Math.PI / 2);
  transformAtSite(geometry, site, localX, y, localZ);
  bag.push(geometry);
}
