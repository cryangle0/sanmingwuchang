namespace Jwgb.Sim.Deterministic
{
    public sealed partial class GameSimulation
    {
        public string PurchaseShopListingResult(
            int playerEntityId,
            string shopId,
            string listingId,
            int expectedVersion,
            string destination = "inventory")
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "match-finished";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            ShopSystem.Sync(state, pendingEvents);
            return CompleteTransaction(
                ShopSystem.PurchaseListingResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    shopId,
                    listingId,
                    expectedVersion,
                    destination));
        }

        public string SellShopEquipmentResult(
            int playerEntityId,
            string shopId,
            int instanceId,
            int expectedVersion)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "match-finished";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            ShopSystem.Sync(state, pendingEvents);
            return CompleteTransaction(
                ShopSystem.SellEquipmentResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    shopId,
                    instanceId,
                    expectedVersion));
        }

        public string SpendGemResult(
            int playerEntityId,
            string passiveId)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "match-finished";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            return CompleteTransaction(
                PassiveTransactionSystem.SpendGemResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    passiveId));
        }

        public string ReplaceSkillBookResult(
            int playerEntityId,
            int lootEntityId,
            string replacePassiveId)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "match-finished";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            return CompleteTransaction(
                PassiveTransactionSystem.ReplaceSkillBookResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    lootEntityId,
                    replacePassiveId));
        }

        public string EquipInventoryEquipmentResult(
            int playerEntityId,
            int instanceId,
            int? replacementInstanceId = null)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "player-not-alive";
            }

            return CompleteTransaction(
                EquipmentInventorySystem.EquipInventoryEquipmentResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    instanceId,
                    replacementInstanceId));
        }

        public string UnequipEquipmentResult(
            int playerEntityId,
            int instanceId)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "player-not-alive";
            }

            return CompleteTransaction(
                EquipmentInventorySystem.UnequipEquipmentResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    instanceId));
        }

        public string DiscardEquipmentResult(
            int playerEntityId,
            int instanceId)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "player-not-alive";
            }

            var code = EquipmentInventorySystem.DiscardEquipmentResult(
                state,
                pendingEvents,
                playerEntityId,
                instanceId,
                out _);
            return CompleteTransaction(code);
        }

        public string StartAirdropOpenResult(
            int playerEntityId,
            string airdropId)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "match-finished";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            return CompleteTransaction(
                AirdropSystem.StartOpenResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    airdropId));
        }
    }
}
