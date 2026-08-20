using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/monster-damage.ts.
    /// </summary>
    internal static partial class MonsterDamageSystem
    {
        public static int Apply(
            SimulationState state,
            List<SimEvent> events,
            int? sourceEntityId,
            MonsterState monster,
            int amount,
            FiveElement? sourceElement,
            int? outgoingDamageBasisPointsOverride = null,
            bool ignoreExecute = false,
            bool ignoreSourceBonuses = false,
            bool ignoreElement = false,
            bool periodic = false,
            int lootGoldMultiplier = 1,
            int lootExperienceMultiplier = 1)
        {
            _ = periodic;
            if (amount <= 0 ||
                monster.InvulnerableTicks > 0 ||
                !state.Monsters.ContainsKey(monster.EntityId))
            {
                return 0;
            }

            PlayerState source = null;
            if (sourceEntityId.HasValue)
            {
                state.Players.TryGetValue(
                    sourceEntityId.Value,
                    out source);
            }

            var outgoing = ignoreSourceBonuses
                ? 10_000
                : outgoingDamageBasisPointsOverride ??
                    (source == null
                        ? 10_000
                        : LethalProtectionSystem
                            .GetOutgoingDamageBasisPoints(source));
            var targetBonus = source != null && !ignoreSourceBonuses
                ? TargetDamageBasisPoints(source, monster, ignoreExecute)
                : 10_000;
            var monsterDamageBasisPoints =
                source != null && !ignoreSourceBonuses
                    ? EquipmentMonsterDamageBasisPoints(source)
                    : 10_000;
            var conditionalDamage = checked(
                (int)(
                    (long)amount *
                    outgoing *
                    targetBonus /
                    100_000_000));
            var outgoingDamage = checked(
                (int)(
                    (long)conditionalDamage *
                    monsterDamageBasisPoints /
                    10_000));
            var hpBefore = monster.Hp;
            var elementBasis = ignoreElement || !sourceElement.HasValue
                ? 10_000
                : source != null
                    ? monster.Element.HasValue
                        ? EquipmentElementDamageBasisPoints(
                            source,
                            monster.Element.Value)
                        : 10_000
                    : monster.Element.HasValue
                        ? GameplayRules.ElementDamageBasisPoints(
                            sourceElement.Value,
                            monster.Element.Value)
                        : 10_000;
            var actual = Math.Min(
                monster.Hp,
                Math.Max(
                    1,
                    (int)((long)outgoingDamage * elementBasis / 10_000)));
            monster.Hp -= actual;
            PassiveRuntimeSystem.MarkCombatActivity(
                state,
                sourceEntityId,
                monster.EntityId);
            if (monster.Kind == MonsterKind.CoreBoss &&
                sourceEntityId.HasValue)
            {
                CoreBossSystem.RecordThreat(
                    state,
                    sourceEntityId.Value,
                    actual);
            }

            events.Add(
                new SimEvent
                {
                    Type = "monster-damaged",
                    Tick = state.Tick,
                    SourceEntityId = sourceEntityId,
                    TargetEntityId = monster.EntityId,
                    Amount = actual,
                    RemainingHp = monster.Hp
                });
            if (monster.Hp == 0)
            {
                Kill(
                    state,
                    events,
                    monster,
                    sourceEntityId,
                    hpBefore,
                    lootGoldMultiplier,
                    lootExperienceMultiplier);
            }

            return actual;
        }

        public static int ResolveBasicHit(
            SimulationState state,
            List<SimEvent> events,
            int sourceEntityId,
            MonsterState monster,
            int amount,
            FiveElement sourceElement)
        {
            return Apply(
                state,
                events,
                sourceEntityId,
                monster,
                amount,
                sourceElement,
                outgoingDamageBasisPointsOverride: 10_000);
        }

        /// <summary>
        /// targetDamageBonusBasisPoints x activeTargetDamageBonusBasisPoints;
        /// active damage-mark effects are absent in the deterministic slice,
        /// so the active factor is always 10_000.
        /// </summary>
        private static int TargetDamageBasisPoints(
            PlayerState source,
            MonsterState monster,
            bool ignoreExecute)
        {
            var basisPoints = PassiveRuntimeSystem.TargetDamageBonusBasisPoints(
                source,
                monster.Hp,
                monster.MaxHp,
                monster.Position,
                ignoreExecute);
            basisPoints +=
                EquipmentTargetDamageBasisPoints(source, monster) - 10_000;
            return basisPoints;
        }

        private static int EquipmentTargetDamageBasisPoints(
            PlayerState source,
            MonsterState monster)
        {
            var basisPoints = 10_000;
            if ((long)monster.Hp * 100 < (long)monster.MaxHp * 30 &&
                HasEquipment(source, GameplayIds.SevenStarSword))
            {
                basisPoints += 2_500;
            }

            if (monster.Hp > source.Hp &&
                HasEquipment(source, GameplayIds.DemonSubduingMace))
            {
                basisPoints += 2_500;
            }

            return basisPoints;
        }

        internal static int EquipmentMonsterDamageBasisPoints(
            PlayerState player)
        {
            return HasEquipment(player, GameplayIds.WolfFang)
                ? 13_000
                : 10_000;
        }

        internal static int EquipmentElementDamageBasisPoints(
            PlayerState player,
            FiveElement defenderElement)
        {
            var basis = GameplayRules.ElementDamageBasisPoints(
                player.Element,
                defenderElement);
            if (basis == 15_000 &&
                HasEquipment(player, GameplayIds.PrimordialPearl))
            {
                return 20_000;
            }

            return basis;
        }

        internal static bool HasEquipment(PlayerState player, string id)
        {
            for (var index = 0; index < player.Equipment.Count; index += 1)
            {
                if (player.Equipment[index].EquipmentId == id)
                {
                    return true;
                }
            }

            return false;
        }

        private static void Kill(
            SimulationState state,
            List<SimEvent> events,
            MonsterState monster,
            int? sourceEntityId,
            int victimHpBefore,
            int lootGoldMultiplier,
            int lootExperienceMultiplier)
        {
            if (!state.Monsters.Remove(monster.EntityId))
            {
                return;
            }

            EquipmentStateSystem.ClearComboShoesTargetState(
                state,
                monster.EntityId);
            if (monster.Kind == MonsterKind.CoreBoss)
            {
                CoreBossSystem.HandleDefeated(state, events, monster);
            }

            ScheduleRespawn(state, monster);
            var drops = CreateLootDrops(
                state,
                monster,
                sourceEntityId ?? monster.EntityId,
                lootGoldMultiplier,
                lootExperienceMultiplier);
            if (sourceEntityId.HasValue)
            {
                var treasureDrop =
                    PassiveEconomySystem.CreateTreasureHunterDrop(
                        state,
                        sourceEntityId.Value,
                        monster);
                if (treasureDrop != null)
                {
                    drops.Add(treasureDrop);
                }
            }

            events.Add(
                new SimEvent
                {
                    Type = "monster-killed",
                    Tick = state.Tick,
                    SourceEntityId = sourceEntityId,
                    TargetEntityId = monster.EntityId
                });
            for (var index = 0; index < drops.Count; index += 1)
            {
                LootRuntime.EmitLootDropped(
                    state,
                    events,
                    drops[index],
                    sourceEntityId ?? monster.EntityId);
            }

            if (sourceEntityId.HasValue)
            {
                PassiveKillSystem.Resolve(
                    state,
                    events,
                    new PassiveKillContext(
                        sourceEntityId.Value,
                        monster.EntityId,
                        PassiveKillVictimKind.Monster,
                        victimHpBefore,
                        monster.MaxHp));
            }
        }

        private static void ScheduleRespawn(
            SimulationState state,
            MonsterState monster)
        {
            if (monster.Kind == MonsterKind.CoreBoss &&
                state.Tick >= 14 * 60 * SimulationConstants.TicksPerSecond)
            {
                return;
            }

            var courtId = monster.CourtId;
            var homePosition = monster.HomePosition;
            if (monster.Kind == MonsterKind.CoreBoss &&
                state.MapField != null)
            {
                var courts = MapGeometryCatalog.Courts;
                var currentIndex = 0;
                for (var index = 0; index < courts.Length; index += 1)
                {
                    if (courts[index].Id == monster.CourtId)
                    {
                        currentIndex = index;
                        break;
                    }
                }

                var next = courts[(currentIndex + 1) % courts.Length];
                courtId = next.Id;
                homePosition = new Int2Mm(
                    checked((int)next.Center.X),
                    checked((int)next.Center.Z));
            }

            state.MonsterRespawns.Add(
                new MonsterRespawnState
                {
                    Kind = monster.Kind,
                    Ring = monster.Ring,
                    Element = monster.Element,
                    HomePosition = homePosition,
                    CourtId = courtId,
                    RespawnAtTick = state.Tick + RespawnTicks(monster.Kind)
                });
        }

        private static int RespawnTicks(MonsterKind kind)
        {
            return kind switch
            {
                MonsterKind.GroundMelee or MonsterKind.GroundRanged =>
                    40 * SimulationConstants.TicksPerSecond,
                MonsterKind.Flying => 45 * SimulationConstants.TicksPerSecond,
                MonsterKind.Pig => 120 * SimulationConstants.TicksPerSecond,
                MonsterKind.EliteTank or MonsterKind.EliteRanged =>
                    180 * SimulationConstants.TicksPerSecond,
                MonsterKind.DragonKing =>
                    240 * SimulationConstants.TicksPerSecond,
                MonsterKind.CoreBoss =>
                    300 * SimulationConstants.TicksPerSecond,
                _ => 0
            };
        }
    }
}
