import { createPlayerIntent, heroId } from '@jwgb/core';
import { replaySimulation } from '@jwgb/sim';
import type { InputController } from '../apps/web/src/input/input-controller';
import { localWorldScenarioFromActive } from '../apps/web/src/runtime/local-scenario';
import { LocalWorldHost } from '../apps/web/src/runtime/local-world-host';

describe('local M1 match', () => {
  it('runs deterministically to one winner after bots retarget eliminated opponents', () => {
    const host = new LocalWorldHost();
    const input = {
      sample(sequence: number) {
        return createPlayerIntent({
          sequence,
          moveX: 0,
          moveZ: 0,
          attack: true,
        });
      },
    } as InputController;
    let snapshot = host.getSnapshot();

    for (let frame = 0; frame < 1_000 && snapshot.match.status !== 'finished'; frame += 1) {
      const nextSnapshot = host.update(250, input).snapshot;
      if (!nextSnapshot) {
        throw new Error('local host must always produce a snapshot');
      }
      snapshot = nextSnapshot;
    }

    expect(snapshot.match).toEqual({
      status: 'finished',
      startedAtTick: 0,
      finishedAtTick: 3_241,
      outcome: 'winner',
      winnerEntityId: 2,
      winnerEntityIds: [2],
      placements: [2, 1, 3],
      placementGroups: [[2], [1], [3]],
      voidAbortReason: null,
      mmrEligible: true,
      cultivationAwards: [],
      diagnosticReplayRequired: false,
    });
    expect(snapshot.players.filter((player) => player.lifeState === 'alive')).toHaveLength(1);
    const tape = host.exportReplay();
    expect(replaySimulation(tape).getStateHash()).toBe(tape.expectedStateHash);
  }, 120_000);
});

describe('local MAP match', () => {
  it('uses an explicitly requested local hero', () => {
    const host = new LocalWorldHost({
      ...localWorldScenarioFromActive('MAP'),
      localHeroId: heroId('H018'),
    });

    const localPlayer = host
      .getSnapshot()
      .players.find((player) => player.entityId === host.localEntityId);
    expect(localPlayer?.heroId).toBe(heroId('H018'));
  });

  it('keeps deferred presentation hashes exact when a caller reads them', () => {
    const host = new LocalWorldHost(localWorldScenarioFromActive('MAP'));
    const input = {
      sample(sequence: number) {
        return createPlayerIntent({
          sequence,
          moveX: 0,
          moveZ: 0,
        });
      },
    } as InputController;
    const frame = host.update(50, input);

    expect(frame.snapshot?.tick).toBeGreaterThan(0);
    expect(frame.snapshot?.stateHash).toBe(host.getSnapshot().stateHash);
  });

  it('uses the full authoritative PVE population and configured bot roster', () => {
    const scenario = localWorldScenarioFromActive('MAP');
    const host = new LocalWorldHost(scenario);
    const localSnapshot = host.getSnapshot();
    const tape = host.exportReplay();
    const authoritative = replaySimulation(tape).getSnapshot();

    expect(scenario.pve).toEqual({ enabled: true, population: 'full' });
    expect(tape.pve).toEqual({ enabled: true, population: 'full' });
    expect(localSnapshot.players).toHaveLength(7);
    expect(localSnapshot.monsters).toHaveLength(123);
    expect(authoritative.players).toHaveLength(7);
    expect(authoritative.monsters).toHaveLength(123);
    expect(new Set(authoritative.players.map((player) => player.playerId)).size).toBe(7);
  });

  it('keeps the full PVE population after a local restart', () => {
    const host = new LocalWorldHost(localWorldScenarioFromActive('MAP'));
    const firstTape = host.exportReplay();

    host.reset();

    const secondTape = host.exportReplay();
    const first = replaySimulation(firstTape).getSnapshot();
    const second = replaySimulation(secondTape).getSnapshot();

    expect(secondTape.pve).toEqual(firstTape.pve);
    expect(second.players).toHaveLength(first.players.length);
    expect(second.monsters).toHaveLength(first.monsters.length);
    expect(second.stateHash).toBe(first.stateHash);
  });
});
