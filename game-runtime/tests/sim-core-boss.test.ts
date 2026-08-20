import { HERO_IDS } from '@jwgb/content';
import { playerId, vec2Mm } from '@jwgb/core';
import { GameSimulation, type MonsterEntity, type MutableSimulationState } from '@jwgb/sim';
import { applyActiveSlow } from '../packages/sim/src/systems/active-damage';
import { resolveTargetForcedDisplacement } from '../packages/sim/src/systems/displacement';
import { applyMonsterDamage } from '../packages/sim/src/systems/monster-damage';

function internalState(simulation: GameSimulation): MutableSimulationState {
  return (
    simulation as unknown as {
      readonly state: MutableSimulationState;
    }
  ).state;
}

function coreBoss(state: MutableSimulationState): MonsterEntity {
  const boss = [...state.monsters.values()].find((monster) => monster.kind === 'core-boss');
  if (!boss) {
    throw new Error('missing core boss');
  }
  return boss;
}

function quietNonCoreMonsters(state: MutableSimulationState): void {
  for (const monster of state.monsters.values()) {
    if (monster.kind !== 'core-boss') {
      (monster as { aggroRadiusMm: number }).aggroRadiusMm = 0;
    }
  }
}

describe('core boss authoritative runtime', () => {
  it('emits both public skills and all six signature mechanisms with deterministic hazards', () => {
    const simulation = new GameSimulation({
      rootSeed: 0x260726,
      pve: { enabled: true, population: 'full' },
    });
    simulation.addPlayer({
      playerId: playerId('core-test-a'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(5_000, 0),
    });
    simulation.addPlayer({
      playerId: playerId('core-test-b'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(-5_000, 0),
    });
    const state = internalState(simulation);
    const boss = coreBoss(state);
    boss.invulnerableTicks = 0;
    (boss as { attackPower: number }).attackPower = 0;
    quietNonCoreMonsters(state);
    for (const player of state.players.values()) {
      player.maxHp = 100_000;
      player.hp = 100_000;
    }
    simulation.drainEvents();

    simulation.step(2_200);
    const events = simulation.drainEvents();
    const castAbilities = new Set(
      events
        .filter(
          (event): event is Extract<typeof event, { type: 'core-boss-cast' }> =>
            event.type === 'core-boss-cast' && event.phase === 'warning',
        )
        .map((event) => event.abilityId),
    );

    expect(castAbilities).toEqual(
      new Set([
        'ring-shockwave',
        'meteor',
        'earthbreak',
        'firelane',
        'poisonpool',
        'windcharge',
        'thunderchain',
        'mirrorshadow',
      ]),
    );
    expect(
      events.some((event) => event.type === 'summon-spawned' && event.summonKind === 'core-mirror'),
    ).toBe(true);
    expect(
      events.some(
        (event) => event.type === 'damage' && event.cause === 'monster' && event.form === 'skill',
      ),
    ).toBe(true);
    expect(simulation.getSnapshot().stateHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('applies core immunity and half-strength slow to every shared control path', () => {
    const simulation = new GameSimulation({
      rootSeed: 0x260727,
      pve: { enabled: true, population: 'full' },
    });
    const player = simulation.addPlayer({
      playerId: playerId('core-control-player'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(1_000, 0),
    });
    simulation.addPlayer({
      playerId: playerId('core-control-observer'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(80_000, 80_000),
    });
    const state = internalState(simulation);
    const boss = coreBoss(state);
    boss.invulnerableTicks = 0;
    const before = boss.position;
    applyActiveSlow(boss, 60, 100);
    expect(boss.slowBasisPoints).toBe(7_000);
    const destination = resolveTargetForcedDisplacement(
      state,
      [],
      boss,
      boss.position,
      vec2Mm(boss.position.x + 5_000, boss.position.z),
      boss.collisionRadiusMm,
    );
    expect(destination).toEqual(before);
    (boss as { polymorphTicks: number }).polymorphTicks = 0;
    simulation.hardControl(player, 10);
    expect(state.players.get(player)?.hardControlTicks).toBe(10);
    expect(boss.hardControlTicks).toBe(0);
  });

  it('creates the ten-second death anchor and keeps public item drops while suppressing world rewards', () => {
    const simulation = new GameSimulation({
      rootSeed: 0x260728,
      pve: { enabled: true, population: 'full' },
    });
    const player = simulation.addPlayer({
      playerId: playerId('core-killer'),
      heroId: HERO_IDS.sunWukong,
      position: vec2Mm(0, 5_000),
    });
    simulation.addPlayer({
      playerId: playerId('core-killer-two'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(80_000, 80_000),
    });
    const state = internalState(simulation);
    const boss = coreBoss(state);
    boss.invulnerableTicks = 0;
    const events: Parameters<typeof applyMonsterDamage>[1] = [];
    applyMonsterDamage(state, events, player, boss, boss.hp, null, {
      ignoreElement: true,
      lootGoldMultiplier: 0,
      lootExperienceMultiplier: 0,
      environmental: true,
    });

    expect(state.monsters.has(boss.entityId)).toBe(false);
    expect(state.coreBossRevealAnchors.size).toBe(1);
    const anchor = [...state.coreBossRevealAnchors.values()][0];
    expect(anchor?.expiresAtTick).toBe(10 * 20);
    expect(state.lootDrops.size).toBeGreaterThanOrEqual(1 + 2 + 1 + 1);
    expect([...state.lootDrops.values()].find((drop) => drop.kind === 'currency')).toMatchObject({
      gold: 0,
      experience: 0,
    });
    expect(events.some((event) => event.type === 'core-boss-reveal-anchor')).toBe(true);
  });
});
