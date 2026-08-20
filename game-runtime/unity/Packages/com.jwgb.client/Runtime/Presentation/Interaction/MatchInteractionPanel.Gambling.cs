using Jwgb.Content;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client.Presentation
{
    internal sealed partial class MatchInteractionPanel
    {
        private void BuildGambling(ShopSnapshot shop)
        {
            AddSection($"GAMBLES {player.HeishanGambleCount}/3");
            var available = player.HeishanGambleCount < 3 &&
                player.LifeState == LifeState.Alive;
            foreach (var passive in player.Passives)
            {
                var row = AddRow(
                    $"{PassiveCatalog.Get(passive.PassiveId).Name} " +
                    $"LV.{passive.Level}");
                AddAction(
                    row,
                    "RISK",
                    "Gamble passive",
                    () => Submit(
                        new SimulationTransactionRequest
                        {
                            Kind = SimulationTransactionKind
                                .GamblePassive,
                            ShopId = shop.ShopId,
                            ExpectedVersion = shop.Version,
                            PassiveId = passive.PassiveId
                        }),
                    available,
                    "Gamble limit reached");
            }

            foreach (var instance in player.Equipment)
            {
                AddEquipmentGamble(shop, instance, available);
            }
            foreach (var instance in player.InventoryEquipment)
            {
                AddEquipmentGamble(shop, instance, available);
            }

            var activeRow = AddRow(
                $"ACTIVE  {player.ActiveAbilityId}");
            AddAction(
                activeRow,
                "RISK",
                "Gamble active ability",
                () => Submit(
                    new SimulationTransactionRequest
                    {
                        Kind =
                            SimulationTransactionKind.GambleActive,
                        ShopId = shop.ShopId,
                        ExpectedVersion = shop.Version
                    }),
                available,
                "Gamble limit reached");
            BuildGoldGambles(shop, available);
        }

        private void AddEquipmentGamble(
            ShopSnapshot shop,
            EquippedEquipmentInstance instance,
            bool available)
        {
            var row = AddRow(EquipmentName(instance.EquipmentId));
            AddAction(
                row,
                "RISK",
                "Gamble equipment",
                () => Submit(
                    new SimulationTransactionRequest
                    {
                        Kind =
                            SimulationTransactionKind.GambleEquipment,
                        ShopId = shop.ShopId,
                        ExpectedVersion = shop.Version,
                        InstanceId = instance.InstanceId
                    }),
                available,
                "Gamble limit reached");
        }

        private void BuildGoldGambles(
            ShopSnapshot shop,
            bool available)
        {
            var wagers = new[] { 500, 1_000, 2_000, 5_000 };
            var row = AddRow("DOUBLE GOLD");
            for (var index = 0; index < wagers.Length; index += 1)
            {
                var wager = wagers[index];
                AddAction(
                    row,
                    $"{wager}",
                    $"Wager {wager} gold",
                    () => Submit(CreateGoldGambleRequest(
                        shop,
                        wager,
                        "double")),
                    available && player.Gold >= wager,
                    "Insufficient gold or gamble limit");
            }

            var purpleRow = AddRow("PURPLE EQUIPMENT  2000G");
            AddAction(
                purpleRow,
                "RISK",
                "Wager 2000 gold for purple equipment",
                () => Submit(CreateGoldGambleRequest(
                    shop,
                    2_000,
                    "purple")),
                available && player.Gold >= 2_000,
                "Requires 2000 gold or gamble available");
        }

        internal static SimulationTransactionRequest
            CreateGoldGambleRequest(
                ShopSnapshot shop,
                int wagerGold,
                string mode)
        {
            return new SimulationTransactionRequest
            {
                Kind = SimulationTransactionKind.GambleGold,
                ShopId = shop.ShopId,
                ExpectedVersion = shop.Version,
                WagerGold = wagerGold,
                Mode = mode
            };
        }
    }
}
