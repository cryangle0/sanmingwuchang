using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/active-replacement.ts.
    /// </summary>
    internal static class ActiveReplacementSystem
    {
        private const int InteractionRadiusMm = 2_500;

        public static int EquipmentActiveCooldownTicks(
            PlayerState player,
            int durationTicks)
        {
            return MonsterDamageSystem.HasEquipment(
                player,
                GameplayIds.WindBag)
                ? durationTicks * 80 / 100
                : durationTicks;
        }

        private static bool IsActiveLoot(LootDropState drop)
        {
            return drop != null &&
                drop.HasRuntimeFields &&
                drop.ActiveId != null;
        }

        public static bool Request(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            LootDropState drop)
        {
            if (!IsActiveLoot(drop) ||
                player.ActiveAbilityId == drop.ActiveId)
            {
                return false;
            }

            if (state.PendingActiveReplacements.TryGetValue(
                    player.EntityId,
                    out var previous))
            {
                if (previous.LootEntityId == drop.EntityId &&
                    previous.ActiveId == drop.ActiveId)
                {
                    return true;
                }

                events.Add(
                    new SimEvent
                    {
                        Type = "active-replacement-cancelled",
                        Tick = state.Tick,
                        EntityId = player.EntityId,
                        Reason = "active-changed"
                    });
            }

            state.PendingActiveReplacements[player.EntityId] =
                new PendingActiveReplacementState
                {
                    PlayerEntityId = player.EntityId,
                    LootEntityId = drop.EntityId,
                    ActiveId = drop.ActiveId,
                    RequestedAtTick = state.Tick
                };
            events.Add(
                new SimEvent
                {
                    Type = "active-replacement-required",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    ActiveAbilityId = drop.ActiveId
                });
            return true;
        }

        public static void ClearPending(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string reason)
        {
            if (!state.PendingActiveReplacements.ContainsKey(
                    playerEntityId))
            {
                return;
            }

            state.PendingActiveReplacements.Remove(playerEntityId);
            events.Add(
                new SimEvent
                {
                    Type = "active-replacement-cancelled",
                    Tick = state.Tick,
                    EntityId = playerEntityId,
                    Reason = reason
                });
        }

        public static void ClearPendingForLoot(
            SimulationState state,
            List<SimEvent> events,
            int lootEntityId)
        {
            var players = new List<int>();
            foreach (var pending in state.PendingActiveReplacements.Values)
            {
                if (pending.LootEntityId == lootEntityId)
                {
                    players.Add(pending.PlayerEntityId);
                }
            }

            for (var index = 0; index < players.Count; index += 1)
            {
                ClearPending(
                    state,
                    events,
                    players[index],
                    "loot-unavailable");
            }
        }

        /// <summary>Returns the transaction code; "accepted" on success.</summary>
        public static string ReplaceResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            int lootEntityId,
            bool confirm)
        {
            if (!state.Players.TryGetValue(playerEntityId, out var player))
            {
                throw new System.InvalidOperationException(
                    "unknown player " + playerEntityId);
            }

            if (!state.PendingActiveReplacements.TryGetValue(
                    playerEntityId,
                    out var pending) ||
                pending.LootEntityId != lootEntityId)
            {
                return "active-replacement-not-found";
            }

            if (!confirm)
            {
                ClearPending(state, events, playerEntityId, "declined");
                return "active-replacement-declined";
            }

            if (!LootSystem.CanUseWorldResources(player))
            {
                return "player-not-alive";
            }

            state.LootDrops.TryGetValue(lootEntityId, out var drop);
            if (!IsActiveLoot(drop) || drop.ExpiresAtTick <= state.Tick)
            {
                ClearPending(
                    state,
                    events,
                    playerEntityId,
                    "loot-unavailable");
                return "active-loot-not-found";
            }

            if (drop.ActiveId != pending.ActiveId)
            {
                ClearPending(
                    state,
                    events,
                    playerEntityId,
                    "active-changed");
                return "active-changed";
            }

            if (player.ActiveAbilityId == pending.ActiveId)
            {
                ClearPending(
                    state,
                    events,
                    playerEntityId,
                    "active-changed");
                return "active-already-equipped";
            }

            if (IntegerMath.DistanceSquared(
                    player.Position,
                    drop.Position) >
                (long)InteractionRadiusMm * InteractionRadiusMm)
            {
                return "active-loot-too-far";
            }

            if (!LineOfSightSystem.HasDirectLineOfSight(
                    state,
                    player.Position,
                    drop.Position))
            {
                return "active-loot-line-of-sight";
            }

            var previousActiveId = player.ActiveAbilityId;
            var active = ActiveCatalog.Get(drop.ActiveId);
            LoadoutCleanupSystem.ClearOwnedActiveStateForReplacement(
                state,
                events,
                player,
                previousActiveId);
            player.ActiveAbilityId = drop.ActiveId;
            player.ActiveCooldownTicks = EquipmentActiveCooldownTicks(
                player,
                active.CooldownTicks);
            state.LootDrops.Remove(drop.EntityId);
            state.PendingActiveReplacements.Remove(playerEntityId);
            events.Add(
                new SimEvent
                {
                    Type = "active-replaced",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    ActiveAbilityId = drop.ActiveId,
                    DurationTicks = player.ActiveCooldownTicks
                });
            events.Add(
                new SimEvent
                {
                    Type = "loot-collected",
                    Tick = state.Tick,
                    EntityId = drop.EntityId,
                    SourceEntityId = player.EntityId
                });
            return "accepted";
        }
    }
}
