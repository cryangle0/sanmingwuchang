import {
  AUTHORITATIVE_MAP_SHOPS,
  MAP_COURTS,
  MAP_DRAGONS,
  MAP_ELITES,
  MAP_PIGS,
} from '@jwgb/content';
import * as THREE from 'three';
import {
  addBeamBetween,
  addBox,
  addCone,
  addCylinder,
  addDisc,
  addDodecahedron,
  addEllipsoid,
  addFacingDisc,
  addHemisphere,
  addHorizontalArcTorus,
  addHorizontalRing,
  addHorizontalTorus,
  addRoof,
  type BagRenderSpec,
  type GeometryBag,
  mergeBagsIntoGroup,
  offsetFromSite,
  type Site,
  shiftedSite,
  siteTowardOrigin,
  yawToward,
} from './dressing/prop-kit';
import {
  buildRoofOcclusionBatch,
  disposeRoofOcclusionBatchTargets,
  type MapRoofOccluderSource,
  type MapRoofOcclusionBatch,
  roofOccluderSource,
} from './map-occlusion';
import type { MapMaterialLibrary } from './map-palette';
import { createRandomStream } from './map-sampling';

const MM = 1_000;
const MARKET_PRESENTATION_YAW = Math.PI / 4;

export type LandmarkMaterialLibrary = Pick<
  MapMaterialLibrary,
  | 'courtInlay'
  | 'dragonPalace'
  | 'dragonWater'
  | 'eliteArena'
  | 'lacquer'
  | 'pigDen'
  | 'rock'
  | 'roofTile'
  | 'shopAnchor'
  | 'timber'
  | 'wallTrim'
>;

export interface LandmarkBuildSummary {
  readonly shopMarkets: number;
  readonly shopStalls: number;
  readonly pigDens: number;
  readonly dragonPalaces: number;
  readonly dragonApproachGates: number;
  readonly eliteArenas: number;
  readonly courtGates: number;
  readonly courtShopPavilions: number;
  readonly courtRevivePads: number;
  readonly courtRockMarkers: number;
  readonly drawCalls: number;
}

interface GeometryBags {
  readonly stone: GeometryBag;
  readonly timber: GeometryBag;
  readonly lacquer: GeometryBag;
  readonly roof: GeometryBag;
  readonly shop: GeometryBag;
  readonly pig: GeometryBag;
  readonly dragon: GeometryBag;
  readonly water: GeometryBag;
  readonly elite: GeometryBag;
  readonly rock: GeometryBag;
  readonly gold: GeometryBag;
}

/**
 * Builds complete procedural prop families around authoritative map anchors.
 *
 * Every family keeps its authored approaches open and leaves simulation,
 * collision and source geometry untouched. Primitive parts are baked into
 * world space and merged by material, following the static-prop pipeline in
 * world-of-claudecraft while keeping this map asset-free and deterministic.
 */
export function buildMapLandmarks(
  parent: THREE.Group,
  materials: LandmarkMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  seed: number,
  registerRoofBatch?: (batch: MapRoofOcclusionBatch) => void,
): LandmarkBuildSummary {
  const root = new THREE.Group();
  root.name = 'map-landmarks';
  const bags = createGeometryBags();
  const roofOccluders: MapRoofOccluderSource[] = [];
  const nextRandom = createRandomStream(seed ^ 0x6c8e9cf5);

  const shopMarkets = buildShopMarkets(bags, roofOccluders, nextRandom);
  buildPigDens(bags, nextRandom);
  const dragonApproachGates = buildDragonPalaces(bags, roofOccluders);
  buildEliteArenas(bags);
  const courtCounts = buildCourtArchitecture(bags, roofOccluders, nextRandom);

  const renderSpecs: readonly BagRenderSpec[] = [
    {
      name: 'landmarks-stone',
      geometries: bags.stone,
      material: materials.wallTrim,
      castShadow: true,
    },
    {
      name: 'landmarks-timber',
      geometries: bags.timber,
      material: materials.timber,
      castShadow: true,
    },
    {
      name: 'landmarks-lacquer',
      geometries: bags.lacquer,
      material: materials.lacquer,
      castShadow: true,
    },
    {
      name: 'landmarks-shop',
      geometries: bags.shop,
      material: materials.shopAnchor,
      castShadow: true,
    },
    {
      name: 'landmarks-pig',
      geometries: bags.pig,
      material: materials.pigDen,
      castShadow: true,
    },
    {
      name: 'landmarks-dragon',
      geometries: bags.dragon,
      material: materials.dragonPalace,
      castShadow: true,
    },
    {
      name: 'landmarks-water',
      geometries: bags.water,
      material: materials.dragonWater,
      castShadow: false,
    },
    {
      name: 'landmarks-elite',
      geometries: bags.elite,
      material: materials.eliteArena,
      castShadow: true,
    },
    {
      name: 'landmarks-rock',
      geometries: bags.rock,
      material: materials.rock,
      castShadow: true,
    },
    {
      name: 'landmarks-gold',
      geometries: bags.gold,
      material: materials.courtInlay,
      castShadow: false,
    },
  ];

  const mergedDrawCalls = mergeBagsIntoGroup(root, renderSpecs, track);
  const roofBatch = buildRoofOcclusionBatch(
    root,
    'landmarks-roof',
    bags.roof,
    roofOccluders,
    materials.roofTile,
    track,
  );
  if (roofBatch) {
    if (registerRoofBatch) {
      registerRoofBatch(roofBatch);
    } else {
      disposeRoofOcclusionBatchTargets(roofBatch);
    }
  }
  const drawCalls = mergedDrawCalls + (roofBatch ? 1 : 0);

  const summary: LandmarkBuildSummary = {
    shopMarkets,
    shopStalls: AUTHORITATIVE_MAP_SHOPS.length,
    pigDens: MAP_PIGS.length,
    dragonPalaces: MAP_DRAGONS.length,
    dragonApproachGates,
    eliteArenas: MAP_ELITES.length,
    courtGates: courtCounts.gates,
    courtShopPavilions: courtCounts.shopPavilions,
    courtRevivePads: courtCounts.revivePads,
    courtRockMarkers: courtCounts.rockMarkers,
    drawCalls,
  };
  root.userData.landmarkSummary = summary;
  parent.add(root);
  return summary;
}

function createGeometryBags(): GeometryBags {
  return {
    stone: [],
    timber: [],
    lacquer: [],
    roof: [],
    shop: [],
    pig: [],
    dragon: [],
    water: [],
    elite: [],
    rock: [],
    gold: [],
  };
}

function buildShopMarkets(
  bags: GeometryBags,
  roofOccluders: MapRoofOccluderSource[],
  nextRandom: () => number,
): number {
  const clusters = new Map<string, (typeof AUTHORITATIVE_MAP_SHOPS)[number][]>();
  for (const shop of AUTHORITATIVE_MAP_SHOPS) {
    const cluster = clusters.get(shop.zone);
    if (cluster) {
      cluster.push(shop);
    } else {
      clusters.set(shop.zone, [shop]);
    }
  }

  for (const cluster of clusters.values()) {
    const centre = {
      x: cluster.reduce((sum, point) => sum + point.x, 0) / cluster.length / MM,
      z: cluster.reduce((sum, point) => sum + point.z, 0) / cluster.length / MM,
    };
    for (const [index, anchor] of cluster.entries()) {
      const x = anchor.x / MM;
      const z = anchor.z / MM;
      const site: Site = {
        x,
        z,
        yaw: MARKET_PRESENTATION_YAW + (nextRandom() - 0.5) * 0.08,
      };
      const scale = 0.94 + nextRandom() * 0.12;
      const roofs = createRoofBag();
      addMarketStall(bags, bags.shop, roofs, site, scale, false, index % 3);
      roofOccluders.push(roofOccluderSource(`shop-${anchor.id}`, roofs));
    }
    const centreSite = {
      x: centre.x,
      z: centre.z,
      yaw: yawToward(centre.x, centre.z, 0, 0),
    };
    addDisc(bags.stone, centreSite, 0, 0.025, 0, 4.4, 3.5, 16);
    addHorizontalTorus(bags.shop, centre.x, 0.09, centre.z, 1.75, 0.07, 20);
    const beaconRoofs = createRoofBag();
    addMarketBeacon(bags, beaconRoofs, centreSite);
    roofOccluders.push(
      roofOccluderSource(`shop-market-${cluster[0]?.zone ?? roofOccluders.length}`, beaconRoofs),
    );
  }
  return clusters.size;
}

function addMarketStall(
  bags: GeometryBags,
  accent: GeometryBag,
  roofs: GeometryBag,
  site: Site,
  scale: number,
  ornate: boolean,
  variant = 0,
): void {
  // Authoritative shop anchors are service points. Keep the counter and roof
  // behind that point so interacting players stand in front of the stall
  // instead of inside its posts and display geometry.
  const stallSite = shiftedSite(site, 0, -2.35 * scale);
  addBox(bags.stone, stallSite, 0, 0.09 * scale, 0, 4.9 * scale, 0.18 * scale, 3.55 * scale);
  addBox(accent, stallSite, 0, 0.2 * scale, 0.12 * scale, 4.35 * scale, 0.1 * scale, 3.05 * scale);

  for (const x of [-1.72, 1.72]) {
    for (const z of [-1.08, 1.08]) {
      addCylinder(
        bags.timber,
        stallSite,
        x * scale,
        1.48 * scale,
        z * scale,
        0.1 * scale,
        0.15 * scale,
        2.7 * scale,
        7,
      );
    }
  }

  addBox(
    bags.stone,
    stallSite,
    0,
    1.35 * scale,
    -1.1 * scale,
    3.25 * scale,
    1.72 * scale,
    0.12 * scale,
  );
  addBox(
    bags.timber,
    stallSite,
    0,
    2.19 * scale,
    -1.16 * scale,
    3.55 * scale,
    0.13 * scale,
    0.16 * scale,
  );
  for (const x of [-1.52, 0, 1.52]) {
    addBox(
      bags.timber,
      stallSite,
      x * scale,
      1.36 * scale,
      -1.17 * scale,
      0.12 * scale,
      1.78 * scale,
      0.15 * scale,
    );
  }

  addBox(
    accent,
    stallSite,
    0,
    0.67 * scale,
    1.02 * scale,
    2.85 * scale,
    0.78 * scale,
    0.58 * scale,
  );
  addBox(
    bags.timber,
    stallSite,
    0,
    1.1 * scale,
    1.02 * scale,
    3.08 * scale,
    0.13 * scale,
    0.7 * scale,
  );
  addBox(
    bags.lacquer,
    stallSite,
    0,
    2.13 * scale,
    1.17 * scale,
    1.72 * scale,
    0.43 * scale,
    0.11 * scale,
  );

  if (variant === 0) {
    addBox(
      accent,
      stallSite,
      1.35 * scale,
      0.42 * scale,
      0.2 * scale,
      0.72 * scale,
      0.72 * scale,
      0.72 * scale,
      0.14,
    );
    addBox(
      bags.timber,
      stallSite,
      -1.42 * scale,
      0.48 * scale,
      0.48 * scale,
      0.72 * scale,
      0.12 * scale,
      1.0 * scale,
    );
  } else if (variant === 1) {
    addCylinder(
      accent,
      stallSite,
      1.32 * scale,
      0.48 * scale,
      0.35 * scale,
      0.32 * scale,
      0.4 * scale,
      0.9 * scale,
      10,
    );
    addCylinder(
      accent,
      stallSite,
      -1.35 * scale,
      0.35 * scale,
      0.5 * scale,
      0.26 * scale,
      0.34 * scale,
      0.66 * scale,
      10,
    );
  } else {
    addBox(
      bags.timber,
      stallSite,
      1.4 * scale,
      0.52 * scale,
      0.25 * scale,
      0.14 * scale,
      0.95 * scale,
      1.25 * scale,
      -0.18,
    );
    addBox(
      accent,
      stallSite,
      -1.4 * scale,
      0.36 * scale,
      0.48 * scale,
      0.9 * scale,
      0.54 * scale,
      0.65 * scale,
      -0.12,
    );
  }

  addRoof(roofs, stallSite, 0, 2.72 * scale, 0, 5.35 * scale, 4.15 * scale, 1.15 * scale);
  addLantern(bags, accent, stallSite, -1.45 * scale, 2.48 * scale, 1.22 * scale, 0.78 * scale);
  addLantern(bags, accent, stallSite, 1.45 * scale, 2.48 * scale, 1.22 * scale, 0.78 * scale);

  if (ornate) {
    addBox(bags.lacquer, stallSite, 0, 3.72 * scale, 0, 2.8 * scale, 0.2 * scale, 2.2 * scale);
    addRoof(roofs, stallSite, 0, 3.82 * scale, 0, 3.5 * scale, 2.9 * scale, 0.76 * scale);
    addCylinder(
      bags.gold,
      stallSite,
      0,
      4.74 * scale,
      0,
      0.08 * scale,
      0.12 * scale,
      0.42 * scale,
      8,
    );
  }
}

function addMarketBeacon(bags: GeometryBags, roofs: GeometryBag, site: Site): void {
  addCylinder(bags.stone, site, 0, 0.16, 0, 0.72, 0.88, 0.32, 10);
  addCylinder(bags.timber, site, 0, 2.25, 0, 0.1, 0.16, 4.25, 8);
  addBox(bags.lacquer, site, 0, 3.25, 0.08, 1.25, 0.92, 0.16);
  addBox(bags.gold, site, 0, 3.25, 0.18, 0.82, 0.08, 0.08);
  addRoof(roofs, site, 0, 4.38, 0, 2.15, 1.85, 0.56);
  addLantern(bags, bags.shop, site, 0, 2.1, 0.28, 1.05);
}

function buildPigDens(bags: GeometryBags, nextRandom: () => number): void {
  for (const record of MAP_PIGS) {
    const site = siteTowardOrigin(record.position.x / MM, record.position.z / MM);
    addDisc(bags.pig, site, 0, 0.018, 0.55, 11.4, 8.6, 20);
    addHemisphere(bags.pig, site, 0, 0, -1.35, 5.7, 2.85, 4.45);
    addHemisphere(bags.pig, site, -2.15, 0, -1.65, 2.8, 2.0, 2.85);
    addHemisphere(bags.pig, site, 2.25, 0, -1.75, 2.65, 1.85, 2.7);
    addFacingDisc(bags.roof, site, 0, 1.42, 2.72, 3.5, 2.68);

    for (let index = 0; index < 9; index += 1) {
      const angle = (index / 8) * Math.PI;
      const radius = 0.38 + nextRandom() * 0.2;
      addDodecahedron(
        bags.rock,
        site,
        Math.cos(angle) * 2.02,
        0.38 + Math.sin(angle) * 1.95,
        2.6,
        radius * (1.15 + nextRandom() * 0.25),
        radius,
        radius,
        nextRandom() * Math.PI,
      );
    }

    for (const x of [-1.55, 1.55]) {
      addCylinder(bags.timber, site, x, 1.28, 2.82, 0.11, 0.17, 2.55, 7);
    }
    addBox(bags.timber, site, 0, 2.5, 2.82, 3.7, 0.2, 0.22);
    addBox(bags.lacquer, site, 0, 2.25, 2.96, 1.1, 0.38, 0.1);

    for (const x of [-3.5, 3.5]) {
      for (const z of [2.35, 5.1]) {
        addCylinder(bags.timber, site, x, 0.82, z, 0.1, 0.15, 1.64, 6);
      }
      addBeamBetween(bags.timber, site, x, 0.9, 2.35, x, 1.13, 5.1, 0.09, 6);
    }
    addBox(bags.pig, site, 3.15, 0.38, 0.72, 1.75, 0.58, 0.82, -0.16);
    addBox(bags.timber, site, 3.15, 0.7, 0.72, 1.92, 0.1, 0.94, -0.16);
    addDodecahedron(bags.rock, site, -3.65, 0.5, 0.35, 0.85, 0.62, 0.8, nextRandom() * Math.PI);
    addDodecahedron(bags.rock, site, 3.85, 0.42, -0.45, 0.7, 0.52, 0.74, nextRandom() * Math.PI);
  }
}

function buildDragonPalaces(bags: GeometryBags, roofOccluders: MapRoofOccluderSource[]): number {
  let approachGates = 0;
  for (const record of MAP_DRAGONS) {
    const site = siteTowardOrigin(record.position.x / MM, record.position.z / MM);
    addCylinder(bags.stone, site, 0, 0.08, 0, 9.2, 9.45, 0.16, 24);
    addCylinder(bags.water, site, 0, 0.18, 0, 7.9, 8.05, 0.2, 24);
    addHorizontalRing(bags.stone, site.x, 0.31, site.z, 6.95, 7.55, 32);
    addHorizontalTorus(bags.gold, site.x, 0.34, site.z, 2.15, 0.09, 28);

    for (const [gateIndex, angle] of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].entries()) {
      const localX = Math.sin(angle) * 10.4;
      const localZ = Math.cos(angle) * 10.4;
      const gatePosition = offsetFromSite(site, localX, localZ);
      const gateSite: Site = {
        ...gatePosition,
        yaw: yawToward(gatePosition.x, gatePosition.z, site.x, site.z),
      };
      addBox(bags.stone, gateSite, 0, 0.25, 2.25, 3.1, 0.18, 5.7);
      const gateRoofs = createRoofBag();
      addGate(bags, bags.dragon, gateRoofs, gateSite, 5.3, 4.25, 1.8);
      roofOccluders.push(
        roofOccluderSource(`dragon-${record.id}-gate-${gateIndex + 1}`, gateRoofs),
      );
      approachGates += 1;
    }

    const pavilionSite = shiftedSite(site, 0, -10.25);
    const pavilionRoofs = createRoofBag();
    addOpenPavilion(bags, bags.dragon, pavilionRoofs, pavilionSite, 7.8, 6.1, 4.45, true);
    roofOccluders.push(roofOccluderSource(`dragon-${record.id}-pavilion`, pavilionRoofs));
    for (const x of [-5.15, 5.15]) {
      const towerSite = shiftedSite(site, x, -8.7);
      addCylinder(bags.stone, towerSite, 0, 0.22, 0, 0.85, 1.02, 0.44, 10);
      addCylinder(bags.lacquer, towerSite, 0, 1.8, 0, 0.16, 0.23, 3.25, 8);
      const towerRoofs = createRoofBag();
      addRoof(towerRoofs, towerSite, 0, 3.35, 0, 2.8, 2.8, 0.72);
      roofOccluders.push(
        roofOccluderSource(`dragon-${record.id}-tower-${x < 0 ? 'left' : 'right'}`, towerRoofs),
      );
      addCylinder(bags.gold, towerSite, 0, 4.2, 0, 0.07, 0.11, 0.38, 8);
    }
  }
  return approachGates;
}

function buildEliteArenas(bags: GeometryBags): void {
  for (const record of MAP_ELITES) {
    const site = siteTowardOrigin(record.position.x / MM, record.position.z / MM);
    addCylinder(bags.stone, site, 0, 0.08, 0, 8.3, 8.5, 0.16, 12);
    addCylinder(bags.elite, site, 0, 0.19, 0, 7.65, 7.8, 0.22, 12);
    addHorizontalTorus(bags.gold, site.x, 0.33, site.z, 2.6, 0.09, 28);
    for (const angle of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
      addBox(bags.gold, site, 0, 0.315, 0, 0.08, 0.035, 9.2, angle);
    }

    const entranceHalfAngle = 0.24;
    addHorizontalArcTorus(
      bags.stone,
      site,
      7.38,
      0.29,
      -Math.PI / 2 + entranceHalfAngle,
      Math.PI - entranceHalfAngle * 2,
      18,
      0.42,
    );
    addHorizontalArcTorus(
      bags.stone,
      site,
      7.38,
      0.29,
      Math.PI / 2 + entranceHalfAngle,
      Math.PI - entranceHalfAngle * 2,
      18,
      0.42,
    );

    for (const angle of [Math.PI / 4, (Math.PI * 3) / 4, (Math.PI * 5) / 4, (Math.PI * 7) / 4]) {
      const x = Math.cos(angle) * 6.65;
      const z = Math.sin(angle) * 6.65;
      addCylinder(bags.stone, site, x, 0.65, z, 0.55, 0.72, 1.3, 8);
      addCylinder(bags.lacquer, site, x, 2.55, z, 0.12, 0.17, 3.8, 8);
      addBox(bags.elite, site, x, 3.1, z, 0.98, 1.35, 0.12, -angle);
      addCone(bags.gold, site, x, 4.62, z, 0.18, 0.42, 8);
    }

    for (const x of [-2.4, 2.4]) {
      addBox(bags.stone, site, x, 0.22, 7.75, 1.85, 0.16, 2.35);
      addBox(bags.stone, site, x, 0.22, -7.75, 1.85, 0.16, 2.35);
    }
  }
}

function buildCourtArchitecture(
  bags: GeometryBags,
  roofOccluders: MapRoofOccluderSource[],
  nextRandom: () => number,
): {
  readonly gates: number;
  readonly shopPavilions: number;
  readonly revivePads: number;
  readonly rockMarkers: number;
} {
  let gates = 0;
  let shopPavilions = 0;
  let revivePads = 0;
  let rockMarkers = 0;

  MAP_COURTS.forEach((court, courtIndex) => {
    const centre = {
      x: court.center.x / MM,
      z: court.center.z / MM,
      yaw: 0,
    };
    const accent = courtIndex === 0 ? bags.dragon : courtIndex === 1 ? bags.shop : bags.elite;

    addHorizontalRing(bags.stone, centre.x, 0.305, centre.z, 22.15, 25.25, 72);
    addHorizontalTorus(bags.gold, centre.x, 0.39, centre.z, 22.35, 0.08, 72);
    addHorizontalTorus(accent, centre.x, 0.4, centre.z, 25.0, 0.09, 72);

    for (const [gateIndex, gate] of court.gates.entries()) {
      const x = gate.x / MM;
      const z = gate.z / MM;
      const site: Site = { x, z, yaw: yawToward(x, z, centre.x, centre.z) };
      const roofs = createRoofBag();
      addCourtGatehouse(bags, accent, roofs, site);
      roofOccluders.push(
        roofOccluderSource(`court-${courtIndex + 1}-gate-${gateIndex + 1}`, roofs),
      );
      gates += 1;
    }

    for (const [pavilionIndex, vertex] of court.hexVertices.entries()) {
      const x = vertex.x / MM;
      const z = vertex.z / MM;
      const site: Site = { x, z, yaw: yawToward(x, z, centre.x, centre.z) };
      const roofs = createRoofBag();
      addWatchPavilion(bags, accent, roofs, site);
      roofOccluders.push(
        roofOccluderSource(`court-${courtIndex + 1}-watch-${pavilionIndex + 1}`, roofs),
      );
    }

    for (const [index, point] of court.finalShops.entries()) {
      const x = point.x / MM;
      const z = point.z / MM;
      const site: Site = { x, z, yaw: MARKET_PRESENTATION_YAW };
      const roofs = createRoofBag();
      addMarketStall(bags, accent, roofs, site, 1.12, true, index % 3);
      roofOccluders.push(roofOccluderSource(`court-${courtIndex + 1}-shop-${index + 1}`, roofs));
      shopPavilions += 1;
    }

    for (const point of court.revivePoints) {
      const site: Site = {
        x: point.x / MM,
        z: point.z / MM,
        yaw: yawToward(point.x / MM, point.z / MM, centre.x, centre.z),
      };
      addLotusPad(bags, accent, site);
      revivePads += 1;
    }

    for (const point of court.rockPoints) {
      const site: Site = {
        x: point.x / MM,
        z: point.z / MM,
        yaw: nextRandom() * Math.PI * 2,
      };
      const scale = 0.9 + nextRandom() * 0.25;
      addDodecahedron(
        bags.rock,
        site,
        0,
        0.85 * scale,
        0,
        2.15 * scale,
        1.45 * scale,
        1.75 * scale,
        nextRandom() * Math.PI,
      );
      addCylinder(bags.gold, site, 0, 1.9 * scale, 0, 0.05, 0.09, 0.5 * scale, 7);
      rockMarkers += 1;
    }
  });

  return { gates, shopPavilions, revivePads, rockMarkers };
}

function addCourtGatehouse(
  bags: GeometryBags,
  accent: GeometryBag,
  roofs: GeometryBag,
  site: Site,
): void {
  addBox(bags.stone, site, 0, 0.11, 1.0, 9.8, 0.22, 5.0);
  for (const x of [-4.05, 4.05]) {
    addCylinder(bags.stone, site, x, 0.3, 0, 0.58, 0.74, 0.6, 10);
    addCylinder(bags.lacquer, site, x, 2.8, 0, 0.24, 0.34, 5.0, 10);
    addBox(accent, site, x, 4.9, 0, 0.82, 0.46, 0.82);
  }
  addBox(accent, site, 0, 4.68, 0, 8.55, 0.62, 0.72);
  addBox(bags.timber, site, 0, 3.95, 0, 7.75, 0.26, 0.48);
  for (const x of [-2.6, 0, 2.6]) {
    addBox(bags.timber, site, x, 4.3, 0, 0.18, 0.92, 0.52);
  }
  addRoof(roofs, site, 0, 5.18, 0, 10.4, 3.35, 1.35);
  addBox(bags.lacquer, site, 0, 6.45, 0, 3.6, 0.22, 1.7);
  addRoof(roofs, site, 0, 6.56, 0, 4.65, 2.4, 0.8);
  addLantern(bags, accent, site, -3.0, 4.08, 0.44, 1.05);
  addLantern(bags, accent, site, 3.0, 4.08, 0.44, 1.05);
}

function addWatchPavilion(
  bags: GeometryBags,
  accent: GeometryBag,
  roofs: GeometryBag,
  site: Site,
): void {
  addCylinder(bags.stone, site, 0, 0.28, 0, 1.1, 1.35, 0.56, 10);
  for (const x of [-0.68, 0.68]) {
    for (const z of [-0.55, 0.55]) {
      addCylinder(bags.lacquer, site, x, 2.08, z, 0.1, 0.14, 3.6, 8);
    }
  }
  addBox(accent, site, 0, 3.42, 0, 2.1, 0.3, 1.8);
  addRoof(roofs, site, 0, 3.65, 0, 3.6, 3.25, 0.88);
  addRoof(roofs, site, 0, 4.55, 0, 2.35, 2.15, 0.58);
  addCylinder(bags.gold, site, 0, 5.35, 0, 0.07, 0.11, 0.42, 8);
}

function addLotusPad(bags: GeometryBags, accent: GeometryBag, site: Site): void {
  addCylinder(bags.stone, site, 0, 0.08, 0, 1.42, 1.55, 0.16, 16);
  addCylinder(bags.gold, site, 0, 0.17, 0, 0.62, 0.75, 0.12, 16);
  addHorizontalTorus(accent, site.x, 0.24, site.z, 1.05, 0.08, 20);
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    addEllipsoid(
      accent,
      site,
      Math.cos(angle) * 0.82,
      0.25,
      Math.sin(angle) * 0.82,
      0.42,
      0.09,
      0.22,
      -angle,
    );
  }
}

function addOpenPavilion(
  bags: GeometryBags,
  accent: GeometryBag,
  roofs: GeometryBag,
  site: Site,
  width: number,
  depth: number,
  height: number,
  twoTier: boolean,
): void {
  addBox(bags.stone, site, 0, 0.17, 0, width, 0.34, depth);
  for (const x of [-width * 0.36, width * 0.36]) {
    for (const z of [-depth * 0.33, depth * 0.33]) {
      addCylinder(bags.lacquer, site, x, height / 2, z, 0.17, 0.25, height, 10);
      addCylinder(bags.stone, site, x, 0.22, z, 0.34, 0.44, 0.44, 10);
    }
  }
  addBox(accent, site, 0, height - 0.38, -depth * 0.35, width * 0.78, 0.42, 0.28);
  addBox(bags.timber, site, 0, height - 0.88, 0, width * 0.82, 0.22, 0.38);
  addRoof(roofs, site, 0, height, 0, width + 1.2, depth + 1.2, 1.35);
  if (twoTier) {
    addBox(accent, site, 0, height + 1.34, 0, width * 0.5, 0.26, depth * 0.46);
    addRoof(roofs, site, 0, height + 1.45, 0, width * 0.64, depth * 0.68, 0.88);
    addCylinder(bags.gold, site, 0, height + 2.52, 0, 0.08, 0.13, 0.48, 8);
  }
}

function addGate(
  bags: GeometryBags,
  accent: GeometryBag,
  roofs: GeometryBag,
  site: Site,
  width: number,
  height: number,
  depth: number,
): void {
  const halfPost = width / 2 - 0.58;
  for (const x of [-halfPost, halfPost]) {
    addCylinder(bags.stone, site, x, 0.25, 0, 0.45, 0.58, 0.5, 9);
    addCylinder(bags.timber, site, x, height / 2, 0, 0.18, 0.26, height, 9);
    addBox(accent, site, x, height - 0.46, 0, 0.66, 0.42, 0.66);
  }
  addBox(accent, site, 0, height - 0.52, 0, width, 0.54, 0.64);
  addBox(bags.timber, site, 0, height - 1.06, 0, width - 0.75, 0.2, 0.38);
  for (const x of [-width * 0.26, 0, width * 0.26]) {
    addBox(bags.timber, site, x, height - 0.78, 0, 0.16, 0.72, 0.44);
  }
  addRoof(roofs, site, 0, height + 0.05, 0, width + 1.15, depth + 0.95, 1.0);
  addLantern(bags, accent, site, -halfPost, height - 1.25, 0.38, 0.85);
  addLantern(bags, accent, site, halfPost, height - 1.25, 0.38, 0.85);
}

function addLantern(
  bags: GeometryBags,
  accent: GeometryBag,
  site: Site,
  localX: number,
  y: number,
  localZ: number,
  scale: number,
): void {
  addCylinder(bags.gold, site, localX, y + 0.34 * scale, localZ, 0.04, 0.05, 0.32 * scale, 7);
  addCylinder(accent, site, localX, y, localZ, 0.17 * scale, 0.22 * scale, 0.48 * scale, 8);
  addCylinder(
    bags.timber,
    site,
    localX,
    y - 0.29 * scale,
    localZ,
    0.08 * scale,
    0.11 * scale,
    0.1 * scale,
    7,
  );
}

function createRoofBag(): GeometryBag {
  return [];
}
