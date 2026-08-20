import { EQUIPMENT_IDS, HERO_IDS, MAP_CHESTS } from '@jwgb/content';
import { playerId, vec2Mm } from '@jwgb/core';
import {
  AIRDROP_CHANNEL_TICKS,
  AIRDROP_EQUIPMENT_POOL,
  AIRDROP_INTERRUPT_MOVE_MM,
  AIRDROP_LIFETIME_TICKS,
  AIRDROP_REWARD_GOLD,
  AIRDROP_SCHEDULE_TICKS,
  AIRDROP_WARNING_TICKS,
  advanceAirdrops,
  GameSimulation,
  type MutableSimulationState,
} from '@jwgb/sim';
import { describe, expect, it } from 'vitest';
import { resolvePlayerForcedDisplacement } from '../packages/sim/src/systems/displacement';
import type { SimEvent } from '../packages/sim/src/types';

const LEGACY_POINTS = new Set([
  '0|60000',
  '42426|42426',
  '60000|0',
  '42426|-42426',
  '0|-60000',
  '-42426|-42426',
  '-60000|0',
  '-42426|42426',
  '0|0',
]);

function mutableState(simulation: GameSimulation): MutableSimulationState {
  return (simulation as unknown as { readonly state: MutableSimulationState }).state;
}

function createScenario(options: { readonly map?: boolean; readonly rootSeed?: number } = {}) {
  const simulation = new GameSimulation({
    rootSeed: options.rootSeed ?? 0xa1d0,
    map: { enabled: options.map ?? false },
  });
  const first = simulation.addPlayer({
    playerId: playerId(`airdrop-first-${options.rootSeed ?? 0xa1d0}`),
    heroId: HERO_IDS.sunWukong,
    position: vec2Mm(0, 0),
  });
  const second = simulation.addPlayer({
    playerId: playerId(`airdrop-second-${options.rootSeed ?? 0xa1d0}`),
    heroId: HERO_IDS.bullDemonKing,
    position: vec2Mm(100_000, 0),
  });
  const state = mutableState(simulation);
  state.match.status = 'running';
  state.match.startedAtTick = 0;
  simulation.drainEvents();
  return { simulation, state, first, second };
}

function advanceAt(state: MutableSimulationState, tick: number): readonly SimEvent[] {
  state.tick = tick;
  const events: SimEvent[] = [];
  advanceAirdrops(state, events);
  return events;
}

function availableAirdrop(
  state: MutableSimulationState,
  position = vec2Mm(0, 0),
): NonNullable<
  MutableSimulationState['airdrops'] extends Map<string, infer Value> ? Value : never
> {
  const airdrop = state.airdrops.get('airdrop-1');
  if (!airdrop) {
    throw new Error('airdrop-1 was not initialized');
  }
  airdrop.phase = 'available';
  airdrop.position = position;
  airdrop.announcedAtTick = 0;
  airdrop.landedAtTick = state.tick;
  airdrop.expiresAtTick = state.tick + AIRDROP_LIFETIME_TICKS;
  return airdrop;
}

function startChannel(
  scenario: ReturnType<typeof createScenario>,
  position = vec2Mm(0, 0),
): string {
  const { simulation, state, first } = scenario;
  const airdrop = availableAirdrop(state, position);
  const result = simulation.startAirdropOpenResult(first, airdrop.id);
  expect(result).toEqual({ accepted: true, code: 'accepted' });
  simulation.drainEvents();
  const channel = state.airdropChannels.get(first);
  if (!channel) {
    throw new Error('airdrop channel was not created');
  }
  return channel.airdropId;
}

describe('authoritative airdrops', () => {
  it('announces 15 seconds early and lands exactly at 6:00', () => {
    const scenario = createScenario();
    const warningTick = AIRDROP_SCHEDULE_TICKS[0] - AIRDROP_WARNING_TICKS;

    expect(advanceAt(scenario.state, warningTick - 1)).toEqual([]);
    const warning = advanceAt(scenario.state, warningTick);
    expect(warning).toContainEqual(
      expect.objectContaining({
        type: 'airdrop-warning',
        tick: warningTick,
        airdropId: 'airdrop-1',
        scheduledAtTick: AIRDROP_SCHEDULE_TICKS[0],
      }),
    );
    expect(scenario.state.airdrops.get('airdrop-1')?.phase).toBe('warning');

    const landed = advanceAt(scenario.state, AIRDROP_SCHEDULE_TICKS[0]);
    expect(landed).toContainEqual(
      expect.objectContaining({
        type: 'airdrop-landed',
        tick: AIRDROP_SCHEDULE_TICKS[0],
        airdropId: 'airdrop-1',
      }),
    );
    expect(scenario.state.airdrops.get('airdrop-1')?.phase).toBe('available');
    expect(scenario.state.airdrops.get('airdrop-1')?.expiresAtTick).toBe(
      AIRDROP_SCHEDULE_TICKS[0] + AIRDROP_LIFETIME_TICKS,
    );
  });

  it('uses legal map chest points and legacy fallback points', () => {
    const mapped = createScenario({ map: true, rootSeed: 0xa1d1 });
    const mappedEvents = advanceAt(mapped.state, AIRDROP_SCHEDULE_TICKS[0] - AIRDROP_WARNING_TICKS);
    const mappedPosition = mapped.state.airdrops.get('airdrop-1')?.position;
    expect(mappedEvents).toContainEqual(expect.objectContaining({ type: 'airdrop-warning' }));
    expect(
      MAP_CHESTS.some(
        (chest) => chest.position.x === mappedPosition?.x && chest.position.z === mappedPosition?.z,
      ),
    ).toBe(true);
    expect(mappedPosition).toBeDefined();
    if (mappedPosition) {
      expect(mapped.state.mapField?.isCircleBlocked(mappedPosition, 3_000)).toBe(false);
    }

    const legacy = createScenario({ rootSeed: 0xa1d2 });
    advanceAt(legacy.state, AIRDROP_SCHEDULE_TICKS[0] - AIRDROP_WARNING_TICKS);
    const legacyPosition = legacy.state.airdrops.get('airdrop-1')?.position;
    expect(legacyPosition).toBeDefined();
    if (legacyPosition) {
      expect(LEGACY_POINTS.has(`${legacyPosition.x}|${legacyPosition.z}`)).toBe(true);
      expect(legacyPosition.x ** 2 + legacyPosition.z ** 2).toBeLessThanOrEqual(
        (120_000 - 3_000) ** 2,
      );
    }
  });

  it('revalidates a reserved point against a new occupant and static wall at landing', () => {
    const scenario = createScenario({ rootSeed: 0xa1d3 });
    const warningTick = AIRDROP_SCHEDULE_TICKS[0] - AIRDROP_WARNING_TICKS;
    advanceAt(scenario.state, warningTick);
    const airdrop = scenario.state.airdrops.get('airdrop-1');
    if (!airdrop?.position) {
      throw new Error('airdrop warning point is missing');
    }
    const occupied = vec2Mm(airdrop.position.x, airdrop.position.z);
    const player = scenario.state.players.get(scenario.first);
    if (!player) {
      throw new Error('first player is missing');
    }
    player.position = occupied;
    scenario.state.staticSolids.push({
      solidId: 'new-landing-blocker',
      minimumX: occupied.x - 4_000,
      maximumX: occupied.x + 4_000,
      minimumZ: occupied.z - 4_000,
      maximumZ: occupied.z + 4_000,
    });

    const landed = advanceAt(scenario.state, AIRDROP_SCHEDULE_TICKS[0]);
    expect(landed).toContainEqual(expect.objectContaining({ type: 'airdrop-landed' }));
    expect(airdrop.phase).toBe('available');
    expect(airdrop.position).not.toEqual(occupied);
  });

  it('awards only the first completed channel and drops one G1-G9 gold item', () => {
    const scenario = createScenario({ rootSeed: 0xa1d4 });
    const position = vec2Mm(0, 0);
    const airdrop = availableAirdrop(scenario.state, position);
    const secondPlayer = scenario.state.players.get(scenario.second);
    if (!secondPlayer) {
      throw new Error('second player is missing');
    }
    secondPlayer.position = position;
    const first = scenario.simulation.startAirdropOpenResult(scenario.first, airdrop.id);
    const second = scenario.simulation.startAirdropOpenResult(scenario.second, airdrop.id);
    expect(first).toEqual({ accepted: true, code: 'accepted' });
    expect(second).toEqual({ accepted: true, code: 'accepted' });
    scenario.simulation.drainEvents();

    const firstChannel = scenario.state.airdropChannels.get(scenario.first);
    if (!firstChannel) {
      throw new Error('first channel is missing');
    }
    const completed = advanceAt(scenario.state, firstChannel.completesAtTick);
    const firstPlayer = scenario.state.players.get(scenario.first);
    const committedSecondPlayer = scenario.state.players.get(scenario.second);
    expect(firstPlayer?.gold).toBe(500 + AIRDROP_REWARD_GOLD);
    expect(committedSecondPlayer?.gold).toBe(500);
    expect(scenario.state.airdropChannels.size).toBe(0);
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'airdrop-opened',
        entityId: scenario.first,
        rewardGold: AIRDROP_REWARD_GOLD,
      }),
    );
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'airdrop-channel',
        entityId: scenario.second,
        phase: 'cancelled',
        reason: 'opened-by-other',
      }),
    );
    const equipment = scenario.state.airdrops.get('airdrop-1')?.equipmentId;
    expect(equipment).toBeDefined();
    expect(AIRDROP_EQUIPMENT_POOL).toContain(equipment);
    expect(equipment).not.toBe(EQUIPMENT_IDS.goldenCudgel);
    expect(scenario.simulation.getSnapshot().lootDrops).toHaveLength(1);
  });

  it('is deterministic on the airdrop stream even when combat consumes random values', () => {
    const clean = createScenario({ rootSeed: 0xa1d5 });
    const noisy = createScenario({ rootSeed: 0xa1d5 });
    const cleanAirdrop = availableAirdrop(clean.state);
    const noisyAirdrop = availableAirdrop(noisy.state);
    for (let index = 0; index < 200; index += 1) {
      noisy.state.random.combat.nextUint32();
    }

    expect(clean.simulation.startAirdropOpenResult(clean.first, cleanAirdrop.id).accepted).toBe(
      true,
    );
    expect(noisy.simulation.startAirdropOpenResult(noisy.first, noisyAirdrop.id).accepted).toBe(
      true,
    );
    clean.simulation.drainEvents();
    noisy.simulation.drainEvents();
    const cleanChannel = clean.state.airdropChannels.get(clean.first);
    const noisyChannel = noisy.state.airdropChannels.get(noisy.first);
    if (!cleanChannel || !noisyChannel) {
      throw new Error('determinism channel setup failed');
    }
    advanceAt(clean.state, cleanChannel.completesAtTick);
    advanceAt(noisy.state, noisyChannel.completesAtTick);
    expect(clean.state.airdrops.get('airdrop-1')?.equipmentId).toBe(
      noisy.state.airdrops.get('airdrop-1')?.equipmentId,
    );
  });

  it.each([
    [
      'movement',
      (scenario: ReturnType<typeof createScenario>) => {
        const player = scenario.state.players.get(scenario.first);
        if (!player) throw new Error('player missing');
        player.position = vec2Mm(AIRDROP_INTERRUPT_MOVE_MM + 1, 0);
        advanceAt(scenario.state, scenario.state.tick + 1);
      },
    ],
    [
      'damage',
      (scenario: ReturnType<typeof createScenario>) => {
        scenario.simulation.damage(scenario.first, 1, scenario.second, 'basic');
      },
    ],
    [
      'forced-displacement',
      (scenario: ReturnType<typeof createScenario>) => {
        const player = scenario.state.players.get(scenario.first);
        if (!player) throw new Error('player missing');
        const events: SimEvent[] = [];
        player.position = resolvePlayerForcedDisplacement(
          scenario.state,
          events,
          player,
          vec2Mm(1_000, 0),
          450,
        );
      },
    ],
    [
      'hard-control',
      (scenario: ReturnType<typeof createScenario>) => {
        expect(scenario.simulation.hardControl(scenario.first, 5)).toBe(true);
      },
    ],
    [
      'true-death',
      (scenario: ReturnType<typeof createScenario>) => {
        scenario.simulation.damage(scenario.first, 99_999, null, 'storm');
      },
    ],
  ] as const)('cancels a channel on %s', (_reason, interrupt) => {
    const scenario = createScenario({ rootSeed: 0xa1e0 + _reason.length });
    startChannel(scenario);
    interrupt(scenario);
    expect(scenario.state.airdropChannels.has(scenario.first)).toBe(false);
  });

  it('does not cancel for storm damage, slow, silence, or a root alone', () => {
    const storm = createScenario({ rootSeed: 0xa1e1 });
    startChannel(storm);
    expect(storm.simulation.damage(storm.first, 1, null, 'storm')).toBeGreaterThan(0);
    expect(storm.state.airdropChannels.has(storm.first)).toBe(true);

    const statuses = createScenario({ rootSeed: 0xa1e2 });
    startChannel(statuses);
    const player = statuses.state.players.get(statuses.first);
    if (!player) {
      throw new Error('status test player is missing');
    }
    player.slowTicks = 20;
    player.silenceTicks = 20;
    player.displacementLockTicks = 20;
    advanceAt(statuses.state, statuses.state.tick + 1);
    expect(statuses.state.airdropChannels.has(statuses.first)).toBe(true);
  });

  it('expires an unopened chest after 120 seconds', () => {
    const scenario = createScenario({ rootSeed: 0xa1e3 });
    const airdrop = availableAirdrop(scenario.state);
    const result = scenario.simulation.startAirdropOpenResult(scenario.first, airdrop.id);
    expect(result.accepted).toBe(true);
    scenario.simulation.drainEvents();
    const channel = scenario.state.airdropChannels.get(scenario.first);
    if (!channel) {
      throw new Error('expiry channel is missing');
    }
    const events = advanceAt(
      scenario.state,
      airdrop.expiresAtTick ?? channel.completesAtTick + AIRDROP_LIFETIME_TICKS,
    );
    expect(airdrop.phase).toBe('expired');
    expect(scenario.state.airdropChannels.size).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'airdrop-expired', airdropId: airdrop.id }),
    );
  });

  it('keeps the equipment result inside the authored G1-G9 pool across many seeds', () => {
    const allowed = new Set(AIRDROP_EQUIPMENT_POOL);
    for (let rootSeed = 1; rootSeed <= 128; rootSeed += 1) {
      const scenario = createScenario({ rootSeed: 0xb000 + rootSeed });
      const airdrop = availableAirdrop(scenario.state);
      expect(scenario.simulation.startAirdropOpenResult(scenario.first, airdrop.id).accepted).toBe(
        true,
      );
      scenario.simulation.drainEvents();
      const channel = scenario.state.airdropChannels.get(scenario.first);
      if (!channel) {
        throw new Error('pool channel is missing');
      }
      advanceAt(scenario.state, channel.completesAtTick);
      const equipmentId = airdrop.equipmentId;
      expect(allowed.has(equipmentId as (typeof AIRDROP_EQUIPMENT_POOL)[number])).toBe(true);
      expect(equipmentId).not.toBe(EQUIPMENT_IDS.goldenCudgel);
    }
  });

  it('exposes the fixed schedule and channel duration as deterministic ticks', () => {
    expect(AIRDROP_SCHEDULE_TICKS).toEqual([7_200, 14_400, 21_600]);
    expect(AIRDROP_WARNING_TICKS).toBe(300);
    expect(AIRDROP_CHANNEL_TICKS).toBe(60);
  });
});
