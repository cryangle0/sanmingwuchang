import { MAP_NESTS } from '@jwgb/content';
import * as THREE from 'three';
import {
  addBox,
  addCylinder,
  addDisc,
  addDodecahedron,
  addHorizontalTorus,
  type Site,
  transformAtSite,
} from './prop-kit';
import type { DressingBags } from './region-dressing';

const MM = 1_000;

/**
 * Monster nest markers for all 48 authoritative nests, so the wilds telegraph
 * where the PVE bands live: gnawed bone piles for melee dens, cairn altars
 * for ranged casters, and roost poles for flyers. Inner-band nests build
 * slightly larger than outer ones, mirroring the threat gradient.
 */
export function buildNestMarkers(
  bags: DressingBags,
  nextRandom: () => number,
): Record<'MEL' | 'RNG' | 'FLY', number> {
  const counts = { MEL: 0, RNG: 0, FLY: 0 };
  for (const nest of MAP_NESTS) {
    const site: Site = {
      x: nest.base.x / MM,
      z: nest.base.z / MM,
      yaw: nextRandom() * Math.PI * 2,
    };
    const scale = nest.band === '内' ? 1.18 : nest.band === '中' ? 1.02 : 0.88;
    if (nest.kind === 'MEL') {
      addBonePile(bags, site, scale, nextRandom);
      counts.MEL += 1;
    } else if (nest.kind === 'RNG') {
      addCairnAltar(bags, site, scale, nextRandom);
      counts.RNG += 1;
    } else {
      addRoostPole(bags, site, scale, nextRandom);
      counts.FLY += 1;
    }
  }
  return counts;
}

function addBonePile(
  bags: DressingBags,
  site: Site,
  scale: number,
  nextRandom: () => number,
): void {
  // Trampled dirt circle around the den mouth.
  addDisc(bags.soil, site, 0, 0.022, 0, 4.6 * scale, 3.8 * scale, 12);
  const bones = 4 + Math.floor(nextRandom() * 3);
  for (let index = 0; index < bones; index += 1) {
    const radius = (0.14 + nextRandom() * 0.16) * scale;
    addDodecahedron(
      bags.bone,
      site,
      (nextRandom() - 0.5) * 2.2 * scale,
      radius * 0.6,
      (nextRandom() - 0.5) * 2.2 * scale,
      radius * (1.2 + nextRandom()),
      radius * 0.6,
      radius,
      nextRandom() * Math.PI,
    );
  }
  // Two small rib arcs over the pile.
  for (const offset of [-0.4, 0.5]) {
    const geometry = new THREE.TorusGeometry(
      (0.5 + nextRandom() * 0.2) * scale,
      0.045 * scale,
      4,
      7,
      Math.PI,
    );
    geometry.rotateY(Math.PI / 2 + (nextRandom() - 0.5) * 0.8);
    transformAtSite(geometry, site, offset * scale, 0, 0.2 * scale, 0);
    bags.bone.push(geometry);
  }
}

function addCairnAltar(
  bags: DressingBags,
  site: Site,
  scale: number,
  nextRandom: () => number,
): void {
  // Stacked cairn stones shrinking upward.
  let y = 0;
  for (const size of [0.5, 0.36, 0.24]) {
    const radius = size * scale;
    y += radius * 0.6;
    addDodecahedron(
      bags.rock,
      site,
      0,
      y,
      0,
      radius * 1.25,
      radius * 0.7,
      radius,
      nextRandom() * Math.PI,
    );
    y += radius * 0.45;
  }
  // Offering stake with a torn cloth strip.
  addCylinder(bags.timber, site, 0.7 * scale, 0.55 * scale, 0.2, 0.035, 0.05, 1.1 * scale, 5);
  addBox(bags.cloth, site, 0.7 * scale, 0.92 * scale, 0.2, 0.3 * scale, 0.4 * scale, 0.02, 0.4);
}

function addRoostPole(
  bags: DressingBags,
  site: Site,
  scale: number,
  nextRandom: () => number,
): void {
  const height = 3.1 * scale + nextRandom() * 0.4;
  addCylinder(bags.timber, site, 0, height / 2, 0, 0.07, 0.12, height, 6);
  addBox(bags.timber, site, 0, height - 0.14, 0, 1.5 * scale, 0.07, 0.07, 0.1);
  // Woven roost ring at the top of the pole.
  addHorizontalTorus(bags.straw, site.x, height + 0.08, site.z, 0.4 * scale, 0.11 * scale, 9);
  // Droppings wash at the base.
  addDisc(bags.bone, site, 0, 0.018, 0, 1.5 * scale, 1.2 * scale, 8);
}
