using System.Collections.Generic;
using Jwgb.Client;
using Jwgb.Content;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    [DisallowMultipleComponent]
    public sealed class LocalMatchPresenter : MonoBehaviour
    {
        [SerializeField]
        private LocalMatchRuntime runtime;

        private ClientBootstrap clientBootstrap;

        private NetworkMatchRuntime networkRuntime;

        [SerializeField]
        private Mesh playerMesh;

        [SerializeField]
        private Mesh cubeMesh;

        [SerializeField]
        private Mesh cylinderMesh;

        [SerializeField]
        private Mesh projectileMesh;

        [SerializeField]
        private ModelVisualCatalog modelVisualCatalog;

        [SerializeField]
        private Material ironFanMaterial;

        [SerializeField]
        private Material sunWukongMaterial;

        [SerializeField]
        private Material bullDemonMaterial;

        [SerializeField]
        private Material projectileMaterial;

        [SerializeField]
        private Material windWallMaterial;

        [SerializeField]
        private Material healthBackgroundMaterial;

        [SerializeField]
        private Material healthMaterial;

        [SerializeField]
        private Material shieldMaterial;

        private readonly Dictionary<int, MatchPlayerView> players =
            new Dictionary<int, MatchPlayerView>();
        private readonly Dictionary<int, MatchEffectView> projectiles =
            new Dictionary<int, MatchEffectView>();
        private readonly Dictionary<int, MatchEffectView> windWalls =
            new Dictionary<int, MatchEffectView>();

        internal int PlayerViewCount => players.Count;

        internal MatchPlayerView GetPlayerViewForTesting(int entityId)
        {
            return players.TryGetValue(entityId, out var view)
                ? view
                : null;
        }

        internal void ApplySnapshotForTesting(WorldSnapshot snapshot)
        {
            ApplySnapshot(snapshot);
        }

        private void Start()
        {
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
            }

            if (runtime != null)
            {
                runtime.FrameAdvanced += OnFrameAdvanced;
                runtime.SessionStarted += OnSessionStarted;
                runtime.SessionStopped += OnSessionStopped;
                if (runtime.HasSession && !IsNetworkMode)
                {
                    ApplySnapshot(runtime.Snapshot);
                }
            }
            if (runtime == null && networkRuntime == null)
            {
                enabled = false;
            }
        }

        private void Update()
        {
            var remoteViewCount = 0;
            var remoteHoldCount = 0;
            var maximumRemoteStepMm = 0;
            foreach (var pair in players)
            {
                var isLocal = pair.Key == LocalEntityId;
                if (isLocal &&
                    IsNetworkMode &&
                    networkRuntime != null &&
                    networkRuntime.TryGetPredictedLocalTransform(
                        out var predictedPosition,
                        out var predictedFacing))
                {
                    pair.Value.SetPredictedTransform(
                        predictedPosition,
                        predictedFacing);
                }
                pair.Value.Update(
                    Time.deltaTime,
                    isLocal);
                if (!IsNetworkMode || isLocal)
                {
                    continue;
                }
                remoteViewCount += 1;
                remoteHoldCount +=
                    pair.Value.RemoteHeldLastFrame ? 1 : 0;
                maximumRemoteStepMm = Mathf.Max(
                    maximumRemoteStepMm,
                    pair.Value.RemoteStepMmLastFrame);
            }
            foreach (var view in projectiles.Values)
            {
                view.Update(Time.deltaTime);
            }
            if (IsNetworkMode && remoteViewCount > 0)
            {
                MatchNetworkRuntimeState
                    .RecordRemoteInterpolationFrame(
                        remoteViewCount,
                        remoteHoldCount,
                        maximumRemoteStepMm);
            }
            foreach (var view in windWalls.Values)
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
            }
            if (clientBootstrap != null)
            {
                clientBootstrap.SessionStateChanged -=
                    OnClientSessionStateChanged;
            }
            Dispose(players);
            Dispose(projectiles);
            Dispose(windWalls);
        }

        private void OnFrameAdvanced(LocalMatchFrame frame)
        {
            if (!IsNetworkMode)
            {
                ApplySnapshot(frame.Snapshot);
            }
        }

        private void OnSessionStarted()
        {
            if (IsNetworkMode)
            {
                return;
            }
            ResetViews();
            ApplySnapshot(runtime.Snapshot);
        }

        private void OnSessionStopped()
        {
            if (!IsNetworkMode)
            {
                ResetViews();
            }
        }

        private void OnNetworkSnapshotChanged(WorldSnapshot snapshot)
        {
            if (IsNetworkMode)
            {
                ApplySnapshot(snapshot);
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
                ApplySnapshot(runtime.Snapshot);
            }
        }

        private void ApplySnapshot(WorldSnapshot snapshot)
        {
            if (snapshot == null)
            {
                return;
            }

            var activePlayers = new HashSet<int>();
            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                var player = snapshot.Players[index];
                activePlayers.Add(player.EntityId);
                if (players.TryGetValue(
                        player.EntityId,
                        out var view) &&
                    !string.Equals(
                        view.HeroId,
                        player.HeroId,
                        System.StringComparison.Ordinal))
                {
                    view.Dispose();
                    players.Remove(player.EntityId);
                    view = null;
                }
                if (view == null)
                {
                    view = new MatchPlayerView(
                        player.EntityId,
                        player.HeroId,
                        MatchHudText.HeroName(player.HeroId),
                        playerMesh,
                        cubeMesh,
                        cylinderMesh,
                        ResolveMaterial(player.HeroId),
                        healthBackgroundMaterial,
                        healthMaterial,
                        shieldMaterial,
                        player.EntityId == LocalEntityId,
                        ResolveHeroModel(player.HeroId));
                    players.Add(player.EntityId, view);
                }
                view.SetSnapshot(
                    player,
                    IsNetworkMode && networkRuntime != null
                        ? networkRuntime.GetPlayerSnapshotTick(
                            player.EntityId,
                            snapshot.Tick)
                        : snapshot.Tick);
            }
            RemoveInactivePlayers(activePlayers);

            ApplyProjectiles(snapshot.Projectiles);
            ApplyWindWalls(snapshot.WindWalls);
        }

        private bool IsNetworkMode =>
            clientBootstrap != null &&
            clientBootstrap.IsNetworkActive;

        private int LocalEntityId => IsNetworkMode &&
            networkRuntime != null
            ? networkRuntime.LocalEntityId
            : runtime == null
                ? 0
                : runtime.LocalEntityId;

        private void ApplyProjectiles(ProjectileSnapshot[] snapshots)
        {
            var active = new HashSet<int>();
            for (var index = 0; index < snapshots.Length; index += 1)
            {
                var snapshot = snapshots[index];
                active.Add(snapshot.EntityId);
                if (!projectiles.TryGetValue(
                    snapshot.EntityId,
                    out var view))
                {
                    view = new MatchEffectView(
                        $"Projectile {snapshot.EntityId}",
                        projectileMesh,
                        projectileMaterial);
                    projectiles.Add(snapshot.EntityId, view);
                }
                view.SetProjectile(snapshot);
            }
            RemoveInactive(projectiles, active);
        }

        private void ApplyWindWalls(WindWallSnapshot[] snapshots)
        {
            var active = new HashSet<int>();
            for (var index = 0; index < snapshots.Length; index += 1)
            {
                var snapshot = snapshots[index];
                active.Add(snapshot.EntityId);
                if (!windWalls.TryGetValue(
                    snapshot.EntityId,
                    out var view))
                {
                    view = new MatchEffectView(
                        $"Wind Wall {snapshot.EntityId}",
                        cubeMesh,
                        windWallMaterial);
                    windWalls.Add(snapshot.EntityId, view);
                }
                view.SetWindWall(snapshot);
            }
            RemoveInactive(windWalls, active);
        }

        private Material ResolveMaterial(string heroId)
        {
            return heroId switch
            {
                GameplayIds.IronFanPrincess => ironFanMaterial,
                GameplayIds.BullDemonKing => bullDemonMaterial,
                _ => sunWukongMaterial
            };
        }

        private ModelVisualDefinition ResolveHeroModel(string heroId)
        {
            return modelVisualCatalog != null &&
                modelVisualCatalog.TryResolveHero(
                    heroId,
                    out var definition)
                ? definition
                : default;
        }

        private static void RemoveInactive(
            Dictionary<int, MatchEffectView> views,
            HashSet<int> active)
        {
            var removed = new List<int>();
            foreach (var pair in views)
            {
                if (!active.Contains(pair.Key))
                {
                    pair.Value.Dispose();
                    removed.Add(pair.Key);
                }
            }
            for (var index = 0; index < removed.Count; index += 1)
            {
                views.Remove(removed[index]);
            }
        }

        private void RemoveInactivePlayers(HashSet<int> active)
        {
            var removed = new List<int>();
            foreach (var pair in players)
            {
                if (!active.Contains(pair.Key))
                {
                    pair.Value.Dispose();
                    removed.Add(pair.Key);
                }
            }
            for (var index = 0; index < removed.Count; index += 1)
            {
                players.Remove(removed[index]);
            }
        }

        private static void Dispose<T>(Dictionary<int, T> views)
            where T : class
        {
            foreach (var view in views.Values)
            {
                switch (view)
                {
                    case MatchPlayerView player:
                        player.Dispose();
                        break;
                    case MatchEffectView effect:
                        effect.Dispose();
                        break;
                }
            }
            views.Clear();
        }

        private void ResetViews()
        {
            Dispose(players);
            Dispose(projectiles);
            Dispose(windWalls);
        }
    }
}
