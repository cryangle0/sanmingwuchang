import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EntityId } from '@jwgb/core';
import type { SimEvent, WorldSnapshot } from '@jwgb/sim';
import runtimeManifest from '../apps/web/public/audio/runtime/audio-manifest.json';
import {
  type AudioContextLike,
  audioCueForSimEvent,
  audioCueForTransaction,
  heroSkillAudioCue,
  parseRuntimeAudioManifest,
  WebAudioRuntime,
} from '../apps/web/src/runtime/web-audio';

class FakeParam {
  value = 0;

  setTargetAtTime(value: number): void {
    this.value = value;
  }

  setValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeGain {
  readonly gain = new FakeParam();

  connect(): void {}

  disconnect(): void {}
}

class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  started = false;
  stopCalls = 0;
  private readonly endedListeners = new Set<() => void>();

  connect(): void {}

  disconnect(): void {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'ended') {
      return;
    }
    if (typeof listener === 'function') {
      this.endedListeners.add(listener as () => void);
    }
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopCalls += 1;
    for (const listener of this.endedListeners) {
      listener();
    }
  }
}

class FakeAudioContext implements AudioContextLike {
  readonly currentTime = 0;
  readonly state = 'running' as AudioContextState;
  readonly destination = {} as AudioDestinationNode;
  readonly sources: FakeSource[] = [];

  createGain(): GainNode {
    return new FakeGain() as unknown as GainNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({} as AudioBuffer);
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function entityId(value: number): EntityId {
  return value as EntityId;
}

function responseFor(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function waitForTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

function audioSnapshot(options: {
  readonly zones?: readonly {
    readonly entityId: EntityId;
    readonly ownerEntityId: EntityId;
    readonly activeId: string;
  }[];
  readonly effects?: readonly {
    readonly key: string;
    readonly sourceEntityId: EntityId;
    readonly targetEntityId: EntityId;
    readonly activeId: string;
    readonly kind: string;
  }[];
}): WorldSnapshot {
  return {
    summons: [],
    activeZones: options.zones ?? [],
    activeTargetEffects: options.effects ?? [],
  } as unknown as WorldSnapshot;
}

describe('web audio runtime', () => {
  it('accepts all 121 connected runtime assets and rejects paths outside runtime audio', () => {
    const manifest = parseRuntimeAudioManifest(runtimeManifest);

    expect(manifest).not.toBeNull();
    expect(manifest?.runtimeAssetCount).toBe(121);
    expect(
      Object.keys(manifest?.assets ?? {}).filter((id) => id.startsWith('sfx_skill_')),
    ).toHaveLength(110);
    expect(
      Object.values(manifest?.assets ?? {}).every((asset) =>
        asset.file.startsWith('audio/runtime/'),
      ),
    ).toBe(true);
    expect(
      parseRuntimeAudioManifest({
        ...runtimeManifest,
        assets: {
          ...runtimeManifest.assets,
          source: {
            ...runtimeManifest.assets.ui_confirm,
            file: 'audio/incoming_20260813/source.wav',
          },
        },
      }),
    ).toBeNull();
  });

  it('publishes real 24kHz 16-bit mono WAV files for every skill manifest entry', () => {
    const skillsDirectory = fileURLToPath(
      new URL('../apps/web/public/audio/runtime/skills/', import.meta.url),
    );
    const skillAssets = Object.entries(runtimeManifest.assets).filter(([id]) =>
      id.startsWith('sfx_skill_'),
    );

    expect(readdirSync(skillsDirectory)).toHaveLength(110);
    for (const [, asset] of skillAssets) {
      const fileName = asset.file.slice('audio/runtime/skills/'.length);
      const absolutePath = fileURLToPath(
        new URL(`../apps/web/public/audio/runtime/skills/${fileName}`, import.meta.url),
      );
      expect(statSync(absolutePath).isFile()).toBe(true);
      const header = readFileSync(absolutePath);
      expect(header.toString('ascii', 0, 4)).toBe('RIFF');
      expect(header.toString('ascii', 8, 12)).toBe('WAVE');
      expect(header.readUInt16LE(22)).toBe(1);
      expect(header.readUInt32LE(24)).toBe(24_000);
      expect(header.readUInt16LE(34)).toBe(16);
    }
  });

  it('exposes the intended cast, impact, end and loop phase coverage', () => {
    const phases = Object.values(runtimeManifest.assets).reduce<Record<string, number>>(
      (counts, asset) => {
        if ('phase' in asset && typeof asset.phase === 'string') {
          counts[asset.phase] = (counts[asset.phase] ?? 0) + 1;
        }
        return counts;
      },
      {},
    );

    expect(phases).toEqual({ cast: 38, impact: 35, end: 27, loop: 10 });
    expect(heroSkillAudioCue('H009', 'cast')).toBe('skill-h009-cast');
    expect(heroSkillAudioCue('H009', 'impact')).toBeNull();
    expect(heroSkillAudioCue('H018', 'loop')).toBe('skill-h018-loop');
    expect(heroSkillAudioCue('H024', 'end')).toBeNull();
  });

  it('maps authoritative local events and rejected transactions to bounded cues', () => {
    const local = entityId(7);
    expect(
      audioCueForSimEvent(
        {
          type: 'active-cast',
          entityId: local,
          activeAbilityId: 'H024',
        } as unknown as SimEvent,
        local,
      ),
    ).toBe('skill-h024-cast');
    expect(
      audioCueForSimEvent(
        {
          type: 'damage',
          sourceEntityId: local,
          targetEntityId: entityId(8),
          activeAbilityId: 'H024',
        } as unknown as SimEvent,
        local,
      ),
    ).toBe('skill-h024-impact');
    expect(
      audioCueForSimEvent(
        {
          type: 'loot-collected',
          collectorEntityId: local,
          bookPassiveId: 'B01',
          equipmentId: null,
          activeId: null,
        } as unknown as SimEvent,
        local,
      ),
    ).toBe('book');
    expect(
      audioCueForSimEvent({ type: 'shop-sale', entityId: local } as unknown as SimEvent, local),
    ).toBe('sell');
    expect(
      audioCueForTransaction(
        {
          transactionId: 'tx-1',
          operation: 'shop-purchase',
          accepted: false,
          code: 'shop-closed',
          message: 'shop closed',
        },
        null,
      ),
    ).toBe('error');
    expect(
      audioCueForTransaction(
        {
          transactionId: 'tx-2',
          operation: 'shop-purchase',
          accepted: true,
          code: 'accepted',
          message: 'transaction accepted',
        },
        'buy',
      ),
    ).toBeNull();
  });

  it('does not request audio before unlock, reuses one context, and caps one-shot channels', async () => {
    const context = new FakeAudioContext();
    let contextCreations = 0;
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      return url.endsWith('audio-manifest.json')
        ? responseFor(runtimeManifest)
        : new Response(new ArrayBuffer(8), { status: 200 });
    };
    const runtime = new WebAudioRuntime({
      fetch: fetcher,
      assetUrl: (path) => path,
      audioContextFactory: () => {
        contextCreations += 1;
        return context;
      },
      maxOneShotChannels: 2,
      loopStartDelayMs: 0,
    });

    runtime.setScene('map');
    runtime.playCue('confirm');
    expect(requests).toEqual([]);

    const firstUnlock = runtime.unlock();
    expect(runtime.unlock()).toBe(firstUnlock);
    await firstUnlock;
    await waitForTimers();
    runtime.playCue('cancel');
    runtime.playCue('pickup');
    runtime.playCue('book');
    await waitForTimers();

    const diagnostics = runtime.getDiagnostics();
    expect(contextCreations).toBe(1);
    expect(diagnostics.status).toBe('ready');
    expect(diagnostics.activeLoop).toBe('map');
    expect(diagnostics.activeOneShotSources).toBeLessThanOrEqual(2);
    expect(requests.every((url) => url.includes('audio/runtime/'))).toBe(true);
    expect(requests.some((url) => url.includes('incoming_20260813'))).toBe(false);
    runtime.dispose();
  });

  it('keeps one loop source until the last world instance expires', async () => {
    const context = new FakeAudioContext();
    const fetcher: typeof fetch = async (input) =>
      String(input).endsWith('audio-manifest.json')
        ? responseFor(runtimeManifest)
        : new Response(new ArrayBuffer(8), { status: 200 });
    const runtime = new WebAudioRuntime({
      fetch: fetcher,
      assetUrl: (path) => path,
      audioContextFactory: () => context,
    });
    const local = entityId(1);
    const firstZone = {
      entityId: entityId(20),
      ownerEntityId: local,
      activeId: 'H002',
    };
    const secondZone = {
      entityId: entityId(21),
      ownerEntityId: local,
      activeId: 'H002',
    };

    await runtime.unlock();
    runtime.processFrame(
      [
        {
          type: 'active-world-spawned',
          entityId: firstZone.entityId,
          ownerEntityId: local,
          activeAbilityId: 'H002',
        } as unknown as SimEvent,
      ],
      [],
      local,
      audioSnapshot({ zones: [firstZone] }),
    );
    await waitForTimers();
    expect(runtime.getDiagnostics()).toMatchObject({
      activeSkillLoops: 1,
      activeSkillLoopKeys: ['world:20'],
    });

    runtime.processFrame(
      [
        {
          type: 'active-world-spawned',
          entityId: secondZone.entityId,
          ownerEntityId: local,
          activeAbilityId: 'H002',
        } as unknown as SimEvent,
      ],
      [],
      local,
      audioSnapshot({ zones: [firstZone, secondZone] }),
    );
    await waitForTimers();
    expect(context.sources.filter((source) => source.loop)).toHaveLength(1);

    runtime.processFrame(
      [
        {
          type: 'active-world-expired',
          entityId: firstZone.entityId,
          ownerEntityId: local,
          activeAbilityId: 'H002',
        } as unknown as SimEvent,
      ],
      [],
      local,
      audioSnapshot({ zones: [secondZone] }),
    );
    expect(runtime.getDiagnostics().activeSkillLoops).toBe(1);

    runtime.processFrame(
      [
        {
          type: 'active-world-expired',
          entityId: secondZone.entityId,
          ownerEntityId: local,
          activeAbilityId: 'H002',
        } as unknown as SimEvent,
      ],
      [],
      local,
      audioSnapshot({ zones: [] }),
    );
    await waitForTimers();
    expect(runtime.getDiagnostics()).toMatchObject({
      activeSkillLoops: 0,
      activeSkillLoopKeys: [],
    });
    expect(context.sources.find((source) => source.loop)?.stopCalls).toBe(1);
    runtime.dispose();
  });

  it('uses one stable key for H018 status loop events and snapshots', async () => {
    const context = new FakeAudioContext();
    const fetcher: typeof fetch = async (input) =>
      String(input).endsWith('audio-manifest.json')
        ? responseFor(runtimeManifest)
        : new Response(new ArrayBuffer(8), { status: 200 });
    const runtime = new WebAudioRuntime({
      fetch: fetcher,
      assetUrl: (path) => path,
      audioContextFactory: () => context,
    });
    const local = entityId(1);
    const effect = {
      key: '1:1:whirlwind',
      sourceEntityId: local,
      targetEntityId: local,
      activeId: 'H018',
      kind: 'whirlwind',
    };

    await runtime.unlock();
    runtime.processFrame(
      [
        {
          type: 'active-status-applied',
          sourceEntityId: local,
          targetEntityId: local,
          activeAbilityId: 'H018',
          status: 'whirlwind',
        } as unknown as SimEvent,
      ],
      [],
      local,
      audioSnapshot({ effects: [effect] }),
    );
    await waitForTimers();
    expect(runtime.getDiagnostics()).toMatchObject({
      activeSkillLoops: 1,
      activeSkillLoopKeys: ['status:1:1:whirlwind'],
    });

    runtime.processFrame([], [], local, audioSnapshot({ effects: [effect] }));
    await waitForTimers();
    expect(context.sources.filter((source) => source.loop)).toHaveLength(1);

    runtime.processFrame(
      [
        {
          type: 'active-status-ended',
          sourceEntityId: local,
          targetEntityId: local,
          activeAbilityId: 'H018',
          status: 'whirlwind',
        } as unknown as SimEvent,
      ],
      [],
      local,
      audioSnapshot({ effects: [] }),
    );
    expect(runtime.getDiagnostics().activeSkillLoops).toBe(0);
    runtime.dispose();
  });

  it('keeps the runtime ready when one asset fails to load', async () => {
    const context = new FakeAudioContext();
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('audio-manifest.json')) {
        return responseFor(runtimeManifest);
      }
      if (url.endsWith('ui_error.wav')) {
        return new Response(null, { status: 503 });
      }
      return new Response(new ArrayBuffer(8), { status: 200 });
    };
    const runtime = new WebAudioRuntime({
      fetch: fetcher,
      assetUrl: (path) => path,
      audioContextFactory: () => context,
      loopStartDelayMs: 0,
    });

    await runtime.unlock();
    runtime.playCue('error');
    await waitForTimers();

    const diagnostics = runtime.getDiagnostics();
    expect(diagnostics.status).toBe('ready');
    expect(diagnostics.failedAssetIds).toContain('ui_error');
    runtime.dispose();
  });
});
