import {
  MAP_BOUNDARY,
  MAP_COURTS,
  MAP_HIGHLANDS,
  MAP_ROUTE_EDGES,
  MAP_ROUTE_NODES,
  MAP_WALL_PIECES,
  type MapPointMm,
} from '@jwgb/content';
import type { EntityId } from '@jwgb/core';
import type { PlayerSnapshot, WorldSnapshot } from '@jwgb/sim';
import { createElement, LocateFixed, Minus, Navigation, Plus, X } from 'lucide';
import { regionAt, regionBlendAt, regionStyles } from './map-regions';
import {
  clampDiscreteZoom,
  createMapProjection,
  MAP_BOUNDS_MM,
  MAP_POIS,
  type MapCenterMm,
  type MapPoi,
  type MapProjection,
  MINIMAP_BASE_SPAN_MM,
  MINIMAP_ZOOM_LEVELS,
  mapBoundsCenter,
  mapPointInsideBoundary,
  nearestMapPoi,
  panMapCenter,
  projectMapPoint,
  stepDiscreteZoom,
  unprojectMapPoint,
  WORLD_MAP_ZOOM_LEVELS,
} from './map-view';

const MINIMAP_SIZE = 188;
const WORLD_MAP_WIDTH = 1_024;
const WORLD_MAP_HEIGHT = 704;
const ATLAS_WIDTH = 1_280;
const ATLAS_HEIGHT = 1_024;
const MINIMAP_ZOOM_STORAGE_KEY = 'jwgb.minimapZoom';
const POI_HIT_RADIUS_PX = 18;
const MAP_DRAG_THRESHOLD_PX = 5;

const ROAD_NODES = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node.position]));

export interface MinimapOverlayOptions {
  readonly onOpenChange?: (open: boolean) => void;
  readonly onWaypointChange?: (point: MapPointMm | null) => void;
}

export interface MinimapDiagnostics {
  readonly open: boolean;
  readonly minimapZoom: number;
  readonly worldMapZoom: number;
  readonly worldMapCenter: MapCenterMm;
  readonly waypoint: MapPointMm | null;
  readonly waypointLabel: string | null;
  readonly region: string | null;
}

interface PointerDrag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly projection: MapProjection;
  moved: boolean;
}

interface MapAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly projection: MapProjection;
}

export class MinimapOverlay {
  private readonly root: HTMLElement;
  private readonly minimapCanvas: HTMLCanvasElement;
  private readonly minimapContext: CanvasRenderingContext2D;
  private readonly regionLabel: HTMLElement;
  private readonly zoomInButton: HTMLButtonElement;
  private readonly zoomOutButton: HTMLButtonElement;
  private readonly worldMapOverlay: HTMLElement;
  private readonly worldMapCanvas: HTMLCanvasElement;
  private readonly worldMapContext: CanvasRenderingContext2D;
  private readonly worldMapRegion: HTMLElement;
  private readonly waypointReadout: HTMLElement;
  private readonly clearWaypointButton: HTMLButtonElement;
  private readonly atlas: MapAtlas;
  private readonly options: MinimapOverlayOptions;
  private minimapZoom: number;
  private worldMapZoom: number = WORLD_MAP_ZOOM_LEVELS[0];
  private worldMapCenter: MapCenterMm = mapBoundsCenter();
  private openState = false;
  private snapshot: WorldSnapshot | null = null;
  private localEntityId: EntityId | null = null;
  private waypoint: MapPointMm | null = null;
  private waypointLabel: string | null = null;
  private currentRegion: string | null = null;
  private drag: PointerDrag | null = null;

  constructor(container: HTMLElement, options: MinimapOverlayOptions = {}) {
    this.options = options;
    this.minimapZoom = loadMinimapZoom();
    this.atlas = renderMapAtlas();

    this.root = document.createElement('div');
    this.root.className = 'minimap-overlay';
    this.root.innerHTML = `
      <div class="minimap-disc">
        <button class="minimap-open-button" type="button" aria-label="打开百眼迷城地图" title="打开地图">
          <canvas class="minimap-canvas" width="${MINIMAP_SIZE}" height="${MINIMAP_SIZE}"></canvas>
        </button>
        <span class="minimap-north" aria-hidden="true">北</span>
        <div class="minimap-zoom">
          <button class="minimap-control minimap-zoom-out" type="button" aria-label="缩小小地图" title="缩小"></button>
          <button class="minimap-control minimap-zoom-in" type="button" aria-label="放大小地图" title="放大"></button>
        </div>
      </div>
      <div class="minimap-region-label"></div>
    `;
    this.minimapCanvas = requiredElement(this.root, '.minimap-canvas');
    this.minimapContext = requiredContext(this.minimapCanvas, 'minimap');
    this.regionLabel = requiredElement(this.root, '.minimap-region-label');
    this.zoomInButton = requiredElement(this.root, '.minimap-zoom-in');
    this.zoomOutButton = requiredElement(this.root, '.minimap-zoom-out');
    this.zoomInButton.append(createElement(Plus, { width: 15, height: 15 }));
    this.zoomOutButton.append(createElement(Minus, { width: 15, height: 15 }));
    requiredElement<HTMLButtonElement>(this.root, '.minimap-open-button').addEventListener(
      'click',
      this.open,
    );
    this.zoomInButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setMinimapZoom(stepDiscreteZoom(this.minimapZoom, 1, MINIMAP_ZOOM_LEVELS));
    });
    this.zoomOutButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setMinimapZoom(stepDiscreteZoom(this.minimapZoom, -1, MINIMAP_ZOOM_LEVELS));
    });
    this.minimapCanvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setMinimapZoom(
          stepDiscreteZoom(this.minimapZoom, event.deltaY < 0 ? 1 : -1, MINIMAP_ZOOM_LEVELS),
        );
      },
      { passive: false },
    );

    this.worldMapOverlay = document.createElement('div');
    this.worldMapOverlay.className = 'world-map-overlay';
    this.worldMapOverlay.hidden = true;
    this.worldMapOverlay.innerHTML = `
      <section class="world-map-panel" role="dialog" aria-modal="true" aria-label="百眼迷城地图">
        <header class="world-map-header">
          <div class="world-map-title">
            <strong>百眼迷城</strong>
            <span class="world-map-region"></span>
          </div>
          <div class="world-map-tools">
            <button class="world-map-tool world-map-center" type="button" aria-label="回到角色位置" title="回到角色位置"></button>
            <button class="world-map-tool world-map-zoom-out" type="button" aria-label="缩小地图" title="缩小"></button>
            <button class="world-map-tool world-map-zoom-in" type="button" aria-label="放大地图" title="放大"></button>
            <button class="world-map-tool world-map-clear" type="button" aria-label="清除导航点" title="清除导航点"></button>
            <button class="world-map-tool world-map-close" type="button" aria-label="关闭地图" title="关闭地图"></button>
          </div>
        </header>
        <div class="world-map-stage">
          <canvas class="world-map-canvas" width="${WORLD_MAP_WIDTH}" height="${WORLD_MAP_HEIGHT}"></canvas>
          <div class="world-map-legend" aria-label="地图图例">
            <span data-kind="court">三庭</span>
            <span data-kind="shop">集市</span>
            <span data-kind="pig">猪巢</span>
            <span data-kind="dragon">龙宫</span>
            <span data-kind="elite">精英</span>
          </div>
          <div class="world-map-waypoint" hidden>
            <span class="world-map-waypoint-icon"></span>
            <span class="world-map-waypoint-text"></span>
          </div>
        </div>
      </section>
    `;
    this.worldMapCanvas = requiredElement(this.worldMapOverlay, '.world-map-canvas');
    this.worldMapContext = requiredContext(this.worldMapCanvas, 'world map');
    this.worldMapRegion = requiredElement(this.worldMapOverlay, '.world-map-region');
    this.waypointReadout = requiredElement(this.worldMapOverlay, '.world-map-waypoint');
    this.clearWaypointButton = requiredElement(this.worldMapOverlay, '.world-map-clear');

    requiredElement(this.worldMapOverlay, '.world-map-center').append(
      createElement(LocateFixed, { width: 18, height: 18 }),
    );
    requiredElement(this.worldMapOverlay, '.world-map-zoom-out').append(
      createElement(Minus, { width: 18, height: 18 }),
    );
    requiredElement(this.worldMapOverlay, '.world-map-zoom-in').append(
      createElement(Plus, { width: 18, height: 18 }),
    );
    this.clearWaypointButton.append(createElement(Navigation, { width: 18, height: 18 }));
    requiredElement(this.worldMapOverlay, '.world-map-close').append(
      createElement(X, { width: 19, height: 19 }),
    );
    requiredElement(this.worldMapOverlay, '.world-map-waypoint-icon').append(
      createElement(Navigation, { width: 15, height: 15 }),
    );

    requiredElement(this.worldMapOverlay, '.world-map-close').addEventListener('click', this.close);
    requiredElement(this.worldMapOverlay, '.world-map-center').addEventListener(
      'click',
      this.centerWorldMapOnPlayer,
    );
    requiredElement(this.worldMapOverlay, '.world-map-zoom-in').addEventListener('click', () => {
      this.setWorldMapZoom(stepDiscreteZoom(this.worldMapZoom, 1, WORLD_MAP_ZOOM_LEVELS));
    });
    requiredElement(this.worldMapOverlay, '.world-map-zoom-out').addEventListener('click', () => {
      this.setWorldMapZoom(stepDiscreteZoom(this.worldMapZoom, -1, WORLD_MAP_ZOOM_LEVELS));
    });
    this.clearWaypointButton.addEventListener('click', this.clearWaypoint);
    this.worldMapOverlay.addEventListener('pointerdown', (event) => {
      if (event.target === this.worldMapOverlay) {
        this.close();
      }
    });
    this.worldMapCanvas.addEventListener('pointerdown', this.handleMapPointerDown);
    this.worldMapCanvas.addEventListener('pointermove', this.handleMapPointerMove);
    this.worldMapCanvas.addEventListener('pointerup', this.handleMapPointerUp);
    this.worldMapCanvas.addEventListener('pointercancel', this.handleMapPointerCancel);
    this.worldMapCanvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const before = this.currentWorldMapProjection();
        const cursor = canvasPoint(this.worldMapCanvas, event.clientX, event.clientY);
        const anchorBefore = unprojectMapPoint(before, cursor);
        const nextZoom = stepDiscreteZoom(
          this.worldMapZoom,
          event.deltaY < 0 ? 1 : -1,
          WORLD_MAP_ZOOM_LEVELS,
        );
        if (nextZoom === this.worldMapZoom) {
          return;
        }
        this.worldMapZoom = nextZoom;
        const after = this.currentWorldMapProjection();
        const anchorAfter = unprojectMapPoint(after, cursor);
        this.worldMapCenter = {
          x: this.worldMapCenter.x + anchorBefore.x - anchorAfter.x,
          z: this.worldMapCenter.z + anchorBefore.z - anchorAfter.z,
        };
        this.drawWorldMap();
      },
      { passive: false },
    );

    container.append(this.root, this.worldMapOverlay);
    this.syncZoomControls();
    this.syncWaypointUi();
  }

  update(snapshot: WorldSnapshot, localEntityId: EntityId | null): void {
    this.snapshot = snapshot;
    this.localEntityId = localEntityId;
    const local = this.localPlayer();
    this.currentRegion = local
      ? regionAt(local.position.x / 1_000, local.position.z / 1_000).name
      : null;
    this.regionLabel.textContent = this.currentRegion ?? '百眼迷城';
    this.worldMapRegion.textContent = this.currentRegion
      ? `当前位置 · ${this.currentRegion}`
      : '全域态势';
    this.drawMinimap();
    if (this.openState) {
      this.drawWorldMap();
    }
  }

  getDiagnostics(): MinimapDiagnostics {
    return {
      open: this.openState,
      minimapZoom: this.minimapZoom,
      worldMapZoom: this.worldMapZoom,
      worldMapCenter: { ...this.worldMapCenter },
      waypoint: this.waypoint,
      waypointLabel: this.waypointLabel,
      region: this.currentRegion,
    };
  }

  isOpen(): boolean {
    return this.openState;
  }

  readonly open = (): void => {
    if (this.openState) {
      return;
    }
    this.openState = true;
    this.worldMapZoom = WORLD_MAP_ZOOM_LEVELS[0];
    this.worldMapCenter = mapBoundsCenter();
    this.worldMapOverlay.hidden = false;
    this.worldMapOverlay.classList.add('is-open');
    this.options.onOpenChange?.(true);
    this.drawWorldMap();
    requiredElement<HTMLButtonElement>(this.worldMapOverlay, '.world-map-close').focus({
      preventScroll: true,
    });
  };

  readonly close = (): void => {
    if (!this.openState) {
      return;
    }
    this.openState = false;
    this.drag = null;
    this.worldMapOverlay.hidden = true;
    this.worldMapOverlay.classList.remove('is-open');
    this.options.onOpenChange?.(false);
  };

  toggle(): void {
    if (this.openState) {
      this.close();
    } else {
      this.open();
    }
  }

  dispose(): void {
    this.root.remove();
    this.worldMapOverlay.remove();
  }

  private readonly centerWorldMapOnPlayer = (): void => {
    const local = this.localPlayer();
    if (!local) {
      return;
    }
    this.worldMapCenter = { x: local.position.x, z: local.position.z };
    this.drawWorldMap();
  };

  private readonly clearWaypoint = (): void => {
    this.waypoint = null;
    this.waypointLabel = null;
    this.options.onWaypointChange?.(null);
    this.syncWaypointUi();
    this.drawMinimap();
    this.drawWorldMap();
  };

  private setMinimapZoom(zoom: number): void {
    this.minimapZoom = clampDiscreteZoom(zoom, MINIMAP_ZOOM_LEVELS);
    try {
      window.localStorage.setItem(MINIMAP_ZOOM_STORAGE_KEY, String(this.minimapZoom));
    } catch {
      // Storage can be disabled; zoom still works for the current session.
    }
    this.syncZoomControls();
    this.drawMinimap();
  }

  private setWorldMapZoom(zoom: number): void {
    this.worldMapZoom = clampDiscreteZoom(zoom, WORLD_MAP_ZOOM_LEVELS);
    this.drawWorldMap();
  }

  private syncZoomControls(): void {
    this.zoomOutButton.disabled = this.minimapZoom === MINIMAP_ZOOM_LEVELS[0];
    this.zoomInButton.disabled =
      this.minimapZoom === MINIMAP_ZOOM_LEVELS[MINIMAP_ZOOM_LEVELS.length - 1];
    const label = `${this.minimapZoom.toFixed(this.minimapZoom % 1 === 0 ? 0 : 1)}×`;
    this.root.style.setProperty('--minimap-zoom-label', `"${label}"`);
  }

  private syncWaypointUi(): void {
    this.clearWaypointButton.disabled = this.waypoint === null;
    this.waypointReadout.hidden = this.waypoint === null;
    const text = this.waypointReadout.querySelector<HTMLElement>('.world-map-waypoint-text');
    if (text) {
      text.textContent = this.waypointLabel ?? '';
    }
  }

  private localPlayer(): PlayerSnapshot | null {
    return this.snapshot?.players.find((player) => player.entityId === this.localEntityId) ?? null;
  }

  private drawMinimap(): void {
    const snapshot = this.snapshot;
    const local = this.localPlayer();
    if (!snapshot || !local) {
      return;
    }
    const projection = createMapProjection({
      width: MINIMAP_SIZE,
      height: MINIMAP_SIZE,
      center: local.position,
      zoom: this.minimapZoom,
      baseSpanMm: MINIMAP_BASE_SPAN_MM,
    });
    const context = this.minimapContext;
    context.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    context.save();
    context.beginPath();
    context.arc(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, MINIMAP_SIZE / 2 - 2, 0, Math.PI * 2);
    context.clip();
    drawAtlasViewport(context, this.atlas, projection);
    drawStorm(context, projection, snapshot);
    drawPoiMarkers(context, projection, false);
    drawSnapshotMarkers(context, projection, snapshot, this.localEntityId, false);
    drawWaypoint(context, projection, this.waypoint, local.position);
    drawPlayerArrow(context, projection, local);
    context.restore();

    context.beginPath();
    context.arc(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, MINIMAP_SIZE / 2 - 2.5, 0, Math.PI * 2);
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(228, 197, 117, 0.74)';
    context.stroke();
  }

  private drawWorldMap(): void {
    if (!this.openState) {
      return;
    }
    const snapshot = this.snapshot;
    const context = this.worldMapContext;
    const projection = this.currentWorldMapProjection();
    this.worldMapCenter = projection.center;

    context.clearRect(0, 0, WORLD_MAP_WIDTH, WORLD_MAP_HEIGHT);
    drawAtlasViewport(context, this.atlas, projection);
    drawRegionLabels(context, projection);
    if (snapshot) {
      drawStorm(context, projection, snapshot);
      drawSnapshotMarkers(context, projection, snapshot, this.localEntityId, true);
    }
    drawPoiMarkers(context, projection, true);
    const local = this.localPlayer();
    if (local) {
      drawWaypoint(context, projection, this.waypoint, local.position);
      drawPlayerArrow(context, projection, local);
    }
    context.strokeStyle = 'rgba(231, 207, 147, 0.24)';
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, WORLD_MAP_WIDTH - 1, WORLD_MAP_HEIGHT - 1);

    const zoomIn = requiredElement<HTMLButtonElement>(this.worldMapOverlay, '.world-map-zoom-in');
    const zoomOut = requiredElement<HTMLButtonElement>(this.worldMapOverlay, '.world-map-zoom-out');
    zoomOut.disabled = this.worldMapZoom === WORLD_MAP_ZOOM_LEVELS[0];
    zoomIn.disabled = this.worldMapZoom === WORLD_MAP_ZOOM_LEVELS[WORLD_MAP_ZOOM_LEVELS.length - 1];
  }

  private currentWorldMapProjection(): MapProjection {
    return createMapProjection({
      width: WORLD_MAP_WIDTH,
      height: WORLD_MAP_HEIGHT,
      center: this.worldMapCenter,
      zoom: this.worldMapZoom,
    });
  }

  private readonly handleMapPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag !== null) {
      return;
    }
    event.preventDefault();
    tryCapturePointer(this.worldMapCanvas, event.pointerId);
    const point = canvasPoint(this.worldMapCanvas, event.clientX, event.clientY);
    this.drag = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      projection: this.currentWorldMapProjection(),
      moved: false,
    };
    this.worldMapCanvas.classList.add('is-dragging');
  };

  private readonly handleMapPointerMove = (event: PointerEvent): void => {
    if (!this.drag || this.drag.pointerId !== event.pointerId) {
      return;
    }
    const point = canvasPoint(this.worldMapCanvas, event.clientX, event.clientY);
    const deltaX = point.x - this.drag.startX;
    const deltaY = point.y - this.drag.startY;
    if (Math.hypot(deltaX, deltaY) >= MAP_DRAG_THRESHOLD_PX) {
      this.drag.moved = true;
    }
    if (!this.drag.moved || this.worldMapZoom <= WORLD_MAP_ZOOM_LEVELS[0]) {
      return;
    }
    this.worldMapCenter = panMapCenter(this.drag.projection, deltaX, deltaY);
    this.drawWorldMap();
  };

  private readonly handleMapPointerUp = (event: PointerEvent): void => {
    if (!this.drag || this.drag.pointerId !== event.pointerId) {
      return;
    }
    const drag = this.drag;
    this.drag = null;
    this.worldMapCanvas.classList.remove('is-dragging');
    if (!drag.moved) {
      const point = canvasPoint(this.worldMapCanvas, event.clientX, event.clientY);
      this.setWaypointFromCanvas(point);
    }
  };

  private readonly handleMapPointerCancel = (event: PointerEvent): void => {
    if (this.drag?.pointerId === event.pointerId) {
      this.drag = null;
      this.worldMapCanvas.classList.remove('is-dragging');
    }
  };

  private setWaypointFromCanvas(pixel: { readonly x: number; readonly y: number }): void {
    const projection = this.currentWorldMapProjection();
    const poi = nearestMapPoi(projection, pixel, POI_HIT_RADIUS_PX);
    const point = poi?.position ?? unprojectMapPoint(projection, pixel);
    if (!mapPointInsideBoundary(point)) {
      return;
    }
    this.waypoint = { x: point.x, z: point.z };
    this.waypointLabel =
      poi?.name ?? `导航点 ${formatCoordinate(point.x)}, ${formatCoordinate(point.z)}`;
    this.options.onWaypointChange?.(this.waypoint);
    this.syncWaypointUi();
    this.drawMinimap();
    this.drawWorldMap();
  }
}

function renderMapAtlas(): MapAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH;
  canvas.height = ATLAS_HEIGHT;
  const context = requiredContext(canvas, 'map atlas');
  const projection = createMapProjection({
    width: ATLAS_WIDTH,
    height: ATLAS_HEIGHT,
    center: mapBoundsCenter(),
    zoom: 1,
  });

  context.fillStyle = '#101713';
  context.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
  context.save();
  traceRing(context, projection, MAP_BOUNDARY);
  context.clip();
  context.drawImage(renderRegionWash(projection), 0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
  drawContourLines(context, projection);
  drawRoadNetwork(context, projection);

  for (const highland of MAP_HIGHLANDS) {
    traceRing(context, projection, highland.vertices);
    context.fillStyle = 'rgba(87, 105, 82, 0.82)';
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = 'rgba(180, 192, 159, 0.35)';
    context.stroke();
  }

  for (const piece of MAP_WALL_PIECES) {
    traceRing(context, projection, piece.vertices);
    context.fillStyle =
      piece.wallClass === 'BOUND' ? 'rgba(56, 55, 50, 0.96)' : 'rgba(91, 82, 67, 0.94)';
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(210, 194, 158, 0.28)';
    context.stroke();
  }

  for (const court of MAP_COURTS) {
    traceRing(context, projection, court.hexVertices);
    context.fillStyle = 'rgba(117, 91, 43, 0.42)';
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(218, 178, 75, 0.92)';
    context.stroke();
  }
  context.restore();

  traceRing(context, projection, MAP_BOUNDARY);
  context.lineWidth = 4;
  context.strokeStyle = 'rgba(202, 190, 155, 0.66)';
  context.stroke();
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(245, 228, 184, 0.42)';
  context.stroke();
  return { canvas, projection };
}

function renderRegionWash(projection: MapProjection): HTMLCanvasElement {
  const width = 320;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = requiredContext(canvas, 'region wash');
  const image = context.createImageData(width, height);
  const sampleProjection = createMapProjection({
    width,
    height,
    center: projection.center,
    zoom: 1,
  });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = unprojectMapPoint(sampleProjection, { x: x + 0.5, y: y + 0.5 });
      const blend = regionBlendAt(point.x / 1_000, point.z / 1_000);
      const primary = hexChannels(blend.primary.ground);
      const secondary = hexChannels(blend.secondary.ground);
      const mottle =
        0.88 +
        Math.sin(point.x * 0.000071 + point.z * 0.000043) * 0.04 +
        Math.sin(point.x * 0.00019 - point.z * 0.00013) * 0.025;
      const offset = (y * width + x) * 4;
      image.data[offset] = lerp(primary.r, secondary.r, blend.mix) * mottle;
      image.data[offset + 1] = lerp(primary.g, secondary.g, blend.mix) * mottle;
      image.data[offset + 2] = lerp(primary.b, secondary.b, blend.mix) * mottle;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function drawContourLines(context: CanvasRenderingContext2D, projection: MapProjection): void {
  context.save();
  context.globalAlpha = 0.12;
  context.strokeStyle = '#d9cfb4';
  context.lineWidth = 1;
  const spacingMm = 48_000;
  for (
    let x = Math.ceil(MAP_BOUNDS_MM.minX / spacingMm) * spacingMm;
    x <= MAP_BOUNDS_MM.maxX;
    x += spacingMm
  ) {
    const top = projectMapPoint(projection, { x, z: MAP_BOUNDS_MM.maxZ });
    const bottom = projectMapPoint(projection, { x, z: MAP_BOUNDS_MM.minZ });
    context.beginPath();
    context.moveTo(top.x, top.y);
    context.lineTo(bottom.x, bottom.y);
    context.stroke();
  }
  for (
    let z = Math.ceil(MAP_BOUNDS_MM.minZ / spacingMm) * spacingMm;
    z <= MAP_BOUNDS_MM.maxZ;
    z += spacingMm
  ) {
    const left = projectMapPoint(projection, { x: MAP_BOUNDS_MM.minX, z });
    const right = projectMapPoint(projection, { x: MAP_BOUNDS_MM.maxX, z });
    context.beginPath();
    context.moveTo(left.x, left.y);
    context.lineTo(right.x, right.y);
    context.stroke();
  }
  context.restore();
}

function drawRoadNetwork(context: CanvasRenderingContext2D, projection: MapProjection): void {
  const drawPass = (shoulder: boolean): void => {
    for (const edge of MAP_ROUTE_EDGES) {
      const a = ROAD_NODES.get(edge.a);
      const b = ROAD_NODES.get(edge.b);
      if (!a || !b) {
        continue;
      }
      const projectedA = projectMapPoint(projection, a);
      const projectedB = projectMapPoint(projection, b);
      context.beginPath();
      context.moveTo(projectedA.x, projectedA.y);
      context.lineTo(projectedB.x, projectedB.y);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = Math.max(
        shoulder ? 2.2 : 1,
        edge.widthMm * projection.scale + (shoulder ? 2.4 : 0),
      );
      context.strokeStyle = shoulder ? 'rgba(40, 39, 32, 0.48)' : roadColour(edge.roadClass);
      context.stroke();
    }
  };
  drawPass(true);
  drawPass(false);
}

function drawAtlasViewport(
  context: CanvasRenderingContext2D,
  atlas: MapAtlas,
  projection: MapProjection,
): void {
  const sourceTopLeft = projectMapPoint(atlas.projection, {
    x: projection.visibleBounds.minX,
    z: projection.visibleBounds.maxZ,
  });
  const sourceBottomRight = projectMapPoint(atlas.projection, {
    x: projection.visibleBounds.maxX,
    z: projection.visibleBounds.minZ,
  });
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    atlas.canvas,
    sourceTopLeft.x,
    sourceTopLeft.y,
    sourceBottomRight.x - sourceTopLeft.x,
    sourceBottomRight.y - sourceTopLeft.y,
    0,
    0,
    projection.width,
    projection.height,
  );
  context.restore();
}

function drawRegionLabels(context: CanvasRenderingContext2D, projection: MapProjection): void {
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const region of regionStyles()) {
    const point = projectMapPoint(projection, {
      x: region.anchor.x * 1_000,
      z: region.anchor.z * 1_000,
    });
    if (!pointVisible(projection, point, 50)) {
      continue;
    }
    const fontSize = projection.scale * 100_000 > 30 ? 22 : 17;
    context.font = `800 ${fontSize}px "STKaiti", "KaiTi", "Microsoft YaHei", sans-serif`;
    context.lineWidth = 4;
    context.strokeStyle = 'rgba(12, 16, 13, 0.72)';
    context.strokeText(region.name, point.x, point.y);
    context.fillStyle = colourCss(region.accent, 0.98);
    context.fillText(region.name, point.x, point.y);
  }
  context.restore();
}

function drawPoiMarkers(
  context: CanvasRenderingContext2D,
  projection: MapProjection,
  fullMap: boolean,
): void {
  context.save();
  for (const poi of MAP_POIS) {
    const point = projectMapPoint(projection, poi.position);
    if (!pointVisible(projection, point, 24)) {
      continue;
    }
    drawPoiGlyph(context, point.x, point.y, poi, fullMap ? 1 : 0.72);
    const showLabel =
      fullMap &&
      (poi.kind === 'court' ||
        poi.kind === 'dragon' ||
        poi.kind === 'elite' ||
        projection.scale * 100_000 >= 31);
    if (showLabel) {
      context.textAlign = 'center';
      context.textBaseline = 'top';
      context.font = '700 12px "Microsoft YaHei", sans-serif';
      context.lineWidth = 3;
      context.strokeStyle = 'rgba(12, 16, 13, 0.82)';
      context.strokeText(poi.name, point.x, point.y + 9);
      context.fillStyle = '#f1ead7';
      context.fillText(poi.name, point.x, point.y + 9);
    }
  }
  context.restore();
}

function drawPoiGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  poi: MapPoi,
  scale: number,
): void {
  const radius = 5.5 * scale;
  context.save();
  context.translate(x, y);
  context.lineWidth = Math.max(1, 1.7 * scale);
  context.strokeStyle = poiColour(poi.kind);
  context.fillStyle = 'rgba(13, 18, 15, 0.86)';
  context.beginPath();
  switch (poi.kind) {
    case 'court':
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      break;
    case 'shop':
      context.rotate(Math.PI / 4);
      context.rect(-radius * 0.72, -radius * 0.72, radius * 1.44, radius * 1.44);
      break;
    case 'pig':
      context.arc(0, 0, radius * 0.82, 0, Math.PI * 2);
      break;
    case 'dragon':
      context.arc(0, 0, radius, 0, Math.PI * 2);
      break;
    case 'elite':
      context.moveTo(0, -radius);
      context.lineTo(radius * 0.9, radius * 0.75);
      context.lineTo(-radius * 0.9, radius * 0.75);
      context.closePath();
      break;
  }
  context.fill();
  context.stroke();
  context.restore();
}

function drawSnapshotMarkers(
  context: CanvasRenderingContext2D,
  projection: MapProjection,
  snapshot: WorldSnapshot,
  localEntityId: EntityId | null,
  fullMap: boolean,
): void {
  for (const shop of snapshot.shops) {
    const point = projectMapPoint(projection, shop.position);
    if (!pointVisible(projection, point, 8)) continue;
    context.beginPath();
    context.arc(point.x, point.y, fullMap ? 3.8 : 2.5, 0, Math.PI * 2);
    context.fillStyle = shop.status === 'open' ? '#e3ba55' : '#8d8164';
    context.fill();
  }

  if (fullMap) {
    for (const monster of snapshot.monsters) {
      if (
        monster.kind !== 'core-boss' &&
        monster.kind !== 'dragon-king' &&
        !monster.kind.startsWith('elite')
      ) {
        continue;
      }
      const point = projectMapPoint(projection, monster.position);
      if (!pointVisible(projection, point, 8)) continue;
      context.beginPath();
      context.arc(point.x, point.y, monster.kind === 'core-boss' ? 5 : 3.5, 0, Math.PI * 2);
      context.fillStyle = monster.kind === 'core-boss' ? '#d34f5b' : '#d98c5f';
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = '#28100f';
      context.stroke();
    }
  } else if (projection.scale * 100_000 >= 31) {
    for (const monster of snapshot.monsters) {
      const point = projectMapPoint(projection, monster.position);
      if (!pointVisible(projection, point, 5)) continue;
      context.fillStyle = monster.targetEntityId === localEntityId ? '#e75f54' : '#b69268';
      context.fillRect(point.x - 1.5, point.y - 1.5, 3, 3);
    }
  }

  for (const drop of snapshot.lootDrops) {
    const point = projectMapPoint(projection, drop.position);
    if (!pointVisible(projection, point, 6)) continue;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(Math.PI / 4);
    context.fillStyle = drop.gems > 0 ? '#63c4c7' : '#e0b44f';
    const size = fullMap ? 4 : 3;
    context.fillRect(-size / 2, -size / 2, size, size);
    context.restore();
  }

  for (const airdrop of snapshot.airdrops) {
    if (!airdrop.position || (airdrop.phase !== 'warning' && airdrop.phase !== 'available')) {
      continue;
    }
    const point = projectMapPoint(projection, airdrop.position);
    if (!pointVisible(projection, point, 10)) continue;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(Math.PI / 4);
    const size = fullMap ? 9 : 7;
    context.beginPath();
    context.rect(-size / 2, -size / 2, size, size);
    context.fillStyle = airdrop.phase === 'available' ? '#f2c956' : 'rgba(242, 201, 86, 0.18)';
    context.strokeStyle = '#f2c956';
    context.lineWidth = 1.5;
    context.fill();
    context.stroke();
    context.restore();
  }

  for (const player of snapshot.players) {
    if (player.lifeState === 'eliminated' || player.entityId === localEntityId) {
      continue;
    }
    const point = projectMapPoint(projection, player.position);
    if (!pointVisible(projection, point, 6)) continue;
    context.beginPath();
    context.arc(point.x, point.y, fullMap ? 3.2 : 2.4, 0, Math.PI * 2);
    context.fillStyle = '#d9e5da';
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = '#172018';
    context.stroke();
  }
}

function drawStorm(
  context: CanvasRenderingContext2D,
  projection: MapProjection,
  snapshot: WorldSnapshot,
): void {
  const storm = snapshot.stormZone;
  if (storm.radiusMm <= 0) {
    return;
  }
  const center = projectMapPoint(projection, storm.center);
  const radius = storm.radiusMm * projection.scale;
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.strokeStyle = storm.apocalypseStarted
    ? 'rgba(224, 68, 68, 0.94)'
    : 'rgba(219, 190, 102, 0.78)';
  context.stroke();
  context.restore();
}

function drawWaypoint(
  context: CanvasRenderingContext2D,
  projection: MapProjection,
  waypoint: MapPointMm | null,
  localPosition: MapPointMm,
): void {
  if (!waypoint) {
    return;
  }
  const target = projectMapPoint(projection, waypoint);
  const local = projectMapPoint(projection, localPosition);
  context.save();
  context.beginPath();
  context.moveTo(local.x, local.y);
  context.lineTo(target.x, target.y);
  context.setLineDash([5, 5]);
  context.lineWidth = 1.5;
  context.strokeStyle = 'rgba(246, 211, 92, 0.74)';
  context.stroke();
  context.setLineDash([]);
  context.translate(target.x, target.y);
  context.beginPath();
  context.moveTo(0, -9);
  context.lineTo(6, 5);
  context.lineTo(0, 2);
  context.lineTo(-6, 5);
  context.closePath();
  context.fillStyle = '#f4d35c';
  context.fill();
  context.lineWidth = 1.4;
  context.strokeStyle = '#251d06';
  context.stroke();
  context.restore();
}

function drawPlayerArrow(
  context: CanvasRenderingContext2D,
  projection: MapProjection,
  player: PlayerSnapshot,
): void {
  const point = projectMapPoint(projection, player.position);
  context.save();
  context.translate(point.x, point.y);
  context.rotate(Math.atan2(player.facing.x, player.facing.z));
  context.beginPath();
  context.moveTo(0, -8);
  context.lineTo(5.5, 5.5);
  context.lineTo(0, 3);
  context.lineTo(-5.5, 5.5);
  context.closePath();
  context.fillStyle = '#f8d45e';
  context.fill();
  context.lineWidth = 1.6;
  context.strokeStyle = '#211a06';
  context.stroke();
  context.restore();
}

function traceRing(
  context: CanvasRenderingContext2D,
  projection: MapProjection,
  ring: readonly MapPointMm[],
): void {
  context.beginPath();
  ring.forEach((point, index) => {
    const projected = projectMapPoint(projection, point);
    if (index === 0) context.moveTo(projected.x, projected.y);
    else context.lineTo(projected.x, projected.y);
  });
  context.closePath();
}

function pointVisible(
  projection: MapProjection,
  point: { readonly x: number; readonly y: number },
  margin: number,
): boolean {
  return (
    point.x >= -margin &&
    point.x <= projection.width + margin &&
    point.y >= -margin &&
    point.y <= projection.height + margin
  );
}

function canvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { readonly x: number; readonly y: number } {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((clientX - bounds.left) / Math.max(1, bounds.width)) * canvas.width,
    y: ((clientY - bounds.top) / Math.max(1, bounds.height)) * canvas.height,
  };
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing map element: ${selector}`);
  }
  return element;
}

function requiredContext(canvas: HTMLCanvasElement, label: string): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error(`${label} 2d context unavailable`);
  }
  return context;
}

function tryCapturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Synthetic pointer events may not own an OS pointer.
  }
}

function loadMinimapZoom(): number {
  try {
    return clampDiscreteZoom(
      Number(window.localStorage.getItem(MINIMAP_ZOOM_STORAGE_KEY)),
      MINIMAP_ZOOM_LEVELS,
    );
  } catch {
    return MINIMAP_ZOOM_LEVELS[0];
  }
}

function roadColour(roadClass: string): string {
  switch (roadClass) {
    case 'MAIN':
    case 'COURT':
    case 'ARENA':
      return 'rgba(211, 190, 143, 0.9)';
    case 'RISK':
    case 'DEN':
    case 'BREACH':
      return 'rgba(137, 105, 76, 0.82)';
    default:
      return 'rgba(174, 151, 112, 0.78)';
  }
}

function poiColour(kind: MapPoi['kind']): string {
  switch (kind) {
    case 'court':
      return '#d6ad49';
    case 'shop':
      return '#e1c071';
    case 'pig':
      return '#a9bd6a';
    case 'dragon':
      return '#57b9b2';
    case 'elite':
      return '#cf7659';
  }
}

function hexChannels(hex: number): { readonly r: number; readonly g: number; readonly b: number } {
  return {
    r: (hex >> 16) & 0xff,
    g: (hex >> 8) & 0xff,
    b: hex & 0xff,
  };
}

function colourCss(hex: number, alpha: number): string {
  const channels = hexChannels(hex);
  return `rgba(${channels.r}, ${channels.g}, ${channels.b}, ${alpha})`;
}

function lerp(left: number, right: number, mix: number): number {
  return left + (right - left) * mix;
}

function formatCoordinate(valueMm: number): string {
  return `${Math.round(valueMm / 1_000)}m`;
}
