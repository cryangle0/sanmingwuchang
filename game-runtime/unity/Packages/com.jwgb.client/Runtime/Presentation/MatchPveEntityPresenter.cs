using System.Collections.Generic;
using Jwgb.Client;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Renders PVE and world-state entities for the local match:
    /// monsters, loot drops, shop pads, and the storm-zone ring with
    /// the apocalypse ambient tint. Pooled view per entity family,
    /// reading WorldSnapshot only.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class MatchPveEntityPresenter : MonoBehaviour
    {
        private static readonly Color ApocalypseAmbient =
            new Color(0.32f, 0.1f, 0.08f);

        [SerializeField]
        private LocalMatchRuntime runtime;

        private ClientBootstrap clientBootstrap;

        private NetworkMatchRuntime networkRuntime;

        [SerializeField]
        private Mesh capsuleMesh;

        [SerializeField]
        private Mesh cubeMesh;

        [SerializeField]
        private Mesh sphereMesh;

        [SerializeField]
        private Mesh cylinderMesh;

        [SerializeField]
        private ModelVisualCatalog modelVisualCatalog;

        [SerializeField]
        private Material monsterMaterial;

        [SerializeField]
        private Material lootMaterial;

        [SerializeField]
        private Material shopMaterial;

        [SerializeField]
        private Material stormMaterial;

        private readonly Dictionary<int, MonsterView> monsters =
            new Dictionary<int, MonsterView>();
        private readonly Dictionary<int, LootView> lootDrops =
            new Dictionary<int, LootView>();
        private readonly Dictionary<string, ShopPadView> shops =
            new Dictionary<string, ShopPadView>();
        private StormZoneView stormZone;
        private Color defaultAmbient;
        private bool apocalypseTintApplied;

        public int MonsterViewCount => monsters.Count;

        public int LootViewCount => lootDrops.Count;

        public int ShopViewCount => shops.Count;

        internal MonsterView GetMonsterViewForTesting(int entityId)
        {
            return monsters.TryGetValue(entityId, out var view)
                ? view
                : null;
        }

        private void Start()
        {
            defaultAmbient = RenderSettings.ambientLight;
            clientBootstrap =
                FindFirstObjectByType<ClientBootstrap>();
            networkRuntime =
                FindFirstObjectByType<NetworkMatchRuntime>();
            if (runtime == null)
            {
                runtime = FindFirstObjectByType<LocalMatchRuntime>();
            }
            if (clientBootstrap != null)
            {
                clientBootstrap.SessionStateChanged +=
                    OnClientSessionStateChanged;
            }
            if (networkRuntime != null)
            {
                networkRuntime.SnapshotChanged +=
                    OnNetworkSnapshotChanged;
                networkRuntime.EventsReceived +=
                    OnNetworkEventsReceived;
            }
            if (runtime != null)
            {
                runtime.FrameAdvanced += OnFrameAdvanced;
                runtime.SessionStarted += OnSessionStarted;
                runtime.SessionStopped += OnSessionStopped;
                if (runtime.HasSession && !IsNetworkMode)
                {
                    Apply(runtime.Snapshot);
                }
            }
            if (runtime == null && networkRuntime == null)
            {
                enabled = false;
            }
        }

        private void Update()
        {
            foreach (var view in monsters.Values)
            {
                view.Update(Time.deltaTime);
            }
            foreach (var view in lootDrops.Values)
            {
                view.Update(Time.deltaTime);
            }
        }

        private void OnDestroy()
        {
            if (runtime != null)
            {
                runtime.FrameAdvanced -= OnFrameAdvanced;
                runtime.SessionStarted -= OnSessionStarted;
                runtime.SessionStopped -= OnSessionStopped;
            }
            if (networkRuntime != null)
            {
                networkRuntime.SnapshotChanged -=
                    OnNetworkSnapshotChanged;
                networkRuntime.EventsReceived -=
                    OnNetworkEventsReceived;
            }
            if (clientBootstrap != null)
            {
                clientBootstrap.SessionStateChanged -=
                    OnClientSessionStateChanged;
            }
            ResetViews();
        }

        private bool IsNetworkMode =>
            clientBootstrap != null &&
            clientBootstrap.IsNetworkActive;

        private void OnFrameAdvanced(LocalMatchFrame frame)
        {
            if (!IsNetworkMode)
            {
                Apply(frame.Snapshot);
                ApplyEvents(frame.Events);
            }
        }

        private void OnNetworkSnapshotChanged(WorldSnapshot snapshot)
        {
            if (IsNetworkMode)
            {
                Apply(snapshot);
            }
        }

        private void OnNetworkEventsReceived(SimEvent[] events)
        {
            if (IsNetworkMode)
            {
                ApplyEvents(events);
            }
        }

        private void OnClientSessionStateChanged(
            ClientSessionState state,
            string _)
        {
            ResetViews();
            if (state == ClientSessionState.Local &&
                runtime != null &&
                runtime.HasSession)
            {
                Apply(runtime.Snapshot);
            }
        }

        private void OnSessionStarted()
        {
            if (IsNetworkMode)
            {
                return;
            }
            ResetViews();
            Apply(runtime.Snapshot);
        }

        private void OnSessionStopped()
        {
            if (!IsNetworkMode)
            {
                ResetViews();
            }
        }

        /// <summary>
        /// Applies one snapshot to the pooled views. Public so tests
        /// can drive the presenter without the runtime event loop.
        /// </summary>
        public void Apply(WorldSnapshot snapshot)
        {
            if (snapshot == null)
            {
                return;
            }
            ApplyMonsters(snapshot.Monsters, snapshot.RootSeed);
            ApplyLoot(snapshot.LootDrops);
            ApplyShops(snapshot.Shops, snapshot.Tick);
            ApplyStormZone(snapshot.StormZone);
        }

        private void ApplyMonsters(
            MonsterSnapshot[] snapshots,
            uint rootSeed)
        {
            var active = new HashSet<int>();
            for (var index = 0; index < snapshots.Length; index += 1)
            {
                var snapshot = snapshots[index];
                active.Add(snapshot.EntityId);
                var modelDefinition = ResolveMonsterModel(
                    snapshot.Kind,
                    snapshot.EntityId,
                    snapshot.Element,
                    rootSeed);
                var visualIdentity = modelDefinition.IsValid
                    ? modelDefinition.ModelId
                    : $"fallback:{snapshot.Kind}";
                if (monsters.TryGetValue(
                        snapshot.EntityId,
                        out var view) &&
                    !string.Equals(
                        view.VisualIdentity,
                        visualIdentity,
                        System.StringComparison.Ordinal))
                {
                    view.Dispose();
                    monsters.Remove(snapshot.EntityId);
                    view = null;
                }
                if (view == null)
                {
                    view = new MonsterView(
                        snapshot.EntityId,
                        snapshot.Kind,
                        capsuleMesh,
                        cubeMesh,
                        cubeMesh,
                        monsterMaterial,
                        modelDefinition);
                    monsters.Add(snapshot.EntityId, view);
                }
                view.SetSnapshot(snapshot);
            }
            RemoveInactive(monsters, active);
        }

        private ModelVisualDefinition ResolveMonsterModel(
            string kind,
            int entityId,
            string element,
            uint rootSeed)
        {
            return modelVisualCatalog != null &&
                modelVisualCatalog.TryResolveMonster(
                    kind,
                    entityId,
                    element,
                    rootSeed,
                    out var definition)
                ? definition
                : default;
        }

        private void ApplyEvents(SimEvent[] events)
        {
            if (events == null)
            {
                return;
            }

            for (var index = 0; index < events.Length; index += 1)
            {
                var simEvent = events[index];
                if (simEvent == null ||
                    simEvent.Type != "core-boss-cast" ||
                    simEvent.Reason != "warning" ||
                    !simEvent.SourceEntityId.HasValue ||
                    !monsters.TryGetValue(
                        simEvent.SourceEntityId.Value,
                        out var view))
                {
                    continue;
                }
                view.TriggerSpell();
            }
        }

        private void ApplyLoot(LootSnapshot[] snapshots)
        {
            var active = new HashSet<int>();
            for (var index = 0; index < snapshots.Length; index += 1)
            {
                var snapshot = snapshots[index];
                active.Add(snapshot.EntityId);
                if (!lootDrops.TryGetValue(
                    snapshot.EntityId,
                    out var view))
                {
                    view = new LootView(
                        snapshot.EntityId,
                        sphereMesh,
                        lootMaterial);
                    lootDrops.Add(snapshot.EntityId, view);
                }
                view.SetSnapshot(snapshot);
            }
            RemoveInactive(lootDrops, active);
        }

        private void ApplyShops(ShopSnapshot[] snapshots, int tick)
        {
            var active = new HashSet<string>();
            for (var index = 0; index < snapshots.Length; index += 1)
            {
                var snapshot = snapshots[index];
                active.Add(snapshot.ShopId);
                if (!shops.TryGetValue(snapshot.ShopId, out var view))
                {
                    view = new ShopPadView(
                        snapshot.ShopId,
                        cylinderMesh,
                        shopMaterial);
                    shops.Add(snapshot.ShopId, view);
                }
                view.SetSnapshot(snapshot, tick);
            }
            var removed = new List<string>();
            foreach (var pair in shops)
            {
                if (!active.Contains(pair.Key))
                {
                    pair.Value.Dispose();
                    removed.Add(pair.Key);
                }
            }
            for (var index = 0; index < removed.Count; index += 1)
            {
                shops.Remove(removed[index]);
            }
        }

        private void ApplyStormZone(StormZoneSnapshot snapshot)
        {
            if (snapshot == null)
            {
                return;
            }
            if (stormZone == null)
            {
                stormZone = new StormZoneView(stormMaterial);
            }
            stormZone.SetSnapshot(snapshot);
            if (snapshot.ApocalypseStarted && !apocalypseTintApplied)
            {
                RenderSettings.ambientLight = ApocalypseAmbient;
                apocalypseTintApplied = true;
            }
            else if (!snapshot.ApocalypseStarted &&
                apocalypseTintApplied)
            {
                RenderSettings.ambientLight = defaultAmbient;
                apocalypseTintApplied = false;
            }
        }

        private static void RemoveInactive<TView>(
            Dictionary<int, TView> views,
            HashSet<int> active)
            where TView : class
        {
            var removed = new List<int>();
            foreach (var pair in views)
            {
                if (!active.Contains(pair.Key))
                {
                    DisposeView(pair.Value);
                    removed.Add(pair.Key);
                }
            }
            for (var index = 0; index < removed.Count; index += 1)
            {
                views.Remove(removed[index]);
            }
        }

        private static void DisposeView(object view)
        {
            switch (view)
            {
                case MonsterView monster:
                    monster.Dispose();
                    break;
                case LootView loot:
                    loot.Dispose();
                    break;
            }
        }

        private void ResetViews()
        {
            foreach (var view in monsters.Values)
            {
                view.Dispose();
            }
            monsters.Clear();
            foreach (var view in lootDrops.Values)
            {
                view.Dispose();
            }
            lootDrops.Clear();
            foreach (var view in shops.Values)
            {
                view.Dispose();
            }
            shops.Clear();
            stormZone?.Dispose();
            stormZone = null;
            if (apocalypseTintApplied)
            {
                RenderSettings.ambientLight = defaultAmbient;
                apocalypseTintApplied = false;
            }
        }
    }
}
