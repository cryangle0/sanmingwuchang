namespace Jwgb.Sim.Deterministic
{
    public sealed partial class GameSimulation
    {
        /// <summary>Returns the transaction code string.</summary>
        public string PickupEquipmentLootResult(
            int playerEntityId,
            int lootEntityId,
            string destination,
            int? replacementInstanceId)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "match-finished";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            return CompleteTransaction(
                EquipmentLootPickupSystem.PickupResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    lootEntityId,
                    destination,
                    replacementInstanceId));
        }

        public string ReplaceActiveLootResult(
            int playerEntityId,
            int lootEntityId,
            bool confirm)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "match-finished";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            return CompleteTransaction(
                ActiveReplacementSystem.ReplaceResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    lootEntityId,
                    confirm));
        }

        public string StartHeroSwapResult(
            int playerEntityId,
            string shopId,
            int expectedVersion,
            string targetHeroId)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "match-finished";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            ShopSystem.Sync(state, pendingEvents);
            return CompleteTransaction(
                ShopSystem.StartHeroSwapResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    shopId,
                    expectedVersion,
                    targetHeroId));
        }

        public string GamblePassiveResult(
            int playerEntityId,
            string shopId,
            int expectedVersion,
            string passiveId)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "player-not-alive";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            ShopSystem.Sync(state, pendingEvents);
            return CompleteTransaction(
                GamblingSystem.GamblePassiveResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    shopId,
                    expectedVersion,
                    passiveId));
        }

        public string GambleEquipmentResult(
            int playerEntityId,
            string shopId,
            int expectedVersion,
            int instanceId)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "player-not-alive";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            ShopSystem.Sync(state, pendingEvents);
            return CompleteTransaction(
                GamblingSystem.GambleEquipmentResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    shopId,
                    expectedVersion,
                    instanceId));
        }

        public string GambleActiveResult(
            int playerEntityId,
            string shopId,
            int expectedVersion)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "player-not-alive";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            ShopSystem.Sync(state, pendingEvents);
            return CompleteTransaction(
                GamblingSystem.GambleActiveResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    shopId,
                    expectedVersion));
        }

        public string GambleGoldResult(
            int playerEntityId,
            string shopId,
            int expectedVersion,
            int wagerGold,
            string mode)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return "player-not-alive";
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            ShopSystem.Sync(state, pendingEvents);
            return CompleteTransaction(
                GamblingSystem.GambleGoldResult(
                    state,
                    pendingEvents,
                    playerEntityId,
                    shopId,
                    expectedVersion,
                    wagerGold,
                    mode));
        }

        private string CompleteTransaction(string code)
        {
            if (code == "accepted")
            {
                hasUnsupportedReplayMutation = true;
            }

            return code;
        }
    }
}
