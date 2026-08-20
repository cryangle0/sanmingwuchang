using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class EquipmentInventorySystem
    {
        public static string EquipInventoryEquipmentResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            int instanceId,
            int? replacementInstanceId)
        {
            var player = StateQueries.GetRequiredPlayer(
                state,
                playerEntityId);
            if (!CanInteract(player))
            {
                return "player-not-alive";
            }

            var incomingIndex = FindByInstanceId(
                player.InventoryEquipment,
                instanceId);
            if (incomingIndex < 0)
            {
                return "equipment-not-found";
            }

            var incoming = player.InventoryEquipment[incomingIndex];
            for (var index = 0; index < player.Equipment.Count; index += 1)
            {
                if (player.Equipment[index].EquipmentId ==
                    incoming.EquipmentId)
                {
                    return "duplicate-equipped";
                }
            }

            var replacementIndex = -1;
            EquippedEquipmentInstance? replacement = null;
            if (replacementInstanceId.HasValue)
            {
                replacementIndex = FindByInstanceId(
                    player.Equipment,
                    replacementInstanceId.Value);
                if (replacementIndex < 0)
                {
                    return "invalid-replacement";
                }

                replacement = player.Equipment[replacementIndex];
            }
            else if (player.Equipment.Count >= 3)
            {
                return "replacement-required";
            }

            player.InventoryEquipment.RemoveAt(incomingIndex);
            if (replacement.HasValue)
            {
                EquipmentStateSystem.ClearRemovedEquipmentState(
                    state,
                    player,
                    replacement.Value.EquipmentId);
                player.Equipment[replacementIndex] = incoming;
                player.InventoryEquipment.Add(replacement.Value);
            }
            else
            {
                player.Equipment.Add(incoming);
            }

            RebuildEquipmentStats(player);
            DropHandOverflow(state, events, player);
            events.Add(
                new SimEvent
                {
                    Type = "equipment-equipped",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    InstanceId = incoming.InstanceId,
                    EquipmentId = incoming.EquipmentId,
                    ReplacementInstanceId =
                        replacement?.InstanceId
                });
            return "accepted";
        }

        public static string UnequipEquipmentResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            int instanceId)
        {
            var player = StateQueries.GetRequiredPlayer(
                state,
                playerEntityId);
            if (!CanInteract(player))
            {
                return "player-not-alive";
            }

            var index = FindByInstanceId(player.Equipment, instanceId);
            if (index < 0)
            {
                return "equipment-not-found";
            }

            var candidate = player.Equipment[index];
            var changesCapacity =
                candidate.EquipmentId == GameplayIds.ClothBag;
            if (!changesCapacity &&
                player.InventoryEquipment.Count >=
                LootSystem.EquipmentHandCapacity(player))
            {
                return "hand-full";
            }

            EquipmentStateSystem.ClearRemovedEquipmentState(
                state,
                player,
                candidate.EquipmentId);
            player.Equipment.RemoveAt(index);
            player.InventoryEquipment.Add(candidate);
            RebuildEquipmentStats(player);
            DropHandOverflow(state, events, player);
            events.Add(
                new SimEvent
                {
                    Type = "equipment-unequipped",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    InstanceId = candidate.InstanceId,
                    EquipmentId = candidate.EquipmentId
                });
            return "accepted";
        }

        public static string DiscardEquipmentResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            int instanceId,
            out int? lootEntityId)
        {
            lootEntityId = null;
            var player = StateQueries.GetRequiredPlayer(
                state,
                playerEntityId);
            if (!CanInteract(player))
            {
                return "player-not-alive";
            }

            var equippedIndex = FindByInstanceId(
                player.Equipment,
                instanceId);
            var inventoryIndex = FindByInstanceId(
                player.InventoryEquipment,
                instanceId);
            if (equippedIndex < 0 && inventoryIndex < 0)
            {
                return "equipment-not-found";
            }

            EquippedEquipmentInstance instance;
            if (equippedIndex >= 0)
            {
                instance = player.Equipment[equippedIndex];
                EquipmentStateSystem.ClearRemovedEquipmentState(
                    state,
                    player,
                    instance.EquipmentId);
                player.Equipment.RemoveAt(equippedIndex);
                RebuildEquipmentStats(player);
            }
            else
            {
                instance = player.InventoryEquipment[inventoryIndex];
                player.InventoryEquipment.RemoveAt(inventoryIndex);
            }

            var drop = LootRuntime.CreateEquipmentLootDrop(
                state,
                player.Position,
                instance);
            LootRuntime.EmitLootDropped(
                state,
                events,
                drop,
                player.EntityId);
            events.Add(
                new SimEvent
                {
                    Type = "equipment-discarded",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    InstanceId = instance.InstanceId,
                    EquipmentId = instance.EquipmentId
                });
            lootEntityId = drop.EntityId;
            return "accepted";
        }

        private static bool CanInteract(PlayerState player)
        {
            return player.LifeState == LifeState.Alive &&
                player.WorldInteractionLockTicks <= 0;
        }

        private static int FindByInstanceId(
            List<EquippedEquipmentInstance> values,
            int instanceId)
        {
            for (var index = 0; index < values.Count; index += 1)
            {
                if (values[index].InstanceId == instanceId)
                {
                    return index;
                }
            }

            return -1;
        }
    }
}
