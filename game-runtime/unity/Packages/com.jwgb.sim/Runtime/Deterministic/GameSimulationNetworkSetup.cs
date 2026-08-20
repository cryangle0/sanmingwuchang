using System;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    public sealed partial class GameSimulation
    {
        public void AssignNetworkHero(
            int entityId,
            string heroId)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                throw new InvalidOperationException(
                    "Cannot assign a hero after the match finishes.");
            }
            HeroCatalog.Get(heroId);
            var player = StateQueries.GetRequiredPlayer(
                state,
                entityId);
            if (player.HeroId == heroId)
            {
                return;
            }

            HeroAssignmentSystem.Apply(
                state,
                pendingEvents,
                player,
                heroId,
                preserveHealthRatio: false);
            pendingEvents.Add(
                new SimEvent
                {
                    Type = "network-hero-assigned",
                    Tick = state.Tick,
                    EntityId = entityId,
                    PlayerId = player.PlayerId,
                    HeroId = heroId
                });
            hasUnsupportedReplayMutation = true;
            RecordReplayCheckpoint();
        }
    }
}
