import { MAP_COURTS, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';

/**
 * Sky beacons over the 万劫三庭.
 *
 * The scene prompt makes the courts the map's primary visual anchor and asks
 * for the destination to stay legible even when the platform itself is hidden:
 * "被建筑、森林或峡谷遮挡时，使用高台轮廓、天光、云柱、雷云和建筑屋脊保持
 * 方向提示，不要完全失去目标感" (section 3).
 *
 * A tall column of 天光 over each court does that with no gameplay cost:
 *
 * - It is additive with `depthWrite: false`, so it only ever adds light. It
 *   can never hide a character, a drop or a skill telegraph, which sections 3
 *   and 15 both forbid.
 * - It is depth *tested*, so terrain and buildings occlude it normally. The
 *   column is not an x-ray marker: what carries over an obstacle is the part
 *   of the shaft that stands above the skyline, exactly like the real
 *   silhouette-and-god-ray cue the prompt describes. Nothing here reveals
 *   anything the camera could not already see, so fog of war, logical vision
 *   and lock-on rules are untouched.
 * - Three courts share three instanced draw calls and no per-frame work.
 *
 * Geometry only: this module reads the compiled court list and writes nothing
 * back, so it cannot affect the simulation.
 */

const MM = 1_000;

/** How high the column climbs above the court floor, metres. */
const SHAFT_HEIGHT_METERS = 132;
/** The shaft widens with height so it reads as 天光 rather than a laser. */
const SHAFT_BASE_RADIUS_METERS = 9.5;
const SHAFT_TOP_RADIUS_METERS = 21;
/** Ground bloom where the column lands on the court floor. */
const GLOW_RADIUS_METERS = 27;
const GLOW_LIFT_METERS = 0.12;
/** Cloud cap: the 云柱 head that keeps the anchor readable at long range. */
const CROWN_RADIUS_METERS = 34;
const CROWN_HEIGHT_METERS = 118;

export interface CourtBeaconDiagnostics {
  readonly courts: number;
  readonly shaftHeightMeters: number;
  /** Additive, non-depth-writing beacons can never occlude gameplay. */
  readonly occludesGameplay: boolean;
}

export function buildCourtBeacons(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): CourtBeaconDiagnostics {
  const courts = MAP_COURTS.map((court) => {
    const x = court.center.x / MM;
    const z = court.center.z / MM;
    return { x, z, y: terrainHeightMeters(x, z) };
  });

  if (courts.length === 0) {
    return {
      courts: 0,
      shaftHeightMeters: SHAFT_HEIGHT_METERS,
      occludesGameplay: false,
    };
  }

  const beacons = new THREE.Group();
  beacons.name = 'map-court-beacons';

  // Open-ended cone: no caps, so looking straight up the column never shows a
  // lid and looking down never shows a disc floating over the floor.
  const shaftGeometry = track(
    new THREE.CylinderGeometry(
      SHAFT_TOP_RADIUS_METERS,
      SHAFT_BASE_RADIUS_METERS,
      SHAFT_HEIGHT_METERS,
      24,
      1,
      true,
    ),
  );
  const shafts = new THREE.InstancedMesh(shaftGeometry, materials.courtBeaconShaft, courts.length);
  shafts.name = 'map-court-beacon-shafts';
  shafts.castShadow = false;
  shafts.receiveShadow = false;
  // Draw after opaque terrain so the additive blend lands on a finished frame.
  shafts.renderOrder = 2;

  const glowGeometry = track(new THREE.PlaneGeometry(GLOW_RADIUS_METERS * 2, GLOW_RADIUS_METERS * 2));
  glowGeometry.rotateX(-Math.PI / 2);
  const glows = new THREE.InstancedMesh(glowGeometry, materials.courtBeaconGlow, courts.length);
  glows.name = 'map-court-beacon-glows';
  glows.castShadow = false;
  glows.receiveShadow = false;
  glows.renderOrder = 2;

  const crownGeometry = track(
    new THREE.PlaneGeometry(CROWN_RADIUS_METERS * 2, CROWN_RADIUS_METERS * 2),
  );
  crownGeometry.rotateX(-Math.PI / 2);
  const crowns = new THREE.InstancedMesh(crownGeometry, materials.courtBeaconCrown, courts.length);
  crowns.name = 'map-court-beacon-crowns';
  crowns.castShadow = false;
  crowns.receiveShadow = false;
  crowns.renderOrder = 2;

  const matrix = new THREE.Matrix4();
  courts.forEach((court, index) => {
    matrix.makeTranslation(court.x, court.y + SHAFT_HEIGHT_METERS / 2, court.z);
    shafts.setMatrixAt(index, matrix);

    matrix.makeTranslation(court.x, court.y + GLOW_LIFT_METERS, court.z);
    glows.setMatrixAt(index, matrix);

    matrix.makeTranslation(court.x, court.y + CROWN_HEIGHT_METERS, court.z);
    crowns.setMatrixAt(index, matrix);
  });
  shafts.instanceMatrix.needsUpdate = true;
  glows.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;

  beacons.add(shafts);
  beacons.add(glows);
  beacons.add(crowns);
  group.add(beacons);

  return {
    courts: courts.length,
    shaftHeightMeters: SHAFT_HEIGHT_METERS,
    occludesGameplay: false,
  };
}
