using System.Collections.Generic;
using Jwgb.Sim.Deterministic;
using Unity.Collections;
using Unity.Entities;

namespace Jwgb.Netcode
{
    public partial class MatchGhostSnapshotSystem
    {
        private readonly Dictionary<string, Entity> airdrops =
            new Dictionary<string, Entity>(
                System.StringComparer.Ordinal);
        private readonly Dictionary<int, Entity> airdropChannels =
            new Dictionary<int, Entity>();
        private readonly HashSet<string> activeAirdropIds =
            new HashSet<string>(System.StringComparer.Ordinal);
        private readonly List<string> removedAirdropIds =
            new List<string>();

        private void SyncAirdrops(
            WorldSnapshot snapshot,
            Entity airdropPrefab,
            Entity channelPrefab)
        {
            SyncAirdropStates(snapshot, airdropPrefab);
            SyncAirdropChannels(snapshot, channelPrefab);
        }

        private void SyncAirdropStates(
            WorldSnapshot snapshot,
            Entity prefab)
        {
            activeAirdropIds.Clear();
            for (var index = 0;
                index < snapshot.Airdrops.Length;
                index += 1)
            {
                var value = snapshot.Airdrops[index];
                activeAirdropIds.Add(value.Id);
                if (!airdrops.TryGetValue(
                        value.Id,
                        out var entity) ||
                    !EntityManager.Exists(entity))
                {
                    entity = EntityManager.Instantiate(prefab);
                    EntityManager.SetName(
                        entity,
                        $"JWGB Replicated Airdrop {value.Id}");
                    airdrops[value.Id] = entity;
                }

                EntityManager.SetComponentData(
                    entity,
                    new MatchAirdropGhostState
                    {
                        SnapshotTick = snapshot.Tick,
                        AirdropId = ToFixed64(value.Id),
                        Sequence = value.Sequence,
                        ScheduledElapsedTick =
                            value.ScheduledElapsedTick,
                        Phase = new FixedString32Bytes(
                            value.Phase ?? string.Empty),
                        HasPosition = value.Position.HasValue,
                        PositionX = value.Position?.X ?? 0,
                        PositionZ = value.Position?.Z ?? 0,
                        HasAnnouncedAtTick =
                            value.AnnouncedAtTick.HasValue,
                        AnnouncedAtTick =
                            value.AnnouncedAtTick ?? 0,
                        HasLandedAtTick =
                            value.LandedAtTick.HasValue,
                        LandedAtTick = value.LandedAtTick ?? 0,
                        HasExpiresAtTick =
                            value.ExpiresAtTick.HasValue,
                        ExpiresAtTick = value.ExpiresAtTick ?? 0,
                        HasOpenedAtTick =
                            value.OpenedAtTick.HasValue,
                        OpenedAtTick = value.OpenedAtTick ?? 0,
                        HasOpenedByEntityId =
                            value.OpenedByEntityId.HasValue,
                        OpenedByEntityId =
                            value.OpenedByEntityId ?? 0,
                        EquipmentId =
                            ToFixed64(value.EquipmentId),
                        HasLootEntityId =
                            value.LootEntityId.HasValue,
                        LootEntityId = value.LootEntityId ?? 0
                    });
            }

            removedAirdropIds.Clear();
            foreach (var pair in airdrops)
            {
                if (activeAirdropIds.Contains(pair.Key))
                {
                    continue;
                }
                if (EntityManager.Exists(pair.Value))
                {
                    EntityManager.DestroyEntity(pair.Value);
                }
                removedAirdropIds.Add(pair.Key);
            }
            for (var index = 0;
                index < removedAirdropIds.Count;
                index += 1)
            {
                airdrops.Remove(removedAirdropIds[index]);
            }
        }

        private void SyncAirdropChannels(
            WorldSnapshot snapshot,
            Entity prefab)
        {
            activeIds.Clear();
            for (var index = 0;
                index < snapshot.AirdropChannels.Length;
                index += 1)
            {
                var value = snapshot.AirdropChannels[index];
                activeIds.Add(value.PlayerEntityId);
                var entity = GetOrCreate(
                    airdropChannels,
                    value.PlayerEntityId,
                    prefab);
                EntityManager.SetComponentData(
                    entity,
                    new MatchAirdropChannelGhostState
                    {
                        SnapshotTick = snapshot.Tick,
                        Sequence = value.Sequence,
                        PlayerEntityId = value.PlayerEntityId,
                        AirdropId = ToFixed64(value.AirdropId),
                        StartedAtTick = value.StartedAtTick,
                        CompletesAtTick = value.CompletesAtTick,
                        OriginPositionX =
                            value.OriginPosition.X,
                        OriginPositionZ =
                            value.OriginPosition.Z
                    });
            }
            RemoveInactive(airdropChannels);
        }
    }
}
