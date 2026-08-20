using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/airdrop.ts for the classic
    /// arena, including explicit open transactions and interruptible
    /// three-second channels.
    /// </summary>
    internal static partial class AirdropSystem
    {
        private const int WarningTicks =
            15 * SimulationConstants.TicksPerSecond;
        private const int LifetimeTicks =
            120 * SimulationConstants.TicksPerSecond;
        private const int LandingReservationRadiusMm = 3_000;

        private static readonly int[] ScheduleTicks =
        {
            6 * 60 * SimulationConstants.TicksPerSecond,
            12 * 60 * SimulationConstants.TicksPerSecond,
            18 * 60 * SimulationConstants.TicksPerSecond
        };

        private static readonly Int2Mm[] LegacyAirdropPoints =
        {
            new Int2Mm(0, 60_000),
            new Int2Mm(42_426, 42_426),
            new Int2Mm(60_000, 0),
            new Int2Mm(42_426, -42_426),
            new Int2Mm(0, -60_000),
            new Int2Mm(-42_426, -42_426),
            new Int2Mm(-60_000, 0),
            new Int2Mm(-42_426, 42_426),
            new Int2Mm(0, 0)
        };

        public static void Initialize(SimulationState state)
        {
            if (state.Airdrops.Count > 0)
            {
                return;
            }

            for (var index = 0; index < ScheduleTicks.Length; index += 1)
            {
                var sequence = index + 1;
                var id = $"airdrop-{sequence}";
                state.Airdrops.Add(
                    id,
                    new AirdropState
                    {
                        Id = id,
                        Sequence = sequence,
                        ScheduledElapsedTick = ScheduleTicks[index],
                        Phase = "pending"
                    });
            }
        }

        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            Initialize(state);
            if (state.Match.Status != MatchStatus.Running)
            {
                return;
            }

            var elapsedTick = MatchElapsedTick(state);
            foreach (var airdrop in state.Airdrops.Values)
            {
                if (airdrop.Phase == "pending" &&
                    elapsedTick >=
                    airdrop.ScheduledElapsedTick - WarningTicks)
                {
                    Announce(state, events, airdrop);
                }

                if (airdrop.Phase == "warning" &&
                    elapsedTick >= airdrop.ScheduledElapsedTick)
                {
                    Land(state, events, airdrop);
                }

                if (airdrop.Phase == "available" &&
                    airdrop.ExpiresAtTick.HasValue &&
                    airdrop.ExpiresAtTick.Value <= state.Tick)
                {
                    Expire(state, events, airdrop);
                }
            }

            AdvanceChannels(state, events);
        }

        private static int MatchElapsedTick(SimulationState state)
        {
            if (!state.Match.StartedAtTick.HasValue)
            {
                return 0;
            }

            var elapsed = state.Tick - state.Match.StartedAtTick.Value;
            return elapsed > 0 ? elapsed : 0;
        }

        private static void Announce(
            SimulationState state,
            List<SimEvent> events,
            AirdropState airdrop)
        {
            var position = SelectLandingPoint(state);
            if (!position.HasValue)
            {
                return;
            }

            airdrop.Phase = "warning";
            airdrop.Position = position.Value;
            airdrop.AnnouncedAtTick = state.Tick;
            events.Add(
                new SimEvent
                {
                    Type = "airdrop-warning",
                    Tick = state.Tick,
                    AirdropId = airdrop.Id,
                    Position = position.Value
                });
        }

        private static void Land(
            SimulationState state,
            List<SimEvent> events,
            AirdropState airdrop)
        {
            if (!airdrop.Position.HasValue ||
                !IsLegalLandingPoint(state, airdrop.Position.Value))
            {
                var replacement = SelectLandingPoint(state);
                if (!replacement.HasValue)
                {
                    return;
                }

                airdrop.Position = replacement.Value;
            }

            airdrop.Phase = "available";
            airdrop.LandedAtTick = state.Tick;
            airdrop.ExpiresAtTick = state.Tick + LifetimeTicks;
            events.Add(
                new SimEvent
                {
                    Type = "airdrop-landed",
                    Tick = state.Tick,
                    AirdropId = airdrop.Id,
                    Position = airdrop.Position.Value
                });
        }

        private static void Expire(
            SimulationState state,
            List<SimEvent> events,
            AirdropState airdrop)
        {
            if (airdrop.Phase != "available")
            {
                return;
            }

            airdrop.Phase = "expired";
            var channels = new List<AirdropChannelState>(
                state.AirdropChannels.Values);
            for (var index = 0; index < channels.Count; index += 1)
            {
                if (channels[index].AirdropId == airdrop.Id)
                {
                    CancelChannel(
                        state,
                        events,
                        channels[index],
                        "expired");
                }
            }
            events.Add(
                new SimEvent
                {
                    Type = "airdrop-expired",
                    Tick = state.Tick,
                    AirdropId = airdrop.Id
                });
        }

    }
}
