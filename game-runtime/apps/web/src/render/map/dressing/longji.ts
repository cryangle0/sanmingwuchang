import * as THREE from 'three';
import { addCone, addCylinder, addDodecahedron, type Site, transformAtSite } from './prop-kit';
import type { DressingBags } from './region-dressing';

/**
 * 龙脊渊 · 东北 · 高台深潭。
 *
 * The district's namesake: colossal dragon spines — rows of bleached rib
 * arches sinking into the earth with a vertebra chain between them — plus
 * reed clusters and mossy pool stones for the "渊" waterline feel.
 */
export function dressLongji(
  bags: DressingBags,
  sites: readonly Site[],
  nextRandom: () => number,
): number {
  sites.forEach((site, index) => {
    // The first few open sites carry the big skeleton landmarks; the rest are
    // reeds and pool stones so the fossil rows stay rare enough to be special.
    if (index < 3) {
      addDragonSpine(bags, site, nextRandom);
    } else if (nextRandom() < 0.58) {
      addReedCluster(bags, site, nextRandom);
    } else {
      addPoolStones(bags, site, nextRandom);
    }
  });
  return sites.length;
}

function addDragonSpine(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const ribs = 5 + Math.floor(nextRandom() * 2);
  const spacing = 2.1;
  const start = (-(ribs - 1) / 2) * spacing;
  for (let index = 0; index < ribs; index += 1) {
    // Ribs shrink toward the tail like a beached serpent skeleton.
    const falloff = 1 - (index / ribs) * 0.55;
    const radius = (2.6 + nextRandom() * 0.5) * falloff;
    const tube = 0.16 * falloff + 0.05;
    const geometry = new THREE.TorusGeometry(radius, tube, 5, 9, Math.PI);
    // Torus arcs live in the XY plane, so the half-arc already stands upright;
    // yaw turns each rib across the spine axis.
    geometry.rotateY(Math.PI / 2);
    transformAtSite(
      geometry,
      site,
      start + index * spacing,
      0,
      (nextRandom() - 0.5) * 0.3,
      (nextRandom() - 0.5) * 0.14,
    );
    bags.bone.push(geometry);

    // Vertebra between ribs.
    addDodecahedron(
      bags.bone,
      site,
      start + index * spacing + spacing / 2,
      0.26 * falloff + 0.08,
      0,
      0.34 * falloff + 0.1,
      0.3 * falloff + 0.08,
      0.34 * falloff + 0.1,
      nextRandom() * Math.PI,
    );
  }
  // Skull-like boulder at the head end.
  addDodecahedron(
    bags.bone,
    site,
    start - 1.3,
    0.42,
    0.1,
    0.78,
    0.55,
    0.62,
    nextRandom() * Math.PI,
  );
}

function addReedCluster(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const reeds = 5 + Math.floor(nextRandom() * 5);
  for (let index = 0; index < reeds; index += 1) {
    const localX = (nextRandom() - 0.5) * 2.2;
    const localZ = (nextRandom() - 0.5) * 2.2;
    const height = 1.3 + nextRandom() * 1.1;
    addCylinder(bags.straw, site, localX, height / 2, localZ, 0.022, 0.05, height, 4);
    // Seed head.
    addCone(bags.straw, site, localX, height + 0.14, localZ, 0.07, 0.3, 4);
  }
}

function addPoolStones(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const stones = 3 + Math.floor(nextRandom() * 3);
  for (let index = 0; index < stones; index += 1) {
    const radius = 0.24 + nextRandom() * 0.4;
    addDodecahedron(
      bags.rock,
      site,
      (nextRandom() - 0.5) * 2.6,
      radius * 0.5,
      (nextRandom() - 0.5) * 2.6,
      radius * (1 + nextRandom() * 0.5),
      radius * 0.62,
      radius,
      nextRandom() * Math.PI,
    );
  }
}
