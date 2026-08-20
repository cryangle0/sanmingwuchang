using Jwgb.Content;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client.Presentation
{
    internal static class MatchHudText
    {
        public static string StormPhase(WorldSnapshot snapshot)
        {
            var stormZone = snapshot.StormZone;
            if (stormZone == null)
            {
                return string.Empty;
            }
            if (stormZone.ApocalypseStarted)
            {
                return "APOCALYPSE";
            }
            if (stormZone.ApocalypseWarning)
            {
                return "APOCALYPSE WARNING";
            }
            if (snapshot.Tick < stormZone.WarningTick)
            {
                var seconds =
                    (stormZone.WarningTick - snapshot.Tick) /
                    Jwgb.Core.SimulationConstants.TicksPerSecond;
                return $"STORM IN {seconds}s";
            }
            return $"STORM {stormZone.RadiusMm / 1_000}m";
        }

        public static string HeroName(string heroId)
        {
            if (string.IsNullOrWhiteSpace(heroId))
            {
                return "UNKNOWN HERO";
            }
            try
            {
                return HeroCatalog.Get(heroId).Name.ToUpperInvariant();
            }
            catch
            {
                return heroId.ToUpperInvariant();
            }
        }

        public static string LifeState(
            Jwgb.Sim.Deterministic.LifeState state)
        {
            return state switch
            {
                Jwgb.Sim.Deterministic.LifeState.SoulFlight =>
                    "SOUL FLIGHT",
                Jwgb.Sim.Deterministic.LifeState.ReviveProtection =>
                    "PROTECTED",
                Jwgb.Sim.Deterministic.LifeState.Eliminated =>
                    "ELIMINATED",
                _ => "ALIVE"
            };
        }

        public static string EventText(
            WorldSnapshot snapshot,
            SimEvent simEvent)
        {
            return simEvent.Type switch
            {
                "critical-hit" =>
                    $"{PlayerName(snapshot, simEvent.SourceEntityId)} CRITICAL",
                "active-cast" =>
                    $"{PlayerName(snapshot, simEvent.EntityId)} CAST " +
                    ActiveName(simEvent),
                "true-death" =>
                    $"{PlayerName(snapshot, simEvent.EntityId)} LOST A LIFE",
                "eliminated" =>
                    $"{PlayerName(snapshot, simEvent.EntityId)} ELIMINATED",
                "lethal-protection" =>
                    $"{PlayerName(snapshot, simEvent.EntityId)} SURVIVED",
                "projectile-blocked" => "PROJECTILE BLOCKED",
                _ => null
            };
        }

        private static string PlayerName(
            WorldSnapshot snapshot,
            int? entityId)
        {
            if (!entityId.HasValue)
            {
                return "STORM";
            }
            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                if (snapshot.Players[index].EntityId == entityId.Value)
                {
                    return snapshot.Players[index]
                        .PlayerId
                        .ToUpperInvariant();
                }
            }
            return $"PLAYER {entityId.Value}";
        }

        private static string ActiveName(SimEvent simEvent)
        {
            if (!string.IsNullOrWhiteSpace(simEvent.ActiveName))
            {
                return simEvent.ActiveName;
            }
            if (string.IsNullOrWhiteSpace(
                    simEvent.ActiveAbilityId))
            {
                return "ABILITY";
            }
            try
            {
                return ActiveCatalog.Get(
                    simEvent.ActiveAbilityId).Name;
            }
            catch
            {
                return simEvent.ActiveAbilityId;
            }
        }
    }
}
