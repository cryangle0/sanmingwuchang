import { addBox, addCylinder, addEllipsoid, type Site, shiftedSite } from './prop-kit';
import type { DressingBags } from './region-dressing';

/**
 * 烬水市 · 东 · 商店/龙宫/关口三角。
 *
 * The ember market: abandoned goods piles — crates, grain sacks and clay
 * jars — spilling off the trade lanes. Vegetation is supplied exclusively by
 * the Grassworks layer.
 */
export function dressJinshui(
  bags: DressingBags,
  sites: readonly Site[],
  nextRandom: () => number,
): number {
  for (const site of sites) {
    addGoodsPile(bags, site, nextRandom);
  }
  return sites.length;
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
