import type { EntityId } from '@jwgb/core';
import type { SimEvent, WorldSnapshot } from '@jwgb/sim';
import { webAssetUrl } from './asset-url';
import type { WorldConnectionState, WorldTransactionResult } from './world-host';

type WebInterfaceAudioCue =
  | 'confirm'
  | 'cancel'
  | 'error'
  | 'pickup'
  | 'book'
  | 'equip'
  | 'buy'
  | 'sell'
  | 'respawn';
export type HeroSkillAudioPhase = 'cast' | 'impact' | 'end' | 'loop';
export type HeroSkillAudioCue = `skill-h${number}-${HeroSkillAudioPhase}`;
export type WebAudioCue = WebInterfaceAudioCue | HeroSkillAudioCue;

export type WebAudioLoop = 'lobby' | 'map' | null;
type WebAudioChannel = 'sfx' | 'ui';

export interface WebAudioMixSettings {
  readonly masterVolume: number;
  readonly musicVolume: number;
  readonly sfxVolume: number;
  readonly uiVolume: number;
}

interface RuntimeAudioAsset {
  readonly kind: 'ui' | 'sfx' | 'music' | 'ambience';
  readonly alias?: string;
  readonly file: string;
  readonly mime: string;
  readonly loop: boolean;
  readonly volume: number;
  readonly status: string;
}

export interface RuntimeAudioManifest {
  readonly schema: string;
  readonly runtimeAssetCount: number;
  readonly licenseState: string;
  readonly licenseNotice?: string;
  readonly assets: Readonly<Record<string, RuntimeAudioAsset>>;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: AudioContextState;
  readonly destination: AudioDestinationNode;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

interface ActiveSource {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly startedAt: number;
}

interface ActiveSkillLoopSource {
  readonly activeId: string;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

export interface WebAudioRuntimeOptions {
  readonly fetch?: typeof fetch;
  readonly assetUrl?: (path: string) => string;
  readonly audioContextFactory?: () => AudioContextLike | null;
  readonly maxOneShotChannels?: number;
  readonly loopStartDelayMs?: number;
}

export interface WebAudioDiagnostics extends WebAudioMixSettings {
  readonly supported: boolean;
  readonly status: 'locked' | 'loading' | 'ready' | 'failed' | 'disposed';
  readonly manifestLoaded: boolean;
  readonly manifestAssetCount: number;
  readonly requestedAssetIds: readonly string[];
  readonly loadedAssetIds: readonly string[];
  readonly failedAssetIds: readonly string[];
  readonly activeOneShotSources: number;
  readonly activeSkillLoops: number;
  readonly activeSkillLoopKeys: readonly string[];
  readonly activeLoop: WebAudioLoop;
  readonly desiredLoop: WebAudioLoop;
  readonly pendingCueCount: number;
  readonly maxOneShotChannels: number;
  readonly lastError: string | null;
}

const INTERFACE_CUE_ASSET: Readonly<Record<WebInterfaceAudioCue, string>> = {
  confirm: 'ui_confirm',
  cancel: 'ui_cancel',
  error: 'ui_error',
  pickup: 'ui_pickup',
  book: 'ui_book',
  equip: 'ui_equip',
  buy: 'ui_shop_buy',
  sell: 'ui_shop_sell',
  respawn: 'ui_respawn',
};

const INTERFACE_CUE_CHANNEL: Readonly<Record<WebInterfaceAudioCue, WebAudioChannel>> = {
  confirm: 'ui',
  cancel: 'ui',
  error: 'ui',
  buy: 'ui',
  sell: 'ui',
  pickup: 'sfx',
  book: 'sfx',
  equip: 'sfx',
  respawn: 'sfx',
};

const LOOP_ASSET: Readonly<Record<Exclude<WebAudioLoop, null>, string>> = {
  lobby: 'music_lobby',
  map: 'ambience_map',
};

const MANIFEST_PATH = 'audio/runtime/audio-manifest.json';
const REQUIRED_AUDIO_ASSET_IDS = [
  ...Object.values(INTERFACE_CUE_ASSET),
  LOOP_ASSET.lobby,
  LOOP_ASSET.map,
] as const;
const MAX_PENDING_CUES = 16;
const DEFAULT_MAX_ONE_SHOT_CHANNELS = 8;
const DEFAULT_LOOP_START_DELAY_MS = 700;
const MIN_CUE_INTERVAL_MS = 70;
const HERO_SKILL_IMPACT_AUDIO_IDS = new Set(
  Array.from({ length: 38 }, (_, index) => `H${String(index + 1).padStart(3, '0')}`).filter(
    (id) => id !== 'H009' && id !== 'H010' && id !== 'H034',
  ),
);
const HERO_SKILL_END_AUDIO_IDS = new Set([
  'H001',
  'H002',
  'H003',
  'H004',
  'H005',
  'H006',
  'H007',
  'H009',
  'H012',
  'H014',
  'H015',
  'H018',
  'H019',
  'H020',
  'H023',
  'H025',
  'H026',
  'H028',
  'H030',
  'H031',
  'H032',
  'H033',
  'H034',
  'H035',
  'H036',
  'H037',
  'H038',
]);
const HERO_SKILL_LOOP_AUDIO_IDS = new Set([
  'H002',
  'H003',
  'H006',
  'H007',
  'H018',
  'H030',
  'H031',
  'H033',
  'H036',
  'H038',
]);
const HERO_SKILL_STATUS_LOOP_AUDIO_IDS = new Set(['H018']);
const HERO_SKILL_WORLD_END_AUDIO_IDS = new Set([
  'H001',
  'H002',
  'H003',
  'H006',
  'H007',
  'H014',
  'H030',
  'H031',
  'H033',
  'H036',
  'H038',
]);
const HERO_SKILL_STATUS_END_AUDIO_IDS = new Set([
  'H004',
  'H005',
  'H009',
  'H015',
  'H018',
  'H019',
  'H023',
  'H025',
  'H026',
  'H028',
  'H032',
  'H034',
  'H035',
  'H037',
]);
const HERO_SKILL_SUMMON_END_AUDIO_IDS = new Set(['H012', 'H020']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isAudioKind(value: unknown): value is RuntimeAudioAsset['kind'] {
  return value === 'ui' || value === 'sfx' || value === 'music' || value === 'ambience';
}

function heroNumberFromActiveId(activeId: string): number | null {
  const match = /^H(\d{3})$/.exec(activeId);
  if (!match?.[1]) {
    return null;
  }
  const heroNumber = Number(match[1]);
  return Number.isSafeInteger(heroNumber) && heroNumber >= 1 && heroNumber <= 38
    ? heroNumber
    : null;
}

function skillStatusLoopKey(
  sourceEntityId: EntityId,
  targetEntityId: EntityId,
  status: string,
): string {
  return `status:${Number(sourceEntityId)}:${Number(targetEntityId)}:${status}`;
}

export function heroSkillAudioCue(
  activeId: string,
  phase: HeroSkillAudioPhase,
): HeroSkillAudioCue | null {
  const heroNumber = heroNumberFromActiveId(activeId);
  if (
    heroNumber === null ||
    (phase === 'impact' && !HERO_SKILL_IMPACT_AUDIO_IDS.has(activeId)) ||
    (phase === 'end' && !HERO_SKILL_END_AUDIO_IDS.has(activeId)) ||
    (phase === 'loop' && !HERO_SKILL_LOOP_AUDIO_IDS.has(activeId))
  ) {
    return null;
  }
  return `skill-h${String(heroNumber).padStart(3, '0')}-${phase}` as HeroSkillAudioCue;
}

function isHeroSkillAudioCue(cue: WebAudioCue): cue is HeroSkillAudioCue {
  return /^skill-h\d{3}-(cast|impact|end|loop)$/.test(cue);
}

function assetIdForCue(cue: WebAudioCue): string {
  if (isHeroSkillAudioCue(cue)) {
    return `sfx_skill_${cue.slice('skill-'.length).replace('-', '_')}`;
  }
  return INTERFACE_CUE_ASSET[cue];
}

function channelForCue(cue: WebAudioCue): WebAudioChannel {
  return isHeroSkillAudioCue(cue) ? 'sfx' : INTERFACE_CUE_CHANNEL[cue];
}

function finiteVolume(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

export function parseRuntimeAudioManifest(value: unknown): RuntimeAudioManifest | null {
  if (!isRecord(value) || typeof value.schema !== 'string' || !isRecord(value.assets)) {
    return null;
  }

  const assets: Record<string, RuntimeAudioAsset> = {};
  for (const [id, candidate] of Object.entries(value.assets)) {
    if (
      !isRecord(candidate) ||
      !isAudioKind(candidate.kind) ||
      typeof candidate.file !== 'string' ||
      !candidate.file.startsWith('audio/runtime/') ||
      typeof candidate.mime !== 'string' ||
      typeof candidate.loop !== 'boolean' ||
      finiteVolume(candidate.volume) === null ||
      typeof candidate.status !== 'string'
    ) {
      return null;
    }
    assets[id] = {
      kind: candidate.kind,
      ...(typeof candidate.alias === 'string' ? { alias: candidate.alias } : {}),
      file: candidate.file,
      mime: candidate.mime,
      loop: candidate.loop,
      volume: candidate.volume as number,
      status: candidate.status,
    };
  }

  const runtimeAssetCount =
    typeof value.runtimeAssetCount === 'number' && Number.isSafeInteger(value.runtimeAssetCount)
      ? value.runtimeAssetCount
      : Object.keys(assets).length;
  if (runtimeAssetCount !== Object.keys(assets).length) {
    return null;
  }
  if (REQUIRED_AUDIO_ASSET_IDS.some((assetId) => !assets[assetId])) {
    return null;
  }

  return {
    schema: value.schema,
    runtimeAssetCount,
    licenseState: typeof value.licenseState === 'string' ? value.licenseState : 'UNKNOWN',
    ...(typeof value.licenseNotice === 'string' ? { licenseNotice: value.licenseNotice } : {}),
    assets,
  };
}

export function audioCueForSimEvent(
  event: SimEvent,
  localEntityId: EntityId | null,
  locallyOwnedEntityIds: ReadonlySet<EntityId> = new Set(),
): WebAudioCue | null {
  const isLocal = (entityId: EntityId): boolean =>
    localEntityId !== null && (entityId === localEntityId || locallyOwnedEntityIds.has(entityId));

  switch (event.type) {
    case 'active-cast':
      return isLocal(event.entityId)
        ? (heroSkillAudioCue(String(event.activeAbilityId), 'cast') ?? 'equip')
        : null;
    case 'damage':
      return event.activeAbilityId !== undefined &&
        event.sourceEntityId !== null &&
        isLocal(event.sourceEntityId)
        ? heroSkillAudioCue(String(event.activeAbilityId), 'impact')
        : null;
    case 'monster-damaged':
      return event.activeAbilityId !== undefined &&
        event.sourceEntityId !== null &&
        isLocal(event.sourceEntityId)
        ? heroSkillAudioCue(String(event.activeAbilityId), 'impact')
        : null;
    case 'passive-proc':
      return event.activeAbilityId !== undefined && isLocal(event.sourceEntityId)
        ? heroSkillAudioCue(String(event.activeAbilityId), 'impact')
        : null;
    case 'active-world-spawned':
      return isLocal(event.ownerEntityId)
        ? heroSkillAudioCue(String(event.activeAbilityId), 'impact')
        : null;
    case 'active-world-damaged':
    case 'active-heal':
      return isLocal(event.sourceEntityId)
        ? heroSkillAudioCue(String(event.activeAbilityId), 'impact')
        : null;
    case 'active-world-expired':
      return isLocal(event.ownerEntityId) &&
        !HERO_SKILL_LOOP_AUDIO_IDS.has(String(event.activeAbilityId)) &&
        HERO_SKILL_WORLD_END_AUDIO_IDS.has(String(event.activeAbilityId))
        ? heroSkillAudioCue(String(event.activeAbilityId), 'end')
        : null;
    case 'active-status-applied':
      return isLocal(event.sourceEntityId)
        ? heroSkillAudioCue(String(event.activeAbilityId), 'impact')
        : null;
    case 'active-status-ended':
      return isLocal(event.sourceEntityId) &&
        !HERO_SKILL_LOOP_AUDIO_IDS.has(String(event.activeAbilityId)) &&
        HERO_SKILL_STATUS_END_AUDIO_IDS.has(String(event.activeAbilityId))
        ? heroSkillAudioCue(String(event.activeAbilityId), 'end')
        : null;
    case 'summon-spawned':
      return event.activeAbilityId !== undefined && isLocal(event.ownerEntityId)
        ? heroSkillAudioCue(String(event.activeAbilityId), 'impact')
        : null;
    case 'summon-expired':
      return event.activeAbilityId !== undefined &&
        isLocal(event.ownerEntityId) &&
        HERO_SKILL_SUMMON_END_AUDIO_IDS.has(String(event.activeAbilityId))
        ? heroSkillAudioCue(String(event.activeAbilityId), 'end')
        : null;
    case 'active-unavailable':
    case 'active-target-missing':
    case 'active-cast-blocked':
      return isLocal(event.entityId) ? 'error' : null;
    case 'loot-collected':
      if (!isLocal(event.collectorEntityId)) {
        return null;
      }
      return event.bookPassiveId !== null
        ? 'book'
        : event.equipmentId !== null || event.activeId !== null
          ? 'equip'
          : 'pickup';
    case 'active-replaced':
    case 'equipment-equipped':
      return isLocal(event.entityId) ? 'equip' : null;
    case 'equipment-unequipped':
    case 'equipment-discarded':
      return isLocal(event.entityId) ? 'cancel' : null;
    case 'passive-upgraded':
    case 'passive-learned':
      return isLocal(event.entityId) ? 'book' : null;
    case 'shop-purchase':
      return isLocal(event.entityId) ? 'buy' : null;
    case 'shop-sale':
      return isLocal(event.entityId) ? 'sell' : null;
    case 'hero-swap-channel':
      if (!isLocal(event.entityId)) {
        return null;
      }
      return event.phase === 'completed' ? 'equip' : event.phase === 'cancelled' ? 'cancel' : null;
    case 'gamble-resolved':
      return isLocal(event.entityId) ? 'confirm' : null;
    case 'airdrop-channel':
      if (!isLocal(event.entityId)) {
        return null;
      }
      return event.phase === 'completed'
        ? 'confirm'
        : event.phase === 'cancelled'
          ? 'cancel'
          : null;
    case 'airdrop-opened':
      return isLocal(event.entityId) ? 'equip' : null;
    case 'active-replacement-cancelled':
    case 'equipment-pickup-replacement-cancelled':
      return isLocal(event.entityId) ? 'cancel' : null;
    case 'true-death':
      return isLocal(event.entityId) ? 'error' : null;
    case 'respawn':
      return isLocal(event.entityId) ? 'respawn' : null;
    case 'eliminated':
      return isLocal(event.entityId) ? 'error' : null;
    case 'match-started':
      return 'confirm';
    case 'match-ended':
      return 'confirm';
    default:
      return null;
  }
}

export function audioCueForTransaction(
  result: WorldTransactionResult,
  matchingEventCue: WebAudioCue | null,
): WebAudioCue | null {
  if (!result.accepted) {
    return 'error';
  }
  if (matchingEventCue !== null) {
    return null;
  }
  if (
    result.operation === 'shop-purchase' ||
    result.operation === 'shop-sale' ||
    result.operation === 'equipment-equip' ||
    result.operation === 'equipment-unequip' ||
    result.operation === 'equipment-discard'
  ) {
    return null;
  }
  return 'confirm';
}

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function browserAudioContextFactory(): AudioContextLike | null {
  const global = globalThis as typeof globalThis & {
    readonly webkitAudioContext?: typeof AudioContext;
  };
  const Constructor = global.AudioContext ?? global.webkitAudioContext;
  return Constructor ? new Constructor({ latencyHint: 'interactive' }) : null;
}

export class WebAudioRuntime {
  private readonly fetcher: typeof fetch;
  private readonly assetUrl: (path: string) => string;
  private readonly audioContextFactory: () => AudioContextLike | null;
  private readonly maxOneShotChannels: number;
  private readonly loopStartDelayMs: number;
  private context: AudioContextLike | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private manifest: RuntimeAudioManifest | null = null;
  private unlockPromise: Promise<void> | null = null;
  private status: WebAudioDiagnostics['status'] = 'locked';
  private lastError: string | null = null;
  private desiredLoop: WebAudioLoop = null;
  private activeLoop: WebAudioLoop = null;
  private loopSource: AudioBufferSourceNode | null = null;
  private loopGain: GainNode | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly bufferCache = new Map<string, AudioBuffer>();
  private readonly bufferPromises = new Map<string, Promise<AudioBuffer | null>>();
  private readonly requestedAssetIds = new Set<string>();
  private readonly failedAssetIds = new Set<string>();
  private readonly activeSources: ActiveSource[] = [];
  private readonly activeSkillLoopInstances = new Map<string, string>();
  private readonly activeSkillLoopSources = new Map<string, ActiveSkillLoopSource>();
  private readonly pendingCues: WebAudioCue[] = [];
  private readonly lastCueAt = new Map<WebAudioCue, number>();
  private mix: WebAudioMixSettings = {
    masterVolume: 0.8,
    musicVolume: 0.6,
    sfxVolume: 0.8,
    uiVolume: 0.7,
  };
  private disposed = false;
  private supported = true;

  constructor(options: WebAudioRuntimeOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.assetUrl = options.assetUrl ?? webAssetUrl;
    this.audioContextFactory = options.audioContextFactory ?? browserAudioContextFactory;
    this.maxOneShotChannels = Math.max(
      1,
      Math.floor(options.maxOneShotChannels ?? DEFAULT_MAX_ONE_SHOT_CHANNELS),
    );
    this.loopStartDelayMs = Math.max(
      0,
      Math.floor(options.loopStartDelayMs ?? DEFAULT_LOOP_START_DELAY_MS),
    );
  }

  setMix(settings: WebAudioMixSettings): void {
    this.mix = {
      masterVolume: clampVolume(settings.masterVolume),
      musicVolume: clampVolume(settings.musicVolume),
      sfxVolume: clampVolume(settings.sfxVolume),
      uiVolume: clampVolume(settings.uiVolume),
    };
    this.applyGainValues();
  }

  unlock(): Promise<void> {
    if (this.disposed || this.status === 'disposed' || this.status === 'failed') {
      return Promise.resolve();
    }
    if (this.status === 'ready') {
      return Promise.resolve();
    }
    if (this.unlockPromise) {
      return this.unlockPromise;
    }
    this.status = 'loading';
    this.unlockPromise = this.loadRuntime().finally(() => {
      this.unlockPromise = null;
    });
    return this.unlockPromise;
  }

  setScene(loop: WebAudioLoop): void {
    if (this.disposed || this.desiredLoop === loop) {
      return;
    }
    this.desiredLoop = loop;
    this.scheduleLoop();
  }

  playCue(cue: WebAudioCue): void {
    if (this.disposed || this.status === 'failed') {
      return;
    }
    if (this.status !== 'ready') {
      if (this.pendingCues.length < MAX_PENDING_CUES) {
        this.pendingCues.push(cue);
      }
      return;
    }
    void this.playCueNow(cue);
  }

  processFrame(
    events: readonly SimEvent[],
    transactionResults: readonly WorldTransactionResult[],
    localEntityId: EntityId | null,
    snapshot: WorldSnapshot | null = null,
  ): void {
    const locallyOwnedEntityIds = new Set<EntityId>(
      localEntityId === null
        ? []
        : (snapshot?.summons ?? [])
            .filter((summon) => summon.ownerEntityId === localEntityId)
            .map((summon) => summon.entityId),
    );
    this.processSkillLoopEvents(events, localEntityId);
    this.syncSkillLoopInstancesFromSnapshot(snapshot, localEntityId);
    const eventCues = events
      .map((event) => audioCueForSimEvent(event, localEntityId, locallyOwnedEntityIds))
      .filter((cue): cue is WebAudioCue => cue !== null);
    const uniqueCues = [...new Set(eventCues)];
    for (const cue of uniqueCues) {
      this.playCue(cue);
    }

    const matchingEventCue = uniqueCues[0] ?? null;
    transactionResults.forEach((result) => {
      const cue = audioCueForTransaction(result, matchingEventCue);
      if (cue) {
        this.playCue(cue);
      }
    });
  }

  private syncSkillLoopInstancesFromSnapshot(
    snapshot: WorldSnapshot | null,
    localEntityId: EntityId | null,
  ): void {
    if (!snapshot || localEntityId === null) {
      return;
    }
    const desired = new Map<string, string>();
    for (const zone of snapshot.activeZones ?? []) {
      const activeId = String(zone.activeId);
      if (zone.ownerEntityId === localEntityId && HERO_SKILL_LOOP_AUDIO_IDS.has(activeId)) {
        desired.set(`world:${zone.entityId}`, activeId);
      }
    }
    for (const effect of snapshot.activeTargetEffects ?? []) {
      const activeId = String(effect.activeId);
      if (
        effect.sourceEntityId === localEntityId &&
        HERO_SKILL_STATUS_LOOP_AUDIO_IDS.has(activeId)
      ) {
        desired.set(
          skillStatusLoopKey(effect.sourceEntityId, effect.targetEntityId, effect.kind),
          activeId,
        );
      }
    }

    const previousActiveIds = new Set(this.activeSkillLoopInstances.values());
    this.activeSkillLoopInstances.clear();
    for (const [key, activeId] of desired) {
      this.activeSkillLoopInstances.set(key, activeId);
    }
    for (const activeId of previousActiveIds) {
      if (!this.hasSkillLoopInstances(activeId)) {
        this.stopSkillLoop(activeId);
      }
    }
    for (const activeId of new Set(desired.values())) {
      void this.startSkillLoop(activeId);
    }
  }

  private processSkillLoopEvents(
    events: readonly SimEvent[],
    localEntityId: EntityId | null,
  ): void {
    if (localEntityId === null) {
      return;
    }
    for (const event of events) {
      if (event.type === 'active-world-spawned' && event.ownerEntityId === localEntityId) {
        this.addSkillLoopInstance(`world:${event.entityId}`, String(event.activeAbilityId));
      } else if (event.type === 'active-world-expired' && event.ownerEntityId === localEntityId) {
        this.removeSkillLoopInstance(`world:${event.entityId}`);
      } else if (
        event.type === 'active-status-applied' &&
        event.sourceEntityId === localEntityId &&
        HERO_SKILL_STATUS_LOOP_AUDIO_IDS.has(String(event.activeAbilityId))
      ) {
        this.addSkillLoopInstance(
          skillStatusLoopKey(event.sourceEntityId, event.targetEntityId, event.status),
          String(event.activeAbilityId),
        );
      } else if (
        event.type === 'active-status-ended' &&
        event.sourceEntityId === localEntityId &&
        HERO_SKILL_STATUS_LOOP_AUDIO_IDS.has(String(event.activeAbilityId))
      ) {
        this.removeSkillLoopInstance(
          skillStatusLoopKey(event.sourceEntityId, event.targetEntityId, event.status),
        );
      }
    }
  }

  private addSkillLoopInstance(key: string, activeId: string): void {
    if (!HERO_SKILL_LOOP_AUDIO_IDS.has(activeId)) {
      return;
    }
    const previousActiveId = this.activeSkillLoopInstances.get(key);
    if (previousActiveId === activeId) {
      return;
    }
    if (previousActiveId !== undefined) {
      this.activeSkillLoopInstances.delete(key);
      if (!this.hasSkillLoopInstances(previousActiveId)) {
        this.stopSkillLoop(previousActiveId);
      }
    }
    this.activeSkillLoopInstances.set(key, activeId);
    void this.startSkillLoop(activeId);
  }

  private removeSkillLoopInstance(key: string): void {
    const activeId = this.activeSkillLoopInstances.get(key);
    if (activeId === undefined) {
      return;
    }
    this.activeSkillLoopInstances.delete(key);
    if (this.hasSkillLoopInstances(activeId)) {
      return;
    }
    this.stopSkillLoop(activeId);
    const endCue = heroSkillAudioCue(activeId, 'end');
    if (endCue) {
      this.playCue(endCue);
    }
  }

  private hasSkillLoopInstances(activeId: string): boolean {
    return [...this.activeSkillLoopInstances.values()].some((candidate) => candidate === activeId);
  }

  getDiagnostics(): WebAudioDiagnostics {
    return {
      ...this.mix,
      supported: this.supported,
      status: this.status,
      manifestLoaded: this.manifest !== null,
      manifestAssetCount: this.manifest?.runtimeAssetCount ?? 0,
      requestedAssetIds: [...this.requestedAssetIds].sort(),
      loadedAssetIds: [...this.bufferCache.keys()].sort(),
      failedAssetIds: [...this.failedAssetIds].sort(),
      activeOneShotSources: this.activeSources.length,
      activeSkillLoops: this.activeSkillLoopSources.size,
      activeSkillLoopKeys: [...this.activeSkillLoopInstances.keys()].sort(),
      activeLoop: this.activeLoop,
      desiredLoop: this.desiredLoop,
      pendingCueCount: this.pendingCues.length,
      maxOneShotChannels: this.maxOneShotChannels,
      lastError: this.lastError,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.status = 'disposed';
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    this.stopLoop();
    for (const active of this.activeSources.splice(0)) {
      this.stopActiveSource(active);
    }
    for (const activeId of [...this.activeSkillLoopSources.keys()]) {
      this.stopSkillLoop(activeId);
    }
    this.activeSkillLoopInstances.clear();
    this.pendingCues.length = 0;
    const context = this.context;
    this.context = null;
    if (context) {
      void context.close().catch(() => undefined);
    }
  }

  private async loadRuntime(): Promise<void> {
    const context = this.audioContextFactory();
    if (!context) {
      this.supported = false;
      this.status = 'failed';
      this.lastError = 'AudioContext is not supported';
      return;
    }
    this.context = context;
    try {
      await context.resume();
      this.masterGain = context.createGain();
      this.musicGain = context.createGain();
      this.sfxGain = context.createGain();
      this.uiGain = context.createGain();
      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.uiGain.connect(this.masterGain);
      this.masterGain.connect(context.destination);
      this.applyGainValues();

      const response = await this.fetcher(this.assetUrl(MANIFEST_PATH), {
        cache: 'force-cache',
      });
      if (!response.ok) {
        throw new Error(`audio manifest request failed: ${response.status}`);
      }
      const manifest = parseRuntimeAudioManifest(await response.json());
      if (!manifest) {
        throw new Error('audio manifest is invalid');
      }
      this.manifest = manifest;
      this.status = 'ready';
      this.flushPendingCues();
      for (const activeId of new Set(this.activeSkillLoopInstances.values())) {
        void this.startSkillLoop(activeId);
      }
      this.scheduleLoop();
    } catch (error) {
      this.status = 'failed';
      this.lastError = error instanceof Error ? error.message : 'audio initialization failed';
      this.pendingCues.length = 0;
      try {
        await context.close();
      } catch {}
      this.context = null;
    }
  }

  private flushPendingCues(): void {
    const pending = this.pendingCues.splice(0);
    for (const cue of pending) {
      void this.playCueNow(cue);
    }
  }

  private applyGainValues(): void {
    const context = this.context;
    if (!context) {
      return;
    }
    const now = context.currentTime;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.mix.masterVolume, now, 0.015);
    }
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(this.mix.musicVolume, now, 0.015);
    }
    if (this.sfxGain) {
      this.sfxGain.gain.setTargetAtTime(this.mix.sfxVolume, now, 0.015);
    }
    if (this.uiGain) {
      this.uiGain.gain.setTargetAtTime(this.mix.uiVolume, now, 0.015);
    }
  }

  private async loadBuffer(assetId: string): Promise<AudioBuffer | null> {
    const cached = this.bufferCache.get(assetId);
    if (cached) {
      return cached;
    }
    const pending = this.bufferPromises.get(assetId);
    if (pending) {
      return pending;
    }
    const manifest = this.manifest;
    const context = this.context;
    const asset = manifest?.assets[assetId];
    if (!manifest || !context || !asset) {
      this.failedAssetIds.add(assetId);
      return null;
    }

    this.requestedAssetIds.add(assetId);
    const loadPromise = (async (): Promise<AudioBuffer | null> => {
      try {
        const response = await this.fetcher(this.assetUrl(asset.file), {
          cache: 'force-cache',
        });
        if (!response.ok) {
          throw new Error(`audio asset request failed: ${response.status}`);
        }
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        this.bufferCache.set(assetId, buffer);
        return buffer;
      } catch {
        this.failedAssetIds.add(assetId);
        return null;
      } finally {
        this.bufferPromises.delete(assetId);
      }
    })();
    this.bufferPromises.set(assetId, loadPromise);
    return loadPromise;
  }

  private async playCueNow(cue: WebAudioCue): Promise<void> {
    const now = performance.now();
    const lastPlayed = this.lastCueAt.get(cue) ?? -Infinity;
    if (now - lastPlayed < MIN_CUE_INTERVAL_MS) {
      return;
    }
    this.lastCueAt.set(cue, now);
    const assetId = assetIdForCue(cue);
    const asset = this.manifest?.assets[assetId];
    const context = this.context;
    if (!asset || !context || this.status !== 'ready') {
      return;
    }
    const buffer = await this.loadBuffer(assetId);
    if (!buffer || this.disposed || this.status !== 'ready' || this.context !== context) {
      return;
    }

    while (this.activeSources.length >= this.maxOneShotChannels) {
      const oldest = this.activeSources.shift();
      if (!oldest) {
        break;
      }
      this.stopActiveSource(oldest);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    const destination = channelForCue(cue) === 'ui' ? this.uiGain : this.sfxGain;
    if (!destination) {
      return;
    }
    const gain = context.createGain();
    gain.gain.setValueAtTime(asset.volume, context.currentTime);
    source.connect(gain);
    gain.connect(destination);
    const active: ActiveSource = { source, gain, startedAt: context.currentTime };
    this.activeSources.push(active);
    source.addEventListener('ended', () => {
      const index = this.activeSources.indexOf(active);
      if (index >= 0) {
        this.activeSources.splice(index, 1);
      }
      try {
        source.disconnect();
        gain.disconnect();
      } catch {}
    });
    source.start();
  }

  private async startSkillLoop(activeId: string): Promise<void> {
    if (
      this.disposed ||
      this.status !== 'ready' ||
      !this.hasSkillLoopInstances(activeId) ||
      this.activeSkillLoopSources.has(activeId)
    ) {
      return;
    }
    const cue = heroSkillAudioCue(activeId, 'loop');
    if (!cue) {
      return;
    }
    const assetId = assetIdForCue(cue);
    const asset = this.manifest?.assets[assetId];
    const context = this.context;
    if (!asset || !context) {
      return;
    }
    const buffer = await this.loadBuffer(assetId);
    if (
      !buffer ||
      this.disposed ||
      this.status !== 'ready' ||
      this.context !== context ||
      !this.hasSkillLoopInstances(activeId) ||
      this.activeSkillLoopSources.has(activeId)
    ) {
      return;
    }
    if (!this.sfxGain) {
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.setValueAtTime(asset.volume, context.currentTime);
    source.connect(gain);
    gain.connect(this.sfxGain);
    source.start();
    this.activeSkillLoopSources.set(activeId, { activeId, source, gain });
  }

  private stopSkillLoop(activeId: string): void {
    const active = this.activeSkillLoopSources.get(activeId);
    if (!active) {
      return;
    }
    this.activeSkillLoopSources.delete(activeId);
    try {
      active.source.stop();
      active.source.disconnect();
      active.gain.disconnect();
    } catch {}
  }

  private scheduleLoop(): void {
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    if (this.disposed || this.status !== 'ready' || this.desiredLoop === this.activeLoop) {
      return;
    }
    const desired = this.desiredLoop;
    if (desired === null) {
      this.stopLoop();
      return;
    }
    this.loopTimer = setTimeout(() => {
      this.loopTimer = null;
      void this.startLoop(desired);
    }, this.loopStartDelayMs);
  }

  private async startLoop(loop: Exclude<WebAudioLoop, null>): Promise<void> {
    if (this.disposed || this.status !== 'ready' || this.desiredLoop !== loop) {
      return;
    }
    const assetId = LOOP_ASSET[loop];
    const asset = this.manifest?.assets[assetId];
    const context = this.context;
    if (!asset || !context) {
      return;
    }
    const buffer = await this.loadBuffer(assetId);
    if (!buffer || this.disposed || this.status !== 'ready' || this.desiredLoop !== loop) {
      return;
    }
    this.stopLoop();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    if (!this.musicGain) {
      return;
    }
    const gain = context.createGain();
    gain.gain.setValueAtTime(asset.volume, context.currentTime);
    source.connect(gain);
    gain.connect(this.musicGain);
    source.start();
    this.loopSource = source;
    this.loopGain = gain;
    this.activeLoop = loop;
  }

  private stopLoop(): void {
    const source = this.loopSource;
    const gain = this.loopGain;
    this.loopSource = null;
    this.loopGain = null;
    this.activeLoop = null;
    if (!source) {
      return;
    }
    try {
      source.stop();
      source.disconnect();
      gain?.disconnect();
    } catch {}
  }

  private stopActiveSource(active: ActiveSource): void {
    try {
      active.source.stop();
      active.source.disconnect();
      active.gain.disconnect();
    } catch {}
  }
}

export function audioSceneForFrame(
  snapshot: { readonly match: { readonly status: string } } | null,
  _connectionState: WorldConnectionState,
): WebAudioLoop {
  if (snapshot && snapshot.match.status !== 'finished') {
    return 'map';
  }
  return 'lobby';
}
