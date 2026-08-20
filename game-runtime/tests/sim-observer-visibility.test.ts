import { HERO_IDS } from '@jwgb/content';
import { entityId, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation } from '@jwgb/sim';
import { describe, expect, it } from 'vitest';
import type { MutableSimulationState } from '../packages/sim/src/types';

function mutableState(simulation: GameSimulation): MutableSimulationState {
  return (simulation as unknown as { readonly state: MutableSimulationState }).state;
}

describe('observer world views', () => {
  it('hides distant players, loot, and projectiles without changing the authority hash', () => {
    const simulation = new GameSimulation({ rootSeed: 0x51_6e });
    const observer = simulation.addPlayer({
      playerId: playerId('observer'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });
    const nearby = simulation.addPlayer({
      playerId: playerId('nearby'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(10_000, 0),
    });
    const distant = simulation.addPlayer({
      playerId: playerId('distant'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(40_000, 0),
    });
    const state = mutableState(simulation);
    const nearbyLoot = entityId(100);
    const distantLoot = entityId(101);
    state.lootDrops.set(nearbyLoot, {
      entityId: nearbyLoot,
      position: vec2Mm(5_000, 0),
      gold: 10,
      experience: 0,
      gems: 0,
      equipmentId: null,
      bookPassiveId: null,
      createdAtTick: 0,
      expiresAtTick: 1_000,
    });
    state.lootDrops.set(distantLoot, {
      entityId: distantLoot,
      position: vec2Mm(40_000, 0),
      gold: 100,
      experience: 0,
      gems: 0,
      equipmentId: null,
      bookPassiveId: null,
      createdAtTick: 0,
      expiresAtTick: 1_000,
    });
    const distantProjectile = entityId(102);
    const distantOwner = state.players.get(distant);
    if (!distantOwner) {
      throw new Error('distant observer fixture player is missing');
    }
    state.projectiles.set(distantProjectile, {
      entityId: distantProjectile,
      kind: 'basic',
      ownerEntityId: distant,
      targetEntityId: nearby,
      position: vec2Mm(40_000, 0),
      speedMmPerSecond: 10_000,
      collisionRadiusMm: 250,
      sourceElement: distantOwner.element,
      baseDamage: 10,
      outgoingDamageBasisPoints: 10_000,
      createdAtTick: 0,
      remainingTravelMm: 20_000,
      movementRemainder: 0,
    });

    const full = simulation.getSnapshot();
    const view = simulation.getObserverSnapshot(observer);

    expect(view.stateHash).toBe(full.stateHash);
    expect(view.players.map((player) => player.entityId)).toEqual([observer, nearby]);
    expect(view.lootDrops.map((drop) => drop.entityId)).toEqual([nearbyLoot]);
    expect(view.projectiles).toEqual([]);
  });

  it('hides otherwise-near entities behind a static rectangular blocker', () => {
    const simulation = new GameSimulation({
      rootSeed: 0x51_6f,
      staticSolids: [
        {
          solidId: 'observer-wall',
          minimumX: 4_500,
          maximumX: 5_500,
          minimumZ: -2_000,
          maximumZ: 2_000,
        },
      ],
    });
    const observer = simulation.addPlayer({
      playerId: playerId('wall-observer'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });
    simulation.addPlayer({
      playerId: playerId('behind-wall'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(10_000, 0),
    });
    const state = mutableState(simulation);
    const hiddenLoot = entityId(100);
    state.lootDrops.set(hiddenLoot, {
      entityId: hiddenLoot,
      position: vec2Mm(10_000, 0),
      gold: 10,
      experience: 0,
      gems: 0,
      equipmentId: null,
      bookPassiveId: null,
      createdAtTick: 0,
      expiresAtTick: 1_000,
    });

    const view = simulation.getObserverSnapshot(observer);

    expect(view.players.map((player) => player.entityId)).toEqual([observer]);
    expect(view.lootDrops).toEqual([]);
  });
});
