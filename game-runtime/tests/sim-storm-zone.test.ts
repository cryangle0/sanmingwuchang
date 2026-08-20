import { HERO_IDS, M0_RULES, MAP_COURTS } from '@jwgb/content';
import { entityId, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation } from '@jwgb/sim';
import { describe, expect, it } from 'vitest';
import { advanceLifeStates, beginTrueDeath } from '../packages/sim/src/systems/life';
import { advanceStormZone } from '../packages/sim/src/systems/storm-zone';
import type { MutableSimulationState, SimEvent } from '../packages/sim/src/types';

const tickAt = (minutes: number, seconds = 0): number => (minutes * 60 + seconds) * 20;

function mapMatch(seed: number): GameSimulation {
  const simulation = new GameSimulation({
    rootSeed: seed,
    map: { enabled: true },
  });
  simulation.addPlayer({
    playerId: playerId(`storm-a-${seed}`),
    heroId: HERO_IDS.sunWukong,
    position: vec2Mm(0, 0),
  });
  simulation.addPlayer({
    playerId: playerId(`storm-b-${seed}`),
    heroId: HERO_IDS.bullDemonKing,
    position: vec2Mm(1_000, 0),
  });
  return simulation;
}

function internalState(simulation: GameSimulation): MutableSimulationState {
  return (simulation as unknown as { readonly state: MutableSimulationState }).state;
}

describe('authoritative storm zone', () => {
  it('selects and announces one map court from an isolated layout stream', () => {
    const simulation = mapMatch(0x5a17);
    const initial = simulation.getSnapshot();
    expect(MAP_COURTS.some((court) => court.id === initial.stormZone.selectedCourtId)).toBe(true);
    expect(initial.stormZone.courtAnnounced).toBe(false);

    simulation.step(M0_RULES.stormCourtAnnouncementTick);
    const snapshot = simulation.getSnapshot();
    expect(snapshot.stormZone.courtAnnounced).toBe(true);
    expect(snapshot.stormZone.radiusMm).toBe(240_000);

    const announcement = simulation
      .drainEvents()
      .find((event) => event.type === 'final-court-announced');
    expect(announcement?.type).toBe('final-court-announced');
    if (announcement?.type === 'final-court-announced') {
      expect(announcement.courtId).toBe(snapshot.stormZone.selectedCourtId);
    }
  });

  it('uses the accepted 150-second shrink windows and moves the center in two legs', () => {
    const simulation = mapMatch(0x5a18);
    simulation.step(tickAt(5));
    expect(simulation.getSnapshot().stormZone.radiusMm).toBe(520_000);
    simulation.step(20);
    expect(simulation.getSnapshot().stormZone.radiusMm).toBeLessThan(520_000);

    simulation.step(tickAt(7, 30) - simulation.tick);
    expect(simulation.getSnapshot().stormZone.radiusMm).toBe(320_000);
    simulation.step(tickAt(10) - simulation.tick);
    expect(simulation.getSnapshot().stormZone.radiusMm).toBe(320_000);
    simulation.step(tickAt(12, 30) - simulation.tick);
    expect(simulation.getSnapshot().stormZone.radiusMm).toBe(220_000);

    const originAtThirteen = simulation.getSnapshot().stormZone.center;
    simulation.step(tickAt(13) - simulation.tick + 1);
    const centerAtThirteen = simulation.getSnapshot().stormZone.center;
    expect(centerAtThirteen).not.toEqual(originAtThirteen);

    simulation.step(tickAt(15) - simulation.tick);
    const centerAtFifteen = simulation.getSnapshot().stormZone.center;
    expect(centerAtFifteen).not.toEqual(centerAtThirteen);
    expect(simulation.getSnapshot().stormZone.radiusMm).toBeLessThanOrEqual(220_000);

    simulation.step(tickAt(17, 30) - simulation.tick);
    const finalCourt = MAP_COURTS.find(
      (court) => court.id === simulation.getSnapshot().stormZone.selectedCourtId,
    );
    expect(finalCourt).toBeDefined();
    expect(simulation.getSnapshot().stormZone.center).toEqual({
      x: finalCourt?.center.x,
      z: finalCourt?.center.z,
    });
    expect(simulation.getSnapshot().stormZone.radiusMm).toBe(140_000);
  });

  it('emits the five-second warning before zero and then starts the apocalypse state', () => {
    const simulation = mapMatch(0x5a19);
    simulation.step(M0_RULES.stormWarningTick);
    expect(simulation.getSnapshot().stormZone.apocalypseWarning).toBe(true);
    expect(simulation.drainEvents().some((event) => event.type === 'apocalypse-warning')).toBe(
      true,
    );

    simulation.step(M0_RULES.apocalypseStartTick - simulation.tick);
    expect(simulation.getSnapshot().stormZone).toMatchObject({
      radiusMm: 0,
      apocalypseWarning: true,
      apocalypseStarted: true,
    });
    expect(simulation.drainEvents().some((event) => event.type === 'apocalypse-started')).toBe(
      true,
    );
  });

  it('uses a deterministic fallback and still respawns when the safe radius is zero', () => {
    const simulation = mapMatch(0x5a1a);
    const state = internalState(simulation);
    const player = state.players.get(entityId(1));
    if (!player) {
      throw new Error('missing test player');
    }
    const events: SimEvent[] = [];
    player.hp = 1;
    player.livesRemaining = 2;
    player.trueDeaths = 1;
    beginTrueDeath(state, events, player);

    state.tick = M0_RULES.apocalypseStartTick;
    advanceStormZone(state, events);
    expect(state.stormZone.radiusMm).toBe(0);

    for (let count = 0; count < 400 && player.lifeState === 'soul-flight'; count += 1) {
      state.tick += 1;
      advanceLifeStates(state, events);
    }

    expect(player.lifeState).toBe('revive-protection');
    expect(player.respawnTarget).toBeNull();
    expect(events.some((event) => event.type === 'respawn')).toBe(true);
  });
});
