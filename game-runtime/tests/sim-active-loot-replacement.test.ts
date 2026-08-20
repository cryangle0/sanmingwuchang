import { GENERIC_ACTIVE_IDS, getActiveDefinition, HERO_IDS } from '@jwgb/content';
import { entityId, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, type MutableSimulationState } from '@jwgb/sim';

function mutableState(simulation: GameSimulation): MutableSimulationState {
  return (simulation as unknown as { readonly state: MutableSimulationState }).state;
}

function addActiveDrop(
  simulation: GameSimulation,
  activeId = GENERIC_ACTIVE_IDS.blink,
  position = vec2Mm(0, 0),
): ReturnType<typeof entityId> {
  const state = mutableState(simulation);
  const dropEntityId = entityId(state.nextEntityId);
  state.nextEntityId += 1;
  state.lootDrops.set(dropEntityId, {
    entityId: dropEntityId,
    position,
    gold: 0,
    experience: 0,
    gems: 0,
    equipmentId: null,
    bookPassiveId: null,
    createdAtTick: state.tick,
    expiresAtTick: Number.MAX_SAFE_INTEGER,
    kind: 'active',
    activeId,
    equipmentInstanceId: null,
    acquiredAtTick: null,
    permanentAttackBonus: 0,
    stormCoveredSinceTick: null,
  });
  return dropEntityId;
}

function createScenario(): {
  readonly simulation: GameSimulation;
  readonly playerEntityId: ReturnType<GameSimulation['addPlayer']>;
} {
  const simulation = new GameSimulation({
    rootSeed: 0xac7103,
    pve: { enabled: true, population: 'demo' },
  });
  const playerEntityId = simulation.addPlayer({
    playerId: playerId('active-loot-owner'),
    heroId: HERO_IDS.sunWukong,
    position: vec2Mm(0, 0),
  });
  simulation.addPlayer({
    playerId: playerId('active-loot-observer'),
    heroId: HERO_IDS.bullDemonKing,
    position: vec2Mm(20_000, 0),
  });
  simulation.drainEvents();
  simulation.step();
  simulation.drainEvents();
  return { simulation, playerEntityId };
}

describe('ground active replacement', () => {
  it('keeps the public item until explicit confirmation and starts a full cooldown', () => {
    const { simulation, playerEntityId } = createScenario();
    const dropEntityId = addActiveDrop(simulation);

    simulation.submitIntent(playerEntityId, {
      sequence: 1,
      movement: { x: 0, z: 0 },
      aim: { x: 0, z: 1_000 },
      attack: false,
      targetEntityId: null,
      secondaryTargetEntityId: null,
      castActive: false,
      alternateActive: false,
      interact: true,
    });
    simulation.step();

    expect(simulation.getSnapshot().pendingActiveReplacements).toEqual([
      expect.objectContaining({
        playerEntityId,
        lootEntityId: dropEntityId,
        activeId: GENERIC_ACTIVE_IDS.blink,
      }),
    ]);
    expect(simulation.getSnapshot().lootDrops.map((drop) => drop.entityId)).toContain(dropEntityId);
    expect(
      simulation.drainEvents().some((event) => event.type === 'active-replacement-required'),
    ).toBe(true);

    const result = simulation.replaceActiveLootResult(playerEntityId, dropEntityId, true);
    expect(result).toEqual({ accepted: true, code: 'accepted' });
    const player = simulation
      .getSnapshot()
      .players.find((candidate) => candidate.entityId === playerEntityId);
    expect(player?.activeAbilityId).toBe(GENERIC_ACTIVE_IDS.blink);
    expect(player?.activeCooldownTicks).toBe(
      getActiveDefinition(GENERIC_ACTIVE_IDS.blink).cooldownTicks,
    );
    expect(simulation.getSnapshot().pendingActiveReplacements).toEqual([]);
    expect(simulation.getSnapshot().lootDrops.map((drop) => drop.entityId)).not.toContain(
      dropEntityId,
    );
    expect(simulation.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'active-replaced',
        entityId: playerEntityId,
        lootEntityId: dropEntityId,
        activeId: GENERIC_ACTIVE_IDS.blink,
      }),
    );
  });

  it('leaves the active on the ground when the player declines', () => {
    const { simulation, playerEntityId } = createScenario();
    const dropEntityId = addActiveDrop(simulation);
    const state = mutableState(simulation);
    state.pendingActiveReplacements.set(playerEntityId, {
      playerEntityId,
      lootEntityId: dropEntityId,
      activeId: GENERIC_ACTIVE_IDS.blink,
      requestedAtTick: state.tick,
    });

    expect(simulation.replaceActiveLootResult(playerEntityId, dropEntityId, false)).toEqual({
      accepted: true,
      code: 'active-replacement-declined',
    });
    expect(simulation.getSnapshot().lootDrops.map((drop) => drop.entityId)).toContain(dropEntityId);
    expect(simulation.getSnapshot().pendingActiveReplacements).toEqual([]);
  });

  it('revalidates line of sight at confirmation time', () => {
    const simulation = new GameSimulation({
      rootSeed: 0xac7104,
      staticSolids: [
        {
          solidId: 'active-loot-wall',
          minimumX: -500,
          maximumX: 500,
          minimumZ: -2_000,
          maximumZ: 2_000,
        },
      ],
      pve: { enabled: true, population: 'demo' },
    });
    const playerEntityId = simulation.addPlayer({
      playerId: playerId('active-loot-los-owner'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(-2_000, 0),
    });
    simulation.addPlayer({
      playerId: playerId('active-loot-los-observer'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(20_000, 0),
    });
    simulation.drainEvents();
    simulation.step();
    simulation.drainEvents();
    const dropEntityId = addActiveDrop(simulation, GENERIC_ACTIVE_IDS.blink, vec2Mm(2_000, 0));

    simulation.submitIntent(playerEntityId, {
      sequence: 1,
      movement: { x: 0, z: 0 },
      aim: { x: 0, z: 1_000 },
      attack: false,
      targetEntityId: null,
      secondaryTargetEntityId: null,
      castActive: false,
      alternateActive: false,
      interact: true,
    });
    simulation.step();
    expect(simulation.getSnapshot().pendingActiveReplacements).toEqual([]);
    expect(simulation.replaceActiveLootResult(playerEntityId, dropEntityId, true)).toEqual({
      accepted: false,
      code: 'active-replacement-not-found',
    });
  });
});
