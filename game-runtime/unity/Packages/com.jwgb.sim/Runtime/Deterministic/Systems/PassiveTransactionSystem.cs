using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class PassiveTransactionSystem
    {
        public static bool ApplySkillBook(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            string passiveId)
        {
            PassiveCatalog.Get(passiveId);
            for (var index = 0; index < player.Passives.Count; index += 1)
            {
                var entry = player.Passives[index];
                if (entry.PassiveId != passiveId)
                {
                    continue;
                }

                if (entry.Level >= 5)
                {
                    return false;
                }

                var level = entry.Level + 1;
                player.Passives[index] =
                    new PassiveLoadoutEntry(passiveId, level);
                events.Add(
                    new SimEvent
                    {
                        Type = "passive-upgraded",
                        Tick = state.Tick,
                        EntityId = player.EntityId,
                        PassiveId = passiveId,
                        Level = level,
                        Source = "skill-book"
                    });
                return true;
            }

            if (player.Passives.Count >= 4)
            {
                return false;
            }

            player.Passives.Add(new PassiveLoadoutEntry(passiveId, 1));
            events.Add(
                new SimEvent
                {
                    Type = "passive-learned",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    PassiveId = passiveId,
                    Level = 1,
                    Source = "skill-book"
                });
            return true;
        }

        public static string SpendGemResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string passiveId)
        {
            var player = StateQueries.GetRequiredPlayer(
                state,
                playerEntityId);
            if (!LootSystem.CanUseWorldResources(player))
            {
                return "player-not-alive";
            }

            if (player.PvpCombatTicks > 0)
            {
                return "pvp-combat-lock";
            }

            if (player.Gems <= 0)
            {
                return "no-gems";
            }

            PassiveCatalog.Get(passiveId);
            for (var index = 0; index < player.Passives.Count; index += 1)
            {
                var entry = player.Passives[index];
                if (entry.PassiveId != passiveId)
                {
                    continue;
                }

                if (entry.Level >= 5)
                {
                    return "passive-maxed";
                }

                var level = entry.Level + 1;
                player.Gems -= 1;
                player.Passives[index] =
                    new PassiveLoadoutEntry(passiveId, level);
                events.Add(
                    new SimEvent
                    {
                        Type = "passive-upgraded",
                        Tick = state.Tick,
                        EntityId = player.EntityId,
                        PassiveId = passiveId,
                        Level = level,
                        Source = "gem"
                    });
                return "accepted";
            }

            return "passive-not-learned";
        }

        public static string ReplaceSkillBookResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            int lootEntityId,
            string replacePassiveId)
        {
            var player = StateQueries.GetRequiredPlayer(
                state,
                playerEntityId);
            if (!LootSystem.CanUseWorldResources(player))
            {
                return "player-not-alive";
            }

            if (player.PvpCombatTicks > 0)
            {
                return "pvp-combat-lock";
            }

            if (!state.LootDrops.TryGetValue(
                    lootEntityId,
                    out var drop))
            {
                return "loot-not-found";
            }

            if (drop.BookPassiveId == null)
            {
                return "loot-not-skill-book";
            }

            if (IntegerMath.DistanceSquared(
                    player.Position,
                    drop.Position) > 2_500L * 2_500L)
            {
                return "skill-book-too-far";
            }

            if (!LineOfSightSystem.HasDirectLineOfSight(
                    state,
                    player.Position,
                    drop.Position))
            {
                return "skill-book-line-of-sight";
            }

            if (player.Passives.Count < 4)
            {
                return "invalid-replacement";
            }

            for (var index = 0; index < player.Passives.Count; index += 1)
            {
                if (player.Passives[index].PassiveId ==
                    drop.BookPassiveId)
                {
                    return "invalid-replacement";
                }
            }

            var replaceIndex = -1;
            for (var index = 0; index < player.Passives.Count; index += 1)
            {
                if (player.Passives[index].PassiveId ==
                    replacePassiveId)
                {
                    replaceIndex = index;
                    break;
                }
            }

            if (replaceIndex < 0)
            {
                return "invalid-replacement";
            }

            PassiveCatalog.Get(drop.BookPassiveId);
            LoadoutCleanupSystem.ClearRemovedPassiveState(
                state,
                events,
                player,
                replacePassiveId);
            player.Passives[replaceIndex] =
                new PassiveLoadoutEntry(drop.BookPassiveId, 1);
            state.LootDrops.Remove(lootEntityId);
            events.Add(
                new SimEvent
                {
                    Type = "passive-learned",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    PassiveId = drop.BookPassiveId,
                    Level = 1,
                    Source = "skill-book"
                });
            events.Add(
                new SimEvent
                {
                    Type = "loot-collected",
                    Tick = state.Tick,
                    EntityId = drop.EntityId,
                    CollectorEntityId = player.EntityId,
                    BookPassiveId = drop.BookPassiveId
                });
            return "accepted";
        }
    }
}
