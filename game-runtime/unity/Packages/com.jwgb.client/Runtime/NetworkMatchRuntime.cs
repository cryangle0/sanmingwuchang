using System;
using System.Collections.Generic;
using Jwgb.Core;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using Unity.Entities;
using UnityEngine;

namespace Jwgb.Client
{
    [DisallowMultipleComponent]
    public sealed partial class NetworkMatchRuntime : MonoBehaviour
    {
        private readonly List<PlayerSnapshot> playerSnapshots =
            new List<PlayerSnapshot>();
        private readonly List<ProjectileSnapshot> projectileSnapshots =
            new List<ProjectileSnapshot>();
        private readonly List<WindWallSnapshot> windWallSnapshots =
            new List<WindWallSnapshot>();
        private readonly List<MonsterSnapshot> monsterSnapshots =
            new List<MonsterSnapshot>();
        private readonly List<LootSnapshot> lootSnapshots =
            new List<LootSnapshot>();
        private readonly List<ShopSnapshot> shopSnapshots =
            new List<ShopSnapshot>();
        private readonly List<AirdropSnapshot> airdropSnapshots =
            new List<AirdropSnapshot>();
        private readonly List<AirdropChannelSnapshot>
            airdropChannelSnapshots =
                new List<AirdropChannelSnapshot>();
        private readonly List<PendingActiveReplacementSnapshot>
            pendingActiveReplacementSnapshots =
                new List<PendingActiveReplacementSnapshot>();
        private readonly List<PendingEquipmentPickupSnapshot>
            pendingEquipmentPickupSnapshots =
                new List<PendingEquipmentPickupSnapshot>();
        private readonly List<PredictedNetworkInput> pendingInputs =
            new List<PredictedNetworkInput>();
        private readonly List<SimEvent> receivedEvents =
            new List<SimEvent>();
        private readonly Dictionary<int, int> playerSnapshotTicks =
            new Dictionary<int, int>();
        private readonly NetworkLocalPrediction localPrediction =
            new NetworkLocalPrediction();
        private World clientWorld;
        private EntityQuery worldQuery;
        private EntityQuery playerQuery;
        private EntityQuery projectileQuery;
        private EntityQuery windWallQuery;
        private EntityQuery monsterQuery;
        private EntityQuery lootQuery;
        private EntityQuery shopQuery;
        private EntityQuery airdropQuery;
        private EntityQuery airdropChannelQuery;
        private bool queriesCreated;
        private int lastMatchSequence;
        private int lastSnapshotTick;
        private int lastLocalPredictionSnapshotTick;
        private ulong lastSnapshotFingerprint;

        public event Action<WorldSnapshot> SnapshotChanged;

        public event Action MatchRestarted;

        public event Action<SimEvent[]> EventsReceived;

        public int LocalEntityId =>
            MatchNetworkRuntimeState.ClientEntityId;

        public WorldSnapshot Snapshot { get; private set; }

        public bool TryGetPredictedLocalTransform(
            out Int2Mm position,
            out Int2Mm facing)
        {
            position = localPrediction.Position;
            facing = localPrediction.Facing;
            return localPrediction.IsInitialized;
        }

        public int GetPlayerSnapshotTick(
            int entityId,
            int fallbackTick)
        {
            return playerSnapshotTicks.TryGetValue(
                entityId,
                out var snapshotTick)
                    ? snapshotTick
                    : fallbackTick;
        }

        public void ResetSession()
        {
            playerSnapshots.Clear();
            projectileSnapshots.Clear();
            windWallSnapshots.Clear();
            monsterSnapshots.Clear();
            lootSnapshots.Clear();
            shopSnapshots.Clear();
            airdropSnapshots.Clear();
            airdropChannelSnapshots.Clear();
            pendingActiveReplacementSnapshots.Clear();
            pendingEquipmentPickupSnapshots.Clear();
            pendingInputs.Clear();
            receivedEvents.Clear();
            playerSnapshotTicks.Clear();
            localPrediction.Reset();
            lastMatchSequence = 0;
            lastSnapshotTick = 0;
            lastLocalPredictionSnapshotTick = 0;
            lastSnapshotFingerprint = 0;
            Snapshot = null;
        }

        private void Update()
        {
            ReadSnapshot();
            DrainNetworkEvents();
        }
    }
}
