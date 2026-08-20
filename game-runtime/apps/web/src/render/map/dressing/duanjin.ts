import { addBox, addCylinder, addDodecahedron, type Site, shiftedSite } from './prop-kit';
import type { DressingBags } from './region-dressing';

/**
 * 断金坊 · 西北 · 断墙巷战。
 *
 * Ruined low wall stubs with rubble at their feet, plus broken blades and
 * halberds driven into the earth — the "断金" of the district name. Every
 * stub stays below 0.45 m so the ruins read as clearly steppable dressing,
 * never as collision the sim does not have.
 */
export function dressDuanjin(
  bags: DressingBags,
  sites: readonly Site[],
  nextRandom: () => number,
): number {
  for (const site of sites) {
    const pick = nextRandom();
    if (pick < 0.62) {
      addRuinedWall(bags, site, nextRandom);
    } else {
      addBrokenWeapons(bags, site, nextRandom);
    }
  }
  return sites.length;
}

function addRuinedWall(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const segments = 2 + Math.floor(nextRandom() * 2);
  let offset = -1.6;
  for (let index = 0; index < segments; index += 1) {
    const length = 1.1 + nextRandom() * 1.5;
    const height = 0.24 + nextRandom() * 0.21;
    const lean = (nextRandom() - 0.5) * 0.24;
    addBox(
      bags.stone,
      site,
      offset + length / 2,
      height / 2,
      (nextRandom() - 0.5) * 0.5,
      length,
      height,
      0.42 + nextRandom() * 0.16,
      lean,
    );
    offset += length + 0.28 + nextRandom() * 0.5;
  }
  const rubble = 3 + Math.floor(nextRandom() * 3);
  for (let index = 0; index < rubble; index += 1) {
    const radius = 0.16 + nextRandom() * 0.22;
    addDodecahedron(
      bags.rock,
      site,
      (nextRandom() - 0.5) * 3.6,
      radius * 0.55,
      0.5 + nextRandom() * 1.1,
      radius * (1 + nextRandom() * 0.4),
      radius * 0.7,
      radius,
      nextRandom() * Math.PI,
    );
  }
}

function addBrokenWeapons(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const blades = 2 + Math.floor(nextRandom() * 2);
  for (let index = 0; index < blades; index += 1) {
    const stuck = shiftedSite(site, (nextRandom() - 0.5) * 2.4, (nextRandom() - 0.5) * 2.4);
    const leanSite: Site = { ...stuck, yaw: nextRandom() * Math.PI * 2 };
    const bladeHeight = 0.9 + nextRandom() * 0.7;
    // Snapped blade driven into the ground at a defeated angle.
    addBox(bags.iron, leanSite, 0, bladeHeight / 2, 0, 0.16, bladeHeight, 0.045, 0.5);
    addBox(bags.iron, leanSite, 0, bladeHeight * 0.32, 0, 0.4, 0.07, 0.09, 0.5);
    addCylinder(bags.timber, leanSite, 0.02, bladeHeight * 0.16, 0.02, 0.035, 0.045, 0.34, 6);
  }
  if (nextRandom() > 0.45) {
    // A fallen round shield half-sunk beside the blades.
    addCylinder(bags.iron, site, 0.9, 0.05, -0.6, 0.42, 0.46, 0.08, 12);
  }
}
