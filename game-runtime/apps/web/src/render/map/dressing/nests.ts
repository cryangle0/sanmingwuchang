import { denCentreMm, MAP_NESTS } from '@jwgb/content';
import * as THREE from 'three';
import {
  addBeamBetween,
  addBox,
  addCone,
  addCylinder,
  addDisc,
  addDodecahedron,
  addEllipsoid,
  addHemisphere,
  type Site,
  siteTowardOrigin,
  transformAtSite,
} from './prop-kit';
import type { DressingBags } from './region-dressing';

/**
 * 48 authoritative nests built as monster lairs, not map pins.
 *
 * The three nest kinds now read as three different places a monster would
 * actually live, at a size that survives the chase camera:
 *
 * - MEL 妖洞: a boulder-ringed cave mouth with a timber door frame, a hanging
 *   pelt, a bone wind-chime, a fire pit and a meat rack.
 * - RNG 祭坛: a stepped stone altar with a carved totem, a ring of standing
 *   stones, two ember braziers and bundles of spent arrows.
 * - FLY 巢塔: a dead spire with branches carrying woven nest bowls, eggs,
 *   hanging feathers and the mess below them.
 *
 * Everything is baked into the shared dressing bags, so all 48 lairs still
 * cost the same handful of draw calls as the rest of the district dressing.
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
    const scale = nest.band === '内' ? 1.24 : nest.band === '中' ? 1.06 : 0.9;
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

/** Irregular trampled ground: overlapping ellipses beat one clean disc. */
function addTrampledGround(
  bags: DressingBags,
  site: Site,
  radius: number,
  nextRandom: () => number,
  lobes = 3,
): void {
  addDisc(bags.soil, site, 0, 0.02, 0, radius * 2, radius * 1.7, 18);
  for (let index = 0; index < lobes; index += 1) {
    const angle = (index / lobes) * Math.PI * 2 + nextRandom() * 0.7;
    const distance = radius * (0.5 + nextRandom() * 0.45);
    addEllipsoid(
      bags.soil,
      site,
      Math.sin(angle) * distance,
      0.012,
      Math.cos(angle) * distance,
      radius * (0.7 + nextRandom() * 0.5),
      0.03,
      radius * (0.6 + nextRandom() * 0.4),
      nextRandom() * Math.PI,
    );
  }
}

/** Boulder arc: the ring that makes a den read as a mouth, not a pile. */
function addBoulderArc(
  bags: DressingBags,
  site: Site,
  radius: number,
  count: number,
  height: (index: number) => number,
  nextRandom: () => number,
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.PI * (0.16 + (index / (count - 1)) * 1.68);
    const wobble = (nextRandom() - 0.5) * 0.22;
    const x = Math.sin(angle) * radius * (1 + wobble);
    const z = Math.cos(angle) * radius * (1 + wobble);
    const size = height(index);
    addDodecahedron(
      bags.rock,
      site,
      x,
      size * 0.34,
      z,
      size * (0.68 + nextRandom() * 0.3),
      size * (0.62 + nextRandom() * 0.32),
      size * (0.6 + nextRandom() * 0.3),
      nextRandom() * Math.PI,
    );
  }
}

/** Hanging bone wind-chime under a lintel or branch. */
function addBoneChime(
  bags: DressingBags,
  site: Site,
  x: number,
  y: number,
  z: number,
  spread: number,
  nextRandom: () => number,
): void {
  for (let index = 0; index < 3; index += 1) {
    const offset = (index - 1) * spread;
    addCylinder(bags.bone, site, x + offset, y - 0.16, z, 0.014, 0.014, 0.34, 4);
    addDodecahedron(
      bags.bone,
      site,
      x + offset,
      y - 0.5,
      z,
      0.16 + nextRandom() * 0.06,
      0.09,
      0.2 + nextRandom() * 0.08,
      nextRandom() * Math.PI,
    );
  }
}

/** Fire pit: stone ring, charred logs, embers that read as lit. */
function addFirePit(
  bags: DressingBags,
  site: Site,
  x: number,
  z: number,
  radius: number,
  nextRandom: () => number,
): void {
  const stones = 7;
  for (let index = 0; index < stones; index += 1) {
    const angle = (index / stones) * Math.PI * 2;
    addDodecahedron(
      bags.rock,
      site,
      x + Math.sin(angle) * radius,
      0.13,
      z + Math.cos(angle) * radius,
      0.3 + nextRandom() * 0.14,
      0.24 + nextRandom() * 0.1,
      0.28 + nextRandom() * 0.12,
      nextRandom() * Math.PI,
    );
  }
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + 0.4;
    addBeamBetween(
      bags.charred,
      site,
      x - Math.sin(angle) * radius * 0.5,
      0.1,
      z - Math.cos(angle) * radius * 0.5,
      x + Math.sin(angle) * radius * 0.5,
      0.22,
      z + Math.cos(angle) * radius * 0.5,
      0.09,
      5,
    );
  }
  addDisc(bags.gold, site, x, 0.16, z, radius * 1.05, radius * 1.05, 10);
  addCone(bags.gold, site, x, 0.4, z, radius * 0.42, 0.5, 6);
}

/** Scattered long bones and skulls. */
function addBoneScatter(
  bags: DressingBags,
  site: Site,
  radius: number,
  count: number,
  nextRandom: () => number,
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = nextRandom() * Math.PI * 2;
    const distance = radius * (0.35 + nextRandom() * 0.65);
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    const yaw = nextRandom() * Math.PI;
    if (nextRandom() < 0.32) {
      // Skull: a blocky cranium with a muzzle and two sockets.
      addDodecahedron(bags.bone, site, x, 0.14, z, 0.34, 0.28, 0.32, yaw);
      addBox(
        bags.bone,
        site,
        x + Math.sin(yaw) * 0.22,
        0.1,
        z + Math.cos(yaw) * 0.22,
        0.2,
        0.14,
        0.18,
        yaw,
      );
      addBox(
        bags.charred,
        site,
        x - Math.cos(yaw) * 0.08,
        0.16,
        z + Math.sin(yaw) * 0.08,
        0.11,
        0.09,
        0.11,
        yaw,
      );
      addBox(
        bags.charred,
        site,
        x + Math.cos(yaw) * 0.08,
        0.16,
        z - Math.sin(yaw) * 0.08,
        0.11,
        0.09,
        0.11,
        yaw,
      );
    } else {
      addBeamBetween(
        bags.bone,
        site,
        x - Math.sin(yaw) * 0.5,
        0.09,
        z - Math.cos(yaw) * 0.5,
        x + Math.sin(yaw) * 0.5,
        0.09,
        z + Math.cos(yaw) * 0.5,
        0.07,
        5,
      );
      addDodecahedron(
        bags.bone,
        site,
        x - Math.sin(yaw) * 0.52,
        0.09,
        z - Math.cos(yaw) * 0.52,
        0.16,
        0.14,
        0.16,
        yaw,
      );
      addDodecahedron(
        bags.bone,
        site,
        x + Math.sin(yaw) * 0.52,
        0.09,
        z + Math.cos(yaw) * 0.52,
        0.16,
        0.14,
        0.16,
        yaw,
      );
    }
  }
}

/** 妖洞: boulder mouth, timber frame, pelt, fire, meat rack. */
function addMeleeDen(
  bags: DressingBags,
  site: Site,
  scale: number,
  nextRandom: () => number,
): void {
  addTrampledGround(bags, site, 5.2 * scale, nextRandom, 4);
  addBoulderArc(
    bags,
    site,
    4.3 * scale,
    9,
    (index) => {
      const edge = Math.abs(index - 4) / 4;
      return (2.9 - edge * 1.35) * scale;
    },
    nextRandom,
  );

  // Cave mouth: a dark recess behind the arc, ringed by a lighter lip.
  addHemisphere(bags.charred, site, 0, -0.1, -1.5 * scale, 3.0 * scale, 2.0 * scale, 2.4 * scale);
  addHemisphere(bags.soil, site, 0, -0.25, -2.9 * scale, 4.2 * scale, 1.7 * scale, 2.8 * scale);

  // Timber door frame across the mouth, with a pelt and a bone chime.
  for (const x of [-1.5, 1.5]) {
    addCylinder(
      bags.timber,
      site,
      x * scale,
      1.25 * scale,
      1.35 * scale,
      0.13,
      0.16,
      2.5 * scale,
      6,
    );
    addBox(
      bags.stone,
      site,
      x * scale,
      0.14 * scale,
      1.35 * scale,
      0.5 * scale,
      0.28 * scale,
      0.5 * scale,
    );
  }
  addBox(bags.timber, site, 0, 2.6 * scale, 1.35 * scale, 3.9 * scale, 0.24 * scale, 0.3 * scale);
  addBox(
    bags.lacquer,
    site,
    0,
    2.82 * scale,
    1.35 * scale,
    3.4 * scale,
    0.16 * scale,
    0.34 * scale,
  );
  addBox(
    bags.cloth,
    site,
    -0.55 * scale,
    1.75 * scale,
    1.5 * scale,
    1.5 * scale,
    1.7 * scale,
    0.06,
  );
  addBox(bags.bone, site, 0.72 * scale, 2.2 * scale, 1.5 * scale, 0.9 * scale, 0.55 * scale, 0.05);
  addBoneChime(bags, site, 0.72 * scale, 1.9 * scale, 1.55 * scale, 0.24 * scale, nextRandom);
  // Trophy horns over the lintel.
  for (const x of [-1.15, 1.15]) {
    addCone(bags.bone, site, x * scale, 3.15 * scale, 1.3 * scale, 0.16 * scale, 0.62 * scale, 5);
    addCone(
      bags.bone,
      site,
      x * scale + 0.22 * scale,
      3.0 * scale,
      1.3 * scale,
      0.12 * scale,
      0.44 * scale,
      5,
    );
  }

  addFirePit(bags, site, 0.9 * scale, 3.3 * scale, 0.85 * scale, nextRandom);

  // Meat rack beside the mouth.
  for (const x of [-3.3, -1.5]) {
    addCylinder(bags.timber, site, x * scale, 1.05 * scale, 3.0 * scale, 0.1, 0.13, 2.1 * scale, 6);
  }
  addBox(
    bags.timber,
    site,
    -2.4 * scale,
    2.1 * scale,
    3.0 * scale,
    2.2 * scale,
    0.14 * scale,
    0.16 * scale,
  );
  for (const x of [-2.9, -2.4, -1.9]) {
    addBox(
      bags.lacquer,
      site,
      x * scale,
      1.55 * scale,
      3.0 * scale,
      0.36 * scale,
      0.9 * scale,
      0.3 * scale,
    );
  }

  addBoneScatter(bags, site, 4.6 * scale, 7, nextRandom);
  // Claw marks scratched into the near ground.
  for (let index = 0; index < 3; index += 1) {
    addBox(
      bags.charred,
      site,
      (1.6 + index * 0.42) * scale,
      0.035,
      2.1 * scale,
      0.12,
      0.02,
      (1.5 - index * 0.22) * scale,
      0.5,
    );
  }
}

/** 祭坛: stepped altar, carved totem, standing stones, braziers, arrows. */
function addRangedShrine(
  bags: DressingBags,
  site: Site,
  scale: number,
  nextRandom: () => number,
): void {
  addTrampledGround(bags, site, 5.6 * scale, nextRandom, 3);

  // Three-step stone altar.
  addBox(bags.stone, site, 0, 0.18 * scale, 0, 5.4 * scale, 0.36 * scale, 5.4 * scale);
  addBox(bags.stone, site, 0, 0.5 * scale, 0, 4.1 * scale, 0.32 * scale, 4.1 * scale);
  addBox(bags.stone, site, 0, 0.79 * scale, 0, 2.9 * scale, 0.28 * scale, 2.9 * scale);
  addBox(bags.clay, site, 0, 0.95 * scale, 0, 2.5 * scale, 0.1 * scale, 2.5 * scale);

  // Carved totem: stacked blocks with gold eyes and a feathered crown.
  addCylinder(bags.timber, site, 0, 2.5 * scale, 0, 0.22 * scale, 0.3 * scale, 3.1 * scale, 6);
  for (let tier = 0; tier < 3; tier += 1) {
    const y = (1.5 + tier * 1.05) * scale;
    const width = (1.05 - tier * 0.16) * scale;
    addBox(bags.timber, site, 0, y, 0, width, 0.5 * scale, width * 0.85);
    addBox(
      bags.gold,
      site,
      -width * 0.22,
      y + 0.04 * scale,
      width * 0.42,
      width * 0.24,
      0.13 * scale,
      0.08,
    );
    addBox(
      bags.gold,
      site,
      width * 0.22,
      y + 0.04 * scale,
      width * 0.42,
      width * 0.24,
      0.13 * scale,
      0.08,
    );
    addBox(bags.charred, site, 0, y - 0.16 * scale, width * 0.42, width * 0.5, 0.1 * scale, 0.08);
    // Bone fringe under each tier.
    for (const x of [-width * 0.42, width * 0.42]) {
      addCylinder(bags.bone, site, x, y - 0.34 * scale, 0, 0.03, 0.03, 0.36 * scale, 4);
    }
  }
  addCone(bags.cloth, site, 0, 4.5 * scale, 0, 0.9 * scale, 0.7 * scale, 7);
  addCone(bags.cloth, site, 0, 4.15 * scale, 0, 1.2 * scale, 0.42 * scale, 7);
  addEllipsoid(bags.gold, site, 0, 5.05 * scale, 0, 0.3 * scale, 0.34 * scale, 0.3 * scale);

  // Standing stones with bone charms.
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2 + 0.25;
    const radius = 4.05 * scale;
    const height = (1.25 + nextRandom() * 0.6) * scale;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    addCylinder(bags.rock, site, x, height * 0.5, z, 0.22 * scale, 0.34 * scale, height, 6);
    addDodecahedron(
      bags.rock,
      site,
      x,
      height + 0.14 * scale,
      z,
      0.42 * scale,
      0.3 * scale,
      0.38 * scale,
      angle,
    );
    addCylinder(bags.bone, site, x * 0.93, height * 0.72, z * 0.93, 0.022, 0.022, 0.5 * scale, 4);
    addDodecahedron(
      bags.bone,
      site,
      x * 0.93,
      height * 0.72 - 0.3 * scale,
      z * 0.93,
      0.18 * scale,
      0.1 * scale,
      0.22 * scale,
      angle,
    );
  }

  // Braziers flanking the altar steps.
  for (const x of [-2.7, 2.7]) {
    addCylinder(bags.iron, site, x * scale, 0.62 * scale, 2.4 * scale, 0.09, 0.12, 1.25 * scale, 6);
    addCylinder(
      bags.iron,
      site,
      x * scale,
      1.3 * scale,
      2.4 * scale,
      0.42 * scale,
      0.3 * scale,
      0.3 * scale,
      8,
    );
    addDisc(bags.gold, site, x * scale, 1.46 * scale, 2.4 * scale, 0.62 * scale, 0.62 * scale, 8);
    addCone(bags.gold, site, x * scale, 1.6 * scale, 2.4 * scale, 0.22 * scale, 0.34 * scale, 6);
  }

  // Spent arrows driven into the ground.
  for (let index = 0; index < 6; index += 1) {
    const angle = nextRandom() * Math.PI * 2;
    const distance = (2.3 + nextRandom() * 1.9) * scale;
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    addBeamBetween(
      bags.timber,
      site,
      x,
      0.05,
      z,
      x + Math.sin(angle) * 0.3,
      1.15 * scale,
      z + Math.cos(angle) * 0.3,
      0.035,
      4,
    );
    addBox(
      bags.cloth,
      site,
      x + Math.sin(angle) * 0.32,
      1.1 * scale,
      z + Math.cos(angle) * 0.32,
      0.2,
      0.34,
      0.05,
      angle,
    );
  }

  // Offerings: clay jars and a bone pile at the altar foot.
  for (const [x, z, size] of [
    [-1.5, -2.1, 0.38],
    [1.75, -1.7, 0.3],
    [-0.4, -2.5, 0.26],
  ] as const) {
    addCylinder(
      bags.clay,
      site,
      x * scale,
      size * scale * 0.9,
      z * scale,
      size * 0.72 * scale,
      size * scale,
      size * 1.5 * scale,
      8,
    );
    addCylinder(
      bags.clay,
      site,
      x * scale,
      size * scale * 1.72,
      z * scale,
      size * 0.34 * scale,
      size * 0.5 * scale,
      size * 0.5 * scale,
      8,
    );
  }
  addBoneScatter(bags, site, 3.4 * scale, 5, nextRandom);
}

/** 巢塔: dead spire, branch nests, eggs, feathers and droppings. */
function addFlyerRoost(
  bags: DressingBags,
  site: Site,
  scale: number,
  nextRandom: () => number,
): void {
  addTrampledGround(bags, site, 4.6 * scale, nextRandom, 3);

  // Dead spire: three tapering trunks with a forked crown.
  const trunkHeight = 7.4 * scale;
  addCylinder(
    bags.timber,
    site,
    0,
    trunkHeight * 0.22,
    0,
    0.52 * scale,
    0.72 * scale,
    trunkHeight * 0.44,
    7,
  );
  addCylinder(
    bags.timber,
    site,
    0.08 * scale,
    trunkHeight * 0.6,
    0.05 * scale,
    0.34 * scale,
    0.52 * scale,
    trunkHeight * 0.4,
    7,
  );
  addCylinder(
    bags.timber,
    site,
    0.14 * scale,
    trunkHeight * 0.87,
    0.1 * scale,
    0.2 * scale,
    0.34 * scale,
    trunkHeight * 0.3,
    6,
  );
  for (const [x, z, yaw] of [
    [0.5, 0.2, 0.5],
    [-0.55, 0.35, -0.6],
    [0.3, -0.6, 2.4],
  ] as const) {
    addBeamBetween(
      bags.timber,
      site,
      0.05 * scale,
      trunkHeight * 0.62,
      0.05 * scale,
      x * scale,
      trunkHeight * 0.78,
      z * scale,
      0.11 * scale,
      5,
    );
    void yaw;
  }
  addBeamBetween(
    bags.timber,
    site,
    0.1 * scale,
    trunkHeight * 0.9,
    0.08 * scale,
    0.9 * scale,
    trunkHeight * 1.02,
    -0.35 * scale,
    0.09 * scale,
    5,
  );
  addBeamBetween(
    bags.timber,
    site,
    0.1 * scale,
    trunkHeight * 0.9,
    0.08 * scale,
    -0.8 * scale,
    trunkHeight * 0.99,
    0.4 * scale,
    0.09 * scale,
    5,
  );

  // Woven nest bowls on the branches, each with a rim and eggs.
  const nests: readonly (readonly [number, number, number])[] = [
    [0.62, 0.62, 0.26],
    [-0.68, 0.53, 0.34],
    [0.36, 0.78, -0.72],
    [0.02, 0.9, 0.06],
  ];
  for (const [x, heightFraction, z] of nests) {
    const y = trunkHeight * heightFraction;
    const radius = (0.72 + nextRandom() * 0.3) * scale;
    addHemisphere(bags.straw, site, x * scale, y, z * scale, radius, radius * 0.6, radius);
    addSiteTorus(bags.straw, site, x * scale, y + radius * 0.3, z * scale, radius, radius * 0.22);
    addSiteTorus(
      bags.bone,
      site,
      x * scale,
      y + radius * 0.34,
      z * scale,
      radius * 1.02,
      radius * 0.07,
    );
    const eggs = 1 + Math.floor(nextRandom() * 3);
    for (let index = 0; index < eggs; index += 1) {
      const angle = nextRandom() * Math.PI * 2;
      addEllipsoid(
        bags.bone,
        site,
        x * scale + Math.sin(angle) * radius * 0.32,
        y + radius * 0.34,
        z * scale + Math.cos(angle) * radius * 0.32,
        0.24 * scale,
        0.34 * scale,
        0.24 * scale,
        angle,
      );
    }
  }

  // Hanging feathers and bones under the branches.
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + 0.3;
    const radius = (1.1 + nextRandom() * 0.5) * scale;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    addCylinder(
      bags.bone,
      site,
      x,
      trunkHeight * 0.66 - 0.2 * scale,
      z,
      0.016,
      0.016,
      0.4 * scale,
      4,
    );
    addBox(
      bags.cloth,
      site,
      x,
      trunkHeight * 0.66 - 0.52 * scale,
      z,
      0.16 * scale,
      0.34 * scale,
      0.03,
      angle,
    );
  }

  // The mess below: guano streaks, dropped bones, a cracked shell.
  addDisc(bags.bone, site, 0.2 * scale, 0.03, 0.15 * scale, 2.6 * scale, 2.2 * scale, 12);
  for (let index = 0; index < 3; index += 1) {
    const angle = nextRandom() * Math.PI * 2;
    const distance = (1.2 + nextRandom() * 1.6) * scale;
    addDisc(
      bags.bone,
      site,
      Math.sin(angle) * distance,
      0.028,
      Math.cos(angle) * distance,
      (0.7 + nextRandom() * 0.7) * scale,
      (0.5 + nextRandom() * 0.6) * scale,
      8,
    );
  }
  addBoneScatter(bags, site, 3.6 * scale, 5, nextRandom);
  addDodecahedron(
    bags.bone,
    site,
    -0.9 * scale,
    0.12,
    1.1 * scale,
    0.3 * scale,
    0.24 * scale,
    0.28 * scale,
    0.4,
  );
  for (let index = 0; index < 3; index += 1) {
    addDodecahedron(
      bags.bone,
      site,
      (-0.9 + (index - 1) * 0.24) * scale,
      0.08,
      (1.32 + index * 0.12) * scale,
      0.16 * scale,
      0.1 * scale,
      0.14 * scale,
      nextRandom() * Math.PI,
    );
  }
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
  const geometry = new THREE.TorusGeometry(radius, tube, 6, 10);
  geometry.rotateX(Math.PI / 2);
  transformAtSite(geometry, site, localX, y, localZ);
  bag.push(geometry);
}
