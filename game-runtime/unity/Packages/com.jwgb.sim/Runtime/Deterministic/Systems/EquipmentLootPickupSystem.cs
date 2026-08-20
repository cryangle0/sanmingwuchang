using System.Collections.Generic;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/equipment-loot-pickup.ts.
    /// </summary>
    internal static class EquipmentLootPickupSystem
    {
        private const int InteractionRadiusMm = 2_500;
        private const int EquippedCapacity = 3;

        private static bool IsEquipmentLoot(LootDropState drop)
        {
            return drop != null &&
                drop.EquipmentId != null &&
                drop.BookPassiveId == null &&
                (!drop.HasRuntimeFields || drop.ActiveId == null);
        }

        public static void ClearPending(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string reason)
        {
            if (!state.PendingEquipmentPickups.ContainsKey(playerEntityId))
            {
                return;
            }

            state.PendingEquipmentPickups.Remove(playerEntityId);
            events.Add(
                new SimEvent
                {
                    Type = "equipment-pickup-replacement-cancelled",
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
            foreach (var pending in state.PendingEquipmentPickups.Values)
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

        public static bool Request(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            LootDropState drop)
        {
            if (!IsEquipmentLoot(drop) ||
                !LootSystem.CanUseWorldResources(player))
            {
                return false;
            }

            if (state.PendingEquipmentPickups.TryGetValue(
                    player.EntityId,
                    out var previous))
            {
                if (previous.LootEntityId == drop.EntityId &&
                    previous.EquipmentId == drop.EquipmentId &&
                    previous.EquipmentInstanceId ==
                        drop.EquipmentInstanceId)
                {
                    return true;
                }

                ClearPending(
                    state,
                    events,
                    player.EntityId,
                    "equipment-changed");
            }

            state.PendingEquipmentPickups[player.EntityId] =
                new PendingEquipmentPickupState
                {
                    PlayerEntityId = player.EntityId,
                    LootEntityId = drop.EntityId,
                    EquipmentId = drop.EquipmentId,
                    EquipmentInstanceId = drop.EquipmentInstanceId,
                    RequestedAtTick = state.Tick
                };
            events.Add(
                new SimEvent
                {
                    Type = "equipment-pickup-replacement-required",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    EquipmentId = drop.EquipmentId
                });
            return true;
        }

        private static bool FindInstance(
            PlayerState player,
            int instanceId,
            out bool equipped,
            out int index,
            out EquippedEquipmentInstance instance)
        {
            for (var i = 0; i < player.Equipment.Count; i += 1)
            {
                if (player.Equipment[i].InstanceId == instanceId)
                {
                    equipped = true;
                    index = i;
                    instance = player.Equipment[i];
                    return true;
                }
            }

            for (var i = 0; i < player.InventoryEquipment.Count; i += 1)
            {
                if (player.InventoryEquipment[i].InstanceId == instanceId)
                {
                    equipped = false;
                    index = i;
                    instance = player.InventoryEquipment[i];
                    return true;
                }
            }

            equipped = false;
            index = -1;
            instance = default;
            return false;
        }

        private static bool InstanceOwnedByAnotherPlayer(
            SimulationState state,
            PlayerState owner,
            int instanceId)
        {
            foreach (var candidate in state.Players.Values)
            {
                if (candidate.EntityId == owner.EntityId)
                {
                    continue;
                }

                for (var index = 0;
                    index < candidate.Equipment.Count;
                    index += 1)
                {
                    if (candidate.Equipment[index].InstanceId ==
                        instanceId)
                    {
                        return true;
                    }
                }

                for (var index = 0;
                    index < candidate.InventoryEquipment.Count;
                    index += 1)
                {
                    if (candidate.InventoryEquipment[index].InstanceId ==
                        instanceId)
                    {
                        return true;
                    }
                }
            }

            return false;
        }

        /// <summary>
        /// Returns the transaction code; "accepted" and
        /// "equipment-pickup-declined" are the accepted outcomes.
        /// </summary>
        public static string PickupResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            int lootEntityId,
            string destination,
            int? replacementInstanceId)
        {
            if (!state.Players.TryGetValue(playerEntityId, out var player))
            {
                throw new System.InvalidOperationException(
                    "unknown player " + playerEntityId);
            }

            state.PendingEquipmentPickups.TryGetValue(
                playerEntityId,
                out var pending);

            if (destination == "cancel")
            {
                if (pending == null || pending.LootEntityId != lootEntityId)
                {
                    return "equipment-pickup-not-found";
                }

                ClearPending(state, events, playerEntityId, "declined");
                return "equipment-pickup-declined";
            }

            if (!LootSystem.CanUseWorldResources(player))
            {
                return "player-not-alive";
            }

            state.LootDrops.TryGetValue(lootEntityId, out var drop);
            if (!IsEquipmentLoot(drop) || drop.ExpiresAtTick <= state.Tick)
            {
                ClearPending(
                    state,
                    events,
                    playerEntityId,
                    "loot-unavailable");
                return "equipment-loot-not-found";
            }

            if (pending != null &&
                (pending.LootEntityId != drop.EntityId ||
                 pending.EquipmentId != drop.EquipmentId ||
                 pending.EquipmentInstanceId != drop.EquipmentInstanceId))
            {
                ClearPending(
                    state,
                    events,
                    playerEntityId,
                    "equipment-changed");
                return "equipment-changed";
            }

            var distance = IntegerMath.DistanceSquared(
                player.Position,
                drop.Position);
            if (distance >
                (long)InteractionRadiusMm * InteractionRadiusMm)
            {
                return "equipment-loot-too-far";
            }

            if (!LineOfSightSystem.HasDirectLineOfSight(
                    state,
                    player.Position,
                    drop.Position))
            {
                return "equipment-loot-line-of-sight";
            }

            // Candidate incoming instance (existing instance identity is
            // preserved when the drop carries one).
            var hasDropInstance = drop.EquipmentInstanceId.HasValue;
            if (hasDropInstance)
            {
                if (FindInstance(
                        player,
                        drop.EquipmentInstanceId.Value,
                        out _,
                        out _,
                        out _) ||
                    InstanceOwnedByAnotherPlayer(
                        state,
                        player,
                        drop.EquipmentInstanceId.Value))
                {
                    return "equipment-changed";
                }
            }

            var replacementFound = false;
            var replacementEquipped = false;
            var replacementIndex = -1;
            EquippedEquipmentInstance replacementInstance = default;
            if (replacementInstanceId.HasValue)
            {
                replacementFound = FindInstance(
                    player,
                    replacementInstanceId.Value,
                    out replacementEquipped,
                    out replacementIndex,
                    out replacementInstance);
                if (!replacementFound)
                {
                    return "invalid-replacement";
                }
            }

            if (destination == "inventory")
            {
                if (replacementFound && replacementEquipped)
                {
                    return "invalid-replacement";
                }

                if (!replacementFound &&
                    player.InventoryEquipment.Count >=
                    LootSystem.EquipmentHandCapacity(player))
                {
                    return "replacement-required";
                }
            }
            else if (destination == "equipped")
            {
                if (replacementFound && !replacementEquipped)
                {
                    return "invalid-replacement";
                }

                if (!replacementFound &&
                    player.Equipment.Count >= EquippedCapacity)
                {
                    return "replacement-required";
                }

                for (var index = 0;
                    index < player.Equipment.Count;
                    index += 1)
                {
                    var instance = player.Equipment[index];
                    if (replacementFound &&
                        instance.InstanceId ==
                        replacementInstance.InstanceId)
                    {
                        continue;
                    }

                    if (instance.EquipmentId == drop.EquipmentId)
                    {
                        return "duplicate-equipped";
                    }
                }
            }
            else
            {
                return "equipment-changed";
            }

            EquippedEquipmentInstance incoming;
            if (hasDropInstance)
            {
                incoming = new EquippedEquipmentInstance(
                    drop.EquipmentInstanceId.Value,
                    drop.EquipmentId,
                    drop.AcquiredAtTick ?? drop.CreatedAtTick,
                    drop.PermanentAttackBonus);
                state.NextEquipmentInstanceId = System.Math.Max(
                    state.NextEquipmentInstanceId,
                    drop.EquipmentInstanceId.Value + 1);
            }
            else
            {
                incoming = EquipmentInventorySystem.CreateEquipmentInstance(
                    state,
                    drop.EquipmentId,
                    drop.HasRuntimeFields && drop.AcquiredAtTick.HasValue
                        ? drop.AcquiredAtTick
                        : state.Tick,
                    drop.PermanentAttackBonus);
            }

            state.LootDrops.Remove(drop.EntityId);
            state.PendingEquipmentPickups.Remove(playerEntityId);

            if (replacementFound)
            {
                if (replacementEquipped)
                {
                    EquipmentStateSystem.ClearRemovedEquipmentState(
                        state,
                        player,
                        replacementInstance.EquipmentId);
                    player.Equipment.RemoveAt(replacementIndex);
                }
                else
                {
                    player.InventoryEquipment.RemoveAt(replacementIndex);
                }
            }

            if (destination == "inventory")
            {
                player.InventoryEquipment.Add(incoming);
            }
            else
            {
                player.Equipment.Add(incoming);
            }

            if (destination == "equipped" ||
                (replacementFound && replacementEquipped))
            {
                EquipmentInventorySystem.RebuildEquipmentStats(player);
                EquipmentInventorySystem.DropHandOverflow(
                    state,
                    events,
                    player);
            }

            var collectedGold = EquipmentEconomySystem.GrantGeneratedGold(
                player,
                drop.Gold);
            EquipmentEconomySystem.GrantExperience(player, drop.Experience);
            player.Gems += drop.Gems;
            EquipmentEconomySystem.GrantGeneratedGold(
                player,
                PassiveEconomySystem.ScavengerPickupGold(
                    player,
                    incoming.EquipmentId));

            events.Add(
                new SimEvent
                {
                    Type = "loot-collected",
                    Tick = state.Tick,
                    EntityId = drop.EntityId,
                    SourceEntityId = player.EntityId,
                    Amount = collectedGold
                });

            if (destination == "equipped")
            {
                events.Add(
                    new SimEvent
                    {
                        Type = "equipment-equipped",
                        Tick = state.Tick,
                        EntityId = player.EntityId,
                        EquipmentId = incoming.EquipmentId
                    });
            }

            if (replacementFound)
            {
                var replacementDrop = LootRuntime.CreateEquipmentLootDrop(
                    state,
                    player.Position,
                    replacementInstance);
                LootRuntime.EmitLootDropped(
                    state,
                    events,
                    replacementDrop,
                    player.EntityId);
                events.Add(
                    new SimEvent
                    {
                        Type = "equipment-discarded",
                        Tick = state.Tick,
                        EntityId = player.EntityId,
                        EquipmentId = replacementInstance.EquipmentId
                    });
            }

            ClearPendingForLoot(state, events, drop.EntityId);
            return "accepted";
        }
    }
}
