import { EQUIPMENT_IDS, GENERIC_ACTIVE_IDS, HERO_IDS, PASSIVE_IDS } from '@jwgb/content';
import { activeId, createPlayerIntent, heroId, playerId, vec2Mm } from '@jwgb/core';
import { addUniversalShield, GameSimulation, type MutableSimulationState } from '@jwgb/sim';
import {
  applyActiveRoot,
  applyActiveSilence,
  applyActiveSlow,
  applyPolymorph,
} from '../packages/sim/src/systems/active-damage';
import { resolveTargetForcedDisplacement } from '../packages/sim/src/systems/displacement';
import { getOrCreatePassiveTargetState } from '../packages/sim/src/systems/passive-runtime';
import { currentMoveSpeedMmPerSecond } from '../packages/sim/src/systems/player-speed';

function stateOf(simulation: GameSimulation): MutableSimulationState {
  return (simulation as unknown as { readonly state: MutableSimulationState }).state;
}

function playerOf(simulation: GameSimulation, entityId: ReturnType<GameSimulation['addPlayer']>) {
  const player = stateOf(simulation).players.get(entityId);
  if (!player) {
    throw new Error(`missing player ${entityId}`);
  }
  return player;
}

describe('B14, P16, and P18 authoritative equipment runtime', () => {
  it('triggers B14 only for an offensive commit and applies the final speed multiplier', () => {
    const simulation = new GameSimulation({ rootSeed: 0x9101 });
    const attacker = simulation.addPlayer({
      playerId: playerId('dormant-basic-attacker'),
      heroId: HERO_IDS.sunWukong,
      equipmentIds: [EQUIPMENT_IDS.dormantBoots],
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('dormant-basic-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(1_000, 0),
    });
    const attackerState = playerOf(simulation, attacker);
    attackerState.stealthTicks = 100;
    const speedBefore = currentMoveSpeedMmPerSecond(stateOf(simulation), attackerState);

    simulation.submitIntent(
      attacker,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step();

    expect(attackerState.dormantBootsSpeedTicks).toBe(40);
    expect(attackerState.dormantBootsCooldownTicks).toBe(160);
    expect(currentMoveSpeedMmPerSecond(stateOf(simulation), attackerState)).toBe(
      Math.trunc((speedBefore * 13) / 10),
    );
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'equipment-proc',
        equipmentId: EQUIPMENT_IDS.dormantBoots,
        detail: 'hostile-basic-commit',
        targetEntityId: target,
      }),
    );

    const fortuneSimulation = new GameSimulation({ rootSeed: 0x9102 });
    const fortuneOwner = fortuneSimulation.addPlayer({
      playerId: playerId('dormant-fortune-owner'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.fortune,
      equipmentIds: [EQUIPMENT_IDS.dormantBoots],
      position: vec2Mm(0, 0),
    });
    const fortuneState = playerOf(fortuneSimulation, fortuneOwner);
    fortuneState.stealthTicks = 100;
    fortuneSimulation.submitIntent(
      fortuneOwner,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
      }),
    );
    fortuneSimulation.step();
    expect(fortuneState.dormantBootsSpeedTicks).toBe(0);
    expect(
      fortuneSimulation
        .drainEvents()
        .some(
          (event) =>
            event.type === 'equipment-proc' && event.equipmentId === EQUIPMENT_IDS.dormantBoots,
        ),
    ).toBe(false);

    const activeSimulation = new GameSimulation({ rootSeed: 0x9107 });
    const activeOwner = activeSimulation.addPlayer({
      playerId: playerId('dormant-hostile-active-owner'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: GENERIC_ACTIVE_IDS.lightning,
      equipmentIds: [EQUIPMENT_IDS.dormantBoots],
      position: vec2Mm(0, 0),
    });
    const activeTarget = activeSimulation.addPlayer({
      playerId: playerId('dormant-hostile-active-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(5_000, 0),
    });
    const activeOwnerState = playerOf(activeSimulation, activeOwner);
    activeOwnerState.stealthTicks = 100;
    activeSimulation.submitIntent(
      activeOwner,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
        targetEntityId: activeTarget,
      }),
    );
    activeSimulation.step();
    expect(activeOwnerState.dormantBootsSpeedTicks).toBe(40);
    expect(activeSimulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'equipment-proc',
        equipmentId: EQUIPMENT_IDS.dormantBoots,
        detail: 'hostile-active-commit',
      }),
    );

    const petrifySimulation = new GameSimulation({ rootSeed: 0x9108 });
    const petrifyOwner = petrifySimulation.addPlayer({
      playerId: playerId('dormant-petrify-owner'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: activeId('H037'),
      equipmentIds: [EQUIPMENT_IDS.dormantBoots],
      position: vec2Mm(0, 0),
    });
    const petrifyTarget = petrifySimulation.addPlayer({
      playerId: playerId('dormant-petrify-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(5_000, 0),
    });
    const petrifyOwnerState = playerOf(petrifySimulation, petrifyOwner);
    petrifyOwnerState.stealthTicks = 100;
    petrifySimulation.submitIntent(
      petrifyOwner,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
        targetEntityId: petrifyTarget,
      }),
    );
    petrifySimulation.step();
    expect(petrifyOwnerState.dormantBootsSpeedTicks).toBe(40);

    const selfPetrifySimulation = new GameSimulation({ rootSeed: 0x9109 });
    const selfPetrifyOwner = selfPetrifySimulation.addPlayer({
      playerId: playerId('dormant-self-petrify-owner'),
      heroId: HERO_IDS.sunWukong,
      activeAbilityId: activeId('H037'),
      equipmentIds: [EQUIPMENT_IDS.dormantBoots],
      position: vec2Mm(0, 0),
    });
    const selfPetrifyOwnerState = playerOf(selfPetrifySimulation, selfPetrifyOwner);
    selfPetrifyOwnerState.stealthTicks = 100;
    selfPetrifySimulation.submitIntent(
      selfPetrifyOwner,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
        targetEntityId: selfPetrifyOwner,
      }),
    );
    selfPetrifySimulation.step();
    expect(selfPetrifyOwnerState.dormantBootsSpeedTicks).toBe(0);
  });

  it('clears B14 and P16 transient state on item removal and true death', () => {
    const simulation = new GameSimulation({ rootSeed: 0x9103 });
    const owner = simulation.addPlayer({
      playerId: playerId('transient-owner'),
      heroId: HERO_IDS.sunWukong,
      equipmentIds: [EQUIPMENT_IDS.dormantBoots, EQUIPMENT_IDS.comboShoes],
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('transient-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(1_000, 0),
    });
    const ownerState = playerOf(simulation, owner);
    const targetState = playerOf(simulation, target);
    ownerState.dormantBootsSpeedTicks = 20;
    ownerState.dormantBootsCooldownTicks = 80;
    const comboState = getOrCreatePassiveTargetState(stateOf(simulation), owner, target);
    comboState.comboShoesStacks = 4;
    comboState.comboShoesExpiresAtTick = 100;

    const boots = ownerState.equipment.find(
      (instance) => instance.equipmentId === EQUIPMENT_IDS.dormantBoots,
    );
    if (!boots) {
      throw new Error('dormant boots missing');
    }
    expect(simulation.unequipEquipmentResult(owner, boots.instanceId).accepted).toBe(true);
    expect(ownerState.dormantBootsSpeedTicks).toBe(0);
    expect(ownerState.dormantBootsCooldownTicks).toBe(0);

    const combo = ownerState.equipment.find(
      (instance) => instance.equipmentId === EQUIPMENT_IDS.comboShoes,
    );
    if (!combo) {
      throw new Error('combo shoes missing');
    }
    getOrCreatePassiveTargetState(stateOf(simulation), owner, target).comboShoesStacks = 4;
    simulation.damage(owner, 999_999);
    expect(ownerState.dormantBootsSpeedTicks).toBe(0);
    expect(ownerState.dormantBootsCooldownTicks).toBe(0);
    expect(comboState.comboShoesStacks).toBe(0);
    expect(targetState.lifeState).toBe('alive');
  });

  it('stacks P16 only on actual basic damage, snapshots attack speed, and retargets cleanly', () => {
    const simulation = new GameSimulation({ rootSeed: 0x9104 });
    const owner = simulation.addPlayer({
      playerId: playerId('combo-owner'),
      heroId: HERO_IDS.sunWukong,
      equipmentIds: [EQUIPMENT_IDS.comboShoes],
      position: vec2Mm(0, 0),
    });
    const firstTarget = simulation.addPlayer({
      playerId: playerId('combo-first-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(1_000, 0),
    });
    const secondTarget = simulation.addPlayer({
      playerId: playerId('combo-second-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(2_000, 0),
    });
    const ownerState = playerOf(simulation, owner);
    const firstState = playerOf(simulation, firstTarget);
    const state = stateOf(simulation);

    simulation.submitIntent(
      owner,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: firstTarget,
      }),
    );
    simulation.step();
    const firstCombo = getOrCreatePassiveTargetState(state, owner, firstTarget);
    expect(firstCombo.comboShoesStacks).toBe(1);

    ownerState.attackCooldownTicks = 0;
    simulation.step();
    expect(firstCombo.comboShoesStacks).toBe(2);
    expect(ownerState.attackCooldownTicks).toBe(14);

    ownerState.attackCooldownTicks = 0;
    simulation.submitIntent(
      owner,
      createPlayerIntent({
        sequence: 2,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: secondTarget,
      }),
    );
    simulation.step();
    expect(firstCombo.comboShoesStacks).toBe(0);
    expect(getOrCreatePassiveTargetState(state, owner, secondTarget).comboShoesStacks).toBe(1);

    ownerState.attackCooldownTicks = 0;
    firstState.invulnerableTicks = 10;
    simulation.submitIntent(
      owner,
      createPlayerIntent({
        sequence: 3,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: firstTarget,
      }),
    );
    simulation.step();
    expect(firstCombo.comboShoesStacks).toBe(0);

    const hpBeforeShieldedHit = firstState.hp;
    addUniversalShield(state, firstState, GENERIC_ACTIVE_IDS.ironShirt, 1_000, 20);
    firstState.invulnerableTicks = 0;
    ownerState.attackCooldownTicks = 0;
    simulation.submitIntent(
      owner,
      createPlayerIntent({
        sequence: 4,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: firstTarget,
      }),
    );
    simulation.step();
    expect(firstCombo.comboShoesStacks).toBe(1);
    expect(firstState.hp).toBe(hpBeforeShieldedHit);
  });

  it('counts each B11 extra basic hit as one eligible P16 stack event', () => {
    const simulation = new GameSimulation({ rootSeed: 3 });
    const owner = simulation.addPlayer({
      playerId: playerId('combo-extra-hit-owner'),
      heroId: HERO_IDS.sunWukong,
      equipmentIds: [EQUIPMENT_IDS.comboShoes],
      passives: [{ passiveId: PASSIVE_IDS.combo, level: 5 }],
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('combo-extra-hit-target'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(1_000, 0),
    });
    simulation.submitIntent(
      owner,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        attack: true,
        targetEntityId: target,
      }),
    );
    simulation.step();
    expect(getOrCreatePassiveTargetState(stateOf(simulation), owner, target).comboShoesStacks).toBe(
      2,
    );
  });

  it('takes the stronger forced-movement resistance and applies P18 after source extension', () => {
    const simulation = new GameSimulation({ rootSeed: 0x9105 });
    const caster = simulation.addPlayer({
      playerId: playerId('control-caster'),
      heroId: heroId('H026'),
      equipmentIds: [EQUIPMENT_IDS.goldRope],
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('control-target'),
      heroId: HERO_IDS.bullDemonKing,
      equipmentIds: [EQUIPMENT_IDS.windPearl, EQUIPMENT_IDS.bedrockBoots],
      position: vec2Mm(10_000, 0),
    });
    const state = stateOf(simulation);
    const targetState = playerOf(simulation, target);
    const displaced = resolveTargetForcedDisplacement(
      state,
      [],
      targetState,
      targetState.position,
      vec2Mm(20_000, 0),
      450,
    );
    expect(displaced.x).toBe(13_000);

    simulation.submitIntent(
      caster,
      createPlayerIntent({
        sequence: 1,
        moveX: 0,
        moveZ: 0,
        castActive: true,
        targetEntityId: target,
      }),
    );
    simulation.step();
    expect(targetState.hardControlTicks).toBe(15);

    targetState.hardControlTicks = 0;
    targetState.b20ReviveBuffTicks = 20;
    expect(simulation.hardControl(target, 100)).toBe(false);
    expect(targetState.hardControlTicks).toBe(0);
  });

  it('applies P18 to root and transform but leaves slow and silence unchanged', () => {
    const simulation = new GameSimulation({ rootSeed: 0x9108 });
    const source = simulation.addPlayer({
      playerId: playerId('bedrock-control-source'),
      heroId: HERO_IDS.sunWukong,
      equipmentIds: [EQUIPMENT_IDS.goldRope],
      position: vec2Mm(0, 0),
    });
    const target = simulation.addPlayer({
      playerId: playerId('bedrock-control-target'),
      heroId: HERO_IDS.bullDemonKing,
      equipmentIds: [EQUIPMENT_IDS.bedrockBoots],
      position: vec2Mm(1_000, 0),
    });
    const state = stateOf(simulation);
    const sourceState = playerOf(simulation, source);
    const targetState = playerOf(simulation, target);

    applyActiveRoot(state, [], targetState, 40, sourceState);
    expect(targetState.displacementLockTicks).toBe(15);
    applyPolymorph(state, [], targetState, 40, 30, sourceState);
    expect(targetState.polymorphTicks).toBe(15);
    applyActiveSlow(targetState, 50, 40);
    applyActiveSilence(targetState, 40);
    expect(targetState.slowTicks).toBe(40);
    expect(targetState.silenceTicks).toBe(40);
  });

  it('keeps immunity at zero instead of applying the P18 minimum', () => {
    const simulation = new GameSimulation({ rootSeed: 0x9106 });
    const target = simulation.addPlayer({
      playerId: playerId('immune-bedrock-target'),
      heroId: HERO_IDS.sunWukong,
      equipmentIds: [EQUIPMENT_IDS.bedrockBoots],
      passives: [{ passiveId: PASSIVE_IDS.passiveRevive, level: 5 }],
      position: vec2Mm(0, 0),
    });
    const targetState = playerOf(simulation, target);
    targetState.b20ReviveBuffTicks = 20;
    expect(simulation.hardControl(target, 20)).toBe(false);
    expect(targetState.hardControlTicks).toBe(0);
    targetState.b20ReviveBuffTicks = 0;
    expect(simulation.hardControl(target, 10)).toBe(true);
    expect(targetState.hardControlTicks).toBe(6);
  });
});
