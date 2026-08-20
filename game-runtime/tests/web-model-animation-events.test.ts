import { activeId, entityId, heroId } from '@jwgb/core';
import type { SimEvent } from '@jwgb/sim';
import { collectModelAnimationEventTriggers } from '../apps/web/src/render/models/model-animation-events';

describe('web model animation events', () => {
  it('routes committed player basic hits to attack animations', () => {
    const playerEntityId = entityId(7);
    const events: SimEvent[] = [
      {
        type: 'basic-attack',
        tick: 20,
        sourceEntityId: playerEntityId,
        targetEntityId: entityId(99),
      },
      {
        type: 'damage',
        tick: 21,
        sourceEntityId: playerEntityId,
        targetEntityId: entityId(8),
        cause: 'basic',
        form: 'basic',
        isCritical: false,
        amount: 80,
        shieldDamage: 0,
        hpDamage: 80,
        shieldBypassHpDamage: 0,
        remainingHp: 920,
        remainingShield: 0,
      },
    ];

    const triggers = collectModelAnimationEventTriggers(events);
    expect(triggers.playerAttacks).toEqual(new Set([playerEntityId]));
  });

  it('does not route active or passive player damage to attack animations', () => {
    const events: SimEvent[] = [
      {
        type: 'damage',
        tick: 20,
        sourceEntityId: entityId(7),
        targetEntityId: entityId(8),
        cause: 'active',
        form: 'skill',
        isCritical: false,
        amount: 80,
        shieldDamage: 0,
        hpDamage: 80,
        shieldBypassHpDamage: 0,
        remainingHp: 920,
        remainingShield: 0,
      },
    ];

    expect(collectModelAnimationEventTriggers(events).playerAttacks.size).toBe(0);
  });

  it('routes successful player casts and core boss warnings to spell animations', () => {
    const playerEntityId = entityId(7);
    const bossEntityId = entityId(99);
    const events: SimEvent[] = [
      {
        type: 'active-cast',
        tick: 20,
        entityId: playerEntityId,
        heroId: heroId('H009'),
        activeAbilityId: activeId('H009'),
        activeName: '大闹天宫',
      },
      {
        type: 'core-boss-cast',
        tick: 20,
        bossEntityId,
        hazardEntityId: entityId(100),
        abilityId: 'meteor',
        phase: 'warning',
        center: { x: 0, z: 0 },
        activatesAtTick: 40,
      },
    ];

    const triggers = collectModelAnimationEventTriggers(events);
    expect(triggers.playerSpells).toEqual(new Set([playerEntityId]));
    expect(triggers.monsterSpells).toEqual(new Set([bossEntityId]));
  });

  it('does not replay spell animations for resolved or rejected casts', () => {
    const bossEntityId = entityId(99);
    const events: SimEvent[] = [
      {
        type: 'core-boss-cast',
        tick: 40,
        bossEntityId,
        hazardEntityId: entityId(100),
        abilityId: 'meteor',
        phase: 'resolved',
        center: { x: 0, z: 0 },
        activatesAtTick: 40,
      },
      {
        type: 'active-cast-blocked',
        tick: 40,
        entityId: entityId(7),
        heroId: heroId('H009'),
        activeAbilityId: activeId('H009'),
        activeName: '大闹天宫',
        reason: 'polymorphed',
      },
    ];

    const triggers = collectModelAnimationEventTriggers(events);
    expect(triggers.playerSpells.size).toBe(0);
    expect(triggers.monsterSpells.size).toBe(0);
  });
});
