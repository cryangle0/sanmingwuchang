using System;
using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Sim;
using Unity.Entities;
using UnityEngine;

namespace Jwgb.Server
{
    [DisallowMultipleComponent]
    public sealed class ServerBootstrap : MonoBehaviour
    {
        private const string SyntheticStressArgument = "-jwgbSyntheticStress";

        private void Start()
        {
            Debug.Log(
                $"JWGB Unity Server | ruleset {SimulationConstants.RulesetVersion} | " +
                $"{SimulationConstants.TicksPerSecond} Hz");

            if (Array.IndexOf(Environment.GetCommandLineArgs(), SyntheticStressArgument) < 0)
            {
                var runtime =
                    gameObject.AddComponent<AuthoritativeMatchRuntime>();
                if (!string.IsNullOrWhiteSpace(
                    ServerRuntimeOptions.SmokeReportPath))
                {
                    var smokeCapture =
                        gameObject.AddComponent<ServerLiveSmokeCapture>();
                    smokeCapture.Initialize(
                        runtime,
                        ServerRuntimeOptions.SmokeReportPath,
                        ServerRuntimeOptions.SmokeTick,
                        ServerRuntimeOptions.RootSeed,
                        ServerRuntimeOptions.CompetitorCount);
                }
                return;
            }

            var world = World.DefaultGameObjectInjectionWorld;
            if (world == null || !world.IsCreated)
            {
                throw new InvalidOperationException("JWGB default ECS world is unavailable.");
            }

            SimulationWorldConfigurator.ConfigureFixedRate(world);
            SyntheticStressSpawner.Spawn(
                world.EntityManager,
                SyntheticStressProfile.Baseline);
        }
    }
}
