using System;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client.Presentation
{
    internal sealed partial class MatchInteractionPanel
    {
        private void UpdateAirdrop()
        {
            var channel = FindChannel();
            var focused = channel != null
                ? FindAirdrop(channel.AirdropId)
                : FindFocusedAirdrop();
            if (focused == null || !focused.Position.HasValue)
            {
                focusedAirdropId = null;
                elements.AirdropBanner.style.display =
                    UnityEngine.UIElements.DisplayStyle.None;
                return;
            }

            focusedAirdropId = focused.Id;
            elements.AirdropBanner.style.display =
                UnityEngine.UIElements.DisplayStyle.Flex;
            var distance = (int)Math.Round(
                Math.Sqrt(
                    DistanceSquared(
                        player.Position,
                        focused.Position.Value)) /
                1_000);
            if (channel != null)
            {
                var total = Math.Max(
                    1,
                    channel.CompletesAtTick -
                    channel.StartedAtTick);
                var remaining = Math.Max(
                    0,
                    channel.CompletesAtTick - snapshot.Tick);
                var remainingSeconds =
                    (double)remaining /
                    Jwgb.Core.SimulationConstants.TicksPerSecond;
                elements.AirdropTitle.text = "OPENING AIRDROP";
                elements.AirdropMeta.text =
                    $"{remainingSeconds:0.0}s  " +
                    $"{distance}m";
                elements.AirdropProgress.style.width =
                    UnityEngine.UIElements.Length.Percent(
                        Math.Max(
                            0,
                            Math.Min(
                                100,
                                (total - remaining) * 100f / total)));
                elements.AirdropAction.text = "CHANNELING";
                elements.AirdropAction.SetEnabled(false);
                return;
            }

            if (focused.Phase == "warning")
            {
                var scheduled =
                    (snapshot.Match.StartedAtTick ?? 0) +
                    focused.ScheduledElapsedTick;
                var remaining = Math.Max(
                    0,
                    scheduled - snapshot.Tick);
                var remainingSeconds =
                    (double)remaining /
                    Jwgb.Core.SimulationConstants.TicksPerSecond;
                elements.AirdropTitle.text = "AIRDROP INBOUND";
                elements.AirdropMeta.text =
                    $"{Math.Ceiling(remainingSeconds)}s  " +
                    $"{distance}m";
                elements.AirdropProgress.style.width =
                    UnityEngine.UIElements.Length.Percent(0);
                elements.AirdropAction.text = "WAIT";
                elements.AirdropAction.SetEnabled(false);
                return;
            }

            var expires = Math.Max(
                0,
                (focused.ExpiresAtTick ?? snapshot.Tick) -
                snapshot.Tick);
            var expiresSeconds =
                (double)expires /
                Jwgb.Core.SimulationConstants.TicksPerSecond;
            var canOpen =
                focused.Phase == "available" &&
                DistanceSquared(
                    player.Position,
                    focused.Position.Value) <=
                    2_500L * 2_500L &&
                player.LifeState == LifeState.Alive &&
                player.PvpCombatTicks <= 0 &&
                player.WorldInteractionLockTicks <= 0;
            elements.AirdropTitle.text = "AIRDROP LANDED";
            elements.AirdropMeta.text =
                $"{Math.Ceiling(expiresSeconds)}s  " +
                $"{distance}m";
            elements.AirdropProgress.style.width =
                UnityEngine.UIElements.Length.Percent(100);
            elements.AirdropAction.text = "OPEN";
            elements.AirdropAction.SetEnabled(canOpen);
            elements.AirdropAction.tooltip = canOpen
                ? "Open airdrop"
                : distance > 2
                    ? "Move closer to the airdrop"
                    : player.PvpCombatTicks > 0
                        ? "PVP combat lock"
                        : "Player unavailable";
        }

        private void OpenFocusedAirdrop()
        {
            if (string.IsNullOrEmpty(focusedAirdropId))
            {
                return;
            }
            Submit(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.AirdropOpen,
                    AirdropId = focusedAirdropId
                });
        }

        private AirdropChannelSnapshot FindChannel()
        {
            for (var index = 0;
                index < snapshot.AirdropChannels.Length;
                index += 1)
            {
                if (snapshot.AirdropChannels[index].PlayerEntityId ==
                    player.EntityId)
                {
                    return snapshot.AirdropChannels[index];
                }
            }
            return null;
        }

        private AirdropSnapshot FindAirdrop(string id)
        {
            for (var index = 0;
                index < snapshot.Airdrops.Length;
                index += 1)
            {
                if (snapshot.Airdrops[index].Id == id)
                {
                    return snapshot.Airdrops[index];
                }
            }
            return null;
        }

        private AirdropSnapshot FindFocusedAirdrop()
        {
            AirdropSnapshot focused = null;
            long distance = long.MaxValue;
            for (var index = 0;
                index < snapshot.Airdrops.Length;
                index += 1)
            {
                var candidate = snapshot.Airdrops[index];
                if ((candidate.Phase != "warning" &&
                     candidate.Phase != "available") ||
                    !candidate.Position.HasValue)
                {
                    continue;
                }
                var candidateDistance = DistanceSquared(
                    player.Position,
                    candidate.Position.Value);
                if (focused == null ||
                    (candidate.Phase == "available" &&
                     focused.Phase != "available") ||
                    candidateDistance < distance)
                {
                    focused = candidate;
                    distance = candidateDistance;
                }
            }
            return focused;
        }
    }
}
