import { EQUIPMENT_IDS, HERO_IDS } from '@jwgb/content';
import {
  createPlayerIntent,
  type EquipmentId,
  entityId,
  equipmentInstanceId,
  playerId,
  vec2Mm,
} from '@jwgb/core';
import { createEquipmentInstance, GameSimulation, type MutableSimulationState } from '@jwgb/sim';

function stateOf(simulation: GameSimulation): MutableSimulationState {
  return (simulation as unknown as { readonly state: MutableSimulationState }).state;
}

function addEquipmentDrop(
  simulation: GameSimulation,
  equipmentId: (typeof EQUIPMENT_IDS)[keyof typeof EQUIPMENT_IDS],
  position = vec2Mm(0, 0),
  instanceId: ReturnType<typeof equipmentInstanceId> | null = null,
): ReturnType<typeof entityId> {
  const state = stateOf(simulation);
  const dropEntityId = entityId(state.nextEntityId);
  state.nextEntityId += 1;
  state.lootDrops.set(dropEntityId, {
    entityId: dropEntityId,
    position,
    gold: 0,
    experience: 0,
    gems: 0,
    equipmentId,
    bookPassiveId: null,
    createdAtTick: state.tick,
    expiresAtTick: Number.MAX_SAFE_INTEGER,
    kind: 'equipment',
    activeId: null,
    equipmentInstanceId: instanceId,
    acquiredAtTick: state.tick,
    permanentAttackBonus: 0,
    stormCoveredSinceTick: null,
  });
  return dropEntityId;
}

function addPlayer(
  simulation: GameSimulation,
  suffix: string,
  equipmentIds?: readonly EquipmentId[],
) {
  return simulation.addPlayer({
    playerId: playerId(`equipment-pickup-${suffix}`),
    heroId: HERO_IDS.sunWukong,
    position: vec2Mm(0, 0),
    ...(equipmentIds ? { equipmentIds } : {}),
  });
}

describe('atomic ground equipment pickup', () => {
  it('keeps a full-hand ground item pending until an explicit replacement choice', () => {
    const simulation = new GameSimulation({
      rootSeed: 0xe401,
      pve: { enabled: true, population: 'demo' },
    });
    const owner = addPlayer(simulation, 'owner', [
      EQUIPMENT_IDS.refinedIronStaff,
      EQUIPMENT_IDS.coarseClothArmor,
      EQUIPMENT_IDS.strawSandal,
    ]);
    simulation.addPlayer({
      playerId: playerId('equipment-pickup-observer'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(20_000, 0),
    });
    const state = stateOf(simulation);
    const player = state.players.get(owner);
    if (!player) throw new Error('missing owner');
    const handItem = createEquipmentInstance(state, EQUIPMENT_IDS.windPearl);
    player.inventoryEquipment.push(handItem);
    const dropId = addEquipmentDrop(simulation, EQUIPMENT_IDS.comboShoes);

    simulation.submitIntent(
      owner,
      createPlayerIntent({
        sequence: 1,
        interact: true,
        moveX: 0,
        moveZ: 0,
      }),
    );
    simulation.step();

    expect(simulation.getSnapshot().pendingEquipmentPickups).toEqual([
      expect.objectContaining({
        playerEntityId: owner,
        lootEntityId: dropId,
        equipmentId: EQUIPMENT_IDS.comboShoes,
      }),
    ]);
    expect(simulation.getSnapshot().lootDrops.some((drop) => drop.entityId === dropId)).toBe(true);
    expect(player.inventoryEquipment.map((item) => item.instanceId)).toEqual([handItem.instanceId]);

    const hashBeforeInvalidChoice = simulation.getStateHash();
    expect(
      simulation.pickupEquipmentLootResult(
        owner,
        dropId,
        'inventory',
        equipmentInstanceId(999_999),
      ),
    ).toEqual({ accepted: false, code: 'invalid-replacement' });
    expect(simulation.getStateHash()).toBe(hashBeforeInvalidChoice);
    expect(simulation.getSnapshot().lootDrops.some((drop) => drop.entityId === dropId)).toBe(true);

    expect(
      simulation.pickupEquipmentLootResult(owner, dropId, 'inventory', handItem.instanceId),
    ).toEqual({ accepted: true, code: 'accepted' });
    const after = simulation.getSnapshot();
    const afterPlayer = after.players.find((candidate) => candidate.entityId === owner);
    expect(after.pendingEquipmentPickups).toEqual([]);
    expect(after.lootDrops.some((drop) => drop.entityId === dropId)).toBe(false);
    expect(afterPlayer?.inventoryEquipment.map((item) => item.equipmentId)).toEqual([
      EQUIPMENT_IDS.comboShoes,
    ]);
    expect(after.lootDrops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          equipmentId: EQUIPMENT_IDS.windPearl,
          kind: 'equipment',
        }),
      ]),
    );
  });

  it('can atomically replace an equipped item, preserves the old instance on the ground, and supports cancel', () => {
    const simulation = new GameSimulation({
      rootSeed: 0xe402,
      pve: { enabled: true, population: 'demo' },
    });
    const owner = addPlayer(simulation, 'replace', [
      EQUIPMENT_IDS.refinedIronStaff,
      EQUIPMENT_IDS.coarseClothArmor,
      EQUIPMENT_IDS.strawSandal,
    ]);
    simulation.addPlayer({
      playerId: playerId('equipment-pickup-replace-observer'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(20_000, 0),
    });
    const state = stateOf(simulation);
    const player = state.players.get(owner);
    if (!player) throw new Error('missing owner');
    const equippedToReplace = player.equipment[0];
    if (!equippedToReplace) throw new Error('missing equipped item');
    const firstDrop = addEquipmentDrop(simulation, EQUIPMENT_IDS.comboShoes);
    state.pendingEquipmentPickups.set(owner, {
      playerEntityId: owner,
      lootEntityId: firstDrop,
      equipmentId: EQUIPMENT_IDS.comboShoes,
      equipmentInstanceId: null,
      requestedAtTick: state.tick,
    });

    expect(
      simulation.pickupEquipmentLootResult(
        owner,
        firstDrop,
        'equipped',
        equippedToReplace.instanceId,
      ),
    ).toEqual({ accepted: true, code: 'accepted' });
    const replaced = simulation.getSnapshot();
    const replacedPlayer = replaced.players.find((candidate) => candidate.entityId === owner);
    expect(replacedPlayer?.equipment.map((item) => item.equipmentId)).toContain(
      EQUIPMENT_IDS.comboShoes,
    );
    expect(replaced.lootDrops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          equipmentId: EQUIPMENT_IDS.refinedIronStaff,
          equipmentInstanceId: equippedToReplace.instanceId,
        }),
      ]),
    );

    const cancelDrop = addEquipmentDrop(simulation, EQUIPMENT_IDS.windPearl);
    state.pendingEquipmentPickups.set(owner, {
      playerEntityId: owner,
      lootEntityId: cancelDrop,
      equipmentId: EQUIPMENT_IDS.windPearl,
      equipmentInstanceId: null,
      requestedAtTick: state.tick,
    });
    expect(simulation.pickupEquipmentLootResult(owner, cancelDrop, 'cancel', null)).toEqual({
      accepted: true,
      code: 'equipment-pickup-declined',
    });
    expect(simulation.getSnapshot().lootDrops.some((drop) => drop.entityId === cancelDrop)).toBe(
      true,
    );
  });

  it('allows only one claimant to consume an equipment instance', () => {
    const simulation = new GameSimulation({ rootSeed: 0xe403 });
    const first = addPlayer(simulation, 'first');
    const second = simulation.addPlayer({
      playerId: playerId('equipment-pickup-second'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(0, 0),
    });
    const dropId = addEquipmentDrop(simulation, EQUIPMENT_IDS.comboShoes);
    const firstResult = simulation.pickupEquipmentLootResult(first, dropId, 'inventory', null);
    const secondResult = simulation.pickupEquipmentLootResult(second, dropId, 'inventory', null);
    expect(firstResult).toEqual({ accepted: true, code: 'accepted' });
    expect(secondResult).toEqual({ accepted: false, code: 'equipment-loot-not-found' });
    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === first)
        ?.inventoryEquipment,
    ).toHaveLength(1);
    expect(
      simulation.getSnapshot().players.find((player) => player.entityId === second)
        ?.inventoryEquipment,
    ).toHaveLength(0);
  });
});
