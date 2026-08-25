import { HERO_IDS } from '@jwgb/content';
import {
  type EntityId,
  type HeroId,
  heroId,
  type PlayerId,
  playerId,
  TICK_DURATION_MS,
  vec2Mm,
} from '@jwgb/core';
import type { PlayerSnapshot, WorldSnapshot } from '@jwgb/sim';
import {
  cameraPanDirectionForCode,
  cameraRotationDirectionForCode,
  cameraViewForCode,
  cameraZoomDirectionForCode,
  isCameraResetCode,
  WEB_CONTROL_BINDINGS,
} from '../input/control-bindings';
import { InputController } from '../input/input-controller';
import { ArenaRenderer } from '../render/arena-renderer';
import { MinimapOverlay } from '../render/map/minimap';
import { ClientWorldHost } from '../runtime/client-world-host';
import { localWorldScenarioFromActive } from '../runtime/local-scenario';
import { LocalWorldHost } from '../runtime/local-world-host';
import { resolveOnlineServerUrl } from '../runtime/online-server-url';
import {
  clearOnlineSession,
  loadOnlineSession,
  saveOnlineSession,
} from '../runtime/online-session-store';
import { audioSceneForFrame, type WebAudioCue, WebAudioRuntime } from '../runtime/web-audio';
import { resolveWebRuntimeMode, type WebRuntimeMode } from '../runtime/web-runtime-mode';
import {
  loadWebGameSettings,
  saveWebGameSettings,
  type WebCameraViewMode,
  type WebGameSettings,
} from '../runtime/web-settings';
import type { HostFrame, WorldConnectionState, WorldHost } from '../runtime/world-host';
import { GameHud } from '../ui/game-hud';
import { GameMenu } from '../ui/game-menu';
import { resolveDebugSpawn } from './debug-spawn';

const TARGET_RENDER_INTERVAL_MS = 1_000 / 60;
const MAX_RENDER_SCHEDULE_DRIFT_MS = TARGET_RENDER_INTERVAL_MS * 4;
const HUD_UPDATE_INTERVAL_MS = 1_000 / 20;
const MINIMAP_UPDATE_INTERVAL_MS = 1_000 / 20;

type CameraPointerMode = 'orbit' | 'pan';

interface CameraPointerGesture {
  readonly pointerId: number;
  readonly button: number;
  readonly mode: CameraPointerMode;
  readonly startX: number;
  readonly startY: number;
  lastX: number;
  lastY: number;
  dragged: boolean;
}

export interface GameAppReadyState {
  readonly snapshot: WorldSnapshot;
  readonly localEntityId: EntityId;
  readonly player: PlayerSnapshot;
}

export interface GameAppOptions {
  readonly mode?: WebRuntimeMode;
  readonly heroId?: HeroId;
  readonly playerId?: PlayerId;
  readonly matchTicket?: string | null;
  readonly resumeSession?: boolean;
  readonly onReady?: (state: GameAppReadyState) => void;
  readonly onResult?: (state: GameAppReadyState) => void;
  readonly onRestartRequested?: () => void;
}

declare global {
  interface Window {
    __JWGB_DEBUG__?: {
      getSnapshot: () => WorldSnapshot | null;
      getLocalEntityId: () => WorldHost['localEntityId'];
      getConnectionState: () => WorldConnectionState;
      getRenderPixelDiagnostics: () => ReturnType<ArenaRenderer['getPixelDiagnostics']>;
      getRenderPerformanceDiagnostics: () => ReturnType<ArenaRenderer['getPerformanceDiagnostics']>;
      getRenderSceneContributorDiagnostics: () => ReturnType<
        ArenaRenderer['getSceneContributorDiagnostics']
      >;
      getRenderEntityDiagnostics: () => ReturnType<ArenaRenderer['getEntityDiagnostics']>;
      resetRenderPerformanceDiagnostics: () => void;
      getModelDiagnostics: () => ReturnType<ArenaRenderer['getModelDiagnostics']>;
      getOcclusionDiagnostics: () => ReturnType<ArenaRenderer['getOcclusionDiagnostics']>;
      getFloraModelDiagnostics: () => ReturnType<ArenaRenderer['getFloraModelDiagnostics']>;
      getMapAssetDiagnostics: () => ReturnType<ArenaRenderer['getMapAssetDiagnostics']>;
      getCameraDiagnostics: () => ReturnType<ArenaRenderer['getCameraDiagnostics']>;
      getCombatRangePreviewDiagnostics: () => ReturnType<
        ArenaRenderer['getCombatRangePreviewDiagnostics']
      >;
      getCombatEffectDiagnostics: () => ReturnType<ArenaRenderer['getCombatEffectDiagnostics']>;
      getInputDiagnostics: () => ReturnType<InputController['getDiagnostics']>;
      getMenuDiagnostics: () => ReturnType<GameMenu['getDiagnostics']>;
      getAudioDiagnostics: () => ReturnType<WebAudioRuntime['getDiagnostics']>;
      getMapDiagnostics: () => ReturnType<MinimapOverlay['getDiagnostics']> | null;
      openMenu: () => void;
      closeMenu: () => void;
      openMap: () => void;
      closeMap: () => void;
      setPaused: (paused: boolean) => void;
      stepTicks: (count?: number) => WorldSnapshot;
      restart: () => void;
      scenarioId: string;
    };
  }
}

export class GameApp {
  private readonly shell: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly input = new InputController();
  private readonly renderer: ArenaRenderer;
  private readonly hud: GameHud;
  private readonly menu: GameMenu;
  private readonly audio: WebAudioRuntime;
  private readonly host: WorldHost;
  private readonly scenarioId: string;
  private settings: WebGameSettings;
  private minimap: MinimapOverlay | null = null;
  private previousTime = performance.now();
  private nextRenderTime = this.previousTime;
  private nextHudUpdateTime = this.previousTime;
  private nextMinimapUpdateTime = this.previousTime;
  private animationFrame = 0;
  private paused = false;
  private cameraPointerGesture: CameraPointerGesture | null = null;
  private readyNotified = false;
  private resultNotified = false;
  private disposed = false;

  constructor(
    root: HTMLElement,
    private readonly options: GameAppOptions = {},
  ) {
    this.settings = loadWebGameSettings(window.localStorage);
    this.audio = new WebAudioRuntime();
    this.audio.setMix(this.settings);
    this.audio.setScene('lobby');
    const search = new URLSearchParams(window.location.search);
    const runtimeMode = options.mode ?? resolveWebRuntimeMode(search.get('mode'));
    const selectedHeroId = options.heroId ?? heroId(search.get('hero') ?? HERO_IDS.sunWukong);
    const online = runtimeMode === 'online';
    if (online) {
      const explicitServerUrl = search.get('server');
      const normalizedServerUrl = resolveOnlineServerUrl(window.location, explicitServerUrl);
      if (options.resumeSession === false) {
        clearOnlineSession(window.sessionStorage, normalizedServerUrl);
      }
      const storedSession =
        options.resumeSession === false
          ? null
          : loadOnlineSession(window.sessionStorage, normalizedServerUrl);
      const explicitPlayerId = search.get('player');
      const selectedPlayerId =
        options.playerId ??
        (explicitPlayerId
          ? playerId(explicitPlayerId)
          : (storedSession?.playerId ?? playerId(`web-${crypto.randomUUID()}`)));
      const initialRecoveryToken =
        options.matchTicket !== undefined
          ? null
          : storedSession && storedSession.playerId === selectedPlayerId
            ? storedSession.recoveryToken
            : null;
      saveOnlineSession(window.sessionStorage, normalizedServerUrl, {
        playerId: selectedPlayerId,
        recoveryToken: initialRecoveryToken,
      });
      this.host = new ClientWorldHost({
        url: normalizedServerUrl,
        playerId: selectedPlayerId,
        heroId: selectedHeroId,
        ...(options.matchTicket === undefined ? {} : { matchTicket: options.matchTicket }),
        initialRecoveryToken,
        onSessionUpdate: (session) => {
          if (session) {
            saveOnlineSession(window.sessionStorage, normalizedServerUrl, session);
          } else {
            clearOnlineSession(window.sessionStorage, normalizedServerUrl);
          }
        },
      });
      this.scenarioId = 'online';
    } else {
      const scenario = localWorldScenarioFromActive(search.get('active'));
      // Debug spawn override, meters: ?spawn=22,109 places the local player
      // at that map position instead of a random spawn point. The request is
      // snapped to standable ground first; see resolveDebugSpawn.
      const spawnParam = search.get('spawn');
      const spawnMatch = spawnParam?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
      this.host = new LocalWorldHost({
        ...scenario,
        localHeroId: selectedHeroId,
        ...(spawnMatch
          ? {
              localPosition: resolveDebugSpawn(
                vec2Mm(
                  Math.round(Number(spawnMatch[1]) * 1_000),
                  Math.round(Number(spawnMatch[2]) * 1_000),
                ),
              ),
            }
          : {}),
      });
      this.scenarioId = scenario.id;
    }
    root.innerHTML = `
      <div class="game-shell">
        <canvas class="game-canvas" aria-label="三命无常竞技场"></canvas>
        <div class="hud"></div>
        <div class="game-menu-host"></div>
      </div>
    `;
    this.shell = root.querySelector<HTMLElement>('.game-shell') ?? root;
    const canvas = root.querySelector<HTMLCanvasElement>('.game-canvas');
    const hudRoot = root.querySelector<HTMLElement>('.hud');
    const menuRoot = root.querySelector<HTMLElement>('.game-menu-host');
    if (!canvas || !hudRoot || !menuRoot) {
      throw new Error('game shell initialization failed');
    }
    this.canvas = canvas;

    this.renderer = new ArenaRenderer(canvas, this.shell, this.settings.graphicsPreference);
    this.renderer.setCameraView(this.settings.cameraView);
    this.renderer.setLocalEntity(this.host.localEntityId);
    const restartAvailable = online
      ? options.onRestartRequested !== undefined
      : this.host.canRestart;
    this.hud = new GameHud(
      hudRoot,
      this.input,
      this.restart,
      restartAvailable,
      this.host,
      this.cycleCameraView,
      (mode) => this.renderer.setCombatRangePreview(mode),
    );
    this.menu = new GameMenu(menuRoot, {
      initialSettings: this.settings,
      onSettingsChange: this.handleSettingsChange,
      onSound: this.handleMenuSound,
      onOpenChange: (open) => {
        if (open) {
          this.cancelCameraPointerGesture();
        }
        this.input.setEnabled(!open && !this.minimap?.isOpen());
      },
    });
    this.hud.setCameraViewState(this.renderer.getCameraViewState());
    this.hud.setConnectionState(this.host.mode === 'local' ? 'local' : 'connecting');
    this.bindDesktopInput();
    this.bindAudioUnlock();
    window.addEventListener('keydown', this.handleGlobalKeyDown);
    window.__JWGB_DEBUG__ = {
      getSnapshot: () => this.host.getSnapshot(),
      getLocalEntityId: () => this.host.localEntityId,
      getConnectionState: (): WorldConnectionState =>
        this.host.mode === 'local' ? 'local' : (this.host as ClientWorldHost).connectionState,
      getRenderPixelDiagnostics: () => this.renderer.getPixelDiagnostics(),
      getRenderPerformanceDiagnostics: () => this.renderer.getPerformanceDiagnostics(),
      getRenderSceneContributorDiagnostics: () => this.renderer.getSceneContributorDiagnostics(),
      getRenderEntityDiagnostics: () => this.renderer.getEntityDiagnostics(),
      resetRenderPerformanceDiagnostics: () => this.renderer.resetPerformanceDiagnostics(),
      getModelDiagnostics: () => this.renderer.getModelDiagnostics(),
      getOcclusionDiagnostics: () => this.renderer.getOcclusionDiagnostics(),
      getFloraModelDiagnostics: () => this.renderer.getFloraModelDiagnostics(),
      getMapAssetDiagnostics: () => this.renderer.getMapAssetDiagnostics(),
      getCameraDiagnostics: () => this.renderer.getCameraDiagnostics(),
      getCombatRangePreviewDiagnostics: () => this.renderer.getCombatRangePreviewDiagnostics(),
      getCombatEffectDiagnostics: () => this.renderer.getCombatEffectDiagnostics(),
      getInputDiagnostics: () => this.input.getDiagnostics(),
      getMenuDiagnostics: () => this.menu.getDiagnostics(),
      getAudioDiagnostics: () => this.audio.getDiagnostics(),
      getMapDiagnostics: () => this.minimap?.getDiagnostics() ?? null,
      openMenu: () => this.menu.open(),
      closeMenu: () => this.menu.close(),
      openMap: () => this.minimap?.open(),
      closeMap: () => this.minimap?.close(),
      setPaused: (paused) => {
        this.paused = paused;
        this.previousTime = performance.now();
        this.nextRenderTime = this.previousTime;
        this.nextHudUpdateTime = this.previousTime;
        this.nextMinimapUpdateTime = this.previousTime;
      },
      stepTicks: this.stepTicks,
      restart: this.restart,
      scenarioId: this.scenarioId,
    };
  }

  start(): void {
    if (this.disposed) {
      return;
    }
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('keydown', this.handleGlobalKeyDown);
    this.unbindAudioUnlock();
    this.unbindDesktopInput();
    this.input.dispose();
    this.host.dispose();
    this.minimap?.dispose();
    this.menu.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    delete window.__JWGB_DEBUG__;
  }

  private readonly restart = (): void => {
    if (this.options.onRestartRequested) {
      this.options.onRestartRequested();
      return;
    }
    if (!this.host.canRestart) {
      return;
    }
    this.host.reset();
    this.renderer.setLocalEntity(this.host.localEntityId);
    this.renderer.snapCameraToLocalEntity();
    this.renderFrame(
      {
        snapshot: this.host.getSnapshot(),
        events: [],
        transactionResults: [],
        connectionState: this.host.mode === 'local' ? 'local' : 'connecting',
      },
      performance.now(),
    );
  };

  private readonly cycleCameraView = (
    direction = 1,
  ): ReturnType<ArenaRenderer['cycleCameraView']> => {
    const state = this.renderer.cycleCameraView(direction);
    this.persistCameraView(state.mode);
    return state;
  };

  private readonly setCameraView = (
    mode: WebCameraViewMode,
  ): ReturnType<ArenaRenderer['setCameraView']> => {
    const state = this.renderer.setCameraView(mode, true);
    this.persistCameraView(state.mode);
    return state;
  };

  private persistCameraView(mode: WebCameraViewMode): void {
    const state = this.renderer.getCameraViewState();
    this.settings = { ...this.settings, cameraView: mode };
    saveWebGameSettings(window.localStorage, this.settings);
    this.menu?.setCameraView(mode);
    this.hud?.setCameraViewState(state);
  }

  private readonly handleSettingsChange = (settings: WebGameSettings): void => {
    this.settings = settings;
    saveWebGameSettings(window.localStorage, settings);
    this.audio.setMix(settings);
    this.renderer.setGraphicsPreference(settings.graphicsPreference);
    const cameraState = this.renderer.setCameraView(settings.cameraView);
    this.hud.setCameraViewState(cameraState);
  };

  private readonly handleMenuSound = (cue: WebAudioCue): void => {
    this.audio.playCue(cue);
  };

  private bindAudioUnlock(): void {
    window.addEventListener('pointerdown', this.handleAudioUnlock, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', this.handleAudioUnlock, true);
  }

  private unbindAudioUnlock(): void {
    window.removeEventListener('pointerdown', this.handleAudioUnlock, true);
    window.removeEventListener('keydown', this.handleAudioUnlock, true);
  }

  private readonly handleAudioUnlock = (): void => {
    void this.audio.unlock();
  };

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && !event.repeat) {
      if (this.menu.isOpen()) {
        event.preventDefault();
        this.menu.close();
        return;
      }
      if (this.minimap?.isOpen()) {
        event.preventDefault();
        this.minimap.close();
        return;
      }
      if (this.hud.dismissCurrentInterface()) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      this.menu.open('settings');
      return;
    }
    if (event.code === WEB_CONTROL_BINDINGS.mapCode && !event.repeat && !this.menu.isOpen()) {
      event.preventDefault();
      this.minimap?.toggle();
      return;
    }
    if (this.menu.isOpen() || this.minimap?.isOpen()) {
      return;
    }
    if (event.code === WEB_CONTROL_BINDINGS.cameraCode && !event.repeat) {
      event.preventDefault();
      this.cycleCameraView(event.shiftKey ? -1 : 1);
      return;
    }
    const cameraView = cameraViewForCode(event.code);
    if (cameraView && !event.repeat) {
      event.preventDefault();
      this.setCameraView(cameraView);
      return;
    }
    if (isCameraResetCode(event.code) && !event.repeat) {
      event.preventDefault();
      this.renderer.resetCameraControls();
      return;
    }
    const zoomDirection = cameraZoomDirectionForCode(event.code);
    if (zoomDirection !== 0) {
      event.preventDefault();
      this.renderer.stepCameraZoom(zoomDirection);
      return;
    }
    const rotationDirection = cameraRotationDirectionForCode(event.code);
    if (rotationDirection !== 0) {
      event.preventDefault();
      this.renderer.rotateCameraByStep(rotationDirection);
      return;
    }
    const panDirection = cameraPanDirectionForCode(event.code);
    if (panDirection) {
      event.preventDefault();
      this.renderer.panCameraByScreenDirection(panDirection[0], panDirection[1]);
    }
  };

  private bindDesktopInput(): void {
    this.canvas.addEventListener('pointermove', this.handleCanvasPointerMove);
    this.canvas.addEventListener('pointerdown', this.handleCanvasPointerDown);
    this.canvas.addEventListener('lostpointercapture', this.handleCanvasLostPointerCapture);
    this.canvas.addEventListener('wheel', this.handleCanvasWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.handleCanvasContextMenu);
    window.addEventListener('pointerup', this.handleWindowPointerUp);
    window.addEventListener('pointercancel', this.handleWindowPointerCancel);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  private unbindDesktopInput(): void {
    this.canvas.removeEventListener('pointermove', this.handleCanvasPointerMove);
    this.canvas.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    this.canvas.removeEventListener('lostpointercapture', this.handleCanvasLostPointerCapture);
    this.canvas.removeEventListener('wheel', this.handleCanvasWheel);
    this.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    window.removeEventListener('pointercancel', this.handleWindowPointerCancel);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.cancelCameraPointerGesture();
  }

  private readonly handleCanvasPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      return;
    }
    const gesture = this.cameraPointerGesture;
    if (gesture?.pointerId === event.pointerId) {
      if (this.menu.isOpen() || this.minimap?.isOpen()) {
        this.cancelCameraPointerGesture();
        return;
      }
      if (
        !gesture.dragged &&
        this.renderer.hasCameraDragStarted(
          gesture.startX,
          gesture.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        gesture.dragged = true;
        if (gesture.button === WEB_CONTROL_BINDINGS.attackMouseButton) {
          this.input.cancelAttack();
        }
        this.canvas.classList.add(
          gesture.mode === 'orbit' ? 'is-camera-orbiting' : 'is-camera-panning',
        );
      }
      if (gesture.dragged) {
        event.preventDefault();
        const deltaX = event.clientX - gesture.lastX;
        const deltaY = event.clientY - gesture.lastY;
        if (gesture.mode === 'orbit') {
          this.renderer.rotateCameraByPixels(deltaX, deltaY);
        } else {
          this.renderer.panCameraByPixels(deltaX, deltaY);
        }
        gesture.lastX = event.clientX;
        gesture.lastY = event.clientY;
      }
      return;
    }
    if (this.menu.isOpen() || this.minimap?.isOpen()) {
      return;
    }
    this.updatePointerAim(event.clientX, event.clientY);
  };

  private readonly handleCanvasPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || this.menu.isOpen() || this.minimap?.isOpen()) {
      return;
    }
    this.updatePointerAim(event.clientX, event.clientY);
    if (
      event.button === WEB_CONTROL_BINDINGS.attackMouseButton ||
      event.button === WEB_CONTROL_BINDINGS.activeMouseButton ||
      (event.button === WEB_CONTROL_BINDINGS.cameraAlternateOrbitMouseButton && event.altKey)
    ) {
      event.preventDefault();
      this.beginCameraPointerGesture(event, 'orbit');
      if (event.button === WEB_CONTROL_BINDINGS.attackMouseButton) {
        this.input.setAttackPressed(true);
      }
      return;
    }
    if (event.button === WEB_CONTROL_BINDINGS.cameraPanMouseButton) {
      event.preventDefault();
      this.beginCameraPointerGesture(event, 'pan');
      return;
    }
    if (event.button === WEB_CONTROL_BINDINGS.attackMouseButton) {
      event.preventDefault();
      this.input.setAttackPressed(true);
    }
  };

  private readonly handleWindowPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      return;
    }
    if (
      event.button === WEB_CONTROL_BINDINGS.attackMouseButton &&
      this.cameraPointerGesture?.button !== WEB_CONTROL_BINDINGS.attackMouseButton
    ) {
      this.input.setAttackPressed(false);
    }
    const gesture = this.cameraPointerGesture;
    if (gesture?.pointerId !== event.pointerId) {
      return;
    }
    if (gesture.button === WEB_CONTROL_BINDINGS.attackMouseButton) {
      if (gesture.dragged) {
        this.input.cancelAttack();
      } else {
        this.input.setAttackPressed(false);
      }
    }
    if (!gesture.dragged) {
      if (gesture.button === WEB_CONTROL_BINDINGS.activeMouseButton) {
        this.input.queueActive();
      } else if (gesture.button === WEB_CONTROL_BINDINGS.cameraPanMouseButton) {
        this.renderer.focusCameraOnLocalEntity();
      }
    }
    this.cancelCameraPointerGesture();
  };

  private readonly handleWindowPointerCancel = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      return;
    }
    this.input.cancelAttack();
    if (this.cameraPointerGesture?.pointerId === event.pointerId) {
      this.cancelCameraPointerGesture();
    }
  };

  private readonly handleCanvasLostPointerCapture = (event: PointerEvent): void => {
    if (this.cameraPointerGesture?.pointerId === event.pointerId) {
      this.cancelCameraPointerGesture(false);
    }
  };

  private readonly handleCanvasWheel = (event: WheelEvent): void => {
    if (this.menu.isOpen() || this.minimap?.isOpen()) {
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      this.renderer.tiltCameraByWheel(event.deltaY, event.deltaMode);
    } else {
      this.renderer.zoomCameraByWheel(event.deltaY, event.deltaMode);
    }
  };

  private readonly handleWindowBlur = (): void => {
    this.input.setAttackPressed(false);
    this.cancelCameraPointerGesture();
  };

  private readonly handleCanvasContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private beginCameraPointerGesture(event: PointerEvent, mode: CameraPointerMode): void {
    this.cancelCameraPointerGesture();
    this.cameraPointerGesture = {
      pointerId: event.pointerId,
      button: event.button,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragged: false,
    };
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {}
  }

  private cancelCameraPointerGesture(releaseCapture = true): void {
    const gesture = this.cameraPointerGesture;
    this.cameraPointerGesture = null;
    this.canvas.classList.remove('is-camera-orbiting', 'is-camera-panning');
    if (!releaseCapture || !gesture) {
      return;
    }
    try {
      if (this.canvas.hasPointerCapture(gesture.pointerId)) {
        this.canvas.releasePointerCapture(gesture.pointerId);
      }
    } catch {}
  }

  private updatePointerAim(clientX: number, clientY: number): void {
    const direction = this.renderer.getGroundAimDirection(clientX, clientY);
    if (direction) {
      this.input.setAimDirection(direction.x, direction.z);
    }
  }

  private readonly stepTicks = (count = 1): WorldSnapshot => {
    if (!(this.host instanceof LocalWorldHost)) {
      throw new Error('debug stepping is only available in local mode');
    }
    if (!this.paused) {
      throw new Error('pause the debug runtime before stepping');
    }
    if (!Number.isSafeInteger(count) || count <= 0 || count > 1_000) {
      throw new Error('debug step count must be an integer from 1 to 1000');
    }

    let frame: HostFrame | undefined;
    for (let tick = 0; tick < count; tick += 1) {
      frame = this.host.update(TICK_DURATION_MS, this.input);
    }
    if (!frame?.snapshot) {
      throw new Error('debug step did not produce a frame');
    }
    this.renderFrame(frame, performance.now());
    return frame.snapshot;
  };

  private renderFrame(frame: HostFrame, now: number): void {
    this.audio.setScene(audioSceneForFrame(frame.snapshot, frame.connectionState));
    this.audio.processFrame(
      frame.events,
      frame.transactionResults,
      this.host.localEntityId,
      frame.snapshot,
    );
    if (!frame.snapshot || this.host.localEntityId === null) {
      return;
    }
    const localPlayer = frame.snapshot.players.find(
      (candidate) => candidate.entityId === this.host.localEntityId,
    );
    if (!localPlayer) {
      return;
    }
    const readyState = {
      snapshot: frame.snapshot,
      localEntityId: this.host.localEntityId,
      player: localPlayer,
    };
    if (!this.readyNotified && frame.snapshot.match.status === 'running') {
      this.readyNotified = true;
      this.options.onReady?.(readyState);
    }
    this.renderer.setLocalEntity(this.host.localEntityId);
    this.renderer.render(frame.snapshot, now / 1_000, frame.events);
    if (frame.snapshot.mapGeometryHash !== null && this.minimap === null) {
      this.minimap = new MinimapOverlay(this.shell, {
        onOpenChange: (open) => {
          if (open) {
            this.cancelCameraPointerGesture();
          }
          this.input.setEnabled(!open && !this.menu.isOpen());
        },
        onWaypointChange: (waypoint) => {
          this.renderer.setNavigationWaypoint(waypoint);
        },
      });
    }
    if (now >= this.nextMinimapUpdateTime) {
      this.minimap?.update(frame.snapshot, this.host.localEntityId);
      this.nextMinimapUpdateTime = now + MINIMAP_UPDATE_INTERVAL_MS;
    }
    if (now >= this.nextHudUpdateTime) {
      this.hud.setConnectionState(frame.connectionState);
      this.hud.update(
        frame.snapshot,
        frame.events,
        this.host.localEntityId,
        now,
        frame.transactionResults,
      );
      if (this.menu.shouldSamplePerformance(now)) {
        this.menu.updatePerformance(this.renderer.getPerformanceDiagnostics(), now);
      }
      this.nextHudUpdateTime = now + HUD_UPDATE_INTERVAL_MS;
    }
    if (
      !this.resultNotified &&
      (frame.snapshot.match.status === 'finished' || localPlayer.lifeState === 'eliminated')
    ) {
      this.resultNotified = true;
      queueMicrotask(() => {
        if (!this.disposed) {
          this.options.onResult?.(readyState);
        }
      });
    }
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) {
      return;
    }
    if (now < this.nextRenderTime) {
      this.animationFrame = requestAnimationFrame(this.frame);
      return;
    }
    const deltaMs = Math.min(100, now - this.previousTime);
    this.previousTime = now;
    this.nextRenderTime += TARGET_RENDER_INTERVAL_MS;
    if (this.nextRenderTime < now - MAX_RENDER_SCHEDULE_DRIFT_MS) {
      this.nextRenderTime = now + TARGET_RENDER_INTERVAL_MS;
    }
    if (!this.paused) {
      this.renderFrame(this.host.update(deltaMs, this.input), now);
    }
    this.animationFrame = requestAnimationFrame(this.frame);
  };
}
