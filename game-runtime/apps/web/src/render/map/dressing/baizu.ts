import { addBox, addCone, addCylinder, type Site } from './prop-kit';
import type { DressingBags } from './region-dressing';

/**
 * 百足城 · 西南 · 窄巷网。
 *
 * Street furniture for the alley city: stone lanterns marking corners,
 * worn stair blocks, and segmented centipede totem poles that carry the
 * hundred-legs name without needing a single monster on screen.
 */
export function dressBaizu(
  bags: DressingBags,
  sites: readonly Site[],
  nextRandom: () => number,
): number {
  for (const site of sites) {
    const pick = nextRandom();
    if (pick < 0.42) {
      addStoneLantern(bags, site, nextRandom);
    } else if (pick < 0.72) {
      addCentipedeTotem(bags, site, nextRandom);
    } else {
      addStairRelic(bags, site, nextRandom);
    }
  }
  return sites.length;
}

function addStoneLantern(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const scale = 0.85 + nextRandom() * 0.3;
  addBox(bags.stone, site, 0, 0.09 * scale, 0, 0.72 * scale, 0.18 * scale, 0.72 * scale);
  addCylinder(bags.stone, site, 0, 0.62 * scale, 0, 0.09 * scale, 0.13 * scale, 0.9 * scale, 6);
  addBox(bags.stone, site, 0, 1.2 * scale, 0, 0.5 * scale, 0.34 * scale, 0.5 * scale);
  // Warm light window on all four faces.
  addBox(bags.gold, site, 0, 1.2 * scale, 0, 0.52 * scale, 0.2 * scale, 0.36 * scale);
  addBox(bags.gold, site, 0, 1.2 * scale, 0, 0.36 * scale, 0.2 * scale, 0.52 * scale);
  addCone(bags.stone, site, 0, 1.52 * scale, 0, 0.42 * scale, 0.3 * scale, 4);
}

function addCentipedeTotem(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const height = 2.6 + nextRandom() * 1.1;
  const segments = 5 + Math.floor(nextRandom() * 3);
  addCylinder(bags.stone, site, 0, 0.14, 0, 0.34, 0.44, 0.28, 8);
  addCylinder(bags.timber, site, 0, height / 2, 0, 0.09, 0.13, height, 6);
  // Stacked lacquer segments with leg stubs, tapering toward the head.
  for (let index = 0; index < segments; index += 1) {
    const y = 0.6 + (index / segments) * (height - 0.9);
    const radius = 0.2 - (index / segments) * 0.06;
    addCylinder(bags.lacquer, site, 0, y, 0, radius, radius * 1.12, 0.22, 7);
    addBox(bags.timber, site, radius + 0.12, y, 0, 0.26, 0.045, 0.05, 0.35);
    addBox(bags.timber, site, -radius - 0.12, y, 0, 0.26, 0.045, 0.05, -0.35);
  }
  // Head with mandible prongs.
  addCylinder(bags.lacquer, site, 0, height + 0.08, 0, 0.16, 0.2, 0.26, 7);
  addBox(bags.gold, site, 0.1, height + 0.24, 0.05, 0.05, 0.2, 0.05, 0.3);
  addBox(bags.gold, site, -0.1, height + 0.24, 0.05, 0.05, 0.2, 0.05, -0.3);
}

function addStairRelic(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const steps = 2 + Math.floor(nextRandom() * 2);
  for (let index = 0; index < steps; index += 1) {
    addBox(
      bags.stone,
      site,
      0,
      0.07 + index * 0.11,
      index * 0.34,
      1.6 - index * 0.25,
      0.14,
      0.62,
      (nextRandom() - 0.5) * 0.1,
    );
  }
  if (nextRandom() > 0.5) {
    addCylinder(bags.stone, site, 0.9, 0.26, -0.4, 0.14, 0.18, 0.52, 6);
  }
}
