using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of the inventory builders from
    /// packages/sim/src/systems/shop.ts (current oracle revision).
    /// </summary>
    internal static class ShopInventoryFactory
    {
        private static readonly HashSet<string> ShoeIds =
            new HashSet<string>(StringComparer.Ordinal)
            {
                "W3",
                "B12",
                "B13",
                "B14",
                "P15",
                "P16",
                "P17",
                "P18",
                "G4"
            };

        private const string GamblingMedal = "P10";
        private const string StrawSandal = "W3";

        public static List<ShopListingState> Build(
            SimulationState state,
            string kind,
            string shopId,
            int version,
            int windowOpenTick)
        {
            switch (kind)
            {
                case "land-god":
                    return BuildLandGod(
                        state,
                        shopId,
                        version,
                        windowOpenTick);
                case "shoemaker":
                    return BuildShoemaker(state, shopId, version);
                case "taibai":
                case "heishan":
                    return new List<ShopListingState>();
                default:
                    throw new ArgumentOutOfRangeException(nameof(kind));
            }
        }

        private static List<ShopListingState> BuildLandGod(
            SimulationState state,
            string shopId,
            int version,
            int windowOpenTick)
        {
            var nonShoes = new List<EquipmentDefinition>();
            var equipment = GeneratedGameplayCatalog.Equipment;
            for (var index = 0; index < equipment.Length; index += 1)
            {
                if (!ShoeIds.Contains(equipment[index].Id))
                {
                    nonShoes.Add(equipment[index]);
                }
            }

            var white = new List<EquipmentDefinition>();
            var blueCandidates = new List<EquipmentDefinition>();
            var purpleCandidates = new List<EquipmentDefinition>();
            for (var index = 0; index < nonShoes.Count; index += 1)
            {
                var candidate = nonShoes[index];
                switch (candidate.Rarity)
                {
                    case EquipmentRarity.White:
                        white.Add(candidate);
                        break;
                    case EquipmentRarity.Blue:
                        blueCandidates.Add(candidate);
                        break;
                    case EquipmentRarity.Purple:
                        if (candidate.Id != GamblingMedal ||
                            HeishanOpenAtTick(windowOpenTick))
                        {
                            purpleCandidates.Add(candidate);
                        }

                        break;
                }
            }

            white.Sort(CompareEquipmentIds);
            var blue = ShuffledEquipment(state, blueCandidates);
            var inventory = new List<ShopListingState>();
            var slot = 0;
            for (var index = 0; index < white.Count; index += 1)
            {
                inventory.Add(
                    EquipmentListing(shopId, version, slot, white[index]));
                slot += 1;
            }

            for (var index = 0;
                index < Math.Min(3, blue.Count);
                index += 1)
            {
                inventory.Add(
                    EquipmentListing(shopId, version, slot, blue[index]));
                slot += 1;
            }

            if (state.Random.Shop.NextInt(10_000) < 7_000)
            {
                var purple = ShuffledEquipment(state, purpleCandidates);
                if (purple.Count > 0)
                {
                    inventory.Add(
                        EquipmentListing(
                            shopId,
                            version,
                            slot,
                            purple[0]));
                    slot += 1;
                }
            }

            for (var index = 0; index < 3; index += 1)
            {
                inventory.Add(GemListing(shopId, version, slot));
                slot += 1;
            }

            inventory.Add(
                ConsumableListing(
                    shopId,
                    version,
                    slot,
                    "clairvoyance-talisman",
                    300));
            slot += 1;
            inventory.Add(
                ConsumableListing(
                    shopId,
                    version,
                    slot,
                    "demon-revealing-mirror",
                    500));
            return inventory;
        }

        private static List<ShopListingState> BuildShoemaker(
            SimulationState state,
            string shopId,
            int version)
        {
            var inventory = new List<ShopListingState>();
            var slot = 0;
            var blueShoeCandidates = new List<EquipmentDefinition>();
            var equipment = GeneratedGameplayCatalog.Equipment;
            for (var index = 0; index < equipment.Length; index += 1)
            {
                var id = equipment[index].Id;
                if (id == "B12" || id == "B13" || id == "B14")
                {
                    blueShoeCandidates.Add(equipment[index]);
                }
            }

            var blueShoes = ShuffledEquipment(state, blueShoeCandidates);
            var listedIds = new List<string> { StrawSandal };
            for (var index = 0;
                index < Math.Min(2, blueShoes.Count);
                index += 1)
            {
                listedIds.Add(blueShoes[index].Id);
            }

            for (var index = 0; index < listedIds.Count; index += 1)
            {
                inventory.Add(
                    EquipmentListing(
                        shopId,
                        version,
                        slot,
                        EquipmentCatalog.Get(listedIds[index])));
                slot += 1;
            }

            if (state.Random.Shop.NextInt(10_000) < 4_000)
            {
                var purpleShoes = new[] { "P15", "P16", "P17", "P18" };
                var equipmentId = purpleShoes[
                    (int)state.Random.Shop.NextInt(
                        (ulong)purpleShoes.Length)];
                inventory.Add(
                    EquipmentListing(
                        shopId,
                        version,
                        slot,
                        EquipmentCatalog.Get(equipmentId)));
                slot += 1;
            }

            inventory.Add(
                ConsumableListing(
                    shopId,
                    version,
                    slot,
                    "clairvoyance-talisman",
                    300));
            slot += 1;
            inventory.Add(
                ConsumableListing(
                    shopId,
                    version,
                    slot,
                    "demon-revealing-mirror",
                    500));
            return inventory;
        }

        private static bool HeishanOpenAtTick(int tick)
        {
            for (var index = 0; index < ShopCatalog.Specs.Length; index += 1)
            {
                var spec = ShopCatalog.Specs[index];
                if (spec.ShopId != ShopCatalog.Heishan)
                {
                    continue;
                }

                for (var windowIndex = 0;
                    windowIndex < spec.Windows.Length;
                    windowIndex += 1)
                {
                    var shopWindow = spec.Windows[windowIndex];
                    if (tick >= shopWindow.OpenAtTick &&
                        tick < shopWindow.CloseAtTick)
                    {
                        return true;
                    }
                }

                return false;
            }

            return false;
        }

        private static List<EquipmentDefinition> ShuffledEquipment(
            SimulationState state,
            List<EquipmentDefinition> candidates)
        {
            var result = new List<EquipmentDefinition>(candidates);
            result.Sort(CompareEquipmentIds);
            for (var index = result.Count - 1; index > 0; index -= 1)
            {
                var swapIndex = (int)state.Random.Shop.NextInt(
                    (ulong)(index + 1));
                var previous = result[index];
                result[index] = result[swapIndex];
                result[swapIndex] = previous;
            }

            return result;
        }

        private static int CompareEquipmentIds(
            EquipmentDefinition left,
            EquipmentDefinition right)
        {
            var leftId = left.Id;
            var rightId = right.Id;
            var leftDigits = FirstDigitIndex(leftId);
            var rightDigits = FirstDigitIndex(rightId);
            if (leftDigits > 0 &&
                rightDigits > 0 &&
                leftId.Substring(0, leftDigits) ==
                rightId.Substring(0, rightDigits))
            {
                return int.Parse(leftId.Substring(leftDigits))
                    .CompareTo(int.Parse(rightId.Substring(rightDigits)));
            }

            return string.CompareOrdinal(leftId, rightId);
        }

        private static int FirstDigitIndex(string id)
        {
            for (var index = 0; index < id.Length; index += 1)
            {
                if (char.IsDigit(id[index]))
                {
                    return index;
                }
            }

            return -1;
        }

        private static ShopListingState EquipmentListing(
            string shopId,
            int version,
            int slot,
            EquipmentDefinition equipment)
        {
            return new ShopListingState
            {
                ListingId = ListingId(shopId, version, slot),
                Kind = "equipment",
                EquipmentId = equipment.Id,
                Price = equipment.Price ?? 0
            };
        }

        private static ShopListingState GemListing(
            string shopId,
            int version,
            int slot)
        {
            return new ShopListingState
            {
                ListingId = ListingId(shopId, version, slot),
                Kind = "gem",
                EquipmentId = null,
                Price = 250
            };
        }

        private static ShopListingState ConsumableListing(
            string shopId,
            int version,
            int slot,
            string consumableId,
            int price)
        {
            return new ShopListingState
            {
                ListingId = ListingId(shopId, version, slot),
                Kind = "consumable",
                EquipmentId = null,
                ConsumableId = consumableId,
                Price = price
            };
        }

        private static string ListingId(
            string shopId,
            int version,
            int slot)
        {
            return $"{shopId}:v{version}:s{slot}";
        }
    }
}
