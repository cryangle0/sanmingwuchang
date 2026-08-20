using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class AirdropSystem
    {
        private const int ChannelTicks =
            3 * SimulationConstants.TicksPerSecond;
        private const int InteractionRadiusMm = 2_500;
        private const int InterruptMoveMm = 250;
        private const int RewardGold = 1_200;

        private static readonly string[] EquipmentPool =
        {
            GameplayIds.NineTurnPill,
            GameplayIds.PrimordialPearl,
            GameplayIds.TribulationBell,
            GameplayIds.CloudRide,
            GameplayIds.TreasureBasin,
            GameplayIds.DemonSubduingMace,
            GameplayIds.KeenEars,
            GameplayIds.ThunderChisel,
            GameplayIds.SoulDevouringRing
        };

        public static string StartOpenResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string airdropId)
        {
            var player = StateQueries.GetRequiredPlayer(
                state,
                playerEntityId);
            if (!state.Airdrops.TryGetValue(
                    airdropId,
                    out var airdrop))
            {
                return "airdrop-not-found";
            }

            if (state.AirdropChannels.ContainsKey(playerEntityId))
            {
                return "channel-active";
            }

            if (airdrop.Phase == "expired" ||
                airdrop.Phase == "opened")
            {
                return "airdrop-expired";
            }

            if (airdrop.Phase != "available" ||
                !airdrop.Position.HasValue)
            {
                return "airdrop-not-available";
            }

            if (!LootSystem.CanUseWorldResources(player))
            {
                return "player-not-alive";
            }

            if (player.PvpCombatTicks > 0)
            {
                return "pvp-combat-lock";
            }

            if (IntegerMath.DistanceSquared(
                    player.Position,
                    airdrop.Position.Value) >
                (long)InteractionRadiusMm * InteractionRadiusMm)
            {
                return "airdrop-too-far";
            }

            if (!LineOfSightSystem.HasDirectLineOfSight(
                    state,
                    player.Position,
                    airdrop.Position.Value,
                    GameplayRules.PlayerCapsuleRadiusMm))
            {
                return "airdrop-line-of-sight";
            }

            var channel = new AirdropChannelState
            {
                Sequence = state.NextAirdropChannelSequence,
                PlayerEntityId = playerEntityId,
                AirdropId = airdrop.Id,
                StartedAtTick = state.Tick,
                CompletesAtTick = state.Tick + ChannelTicks,
                OriginPosition = player.Position
            };
            state.NextAirdropChannelSequence += 1;
            state.AirdropChannels.Add(playerEntityId, channel);
            player.WorldInteractionLockTicks = System.Math.Max(
                player.WorldInteractionLockTicks,
                ChannelTicks);
            events.Add(
                new SimEvent
                {
                    Type = "airdrop-channel",
                    Tick = state.Tick,
                    EntityId = playerEntityId,
                    AirdropId = airdrop.Id,
                    Outcome = "started"
                });
            return "accepted";
        }

        public static void Interrupt(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string reason)
        {
            if (state.AirdropChannels.TryGetValue(
                    playerEntityId,
                    out var channel))
            {
                CancelChannel(state, events, channel, reason);
            }
        }

        private static void AdvanceChannels(
            SimulationState state,
            List<SimEvent> events)
        {
            var channels = new List<AirdropChannelState>(
                state.AirdropChannels.Values);
            channels.Sort(CompareChannels);
            for (var index = 0; index < channels.Count; index += 1)
            {
                var channel = channels[index];
                if (!state.AirdropChannels.TryGetValue(
                        channel.PlayerEntityId,
                        out var current) ||
                    !ReferenceEquals(current, channel))
                {
                    continue;
                }

                if (!state.Players.TryGetValue(
                        channel.PlayerEntityId,
                        out var player) ||
                    !state.Airdrops.TryGetValue(
                        channel.AirdropId,
                        out var airdrop) ||
                    airdrop.Phase != "available")
                {
                    CancelChannel(state, events, channel, "expired");
                    continue;
                }

                var reason = ChannelCancelReason(
                    state,
                    channel,
                    airdrop,
                    player);
                if (reason != null)
                {
                    CancelChannel(state, events, channel, reason);
                    continue;
                }

                if (channel.CompletesAtTick <= state.Tick)
                {
                    CompleteChannel(
                        state,
                        events,
                        channel,
                        airdrop,
                        player);
                }
            }
        }

        private static int CompareChannels(
            AirdropChannelState left,
            AirdropChannelState right)
        {
            var result = left.CompletesAtTick.CompareTo(
                right.CompletesAtTick);
            return result != 0
                ? result
                : left.Sequence.CompareTo(right.Sequence);
        }

        private static string ChannelCancelReason(
            SimulationState state,
            AirdropChannelState channel,
            AirdropState airdrop,
            PlayerState player)
        {
            if (airdrop.ExpiresAtTick.HasValue &&
                airdrop.ExpiresAtTick.Value <= state.Tick)
            {
                return "expired";
            }

            if (player.LifeState != LifeState.Alive)
            {
                return "true-death";
            }

            if (player.HardControlTicks > 0)
            {
                return "hard-control";
            }

            return IntegerMath.DistanceSquared(
                    player.Position,
                    channel.OriginPosition) >
                (long)InterruptMoveMm * InterruptMoveMm
                    ? "moved"
                    : null;
        }

        private static void CancelChannel(
            SimulationState state,
            List<SimEvent> events,
            AirdropChannelState channel,
            string reason)
        {
            if (!state.AirdropChannels.TryGetValue(
                    channel.PlayerEntityId,
                    out var current) ||
                !ReferenceEquals(current, channel))
            {
                return;
            }

            state.AirdropChannels.Remove(channel.PlayerEntityId);
            if (state.Players.TryGetValue(
                    channel.PlayerEntityId,
                    out var player))
            {
                player.WorldInteractionLockTicks = 0;
            }

            events.Add(
                new SimEvent
                {
                    Type = "airdrop-channel",
                    Tick = state.Tick,
                    EntityId = channel.PlayerEntityId,
                    AirdropId = channel.AirdropId,
                    Outcome = "cancelled",
                    Reason = reason
                });
        }
    }
}
