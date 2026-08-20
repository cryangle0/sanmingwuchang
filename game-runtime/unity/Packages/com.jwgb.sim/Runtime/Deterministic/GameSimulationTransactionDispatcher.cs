using System;

namespace Jwgb.Sim.Deterministic
{
    public sealed partial class GameSimulation
    {
        public SimulationTransactionResult ExecuteTransaction(
            SimulationTransactionRequest request)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            int? lootEntityId = null;
            string code;
            switch (request.Kind)
            {
                case SimulationTransactionKind.ShopPurchase:
                    code = PurchaseShopListingResult(
                        request.PlayerEntityId,
                        request.ShopId,
                        request.ListingId,
                        request.ExpectedVersion,
                        request.Destination ?? "inventory");
                    break;
                case SimulationTransactionKind.ShopSale:
                    code = SellShopEquipmentResult(
                        request.PlayerEntityId,
                        request.ShopId,
                        request.InstanceId,
                        request.ExpectedVersion);
                    break;
                case SimulationTransactionKind.HeroSwap:
                    code = StartHeroSwapResult(
                        request.PlayerEntityId,
                        request.ShopId,
                        request.ExpectedVersion,
                        request.HeroId);
                    break;
                case SimulationTransactionKind.GamblePassive:
                    code = GamblePassiveResult(
                        request.PlayerEntityId,
                        request.ShopId,
                        request.ExpectedVersion,
                        request.PassiveId);
                    break;
                case SimulationTransactionKind.GambleEquipment:
                    code = GambleEquipmentResult(
                        request.PlayerEntityId,
                        request.ShopId,
                        request.ExpectedVersion,
                        request.InstanceId);
                    break;
                case SimulationTransactionKind.GambleActive:
                    code = GambleActiveResult(
                        request.PlayerEntityId,
                        request.ShopId,
                        request.ExpectedVersion);
                    break;
                case SimulationTransactionKind.GambleGold:
                    code = GambleGoldResult(
                        request.PlayerEntityId,
                        request.ShopId,
                        request.ExpectedVersion,
                        request.WagerGold,
                        request.Mode ?? "double");
                    break;
                case SimulationTransactionKind.SpendGem:
                    code = SpendGemResult(
                        request.PlayerEntityId,
                        request.PassiveId);
                    break;
                case SimulationTransactionKind.SkillBookReplace:
                    code = ReplaceSkillBookResult(
                        request.PlayerEntityId,
                        request.LootEntityId,
                        request.PassiveId);
                    break;
                case SimulationTransactionKind.EquipmentLootPickup:
                    code = PickupEquipmentLootResult(
                        request.PlayerEntityId,
                        request.LootEntityId,
                        request.Destination ?? "inventory",
                        request.ReplacementInstanceId);
                    break;
                case SimulationTransactionKind.ActiveLootReplace:
                    code = ReplaceActiveLootResult(
                        request.PlayerEntityId,
                        request.LootEntityId,
                        request.Confirm);
                    break;
                case SimulationTransactionKind.EquipmentEquip:
                    code = EquipInventoryEquipmentResult(
                        request.PlayerEntityId,
                        request.InstanceId,
                        request.ReplacementInstanceId);
                    break;
                case SimulationTransactionKind.EquipmentUnequip:
                    code = UnequipEquipmentResult(
                        request.PlayerEntityId,
                        request.InstanceId);
                    break;
                case SimulationTransactionKind.EquipmentDiscard:
                    code = DiscardWithLootResult(
                        request,
                        out lootEntityId);
                    break;
                case SimulationTransactionKind.AirdropOpen:
                    code = StartAirdropOpenResult(
                        request.PlayerEntityId,
                        request.AirdropId);
                    break;
                default:
                    throw new ArgumentOutOfRangeException(
                        nameof(request),
                        request.Kind,
                        "Unknown simulation transaction kind.");
            }

            return new SimulationTransactionResult
            {
                Kind = request.Kind,
                Accepted = code == "accepted",
                Code = code,
                LootEntityId = lootEntityId,
                Snapshot = GetSnapshot()
            };
        }

        private string DiscardWithLootResult(
            SimulationTransactionRequest request,
            out int? lootEntityId)
        {
            lootEntityId = null;
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "player-not-alive";
            }

            var code =
                EquipmentInventorySystem.DiscardEquipmentResult(
                    state,
                    pendingEvents,
                    request.PlayerEntityId,
                    request.InstanceId,
                    out lootEntityId);
            return CompleteTransaction(code);
        }
    }
}
