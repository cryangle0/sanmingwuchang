import { EQUIPMENT_IDS, HERO_IDS } from '@jwgb/content';
import { playerId, vec2Mm } from '@jwgb/core';
import { createEquipmentInstance, GameSimulation, type MutableSimulationState } from '@jwgb/sim';

function mutableState(simulation: GameSimulation): MutableSimulationState {
  return (simulation as unknown as { state: MutableSimulationState }).state;
}

function mutablePlayer(
  simulation: GameSimulation,
  entityId: ReturnType<GameSimulation['addPlayer']>,
) {
  const player = mutableState(simulation).players.get(entityId);
  if (!player) {
    throw new Error('test player missing');
  }
  return player;
}

function advanceUntilAlive(
  simulation: GameSimulation,
  entityId: ReturnType<GameSimulation['addPlayer']>,
): void {
  for (let tick = 0; tick < 500; tick += 1) {
    if (mutablePlayer(simulation, entityId).lifeState === 'alive') {
      return;
    }
    simulation.step();
  }
  throw new Error('player did not respawn');
}

describe('authoritative equipment and kill economy', () => {
  it('drops later hand items when removing the cloth bag reduces capacity', () => {
    const simulation = new GameSimulation({ rootSeed: 7001 });
    const playerIdValue = simulation.addPlayer({
      playerId: playerId('cloth-bag-overflow'),
      heroId: HERO_IDS.sunWukong,
      equipmentIds: [EQUIPMENT_IDS.clothBag],
      position: vec2Mm(0, 0),
    });
    const state = mutableState(simulation);
    const player = mutablePlayer(simulation, playerIdValue);
    player.inventoryEquipment.push(
      createEquipmentInstance(state, EQUIPMENT_IDS.refinedIronStaff, {
        acquiredAtTick: 10,
        permanentAttackBonus: 0,
      }),
      createEquipmentInstance(state, EQUIPMENT_IDS.coarseClothArmor, {
        acquiredAtTick: 20,
        permanentAttackBonus: 0,
      }),
    );
    const bag = player.equipment[0];
    if (!bag) {
      throw new Error('cloth bag missing');
    }

    expect(simulation.unequipEquipmentResult(playerIdValue, bag.instanceId)).toEqual({
      accepted: true,
      code: 'accepted',
    });
    const snapshot = simulation.getSnapshot().players[0];
    expect(snapshot?.inventoryEquipment.map((instance) => instance.equipmentId)).toEqual([
      EQUIPMENT_IDS.clothBag,
    ]);
    expect(simulation.getSnapshot().lootDrops.map((drop) => drop.equipmentId)).toEqual([
      EQUIPMENT_IDS.refinedIronStaff,
      EQUIPMENT_IDS.coarseClothArmor,
    ]);
  });

  it('drops the hand on deaths one and two, then hand plus equipped items on elimination', () => {
    const simulation = new GameSimulation({ rootSeed: 7002 });
    const victim = simulation.addPlayer({
      playerId: playerId('death-equipment-victim'),
      heroId: HERO_IDS.sunWukong,
      equipmentIds: [EQUIPMENT_IDS.refinedIronStaff],
      position: vec2Mm(0, 0),
    });
    simulation.addPlayer({
      playerId: playerId('death-equipment-observer'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(40_000, 0),
    });
    const state = mutableState(simulation);
    const player = mutablePlayer(simulation, victim);

    player.inventoryEquipment.push(createEquipmentInstance(state, EQUIPMENT_IDS.coarseClothArmor));
    simulation.damage(victim, 99_999);
    expect(simulation.getSnapshot().lootDrops.map((drop) => drop.equipmentId)).toContain(
      EQUIPMENT_IDS.coarseClothArmor,
    );
    expect(player.equipment).toHaveLength(1);

    advanceUntilAlive(simulation, victim);
    player.inventoryEquipment.push(createEquipmentInstance(state, EQUIPMENT_IDS.strawSandal));
    simulation.damage(victim, 99_999);
    expect(simulation.getSnapshot().lootDrops.map((drop) => drop.equipmentId)).toContain(
      EQUIPMENT_IDS.strawSandal,
    );
    expect(player.equipment).toHaveLength(1);

    advanceUntilAlive(simulation, victim);
    player.inventoryEquipment.push(createEquipmentInstance(state, EQUIPMENT_IDS.copperBracer));
    simulation.damage(victim, 99_999);
    expect(player.lifeState).toBe('eliminated');
    expect(player.equipment).toHaveLength(0);
    expect(player.inventoryEquipment).toHaveLength(0);
    const finalDrops = simulation.getSnapshot().lootDrops.map((drop) => drop.equipmentId);
    expect(finalDrops).toContain(EQUIPMENT_IDS.copperBracer);
    expect(finalDrops).toContain(EQUIPMENT_IDS.refinedIronStaff);
  });

  it('pays the authored hero kill formula and scales only generated gold with G5', () => {
    const simulation = new GameSimulation({ rootSeed: 7003 });
    const killer = simulation.addPlayer({
      playerId: playerId('kill-reward-owner'),
      heroId: HERO_IDS.sunWukong,
      equipmentIds: [EQUIPMENT_IDS.treasureBasin],
      position: vec2Mm(0, 0),
    });
    const victim = simulation.addPlayer({
      playerId: playerId('kill-reward-victim'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(1_000, 0),
    });
    const victimState = mutablePlayer(simulation, victim);
    victimState.level = 10;
    victimState.gold = 1_000;

    simulation.damage(victim, 99_999, killer);

    const killerSnapshot = simulation
      .getSnapshot()
      .players.find((candidate) => candidate.entityId === killer);
    // 500 + 100*10 + 10%*1000 = 1600, then G5 adds 50%.
    expect(killerSnapshot?.gold).toBe(2_900);
    expect(killerSnapshot?.experience).toBe(140);
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'hero-kill-reward',
        sourceEntityId: killer,
        targetEntityId: victim,
        gold: 2_400,
        experience: 140,
        eliminated: false,
      }),
    );
  });

  it('preserves a discarded equipment instance and its permanent growth on the ground', () => {
    const simulation = new GameSimulation({ rootSeed: 7004 });
    const owner = simulation.addPlayer({
      playerId: playerId('discard-owner'),
      heroId: HERO_IDS.sunWukong,
      equipmentIds: [EQUIPMENT_IDS.soulDevouringRing],
      position: vec2Mm(0, 0),
    });
    const player = mutablePlayer(simulation, owner);
    const ring = player.equipment[0];
    if (!ring) {
      throw new Error('ring missing');
    }
    ring.permanentAttackBonus = 18;

    expect(simulation.discardEquipmentResult(owner, ring.instanceId)).toMatchObject({
      accepted: true,
      code: 'accepted',
    });
    expect(simulation.getSnapshot().lootDrops[0]).toMatchObject({
      kind: 'equipment',
      equipmentId: EQUIPMENT_IDS.soulDevouringRing,
      equipmentInstanceId: ring.instanceId,
      permanentAttackBonus: 18,
    });
  });
});
