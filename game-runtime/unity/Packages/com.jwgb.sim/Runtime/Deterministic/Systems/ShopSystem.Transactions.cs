using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class ShopSystem
    {
        public static string PurchaseListingResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string shopId,
            string listingId,
            int expectedVersion,
            string destination)
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

            if (destination != "equipped" &&
                destination != "inventory")
            {
                return "invalid-destination";
            }

            var listingIndex = FindListing(shop, listingId);
            if (listingIndex < 0)
            {
                return "listing-not-found";
            }

            var listing = shop.Inventory[listingIndex];
            if (player.Gold < listing.Price)
            {
                return "insufficient-gold";
            }

            if (listing.Kind == "equipment")
            {
                if (listing.EquipmentId == null)
                {
                    return "equipment-capacity";
                }

                if (destination == "equipped")
                {
                    if (player.Equipment.Count >= 3 ||
                        HasEquipped(
                            player,
                            listing.EquipmentId))
                    {
                        return "equipment-capacity";
                    }
                }
                else if (player.InventoryEquipment.Count >=
                    LootSystem.EquipmentHandCapacity(player))
                {
                    return "equipment-capacity";
                }
            }

            player.Gold -= listing.Price;
            shop.Inventory.RemoveAt(listingIndex);
            if (listing.Kind == "gem")
            {
                player.Gems += 1;
            }
            else if (listing.Kind == "consumable")
            {
                ApplyConsumable(player, listing.ConsumableId);
            }
            else if (destination == "equipped")
            {
                player.Equipment.Add(
                    EquipmentInventorySystem.CreateEquipmentInstance(
                        state,
                        listing.EquipmentId));
                EquipmentInventorySystem.RebuildEquipmentStats(player);
            }
            else
            {
                player.InventoryEquipment.Add(
                    EquipmentInventorySystem.CreateEquipmentInstance(
                        state,
                        listing.EquipmentId));
            }

            events.Add(
                new SimEvent
                {
                    Type = "shop-purchase",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    ShopId = shopId,
                    ListingId = listingId,
                    EquipmentId = listing.EquipmentId,
                    Amount = listing.Price,
                    Kind = listing.Kind
                });
            return "accepted";
        }

        private static string GetTransactionFailure(
            SimulationState state,
            string shopId,
            int expectedVersion,
            out ShopState shop)
        {
            state.Shops.TryGetValue(shopId, out shop);
            if (shop == null || shop.Status != "open")
            {
                return "shop-unavailable";
            }

            if (shop.Version != expectedVersion)
            {
                return "shop-version-mismatch";
            }

            if (state.Tick < shop.OpenAtTick ||
                state.Tick >= shop.CloseAtTick)
            {
                return "shop-closed";
            }

            return null;
        }

        private static int FindListing(
            ShopState shop,
            string listingId)
        {
            for (var index = 0; index < shop.Inventory.Count; index += 1)
            {
                if (shop.Inventory[index].ListingId == listingId)
                {
                    return index;
                }
            }

            return -1;
        }

        private static int FindInstance(
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

        private static bool HasEquipped(
            PlayerState player,
            string equipmentId)
        {
            for (var index = 0; index < player.Equipment.Count; index += 1)
            {
                if (player.Equipment[index].EquipmentId == equipmentId)
                {
                    return true;
                }
            }

            return false;
        }

        private static void ApplyConsumable(
            PlayerState player,
            string consumableId)
        {
            if (consumableId == "clairvoyance-talisman")
            {
                player.ConsumableVisionTicks =
                    System.Math.Max(
                        player.ConsumableVisionTicks,
                        10 * SimulationConstants.TicksPerSecond);
            }
            else if (consumableId == "demon-revealing-mirror")
            {
                player.ConsumableRevealTicks =
                    System.Math.Max(
                        player.ConsumableRevealTicks,
                        3 * SimulationConstants.TicksPerSecond);
            }
        }
    }
}
