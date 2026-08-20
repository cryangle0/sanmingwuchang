import { HERO_IDS, PASSIVE_IDS } from '@jwgb/content';
import { createPlayerIntent, entityId, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, type LootDrop } from '@jwgb/sim';

function addDrop(
  simulation: GameSimulation,
  playerEntityId: ReturnType<GameSimulation['addPlayer']>,
  drop: Omit<LootDrop, 'entityId' | 'position' | 'createdAtTick' | 'expiresAtTick'>,
): number {
  const state = (
    simulation as unknown as {
      readonly state: {
        tick: number;
        nextEntityId: number;
        lootDrops: Map<number, LootDrop>;
        players: Map<number, { position: { x: number; z: number } }>;
      };
    }
  ).state;
  const player = state.players.get(Number(playerEntityId));
  if (!player) {
    throw new Error('test player missing');
  }
  const lootEntityId = state.nextEntityId;
  state.nextEntityId += 1;
  state.lootDrops.set(lootEntityId, {
    entityId: entityId(lootEntityId),
    position: vec2Mm(player.position.x, player.position.z),
    createdAtTick: state.tick,
    expiresAtTick: state.tick + 10_000,
    ...drop,
  });
  return lootEntityId;
}

describe('passive progression transactions', () => {
  it('spends exactly one gem to upgrade a learned passive and rejects maxed passives', () => {
    const simulation = new GameSimulation({ rootSeed: 0x701 });
    const player = simulation.addPlayer({
      playerId: playerId('gem-player'),
      heroId: HERO_IDS.sunWukong,
      passives: [{ passiveId: PASSIVE_IDS.critical, level: 1 }],
    });
    const state = (
      simulation as unknown as {
        readonly state: {
          players: Map<
            number,
            {
              gems: number;
              passives: { passiveId: typeof PASSIVE_IDS.critical; level: 1 | 2 | 3 | 4 | 5 }[];
            }
          >;
        };
      }
    ).state;
    const playerState = state.players.get(Number(player));
    if (!playerState) {
      throw new Error('gem player missing');
    }
    playerState.gems = 1;

    expect(simulation.spendGemResult(player, PASSIVE_IDS.critical)).toEqual({
      accepted: true,
      code: 'accepted',
    });
    expect(simulation.getSnapshot().players[0]).toMatchObject({
      gems: 0,
      passives: [{ passiveId: PASSIVE_IDS.critical, level: 2 }],
    });
    expect(simulation.spendGemResult(player, PASSIVE_IDS.critical)).toEqual({
      accepted: false,
      code: 'no-gems',
    });

    playerState.gems = 1;
    const maxedState = state.players.get(Number(player));
    if (!maxedState) {
      throw new Error('gem player disappeared');
    }
    maxedState.passives[0] = { passiveId: PASSIVE_IDS.critical, level: 5 };
    expect(simulation.spendGemResult(player, PASSIVE_IDS.critical)).toEqual({
      accepted: false,
      code: 'passive-maxed',
    });
    expect(maxedState.gems).toBe(1);
  });

  it('learns a directional skill book on pickup and leaves a maxed duplicate on the ground', () => {
    const simulation = new GameSimulation({
      rootSeed: 0x702,
      pve: { enabled: true, population: 'demo' },
    });
    const player = simulation.addPlayer({
      playerId: playerId('book-player'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 0),
    });
    simulation.addPlayer({
      playerId: playerId('book-observer'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(80_000, 80_000),
    });
    const firstDrop = addDrop(simulation, player, {
      gold: 0,
      experience: 0,
      gems: 0,
      equipmentId: null,
      bookPassiveId: PASSIVE_IDS.reactiveShield,
    });
    simulation.submitIntent(
      player,
      createPlayerIntent({ sequence: 1, moveX: 0, moveZ: 0, interact: true }),
    );
    simulation.step();
    expect(simulation.getSnapshot().lootDrops).toHaveLength(0);
    expect(simulation.getSnapshot().players[0]?.passives).toEqual([
      { passiveId: PASSIVE_IDS.reactiveShield, level: 1 },
    ]);

    const duplicateDrop = addDrop(simulation, player, {
      gold: 0,
      experience: 0,
      gems: 0,
      equipmentId: null,
      bookPassiveId: PASSIVE_IDS.reactiveShield,
    });
    const current = simulation.getSnapshot().players[0];
    if (!current) {
      throw new Error('book player snapshot missing');
    }
    const state = (
      simulation as unknown as {
        readonly state: {
          players: Map<
            number,
            {
              passives: {
                passiveId: typeof PASSIVE_IDS.reactiveShield;
                level: 1 | 2 | 3 | 4 | 5;
              }[];
            }
          >;
        };
      }
    ).state;
    const playerState = state.players.get(Number(player));
    if (!playerState) {
      throw new Error('book player state missing');
    }
    playerState.passives[0] = {
      passiveId: PASSIVE_IDS.reactiveShield,
      level: 5,
    };
    simulation.submitIntent(
      player,
      createPlayerIntent({ sequence: 2, moveX: 0, moveZ: 0, interact: true }),
    );
    simulation.step();
    expect(simulation.getSnapshot().lootDrops.map((drop) => Number(drop.entityId))).toContain(
      duplicateDrop,
    );
    expect(simulation.getSnapshot().players[0]?.passives[0]?.level).toBe(5);
    expect(firstDrop).not.toBe(duplicateDrop);
  });
});
