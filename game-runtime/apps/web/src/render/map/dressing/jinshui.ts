import { addBox, addCylinder, addDisc, addEllipsoid, type Site, shiftedSite } from './prop-kit';
import type { DressingBags } from './region-dressing';

/**
 * 烬水市 · 东 · 商店/龙宫/关口三角。
 *
 * The ember market: charred bare trees over ash scorch rings, and abandoned
 * goods piles — crates, grain sacks, clay jars — spilling off the trade
 * lanes. The charred material carries a faint ember emissive so the district
 * smoulders at dusk without a single point light.
 */
export function dressJinshui(
  bags: DressingBags,
  sites: readonly Site[],
  nextRandom: () => number,
): number {
  for (const site of sites) {
    const pick = nextRandom();
    if (pick < 0.5) {
      addCharredTree(bags, site, nextRandom);
    } else {
      addGoodsPile(bags, site, nextRandom);
    }
  }
  return sites.length;
}

function addCharredTree(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const height = 2.4 + nextRandom() * 1.6;
  // Ash scorch ring under the trunk.
  addDisc(bags.soil, site, 0, 0.028, 0, 2.6 + nextRandom() * 1.4, 2.2 + nextRandom() * 1.2, 10);
  addCylinder(bags.charred, site, 0, height / 2, 0, 0.1, 0.24, height, 6);
  const branches = 2 + Math.floor(nextRandom() * 3);
  for (let index = 0; index < branches; index += 1) {
    const branchSite: Site = { ...site, yaw: site.yaw + nextRandom() * Math.PI * 2 };
    const y = height * (0.45 + nextRandom() * 0.45);
    const length = 0.6 + nextRandom() * 0.9;
    addBox(bags.charred, branchSite, length / 2 + 0.08, y, 0, length, 0.07, 0.07, 0.55);
  }
  // A couple of fallen charred logs nearby.
  if (nextRandom() > 0.5) {
    const logSite = shiftedSite(site, (nextRandom() - 0.5) * 2.4, 1.1 + nextRandom());
    addBox(
      bags.charred,
      { ...logSite, yaw: nextRandom() * Math.PI },
      0,
      0.09,
      0,
      1.2 + nextRandom() * 0.8,
      0.16,
      0.16,
    );
  }
}

function addGoodsPile(bags: DressingBags, site: Site, nextRandom: () => number): void {
  // Crates.
  const crates = 1 + Math.floor(nextRandom() * 3);
  for (let index = 0; index < crates; index += 1) {
    const size = 0.5 + nextRandom() * 0.3;
    addBox(
      bags.timber,
      site,
      (nextRandom() - 0.5) * 1.6,
      size / 2,
      (nextRandom() - 0.5) * 1.6,
      size,
      size,
      size,
      nextRandom() * Math.PI,
    );
  }
  if (nextRandom() > 0.4) {
    const size = 0.44;
    addBox(bags.timber, site, 0.2, 0.66 + size / 2, 0.1, size, size, size, nextRandom());
  }
  // Grain sacks slumped against the crates.
  const sacks = 1 + Math.floor(nextRandom() * 2);
  for (let index = 0; index < sacks; index += 1) {
    addEllipsoid(
      bags.straw,
      site,
      (nextRandom() - 0.5) * 2.2,
      0.22,
      0.9 + (nextRandom() - 0.5) * 1.4,
      0.42,
      0.26,
      0.3,
      nextRandom() * Math.PI,
    );
  }
  // Clay jars.
  const jars = 1 + Math.floor(nextRandom() * 3);
  for (let index = 0; index < jars; index += 1) {
    const jarSite = shiftedSite(site, -0.9 + nextRandom() * 1.8, -0.9 + nextRandom() * 0.9);
    const scale = 0.75 + nextRandom() * 0.45;
    addCylinder(
      bags.clay,
      jarSite,
      0,
      0.24 * scale,
      0,
      0.22 * scale,
      0.15 * scale,
      0.48 * scale,
      8,
    );
    addCylinder(bags.clay, jarSite, 0, 0.52 * scale, 0, 0.1 * scale, 0.19 * scale, 0.12 * scale, 8);
  }
}
