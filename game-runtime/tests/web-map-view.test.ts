import { describe, expect, it } from 'vitest';
import {
  clampDiscreteZoom,
  createMapProjection,
  MAP_BOUNDS_MM,
  MAP_POIS,
  mapBoundsCenter,
  mapBoundsFromRing,
  mapPointInsideBoundary,
  nearestMapPoi,
  panMapCenter,
  projectMapPoint,
  stepDiscreteZoom,
  unprojectMapPoint,
  WORLD_MAP_ZOOM_LEVELS,
} from '../apps/web/src/render/map/map-view';

describe('web map view', () => {
  it('derives bounds and center from an authored ring', () => {
    const bounds = mapBoundsFromRing([
      { x: -40, z: 10 },
      { x: 25, z: -30 },
      { x: 80, z: 45 },
    ]);

    expect(bounds).toEqual({ minX: -40, maxX: 80, minZ: -30, maxZ: 45 });
    expect(mapBoundsCenter(bounds)).toEqual({ x: 20, z: 7.5 });
  });

  it('round-trips world coordinates through the canvas projection', () => {
    const projection = createMapProjection({
      width: 1_024,
      height: 704,
      center: mapBoundsCenter(),
      zoom: 2.25,
    });
    const source = MAP_POIS[0]?.position ?? mapBoundsCenter();
    const pixel = projectMapPoint(projection, source);

    expect(unprojectMapPoint(projection, pixel)).toEqual(source);
  });

  it('snaps and steps only within the supported zoom levels', () => {
    expect(clampDiscreteZoom(2.1, WORLD_MAP_ZOOM_LEVELS)).toBe(2.25);
    expect(clampDiscreteZoom(Number.NaN, WORLD_MAP_ZOOM_LEVELS)).toBe(1);
    expect(stepDiscreteZoom(1, -1, WORLD_MAP_ZOOM_LEVELS)).toBe(1);
    expect(stepDiscreteZoom(1, 1, WORLD_MAP_ZOOM_LEVELS)).toBe(1.5);
    expect(stepDiscreteZoom(4.5, 1, WORLD_MAP_ZOOM_LEVELS)).toBe(4.5);
  });

  it('converts pointer dragging into a clamped map-center pan', () => {
    const projection = createMapProjection({
      width: 1_024,
      height: 704,
      center: mapBoundsCenter(),
      zoom: 3.25,
    });
    const panned = panMapCenter(projection, 96, -64);
    const next = createMapProjection({
      width: projection.width,
      height: projection.height,
      center: panned,
      zoom: 3.25,
    });

    expect(panned.x).toBeLessThan(projection.center.x);
    expect(panned.z).toBeLessThan(projection.center.z);
    expect(next.visibleBounds.minX).toBeGreaterThanOrEqual(MAP_BOUNDS_MM.minX - 18_000);
    expect(next.visibleBounds.maxX).toBeLessThanOrEqual(MAP_BOUNDS_MM.maxX + 18_000);
    expect(next.visibleBounds.minZ).toBeGreaterThanOrEqual(MAP_BOUNDS_MM.minZ - 18_000);
    expect(next.visibleBounds.maxZ).toBeLessThanOrEqual(MAP_BOUNDS_MM.maxZ + 18_000);
  });

  it('hits a rendered POI and rejects clicks outside the authored boundary', () => {
    const poi = MAP_POIS[0];
    expect(poi).toBeDefined();
    if (!poi) {
      return;
    }
    const projection = createMapProjection({
      width: 1_024,
      height: 704,
      center: mapBoundsCenter(),
      zoom: 1,
    });
    const pixel = projectMapPoint(projection, poi.position);

    expect(nearestMapPoi(projection, pixel, 18)?.id).toBe(poi.id);
    expect(mapPointInsideBoundary(poi.position)).toBe(true);
    expect(mapPointInsideBoundary(unprojectMapPoint(projection, { x: 0, y: 0 }))).toBe(false);
  });
});
