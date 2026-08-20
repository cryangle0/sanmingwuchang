using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class ShopSystem
    {
        public static string SellEquipmentResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string shopId,
            int instanceId,
            int expectedVersion)
        {
            var player = StateQueries.GetRequiredPlayer(
                state,
                playerEntityId);
            var failure = GetTransactionFailure(
                state,
                shopId,
                expectedVersion,
                out var shop);
            if (failure != null)
            {
                return failure;
            }

            if (shop.Kind != "land-god" &&
                shop.Kind != "shoemaker")
            {
                return "unsupported-sale-shop";
            }

            if (!LootSystem.CanUseWorldResources(player))
            {
                return "player-not-alive";
            }

            if (player.PvpCombatTicks > 0)
            {
                return "pvp-combat-lock";
            }

            if (!IsAtShop(state, player, shop))
            {
                return "shop-too-far";
            }

            var equippedIndex = FindInstance(
                player.Equipment,
                instanceId);
            var inventoryIndex = FindInstance(
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
                player.Equipment.RemoveAt(equippedIndex);
                EquipmentStateSystem.ClearRemovedEquipmentState(
                    state,
                    player,
                    instance.EquipmentId);
                EquipmentInventorySystem.RebuildEquipmentStats(player);
            }
            else
            {
                instance = player.InventoryEquipment[inventoryIndex];
                player.InventoryEquipment.RemoveAt(inventoryIndex);
            }

            var baseGold = EquipmentCatalog.Get(
                instance.EquipmentId).SellPrice;
            var saleGold = PassiveEconomySystem.ScavengerSaleGold(
                player,
                baseGold);
            var grantedGold =
                EquipmentEconomySystem.GrantGeneratedGold(
                    player,
                    saleGold);
            events.Add(
                new SimEvent
                {
                    Type = "shop-sale",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    ShopId = shopId,
                    InstanceId = instance.InstanceId,
                    EquipmentId = instance.EquipmentId,
                    Amount = grantedGold
                });
            return "accepted";
        }
    }
}
