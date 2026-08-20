using System;
using System.IO;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Netcode
{
    [DisallowMultipleComponent]
    public sealed partial class NetworkClientSmokeCapture : MonoBehaviour
    {
        private const float DefaultTimeoutSeconds = 15f;
        private const string MinimumGhostTickArgument =
            "-jwgbNetworkSmokeMinTick";
        private const string TimeoutSecondsArgument =
            "-jwgbNetworkSmokeTimeoutSeconds";
        private const string MinimumPlayerCountArgument =
            "-jwgbNetworkSmokeMinPlayers";
        private const string MinimumInputCountArgument =
            "-jwgbNetworkSmokeMinInputs";
        private const string ReadyMarkerArgument =
            "-jwgbNetworkSmokeReady";
        private const string ReleaseFileArgument =
            "-jwgbNetworkSmokeRelease";
        private const string VisualSmokeScreenshotArgument =
            "-jwgbLiveSmokeScreenshot";
        private const string RematchSmokeArgument =
            "-jwgbNetworkSmokeRematch";

        private float timeoutAt;
        private int minimumGhostTick = 1;
        private int minimumPlayerCount = 1;
        private int minimumInputCount = 1;
        private string readyMarkerPath;
        private string releaseFilePath;
        private bool completed;
        private bool readinessWritten;
        private bool deferQuitToVisualCapture;
        private bool rematchMode;
        private bool rematchRequested;
        private bool rematchObserved;
        private int initialEntityId;
        private string initialAssignedHeroId;
        private int firstMatchFinishedTick;
        private int rematchTick;

        private void Start()
        {
            var arguments = Environment.GetCommandLineArgs();
            minimumGhostTick = ReadPositiveInt(
                arguments,
                MinimumGhostTickArgument,
                1);
            minimumPlayerCount = ReadPositiveInt(
                arguments,
                MinimumPlayerCountArgument,
                1);
            minimumInputCount = ReadPositiveInt(
                arguments,
                MinimumInputCountArgument,
                1);
            var timeoutSeconds = ReadPositiveInt(
                arguments,
                TimeoutSecondsArgument,
                (int)DefaultTimeoutSeconds);
            readyMarkerPath = ReadValue(arguments, ReadyMarkerArgument);
            releaseFilePath = ReadValue(arguments, ReleaseFileArgument);
            timeoutAt = Time.realtimeSinceStartup + timeoutSeconds;
            deferQuitToVisualCapture = Array.IndexOf(
                arguments,
                VisualSmokeScreenshotArgument) >= 0;
            rematchMode = Array.IndexOf(
                arguments,
                RematchSmokeArgument) >= 0;
        }

        private void Update()
        {
            if (completed)
            {
                return;
            }
            if (rematchMode)
            {
                UpdateRematchSmoke();
                return;
            }
            if (IsReady())
            {
                if (!readinessWritten &&
                    !string.IsNullOrWhiteSpace(readyMarkerPath))
                {
                    WriteMarker(readyMarkerPath);
                    readinessWritten = true;
                }
                if (!string.IsNullOrWhiteSpace(releaseFilePath) &&
                    !File.Exists(Path.GetFullPath(releaseFilePath)))
                {
                    return;
                }

                Complete();
                return;
            }
            CheckTimeout();
        }

        private void UpdateRematchSmoke()
        {
            var entityId = MatchNetworkRuntimeState.ClientEntityId;
            var assignedHeroId =
                MatchNetworkRuntimeState.ClientAssignedHeroId;
            var state = MatchNetworkRuntimeState.LatestClientGhostState;
            var tick = MatchNetworkRuntimeState.ClientGhostSnapshotTick;
            if (initialEntityId == 0 && entityId > 0)
            {
                initialEntityId = entityId;
                initialAssignedHeroId = assignedHeroId;
            }

            if (!rematchRequested &&
                entityId > 0 &&
                state.Tick > 0 &&
                (MatchStatus)state.MatchStatus ==
                    MatchStatus.Finished)
            {
                firstMatchFinishedTick = tick;
                MatchNetworkRuntimeState.QueueClientRematch();
                rematchRequested = true;
            }
            else if (rematchRequested &&
                tick > 0 &&
                tick < firstMatchFinishedTick &&
                (MatchStatus)state.MatchStatus ==
                    MatchStatus.Running)
            {
                rematchObserved = true;
                rematchTick = tick;
            }

            if (rematchObserved &&
                tick >= minimumGhostTick &&
                entityId == initialEntityId &&
                string.Equals(
                    assignedHeroId,
                    initialAssignedHeroId,
                    StringComparison.Ordinal))
            {
                Complete();
                return;
            }
            CheckTimeout();
        }

        private bool IsReady()
        {
            return MatchNetworkRuntimeState.ClientEntityId > 0 &&
                MatchNetworkRuntimeState.SentInputRpcCount > 0 &&
                MatchNetworkRuntimeState.ReceivedStateRpcCount > 0 &&
                MatchNetworkRuntimeState.ClientCompleteSnapshotCount > 0 &&
                MatchNetworkRuntimeState.ClientGhostSnapshotTick >=
                    minimumGhostTick &&
                MatchNetworkRuntimeState.ClientPlayerGhostCount >=
                    minimumPlayerCount &&
                MatchNetworkRuntimeState.SentInputRpcCount >=
                    minimumInputCount;
        }

        private void Complete()
        {
            completed = true;
            WriteReport();
            if (!deferQuitToVisualCapture)
            {
                Application.Quit(0);
            }
        }

        private void CheckTimeout()
        {
            if (Time.realtimeSinceStartup < timeoutAt)
            {
                return;
            }
            completed = true;
            Debug.LogError(
                rematchMode
                    ? "JWGB Netcode rematch smoke did not observe a new match."
                    : "JWGB Netcode client smoke did not complete by Ghost " +
                        $"tick {minimumGhostTick}.");
            Application.Quit(2);
        }

        private static int ReadPositiveInt(
            string[] arguments,
            string name,
            int fallback)
        {
            var index = Array.IndexOf(arguments, name);
            if (index < 0 || index + 1 >= arguments.Length)
            {
                return fallback;
            }
            return int.TryParse(arguments[index + 1], out var value) &&
                value > 0
                    ? value
                    : fallback;
        }

        private static string ReadValue(
            string[] arguments,
            string name)
        {
            var index = Array.IndexOf(arguments, name);
            if (index < 0)
            {
                return null;
            }
            if (index + 1 >= arguments.Length ||
                string.IsNullOrWhiteSpace(arguments[index + 1]))
            {
                throw new ArgumentException(
                    $"Missing value for {name}.");
            }
            return arguments[index + 1];
        }

        private static void WriteMarker(string path)
        {
            var fullPath = Path.GetFullPath(path);
            var directory = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                throw new InvalidOperationException(
                    $"Marker path has no parent directory: {path}");
            }
            Directory.CreateDirectory(directory);
            File.WriteAllText(fullPath, "ready\n");
        }
    }
}
