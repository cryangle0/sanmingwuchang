import {
  AUTHORITATIVE_MAP_SHOPS,
  MAP_BOUNDARY,
  MAP_COURTS,
  MAP_DRAGONS,
  MAP_ELITES,
  MAP_PIGS,
  type MapPointMm,
} from '@jwgb/content';
import { ringContains } from './map-sampling';

const MAP_FRAME_PADDING_MM = 18_000;

export const MINIMAP_ZOOM_LEVELS = [1, 1.5, 2, 3] as const;
export const WORLD_MAP_ZOOM_LEVELS = [1, 1.5, 2.25, 3.25, 4.5] as const;
export const MINIMAP_BASE_SPAN_MM = 520_000;

export interface MapBoundsMm {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface MapCenterMm {
  readonly x: number;
  readonly z: number;
}

export interface MapProjection {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly center: MapCenterMm;
  readonly visibleBounds: MapBoundsMm;
}

export type MapPoiKind = 'court' | 'shop' | 'pig' | 'dragon' | 'elite';

export interface MapPoi {
  readonly id: string;
  readonly kind: MapPoiKind;
  readonly name: string;
  readonly position: MapPointMm;
}

export interface ProjectedMapPoint {
  readonly x: number;
  readonly y: number;
}

export const MAP_BOUNDS_MM: MapBoundsMm = mapBoundsFromRing(MAP_BOUNDARY);

export const MAP_POIS: readonly MapPoi[] = [
  ...MAP_COURTS.map(
    (court, index): MapPoi => ({
      id: court.id,
      kind: 'court',
      name: court.id.replace(/^B\d+_/, '') || `万劫庭 ${index + 1}`,
      position: court.center,
    }),
  ),
  ...shopClusterPois(),
  ...MAP_PIGS.map(
    (pig, index): MapPoi => ({
      id: pig.id,
      kind: 'pig',
      name: `猪巢 ${index + 1}`,
      position: pig.position,
    }),
  ),
  ...MAP_DRAGONS.map(
    (dragon, index): MapPoi => ({
      id: dragon.id,
      kind: 'dragon',
      name: `龙宫 ${index + 1}`,
      position: dragon.position,
    }),
  ),
  ...MAP_ELITES.map(
    (elite, index): MapPoi => ({
      id: elite.id,
      kind: 'elite',
      name: `精英试炼 ${index + 1}`,
      position: elite.position,
    }),
  ),
];

export function mapBoundsFromRing(ring: readonly MapPointMm[]): MapBoundsMm {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function mapBoundsCenter(bounds: MapBoundsMm = MAP_BOUNDS_MM): MapCenterMm {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

export function clampDiscreteZoom(
  value: number,
  levels: readonly number[],
  fallback = levels[0] ?? 1,
): number {
  if (!Number.isFinite(value) || levels.length === 0) {
    return fallback;
  }
  let closest = levels[0] ?? fallback;
  let closestDistance = Math.abs(value - closest);
  for (const level of levels) {
    const distance = Math.abs(value - level);
    if (distance < closestDistance) {
      closest = level;
      closestDistance = distance;
    }
  }
  return closest;
}

export function stepDiscreteZoom(
  current: number,
  direction: number,
  levels: readonly number[],
): number {
  if (levels.length === 0) {
    return 1;
  }
  const snapped = clampDiscreteZoom(current, levels);
  const currentIndex = Math.max(0, levels.indexOf(snapped));
  const nextIndex = Math.max(0, Math.min(levels.length - 1, currentIndex + Math.sign(direction)));
  return levels[nextIndex] ?? snapped;
}

export function createMapProjection(options: {
  readonly width: number;
  readonly height: number;
  readonly center: MapCenterMm;
  readonly zoom: number;
  readonly bounds?: MapBoundsMm;
  readonly baseSpanMm?: number;
}): MapProjection {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const bounds = options.bounds ?? MAP_BOUNDS_MM;
  const zoom = Math.max(0.01, options.zoom);
  const paddedBounds = {
    minX: bounds.minX - MAP_FRAME_PADDING_MM,
    maxX: bounds.maxX + MAP_FRAME_PADDING_MM,
    minZ: bounds.minZ - MAP_FRAME_PADDING_MM,
    maxZ: bounds.maxZ + MAP_FRAME_PADDING_MM,
  };
  const baseScale =
    options.baseSpanMm === undefined
      ? Math.min(
          width / Math.max(1, paddedBounds.maxX - paddedBounds.minX),
          height / Math.max(1, paddedBounds.maxZ - paddedBounds.minZ),
        )
      : Math.min(width, height) / Math.max(1, options.baseSpanMm);
  const scale = baseScale * zoom;
  const halfSpanX = width / scale / 2;
  const halfSpanZ = height / scale / 2;
  const center = clampMapCenter(options.center, halfSpanX, halfSpanZ, paddedBounds);

  return {
    width,
    height,
    scale,
    center,
    visibleBounds: {
      minX: center.x - halfSpanX,
      maxX: center.x + halfSpanX,
      minZ: center.z - halfSpanZ,
      maxZ: center.z + halfSpanZ,
    },
  };
}

export function projectMapPoint(
  projection: MapProjection,
  point: Pick<MapPointMm, 'x' | 'z'>,
): ProjectedMapPoint {
  return {
    x: projection.width / 2 + (point.x - projection.center.x) * projection.scale,
    y: projection.height / 2 + (projection.center.z - point.z) * projection.scale,
  };
}

export function unprojectMapPoint(projection: MapProjection, pixel: ProjectedMapPoint): MapPointMm {
  return {
    x: Math.round(projection.center.x + (pixel.x - projection.width / 2) / projection.scale),
    z: Math.round(projection.center.z - (pixel.y - projection.height / 2) / projection.scale),
  };
}

export function panMapCenter(
  projection: MapProjection,
  deltaPixelsX: number,
  deltaPixelsY: number,
): MapCenterMm {
  return {
    x: projection.center.x - deltaPixelsX / projection.scale,
    z: projection.center.z + deltaPixelsY / projection.scale,
  };
}

export function mapPointInsideBoundary(point: Pick<MapPointMm, 'x' | 'z'>): boolean {
  return ringContains(MAP_BOUNDARY, point);
}

export function nearestMapPoi(
  projection: MapProjection,
  pixel: ProjectedMapPoint,
  maximumDistancePixels: number,
  pois: readonly MapPoi[] = MAP_POIS,
): MapPoi | null {
  let nearest: MapPoi | null = null;
  let nearestDistanceSquared = maximumDistancePixels * maximumDistancePixels;
  for (const poi of pois) {
    const projected = projectMapPoint(projection, poi.position);
    const dx = projected.x - pixel.x;
    const dy = projected.y - pixel.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= nearestDistanceSquared) {
      nearest = poi;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}

function clampMapCenter(
  center: MapCenterMm,
  halfSpanX: number,
  halfSpanZ: number,
  bounds: MapBoundsMm,
): MapCenterMm {
  return {
    x: clampAxis(center.x, halfSpanX, bounds.minX, bounds.maxX),
    z: clampAxis(center.z, halfSpanZ, bounds.minZ, bounds.maxZ),
  };
}

function clampAxis(value: number, halfSpan: number, minimum: number, maximum: number): number {
  const midpoint = (minimum + maximum) / 2;
  const availableHalfSpan = (maximum - minimum) / 2;
  if (halfSpan >= availableHalfSpan) {
    return midpoint;
  }
  return Math.max(minimum + halfSpan, Math.min(maximum - halfSpan, value));
}

function shopClusterPois(): MapPoi[] {
  const clusters = new Map<string, { x: number; z: number; count: number }>();
  for (const shop of AUTHORITATIVE_MAP_SHOPS) {
    const cluster = clusters.get(shop.zone) ?? { x: 0, z: 0, count: 0 };
    cluster.x += shop.x;
    cluster.z += shop.z;
    cluster.count += 1;
    clusters.set(shop.zone, cluster);
  }
  return [...clusters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([zone, cluster], index): MapPoi => ({
        id: `shop-${zone}`,
        kind: 'shop',
        name: `游商集市 ${index + 1}`,
        position: {
          x: Math.round(cluster.x / cluster.count),
          z: Math.round(cluster.z / cluster.count),
        },
      }),
    );
}
