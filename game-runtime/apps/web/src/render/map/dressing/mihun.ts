import {
  addBox,
  addCone,
  addCylinder,
  addEllipsoid,
  addHemisphere,
  type Site,
  shiftedSite,
} from './prop-kit';
import type { DressingBags } from './region-dressing';

/**
 * 迷魂田 · 南 · 猪窝袋路与拾荒回路。
 *
 * Abandoned farmland: furrowed field patches, slumped scarecrows, haystacks
 * and collapsed fences. Furrows are flat soil ridges a boot barely notices,
 * so the fields dress the scavenging loops without hiding any movement.
 */
export function dressMihun(
  bags: DressingBags,
  sites: readonly Site[],
  nextRandom: () => number,
): number {
  for (const site of sites) {
    const pick = nextRandom();
    if (pick < 0.44) {
      addFieldPatch(bags, site, nextRandom);
    } else if (pick < 0.66) {
      addScarecrow(bags, site, nextRandom);
    } else if (pick < 0.85) {
      addHaystack(bags, site, nextRandom);
    } else {
      addFallenFence(bags, site, nextRandom);
    }
  }
  return sites.length;
}

function addFieldPatch(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const rows = 4 + Math.floor(nextRandom() * 3);
  const length = 4.2 + nextRandom() * 2.6;
  const start = (-(rows - 1) / 2) * 0.92;
  for (let row = 0; row < rows; row += 1) {
    addBox(
      bags.soil,
      site,
      0,
      0.055,
      start + row * 0.92,
      length,
      0.11,
      0.46,
      (nextRandom() - 0.5) * 0.04,
    );
    // Withered stubble clumps along some ridges.
    const stubble = Math.floor(nextRandom() * 4);
    for (let index = 0; index < stubble; index += 1) {
      addCone(
        bags.straw,
        site,
        (nextRandom() - 0.5) * length * 0.8,
        0.26,
        start + row * 0.92,
        0.09,
        0.36,
        4,
      );
    }
  }
}

function addScarecrow(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const height = 1.9 + nextRandom() * 0.5;
  const lean = (nextRandom() - 0.5) * 0.2;
  addCylinder(bags.timber, site, 0, height / 2, 0, 0.05, 0.07, height, 5);
  addBox(bags.timber, site, 0, height * 0.72, 0, 1.3, 0.07, 0.07, lean);
  // Straw head under a wide hat, ragged robe hanging from the crossarm.
  addHemisphere(bags.straw, site, 0, height * 0.82, 0, 0.36, 0.3, 0.36);
  addCone(bags.roof, site, 0, height * 0.98, 0, 0.42, 0.22, 6);
  addBox(bags.cloth, site, 0, height * 0.52, 0, 0.66, height * 0.38, 0.1, lean);
  addCone(bags.straw, site, 0, 0.22, 0, 0.3, 0.44, 6);
}

function addHaystack(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const scale = 0.9 + nextRandom() * 0.5;
  addHemisphere(bags.straw, site, 0, 0, 0, 1.7 * scale, 0.9 * scale, 1.7 * scale);
  addCone(bags.straw, site, 0, 1.05 * scale, 0, 0.62 * scale, 0.7 * scale, 7);
  if (nextRandom() > 0.5) {
    const second = shiftedSite(site, 1.6 * scale, 0.6 * scale);
    addHemisphere(bags.straw, second, 0, 0, 0, 1.0 * scale, 0.55 * scale, 1.0 * scale);
  }
}

function addFallenFence(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const posts = 2 + Math.floor(nextRandom() * 2);
  for (let index = 0; index < posts; index += 1) {
    addCylinder(bags.timber, site, index * 1.4 - 0.7, 0.42, 0, 0.05, 0.07, 0.84, 5);
  }
  // One rail still up, one collapsed into the weeds.
  addBox(bags.timber, site, 0, 0.66, 0.03, posts * 1.4, 0.07, 0.05, (nextRandom() - 0.5) * 0.1);
  addBox(bags.timber, site, 0.3, 0.09, 0.4, 1.6, 0.06, 0.05, 0.5 + nextRandom() * 0.4);
  addEllipsoid(bags.straw, site, -0.6, 0.08, 0.5, 0.4, 0.1, 0.3, nextRandom() * Math.PI);
}
