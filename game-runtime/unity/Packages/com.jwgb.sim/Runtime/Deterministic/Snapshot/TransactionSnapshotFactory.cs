using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class SnapshotFactory
    {
        private static PendingActiveReplacementSnapshot[]
            CreatePendingActiveReplacements(SimulationState state)
        {
            var values =
                new PendingActiveReplacementSnapshot[
                    state.PendingActiveReplacements.Count];
            var index = 0;
            foreach (var pending in
                state.PendingActiveReplacements.Values)
            {
                values[index] = new PendingActiveReplacementSnapshot
                {
                    PlayerEntityId = pending.PlayerEntityId,
                    LootEntityId = pending.LootEntityId,
                    ActiveId = pending.ActiveId,
                    RequestedAtTick = pending.RequestedAtTick
                };
                index += 1;
            }

            return values;
        }

        private static PendingEquipmentPickupSnapshot[]
            CreatePendingEquipmentPickups(SimulationState state)
        {
            var values =
                new PendingEquipmentPickupSnapshot[
                    state.PendingEquipmentPickups.Count];
            var index = 0;
            foreach (var pending in
                state.PendingEquipmentPickups.Values)
            {
                values[index] = new PendingEquipmentPickupSnapshot
                {
                    PlayerEntityId = pending.PlayerEntityId,
                    LootEntityId = pending.LootEntityId,
                    EquipmentId = pending.EquipmentId,
                    EquipmentInstanceId =
                        pending.EquipmentInstanceId,
                    RequestedAtTick = pending.RequestedAtTick
                };
                index += 1;
            }

            return values;
        }

        private static AirdropSnapshot[] CreateAirdrops(
            SimulationState state)
        {
            var ordered = new List<AirdropState>(
                state.Airdrops.Values);
            ordered.Sort(
                (left, right) =>
                    left.Sequence.CompareTo(right.Sequence));
            var values = new AirdropSnapshot[ordered.Count];
            for (var index = 0; index < ordered.Count; index += 1)
            {
                var airdrop = ordered[index];
                values[index] = new AirdropSnapshot
                {
                    Id = airdrop.Id,
                    Sequence = airdrop.Sequence,
                    ScheduledElapsedTick =
                        airdrop.ScheduledElapsedTick,
                    Phase = airdrop.Phase,
                    Position = airdrop.Position,
                    AnnouncedAtTick = airdrop.AnnouncedAtTick,
                    LandedAtTick = airdrop.LandedAtTick,
                    ExpiresAtTick = airdrop.ExpiresAtTick,
                    OpenedAtTick = airdrop.OpenedAtTick,
                    OpenedByEntityId =
                        airdrop.OpenedByEntityId,
                    EquipmentId = airdrop.EquipmentId,
                    LootEntityId = airdrop.LootEntityId
                };
            }

            return values;
        }

        private static AirdropChannelSnapshot[] CreateAirdropChannels(
            SimulationState state)
        {
            var ordered = new List<AirdropChannelState>(
                state.AirdropChannels.Values);
            ordered.Sort(
                (left, right) =>
                {
                    var result = left.Sequence.CompareTo(
                        right.Sequence);
                    return result != 0
                        ? result
                        : left.PlayerEntityId.CompareTo(
                            right.PlayerEntityId);
                });
            var values = new AirdropChannelSnapshot[ordered.Count];
            for (var index = 0; index < ordered.Count; index += 1)
            {
                var channel = ordered[index];
                values[index] = new AirdropChannelSnapshot
                {
                    Sequence = channel.Sequence,
                    PlayerEntityId = channel.PlayerEntityId,
                    AirdropId = channel.AirdropId,
                    StartedAtTick = channel.StartedAtTick,
                    CompletesAtTick = channel.CompletesAtTick,
                    OriginPosition = channel.OriginPosition
                };
            }

            return values;
        }
    }
}
