import { GENERIC_ACTIVE_IDS, HERO_IDS } from '@jwgb/content';
import { playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation } from '@jwgb/sim';
import { addPlayerToState, createSimulationState } from '../packages/sim/src/state';
import { absorbDamageWithShields, addUniversalShield } from '../packages/sim/src/systems/shield';

describe('shield pipeline', () => {
  it('absorbs all verified damage forms before hit points', () => {
    const simulation = new GameSimulation({ rootSeed: 61 });
    const entity = simulation.addPlayer({
      playerId: playerId('iron-shirt'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.ironShirt,
      position: vec2Mm(0, 0),
    });

    simulation.submitIntent(entity, {
      sequence: 1,
      movement: vec2Mm(0, 0),
      aim: vec2Mm(0, -1_000),
      attack: false,
      targetEntityId: null,
      castActive: true,
      interact: false,
    });
    simulation.step();

    expect(simulation.getSnapshot().players[0]).toMatchObject({
      activeAbilityId: GENERIC_ACTIVE_IDS.ironShirt,
      activeCooldownTicks: 900,
      totalShield: 600,
      hp: 488,
    });

    expect(simulation.damage(entity, 250, null, 'storm')).toBe(250);
    expect(simulation.getSnapshot().players[0]).toMatchObject({
      totalShield: 350,
      hp: 488,
    });

    expect(simulation.damage(entity, 500, null, 'true')).toBe(500);
    expect(simulation.getSnapshot().players[0]).toMatchObject({
      totalShield: 0,
      hp: 338,
    });
  });

  it('keeps same-source instances independent and absorbs by expiry then creation order', () => {
    const state = createSimulationState(62);
    const player = addPlayerToState(state, {
      playerId: playerId('shield-order'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });
    const laterExpiry = addUniversalShield(state, player, GENERIC_ACTIVE_IDS.ironShirt, 200, 50);
    const earlierExpiry = addUniversalShield(state, player, GENERIC_ACTIVE_IDS.ironShirt, 300, 30);

    expect(player.shields).toHaveLength(2);
    expect(absorbDamageWithShields(player, 'basic', 250)).toEqual({
      absorbed: 250,
      remainingDamage: 0,
      brokenShields: [],
    });
    expect(earlierExpiry.remainingAmount).toBe(50);
    expect(laterExpiry.remainingAmount).toBe(200);
  });
});
