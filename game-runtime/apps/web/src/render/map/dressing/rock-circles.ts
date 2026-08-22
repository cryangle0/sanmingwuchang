import { MAP_ROCKS } from '@jwgb/content';
import * as THREE from 'three';
import { addCylinder, addDisc, addDodecahedron, type Site, transformAtSite } from './prop-kit';
import type { DressingBags } from './region-dressing';

/**
 * 24 伏石圈: a worn ring and standing stones around each authored rock so
 * the 2m 伏石 reads as a ritual circle, not a lone cylinder.
 */
export function buildRockCircles(bags: DressingBags, nextRandom: () => number): number {
  for (const rock of MAP_ROCKS) {
    const site: Site = {
      x: rock.position.x / 1_000,
      z: rock.position.z / 1_000,
      yaw: nextRandom() * Math.PI * 2,
    };
    addDisc(bags.soil, site, 0, 0.018, 0, 7.2, 7.2, 16);
    const ring = new THREE.RingGeometry(3.15, 3.55, 20);
    ring.rotateX(-Math.PI / 2);
    transformAtSite(ring, site, 0, 0.05, 0);
    bags.rock.push(ring);

    const menhirs = 5;
    for (let index = 0; index < menhirs; index += 1) {
      const angle = (index / menhirs) * Math.PI * 2 + 0.08;
      const radius = 2.05 + nextRandom() * 0.18;
      const height = 1.55 + nextRandom() * 0.7;
      addCylinder(
        bags.rock,
        site,
        Math.sin(angle) * radius,
        height / 2,
        Math.cos(angle) * radius,
        0.22 + nextRandom() * 0.08,
        0.32 + nextRandom() * 0.1,
        height,
        6,
      );
    }

    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2 + 0.2;
      addDodecahedron(
        bags.rock,
        site,
        Math.sin(angle) * 3.45,
        0.18,
        Math.cos(angle) * 3.45,
        0.42 + nextRandom() * 0.16,
        0.28 + nextRandom() * 0.1,
        0.38 + nextRandom() * 0.14,
        nextRandom() * Math.PI,
      );
    }

    addDodecahedron(bags.rock, site, 3.9, 0.22, 0.85, 1.15, 0.38, 0.55, 0.7 + nextRandom() * 0.4);
  }
  return MAP_ROCKS.length;
}
