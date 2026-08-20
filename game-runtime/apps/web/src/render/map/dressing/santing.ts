import { MAP_COURTS } from '@jwgb/content';
import {
  addBox,
  addCylinder,
  addHorizontalRing,
  addHorizontalTorus,
  type Site,
  yawToward,
} from './prop-kit';
import type { DressingBags } from './region-dressing';

const MM = 1_000;

/**
 * 万劫三庭 · 中央。
 *
 * A flat ceremonial array between the existing gold inlay and the cloister
 * ring — spokes, node medallions and a great outer circle — plus banner
 * poles flanking each gate approach outside the cloister. Everything inside
 * the court heart stays strictly flat (≤4 cm) per the 真源 rule that the
 * heart must remain unobstructed for the core boss and endgame.
 */
export function dressSanting(
  bags: DressingBags,
  nextRandom: () => number,
): { courtArrays: number; bannerPoles: number } {
  let bannerPoles = 0;
  for (const court of MAP_COURTS) {
    const centreX = court.center.x / MM;
    const centreZ = court.center.z / MM;

    // The great array circle with eight spokes and node medallions. Keep the
    // linework fine enough that it frames the court instead of filling it.
    addHorizontalRing(bags.gold, centreX, 0.316, centreZ, 15.18, 15.38, 64);
    addHorizontalRing(bags.gold, centreX, 0.316, centreZ, 5.47, 5.62, 40);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2 + Math.PI / 8;
      const spokeSite: Site = { x: centreX, z: centreZ, yaw: angle };
      addBox(bags.gold, spokeSite, 0, 0.318, 10.3, 0.08, 0.012, 8.7);
      const nodeX = centreX + Math.sin(angle) * 15.3;
      const nodeZ = centreZ + Math.cos(angle) * 15.3;
      addHorizontalRing(bags.gold, nodeX, 0.32, nodeZ, 0.43, 0.54, 12);
    }

    // Banner poles flanking each gate approach, outside the cloister ring.
    for (const gate of court.gates) {
      const gateAngle = Math.atan2(gate.x / MM - centreX, gate.z / MM - centreZ);
      for (const side of [-0.34, 0.34]) {
        const angle = gateAngle + side;
        const x = centreX + Math.sin(angle) * 28.2;
        const z = centreZ + Math.cos(angle) * 28.2;
        addBannerPole(bags, { x, z, yaw: yawToward(x, z, centreX, centreZ) }, nextRandom);
        bannerPoles += 1;
      }
    }
  }
  return { courtArrays: MAP_COURTS.length, bannerPoles };
}

function addBannerPole(bags: DressingBags, site: Site, nextRandom: () => number): void {
  const height = 4.6 + nextRandom() * 0.5;
  addCylinder(bags.stone, site, 0, 0.16, 0, 0.3, 0.4, 0.32, 8);
  addCylinder(bags.lacquer, site, 0, height / 2, 0, 0.07, 0.1, height, 6);
  addBox(bags.timber, site, 0.34, height - 0.28, 0, 0.78, 0.06, 0.06);
  // Long court banner hanging from the arm.
  addBox(bags.cloth, site, 0.56, height - 1.62, 0, 0.5, 2.6, 0.03);
  addHorizontalTorus(bags.gold, site.x, height + 0.12, site.z, 0.09, 0.03, 10);
}
