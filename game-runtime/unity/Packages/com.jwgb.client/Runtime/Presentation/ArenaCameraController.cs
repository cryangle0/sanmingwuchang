using Jwgb.Client;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    [RequireComponent(typeof(Camera))]
    public sealed class ArenaCameraController : MonoBehaviour
    {
        [SerializeField]
        private LocalMatchRuntime runtime;

        private ClientBootstrap clientBootstrap;

        private NetworkMatchRuntime networkRuntime;

        [SerializeField]
        private Vector3 offset = new Vector3(0f, 58f, -48f);

        private Vector3 velocity;

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
            if (runtime == null && networkRuntime == null)
            {
                enabled = false;
            }
        }

        private void LateUpdate()
        {
            Vector3 focus;
            if (IsNetworkMode &&
                networkRuntime != null &&
                networkRuntime.TryGetPredictedLocalTransform(
                    out var predictedPosition,
                    out _))
            {
                focus = new Vector3(
                    predictedPosition.X / 1_000f,
                    0f,
                    predictedPosition.Z / 1_000f);
            }
            else
            {
                var local = FindLocalPlayer();
                if (local == null)
                {
                    return;
                }
                focus = new Vector3(
                    local.Position.X / 1_000f,
                    0f,
                    local.Position.Z / 1_000f);
            }
            transform.position = Vector3.SmoothDamp(
                transform.position,
                focus + offset,
                ref velocity,
                0.16f,
                500f,
                Time.unscaledDeltaTime);
            transform.rotation = Quaternion.Slerp(
                transform.rotation,
                Quaternion.LookRotation(
                    focus - transform.position,
                    Vector3.up),
                1f - Mathf.Exp(-12f * Time.unscaledDeltaTime));
        }

        private PlayerSnapshot FindLocalPlayer()
        {
            var snapshot = networkRuntime != null
                && IsNetworkMode
                    ? networkRuntime.Snapshot
                    : runtime?.Snapshot;
            if (snapshot == null)
            {
                return null;
            }

            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                if (snapshot.Players[index].EntityId ==
                    LocalEntityId)
                {
                    return snapshot.Players[index];
                }
            }

            return null;
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
    }
}
