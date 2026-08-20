import { GENERIC_ACTIVE_IDS, HERO_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { type DamageForm, GameSimulation, replaySimulation, type SimEvent } from '@jwgb/sim';
import { addPlayerToState, createSimulationState } from '../packages/sim/src/state';
import { applyDamage } from '../packages/sim/src/systems/damage';
import { advanceLifeStates } from '../packages/sim/src/systems/life';
import {
  addUniversalShield,
  advanceShields,
  getTotalShield,
} from '../packages/sim/src/systems/shield';

const ALL_DAMAGE_FORMS: readonly DamageForm[] = [
  'basic',
  'skill',
  'dot',
  'percent',
  'reflect',
  'true',
  'storm',
];

describe('D21 ice coffin', () => {
  it('locks movement and basic attacks immediately for exactly 80 ticks', () => {
    const simulation = new GameSimulation({ rootSeed: 921 });
    const caster = simulation.addPlayer({
      playerId: playerId('ice-caster'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.iceCoffin,
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('ice-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(4_000, 0),
    });
    simulation.drainEvents();

    simulation.submitIntent(
      caster,
      createPlayerIntent({
        sequence: 1,
        moveX: 1_000,
        moveZ: 0,
        aimX: 1_000,
        aimZ: 0,
        attack: true,
        targetEntityId: target,
        castActive: true,
      }),
    );
    simulation.step();

    expect(simulation.getSnapshot().players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: caster,
          position: vec2Mm(0, 0),
          iceCoffinTicks: 80,
          activeCooldownTicks: 1_500,
        }),
        expect.objectContaining({
          entityId: target,
          hp: 627,
        }),
      ]),
    );
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'active-cast',
        entityId: caster,
        activeAbilityId: GENERIC_ACTIVE_IDS.iceCoffin,
      }),
    );

    simulation.step(79);
    expect(simulation.getSnapshot().players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: caster,
          position: vec2Mm(0, 0),
          iceCoffinTicks: 1,
        }),
        expect.objectContaining({
          entityId: target,
          hp: 627,
        }),
      ]),
    );

    simulation.step();
    expect(simulation.getSnapshot().players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: caster,
          position: vec2Mm(150, 0),
          iceCoffinTicks: 0,
          activeCooldownTicks: 1_420,
        }),
        expect.objectContaining({
          entityId: target,
          hp: 567,
        }),
      ]),
    );
  });

  it('returns zero for all seven damage forms without consuming shields', () => {
    const state = createSimulationState(922);
    const player = addPlayerToState(state, {
      playerId: playerId('ice-damage'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.iceCoffin,
      position: vec2Mm(0, 0),
    });
    addUniversalShield(state, player, GENERIC_ACTIVE_IDS.ironShirt, 600, 100);
    player.iceCoffinTicks = 80;
    const events: SimEvent[] = [];

    for (const form of ALL_DAMAGE_FORMS) {
      expect(
        applyDamage(state, events, {
          sourceEntityId: null,
          targetEntityId: player.entityId,
          amount: 50,
          cause: 'debug',
          form,
        }),
      ).toBe(0);
    }

    expect(player.hp).toBe(player.maxHp);
    expect(getTotalShield(player)).toBe(600);
    expect(events).toEqual([]);
  });

  it('keeps unrelated cooldown, buff, and shield timers advancing', () => {
    const state = createSimulationState(923);
    const player = addPlayerToState(state, {
      playerId: playerId('ice-timers'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.iceCoffin,
      position: vec2Mm(0, 0),
    });
    player.attackCooldownTicks = 10;
    player.activeCooldownTicks = 20;
    player.activeBuffTicks = 30;
    player.b20ReviveBuffTicks = 40;
    player.iceCoffinTicks = 3;
    addUniversalShield(state, player, GENERIC_ACTIVE_IDS.ironShirt, 600, 1);

    state.tick = 1;
    advanceShields(state);
    advanceLifeStates(state, []);

    expect(player).toMatchObject({
      attackCooldownTicks: 9,
      activeCooldownTicks: 19,
      activeBuffTicks: 29,
      b20ReviveBuffTicks: 39,
      iceCoffinTicks: 2,
    });
    expect(getTotalShield(player)).toBe(0);
  });

  it('replays the lock state and cooldown to the same final hash', () => {
    const simulation = new GameSimulation({ rootSeed: 924 });
    const caster = simulation.addPlayer({
      playerId: playerId('ice-replay'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.iceCoffin,
      position: vec2Mm(0, 0),
    });
    simulation.submitIntent(
      caster,
      createPlayerIntent({
        sequence: 1,
        moveX: 1_000,
        moveZ: 0,
        attack: true,
        castActive: true,
      }),
    );
    simulation.step(25);
    const tape = simulation.exportReplay();

    expect(replaySimulation(tape).getStateHash()).toBe(tape.expectedStateHash);
  });
});
