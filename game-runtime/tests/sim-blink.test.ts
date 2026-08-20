import { GENERIC_ACTIVE_IDS, HERO_IDS, M0_RULES } from '@jwgb/content';
import { createPlayerIntent, playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, replaySimulation, type SimEvent, type StaticSolidRect } from '@jwgb/sim';

function createBlinkSimulation(
  position = vec2Mm(0, 0),
  staticSolids: readonly StaticSolidRect[] = [],
): {
  readonly simulation: GameSimulation;
  readonly entity: ReturnType<GameSimulation['addPlayer']>;
} {
  const simulation = new GameSimulation({
    rootSeed: 901,
    staticSolids,
  });
  const entity = simulation.addPlayer({
    playerId: playerId('blink-player'),
    heroId: HERO_IDS.sunWukong,
    activeAbilityId: GENERIC_ACTIVE_IDS.blink,
    position,
  });
  simulation.drainEvents();
  return { simulation, entity };
}

function castBlink(
  simulation: GameSimulation,
  entity: ReturnType<GameSimulation['addPlayer']>,
  sequence: number,
  aimX: number,
  aimZ: number,
): readonly SimEvent[] {
  simulation.submitIntent(
    entity,
    createPlayerIntent({
      sequence,
      moveX: 0,
      moveZ: 0,
      aimX,
      aimZ,
      castActive: true,
    }),
  );
  simulation.step();
  return simulation.drainEvents();
}

describe('D6 deterministic capsule-sweep blink', () => {
  it('travels exactly 15 meters in open space and starts its cooldown', () => {
    const { simulation, entity } = createBlinkSimulation();
    const events = castBlink(simulation, entity, 1, 1_000, 0);

    expect(simulation.getSnapshot().players[0]).toMatchObject({
      position: vec2Mm(15_000, 0),
      activeCooldownTicks: 300,
    });
    expect(events).toContainEqual({
      type: 'blink',
      tick: 1,
      entityId: entity,
      previousPosition: vec2Mm(0, 0),
      newPosition: vec2Mm(15_000, 0),
      requestedDistanceMm: 15_000,
      actualDistanceMm: 15_000,
      blockingSolidId: null,
    });
  });

  it('falls back to the current facing when the aim vector is zero', () => {
    const { simulation, entity } = createBlinkSimulation();
    simulation.submitIntent(
      entity,
      createPlayerIntent({
        sequence: 1,
        moveX: 1_000,
        moveZ: 0,
      }),
    );
    simulation.step();
    const beforeBlink = simulation.getSnapshot().players[0]?.position;
    expect(beforeBlink).toEqual(vec2Mm(150, 0));

    castBlink(simulation, entity, 2, 0, 0);
    expect(simulation.getSnapshot().players[0]?.position).toEqual(vec2Mm(15_150, 0));
  });

  it('stops at the last legal millimeter inside the arena boundary', () => {
    const { simulation, entity } = createBlinkSimulation(vec2Mm(115_000, 0));
    const events = castBlink(simulation, entity, 1, 1_000, 0);
    const legalRadiusMm = M0_RULES.arenaRadiusMm - M0_RULES.playerCapsuleRadiusMm;

    expect(simulation.getSnapshot().players[0]?.position).toEqual(vec2Mm(legalRadiusMm, 0));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'blink',
        entityId: entity,
        requestedDistanceMm: 15_000,
        actualDistanceMm: 4_550,
        blockingSolidId: null,
      }),
    );
  });

  it('passes through a continuous solid chord of exactly 1.5 meters', () => {
    const thinWall: StaticSolidRect = {
      solidId: 'thin-wall',
      minimumX: 5_000,
      maximumX: 5_600,
      minimumZ: -1_000,
      maximumZ: 1_000,
    };
    const { simulation, entity } = createBlinkSimulation(vec2Mm(0, 0), [thinWall]);

    castBlink(simulation, entity, 1, 1_000, 0);
    expect(simulation.getSnapshot()).toMatchObject({
      staticSolids: [thinWall],
      players: [{ position: vec2Mm(15_000, 0) }],
    });
  });

  it('stops before a continuous solid chord of 1.501 meters', () => {
    const thickWall: StaticSolidRect = {
      solidId: 'thick-wall',
      minimumX: 5_000,
      maximumX: 5_601,
      minimumZ: -1_000,
      maximumZ: 1_000,
    };
    const { simulation, entity } = createBlinkSimulation(vec2Mm(0, 0), [thickWall]);
    const events = castBlink(simulation, entity, 1, 1_000, 0);

    expect(simulation.getSnapshot().players[0]?.position).toEqual(vec2Mm(4_549, 0));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'blink',
        entityId: entity,
        actualDistanceMm: 4_549,
        blockingSolidId: 'thick-wall',
      }),
    );
  });

  it('rejects an endpoint that remains inside an otherwise passable thin wall', () => {
    const endpointWall: StaticSolidRect = {
      solidId: 'endpoint-wall',
      minimumX: 14_500,
      maximumX: 15_100,
      minimumZ: -1_000,
      maximumZ: 1_000,
    };
    const { simulation, entity } = createBlinkSimulation(vec2Mm(0, 0), [endpointWall]);

    castBlink(simulation, entity, 1, 1_000, 0);
    expect(simulation.getSnapshot().players[0]?.position).toEqual(vec2Mm(14_049, 0));
  });

  it('includes static geometry in the state hash and deterministic replay', () => {
    const solid: StaticSolidRect = {
      solidId: 'replay-wall',
      minimumX: 5_000,
      maximumX: 5_601,
      minimumZ: -1_000,
      maximumZ: 1_000,
    };
    const { simulation, entity } = createBlinkSimulation(vec2Mm(0, 0), [solid]);
    castBlink(simulation, entity, 1, 1_000, 0);
    const tape = simulation.exportReplay();

    expect(tape.staticSolids).toEqual([solid]);
    expect(replaySimulation(tape).getStateHash()).toBe(tape.expectedStateHash);

    const withoutGeometry = new GameSimulation({ rootSeed: 901 });
    expect(withoutGeometry.getStateHash()).not.toBe(
      new GameSimulation({ rootSeed: 901, staticSolids: [solid] }).getStateHash(),
    );
  });
});
