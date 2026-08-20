import * as THREE from 'three';
import {
  addCone,
  addDodecahedron,
  addEllipsoid,
  offsetFromSite,
  type Site,
  transformAtSite,
} from './prop-kit';
import type { DressingBags } from './region-dressing';

/**
 * 蛛丝峡 · 北 · 双折峡谷与截击区。
 *
 * Stalagmite clusters strung with translucent webs and pale silk cocoons.
 * Webs are simple double-sided fans between spike tips, so the whole district
 * whispers "spider" long before the player meets one.
 */
export function dressZhusi(
  bags: DressingBags,
  sites: readonly Site[],
  nextRandom: () => number,
): number {
  for (const site of sites) {
    const spikes = 2 + Math.floor(nextRandom() * 3);
    const tips: { x: number; z: number; y: number }[] = [];
    for (let index = 0; index < spikes; index += 1) {
      const localX = (nextRandom() - 0.5) * 3.4;
      const localZ = (nextRandom() - 0.5) * 3.4;
      const height = 1.1 + nextRandom() * 1.9;
      const radius = 0.28 + nextRandom() * 0.3;
      addCone(bags.rock, site, localX, height / 2, localZ, radius, height, 6);
      const world = offsetFromSite(site, localX, localZ);
      tips.push({ x: world.x, z: world.z, y: height * 0.82 });
    }

    // Web fans between consecutive spike tips.
    for (let index = 0; index + 1 < tips.length; index += 1) {
      if (nextRandom() < 0.35) {
        continue;
      }
      const a = tips[index] as { x: number; z: number; y: number };
      const b = tips[index + 1] as { x: number; z: number; y: number };
      addWebBetween(bags, a, b, nextRandom);
    }

    // Cocoons stuck to the tallest spike.
    if (tips.length > 0 && nextRandom() > 0.3) {
      const anchor = tips.reduce((best, tip) => (tip.y > best.y ? tip : best));
      const cocoonSite: Site = { x: anchor.x, z: anchor.z, yaw: nextRandom() * Math.PI * 2 };
      addEllipsoid(
        bags.bone,
        cocoonSite,
        0.22,
        anchor.y * (0.4 + nextRandom() * 0.25),
        0.1,
        0.2,
        0.34 + nextRandom() * 0.14,
        0.2,
        nextRandom() * Math.PI,
      );
    }

    // A low ground web hints at trapdoor ambushes on the canyon floor.
    if (nextRandom() > 0.55) {
      const geometry = new THREE.CircleGeometry(0.9 + nextRandom() * 0.7, 8);
      geometry.rotateX(-Math.PI / 2);
      transformAtSite(geometry, site, (nextRandom() - 0.5) * 2, 0.04, (nextRandom() - 0.5) * 2);
      bags.web.push(geometry);
    }

    if (nextRandom() > 0.6) {
      const radius = 0.3 + nextRandom() * 0.3;
      addDodecahedron(
        bags.rock,
        site,
        (nextRandom() - 0.5) * 3,
        radius * 0.6,
        (nextRandom() - 0.5) * 3,
        radius * 1.2,
        radius * 0.8,
        radius,
        nextRandom() * Math.PI,
      );
    }
  }
  return sites.length;
}

function addWebBetween(
  bags: DressingBags,
  a: { x: number; z: number; y: number },
  b: { x: number; z: number; y: number },
  nextRandom: () => number,
): void {
  const middleX = (a.x + b.x) / 2;
  const middleZ = (a.z + b.z) / 2;
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  if (span < 0.6 || span > 4.5) {
    return;
  }
  const height = Math.min(a.y, b.y) * (0.72 + nextRandom() * 0.2);
  const geometry = new THREE.CircleGeometry(span / 2, 7);
  // Face the fan across the strand direction so it reads from the top-down camera.
  geometry.rotateY(Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2);
  geometry.rotateX((nextRandom() - 0.5) * 0.6);
  geometry.translate(middleX, height, middleZ);
  bags.web.push(geometry);
}
