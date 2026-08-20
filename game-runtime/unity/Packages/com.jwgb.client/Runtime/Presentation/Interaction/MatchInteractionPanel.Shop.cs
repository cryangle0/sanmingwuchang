using Jwgb.Content;
using Jwgb.Sim.Deterministic;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    internal sealed partial class MatchInteractionPanel
    {
        private static readonly string[] SwapHeroIds =
        {
            GameplayIds.IronFanPrincess,
            GameplayIds.SunWukong,
            GameplayIds.BullDemonKing
        };

        private void BuildWorldContent()
        {
            var hasReplacement = BuildPendingReplacements();
            var shop = FindNearestShop();
            if (shop != null)
            {
                BuildShop(shop);
                return;
            }
            if (!hasReplacement)
            {
                AddRow("NO NEARBY WORLD INTERACTION");
            }
        }

        private string WorldContextKey()
        {
            var shop = FindNearestShop();
            if (shop != null)
            {
                return $"shop:{shop.ShopId}:{shop.Version}";
            }
            for (var index = 0;
                index < snapshot.PendingActiveReplacements.Length;
                index += 1)
            {
                var pending =
                    snapshot.PendingActiveReplacements[index];
                if (pending.PlayerEntityId == player.EntityId)
                {
                    return $"active:{pending.LootEntityId}";
                }
            }
            for (var index = 0;
                index < snapshot.PendingEquipmentPickups.Length;
                index += 1)
            {
                var pending =
                    snapshot.PendingEquipmentPickups[index];
                if (pending.PlayerEntityId == player.EntityId)
                {
                    return $"equipment:{pending.LootEntityId}";
                }
            }
            return string.Empty;
        }

        private ShopSnapshot FindNearestShop()
        {
            ShopSnapshot nearest = null;
            long nearestDistance = long.MaxValue;
            for (var index = 0; index < snapshot.Shops.Length; index += 1)
            {
                var candidate = snapshot.Shops[index];
                var distance = DistanceSquared(
                    player.Position,
                    candidate.Position);
                if (distance > 2_500L * 2_500L)
                {
                    continue;
                }
                if (nearest == null ||
                    (candidate.Status == "open" &&
                     nearest.Status != "open") ||
                    (candidate.Status == nearest.Status &&
                     distance < nearestDistance))
                {
                    nearest = candidate;
                    nearestDistance = distance;
                }
            }
            return nearest;
        }

        private void BuildShop(ShopSnapshot shop)
        {
            AddSection(
                $"{shop.Kind.ToUpperInvariant()}  V{shop.Version}");
            if (shop.Status != "open")
            {
                var seconds = System.Math.Max(
                    0,
                    shop.NextRelocationAttemptTick - snapshot.Tick) /
                    Jwgb.Core.SimulationConstants.TicksPerSecond;
                AddRow($"RELOCATING  {seconds}s");
                return;
            }

            for (var index = 0;
                index < shop.Inventory.Length;
                index += 1)
            {
                BuildListing(shop, shop.Inventory[index]);
            }

            if (shop.Kind == "taibai")
            {
                BuildHeroSwap(shop);
            }
            else if (shop.Kind == "heishan")
            {
                BuildGambling(shop);
            }
            else
            {
                BuildSales(shop);
            }
        }

        private void BuildListing(
            ShopSnapshot shop,
            ShopListingSnapshot listing)
        {
            var name = ListingName(listing);
            var row = AddRow($"{name}  {listing.Price}G");
            var canAfford = player.Gold >= listing.Price;
            var available = player.LifeState == LifeState.Alive &&
                player.PvpCombatTicks <= 0 &&
                canAfford;
            var reason = !canAfford
                ? "Insufficient gold"
                : player.PvpCombatTicks > 0
                    ? "PVP combat lock"
                    : "Player unavailable";
            if (listing.Kind == "equipment")
            {
                AddAction(
                    row,
                    "EQUIP",
                    $"Buy and equip {name}",
                    () => Purchase(
                        shop,
                        listing,
                        "equipped"),
                    available,
                    reason);
                AddAction(
                    row,
                    "HAND",
                    $"Buy {name} into hand",
                    () => Purchase(
                        shop,
                        listing,
                        "inventory"),
                    available,
                    reason);
                return;
            }

            AddAction(
                row,
                "BUY",
                $"Buy {name}",
                () => Purchase(shop, listing, "inventory"),
                available,
                reason);
        }

        private void Purchase(
            ShopSnapshot shop,
            ShopListingSnapshot listing,
            string destination)
        {
            Submit(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.ShopPurchase,
                    ShopId = shop.ShopId,
                    ListingId = listing.ListingId,
                    ExpectedVersion = shop.Version,
                    Destination = destination
                });
        }

        private void BuildHeroSwap(ShopSnapshot shop)
        {
            AddSection("HERO SWAP");
            var channeling = player.TaibaiChannelTicks > 0;
            for (var index = 0; index < SwapHeroIds.Length; index += 1)
            {
                var heroId = SwapHeroIds[index];
                if (heroId == player.HeroId)
                {
                    continue;
                }
                var row = AddRow(HeroCatalog.Get(heroId).Name);
                var available = player.Gold >= 1_500 &&
                    player.TaibaiCooldownTicks <= 0 &&
                    !channeling &&
                    player.LifeState == LifeState.Alive;
                AddAction(
                    row,
                    "SWAP",
                    $"Swap to {HeroCatalog.Get(heroId).Name}",
                    () => Submit(
                        new SimulationTransactionRequest
                        {
                            Kind =
                                SimulationTransactionKind.HeroSwap,
                            ShopId = shop.ShopId,
                            ExpectedVersion = shop.Version,
                            HeroId = heroId
                        }),
                    available,
                    channeling
                        ? "Swap already channeling"
                        : player.TaibaiCooldownTicks > 0
                            ? "Service cooldown"
                            : "Requires 1500 gold");
            }
        }

        private void BuildSales(ShopSnapshot shop)
        {
            AddSection("SELL");
            foreach (var instance in player.Equipment)
            {
                AddSale(shop, instance);
            }
            foreach (var instance in player.InventoryEquipment)
            {
                AddSale(shop, instance);
            }
        }

        private void AddSale(
            ShopSnapshot shop,
            EquippedEquipmentInstance instance)
        {
            var row = AddRow(EquipmentName(instance.EquipmentId));
            AddAction(
                row,
                "SELL",
                "Sell equipment",
                () => Submit(
                    new SimulationTransactionRequest
                    {
                        Kind = SimulationTransactionKind.ShopSale,
                        ShopId = shop.ShopId,
                        ExpectedVersion = shop.Version,
                        InstanceId = instance.InstanceId
                    }));
        }

        private static string ListingName(
            ShopListingSnapshot listing)
        {
            if (listing.Kind == "gem")
            {
                return "GEM";
            }
            if (listing.Kind == "consumable")
            {
                return listing.ConsumableId == "clairvoyance-talisman"
                    ? "VISION TALISMAN"
                    : "REVEAL MIRROR";
            }
            return EquipmentName(listing.EquipmentId);
        }
    }
}
