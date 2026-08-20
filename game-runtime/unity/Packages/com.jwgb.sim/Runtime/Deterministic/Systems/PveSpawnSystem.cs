using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of monster construction/spawn from
    /// packages/sim/src/systems/pve.ts.
    /// </summary>
    internal static class PveSpawnSystem
    {
        private static readonly FiveElement[] Elements =
        {
            FiveElement.Metal,
            FiveElement.Wood,
            FiveElement.Water,
            FiveElement.Fire,
            FiveElement.Earth
        };

        public static void Initialize(
            SimulationState state,
            List<SimEvent> events)
        {
            if (!state.PveEnabled)
            {
                return;
            }

            var population = state.PvePopulation == "full"
                ? PvePopulation.Full
                : PvePopulation.Demo;
            var placementIndex = 0;
            for (var kindIndex = 0;
                kindIndex < PveCatalog.Kinds.Length;
                kindIndex += 1)
            {
                var kind = PveCatalog.Kinds[kindIndex];
                var count = PveCatalog.Count(population, kind);
                for (var index = 0; index < count; index += 1)
                {
                    var ring = PveCatalog.Ring(
                        state.MapField != null,
                        kind,
                        index);
                    var home = PveCatalog.Home(
                        state,
                        kind,
                        index,
                        placementIndex,
                        ring);
                    FiveElement? element =
                        kind == MonsterKind.DragonKing &&
                        state.MapField != null
                            ? PveMapPlacement.DragonElement(
                                state.RootSeed,
                                index)
                            : kind == MonsterKind.Pig ||
                              kind == MonsterKind.DragonKing
                                ? Elements[
                                    placementIndex %
                                    Elements.Length]
                                : (FiveElement?)null;
                    string courtId = null;
                    if (kind == MonsterKind.CoreBoss &&
                        state.MapField != null)
                    {
                        courtId = PveMapPlacement.CoreCourt(
                            state.RootSeed).Id;
                    }

                    Spawn(state, events, kind, ring, element, home, courtId);
                    placementIndex += 1;
                }
            }
        }

        public static MonsterState Spawn(
            SimulationState state,
            List<SimEvent> events,
            MonsterKind kind,
            MonsterRing ring,
            FiveElement? element,
            Int2Mm homePosition,
            string courtId)
        {
            var monster = Create(
                state,
                kind,
                ring,
                element,
                homePosition,
                courtId);
            events.Add(
                new SimEvent
                {
                    Type = "monster-spawned",
                    Tick = state.Tick,
                    EntityId = monster.EntityId
                });
            if (monster.Kind == MonsterKind.CoreBoss)
            {
                CoreBossSystem.Initialize(state, monster);
            }

            return monster;
        }

        public static void AdvanceRespawns(
            SimulationState state,
            List<SimEvent> events)
        {
            var pending = state.MonsterRespawns.ToArray();
            state.MonsterRespawns.Clear();
            for (var index = 0; index < pending.Length; index += 1)
            {
                var respawn = pending[index];
                if (respawn.RespawnAtTick > state.Tick)
                {
                    state.MonsterRespawns.Add(respawn);
                    continue;
                }

                Spawn(
                    state,
                    events,
                    respawn.Kind,
                    respawn.Ring,
                    respawn.Element,
                    respawn.HomePosition,
                    respawn.CourtId);
            }
        }

        private static MonsterState Create(
            SimulationState state,
            MonsterKind kind,
            MonsterRing ring,
            FiveElement? element,
            Int2Mm homePosition,
            string courtId)
        {
            var stats = PveCatalog.Stats(kind, ring, state.Tick);
            var monster = new MonsterState
            {
                EntityId = state.NextEntityId,
                Kind = kind,
                Ring = ring,
                Element = element,
                Position = homePosition,
                HomePosition = homePosition,
                CourtId = courtId,
                Facing = new Int2Mm(0, 1_000),
                Hp = stats.MaxHp,
                MaxHp = stats.MaxHp,
                AttackPower = stats.AttackPower,
                MoveSpeedMmPerSecond = stats.MoveSpeedMmPerSecond,
                AttackRangeMm = stats.AttackRangeMm,
                AttackPeriodTicks = DivideCeiling(
                    SimulationConstants.TicksPerSecond * 1_000,
                    stats.AttacksPerSecondMilli),
                CollisionRadiusMm = stats.CollisionRadiusMm,
                AggroRadiusMm = stats.AggroRadiusMm,
                LeashRadiusMm = stats.LeashRadiusMm,
                SpawnTick = state.Tick,
                InvulnerableTicks = SimulationConstants.TicksPerSecond
            };
            state.NextEntityId += 1;
            state.Monsters.Add(monster.EntityId, monster);
            return monster;
        }

        private static int DivideCeiling(int numerator, int denominator)
        {
            return checked((numerator + denominator - 1) / denominator);
        }
    }
}
