using Jwgb.Client;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Builds the map greybox when a map-mode session starts and tears
    /// it down when the session stops. Works for the local session and
    /// the networked match: geometry always builds from the local
    /// catalog, the snapshot's MapGeometryHash only gates activation.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class MapEnvironmentPresenter : MonoBehaviour
    {
        [SerializeField]
        private LocalMatchRuntime runtime;

        private ClientBootstrap clientBootstrap;

        private NetworkMatchRuntime networkRuntime;

        [SerializeField]
        private Material beyondMaterial;

        [SerializeField]
        private Material groundMaterial;

        [SerializeField]
        private Material roadMaterial;

        [SerializeField]
        private Material courtMaterial;

        [SerializeField]
        private Material wallMaterial;

        [SerializeField]
        private Material highlandMaterial;

        [SerializeField]
        private Material spawnPadMaterial;

        private MapEnvironmentView view;

        public bool HasEnvironment => view != null;

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
                runtime.SessionStarted += OnSessionStarted;
                runtime.SessionStopped += OnSessionStopped;
                if (runtime.HasSession && !IsNetworkMode)
                {
                    OnSessionStarted();
                }
            }
            if (runtime == null && networkRuntime == null)
            {
                enabled = false;
            }
        }

        private void OnDestroy()
        {
            if (runtime != null)
            {
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
            TearDown();
        }

        private bool IsNetworkMode =>
            clientBootstrap != null &&
            clientBootstrap.IsNetworkActive;

        private void OnSessionStarted()
        {
            if (IsNetworkMode)
            {
                return;
            }
            TearDown();
            BuildFor(runtime.Snapshot);
        }

        private void OnSessionStopped()
        {
            if (!IsNetworkMode)
            {
                TearDown();
            }
        }

        private void OnNetworkSnapshotChanged(WorldSnapshot snapshot)
        {
            if (!IsNetworkMode || view != null)
            {
                return;
            }
            BuildFor(snapshot);
        }

        private void OnClientSessionStateChanged(
            ClientSessionState state,
            string _)
        {
            TearDown();
            if (state == ClientSessionState.Local &&
                runtime != null &&
                runtime.HasSession)
            {
                BuildFor(runtime.Snapshot);
            }
        }

        private void BuildFor(WorldSnapshot snapshot)
        {
            if (snapshot == null ||
                string.IsNullOrEmpty(snapshot.MapGeometryHash))
            {
                return;
            }
            view = new MapEnvironmentView(
                MapMeshBuilder.Build(),
                beyondMaterial,
                groundMaterial,
                roadMaterial,
                courtMaterial,
                wallMaterial,
                highlandMaterial,
                spawnPadMaterial);
        }

        private void TearDown()
        {
            if (view == null)
            {
                return;
            }
            view.Dispose();
            view = null;
        }
    }
}
