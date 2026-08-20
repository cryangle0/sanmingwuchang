using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class SummonSystem
    {
        private static readonly Int2Mm[] FireSpiritOffsets =
        {
            new Int2Mm(900, 0),
            new Int2Mm(636, 636),
            new Int2Mm(0, 900),
            new Int2Mm(-636, 636),
            new Int2Mm(-900, 0),
            new Int2Mm(-636, -636),
            new Int2Mm(0, -900),
            new Int2Mm(636, -636)
        };

        public static void TrySpawnPassiveSummons(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            string forcedPassiveId = null)
        {
            if (PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.WolfSpirit,
                    out var wolf) &&
                (forcedPassiveId == GameplayIds.WolfSpirit ||
                 state.Random.Combat.NextInt(100) <
                 ChanceForLevel(wolf.Level)))
            {
                SpawnPassiveSummon(
                    state,
                    events,
                    owner,
                    SummonKind.WolfSpirit);
            }

            if (PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.FireSpirit,
                    out var fire) &&
                (forcedPassiveId == GameplayIds.FireSpirit ||
                 state.Random.Combat.NextInt(100) <
                 ChanceForLevel(fire.Level)))
            {
                SpawnPassiveSummon(
                    state,
                    events,
                    owner,
                    SummonKind.FireSpirit);
            }
        }

        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            EnsureStoneStatues(state, events);
            var summons = new List<SummonState>(state.Summons.Values);
            for (var index = 0; index < summons.Count; index += 1)
            {
                var summon = summons[index];
                if (!state.Summons.ContainsKey(summon.EntityId))
                {
                    continue;
                }

                if (summon.Hp <= 0)
                {
                    Remove(
                        state,
                        events,
                        summon,
                        summon.DestroyedByHostileDamage);
                    continue;
                }

                if (!state.Players.TryGetValue(
                        summon.OwnerEntityId,
                        out var owner) ||
                    owner.LifeState != LifeState.Alive ||
                    summon.ExpiresAtTick <= state.Tick)
                {
                    Remove(state, events, summon, false);
                    continue;
                }

                summon.AttackCooldownTicks = Math.Max(
                    0,
                    summon.AttackCooldownTicks - 1);
                switch (summon.Kind)
                {
                    case SummonKind.WolfSpirit:
                        AdvanceWolf(state, events, summon, owner);
                        break;
                    case SummonKind.FireSpirit:
                        AdvanceFireSpirit(state, events, summon, owner);
                        break;
                    case SummonKind.StoneStatue:
                        AdvanceStoneStatue(summon, owner);
                        break;
                    default:
                        throw new ArgumentOutOfRangeException();
                }
            }
        }

        private static SummonState SpawnPassiveSummon(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            SummonKind kind)
        {
            var passiveId = kind == SummonKind.WolfSpirit
                ? GameplayIds.WolfSpirit
                : GameplayIds.FireSpirit;
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    passiveId,
                    out var loadout))
            {
                return null;
            }

            var definition = PassiveCatalog.Get(passiveId);
            var maximum = PassiveCatalog.LevelValue(
                definition.MaximumCountByLevel,
                loadout.Level);
            if (Count(state, owner.EntityId, kind) >= maximum)
            {
                return null;
            }

            var isWolf = kind == SummonKind.WolfSpirit;
            var hp = isWolf
                ? PassiveCatalog.LevelValue(
                    definition.HpByLevel,
                    loadout.Level)
                : 1;
            var summon = new SummonState
            {
                EntityId = state.NextEntityId,
                OwnerEntityId = owner.EntityId,
                Kind = kind,
                Position = owner.Position,
                Hp = hp,
                MaxHp = hp,
                AttackPower = isWolf
                    ? PassiveCatalog.LevelValue(
                        definition.AttackByLevel,
                        loadout.Level)
                    : 0,
                Targetable = isWolf,
                ExpiresAtTick = checked(
                    state.Tick + definition.DurationTicks),
                AttackCooldownTicks = isWolf
                    ? SimulationConstants.TicksPerSecond
                    : 0
            };
            state.NextEntityId += 1;
            state.Summons.Add(summon.EntityId, summon);
            AddSpawnEvent(state, events, summon);
            return summon;
        }

        private static int Count(
            SimulationState state,
            int ownerEntityId,
            SummonKind kind)
        {
            var count = 0;
            foreach (var summon in state.Summons.Values)
            {
                if (summon.OwnerEntityId == ownerEntityId &&
                    summon.Kind == kind)
                {
                    count += 1;
                }
            }

            return count;
        }

        private static int ChanceForLevel(int level)
        {
            return level switch
            {
                1 => 6,
                2 => 8,
                3 => 10,
                4 => 12,
                5 => 15,
                _ => 0
            };
        }

        private static void AddSpawnEvent(
            SimulationState state,
            List<SimEvent> events,
            SummonState summon)
        {
            events.Add(
                new SimEvent
                {
                    Type = "summon-spawned",
                    Tick = state.Tick,
                    EntityId = summon.EntityId,
                    OwnerEntityId = summon.OwnerEntityId,
                    SummonKind = SimulationText.SummonKind(summon.Kind)
                });
        }
    }
}
