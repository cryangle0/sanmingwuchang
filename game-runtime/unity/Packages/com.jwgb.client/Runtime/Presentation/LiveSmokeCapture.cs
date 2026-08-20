using System;
using System.Collections;
using System.IO;
using Jwgb.Client;
using Jwgb.Content;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    [DisallowMultipleComponent]
    public sealed class LiveSmokeCapture : MonoBehaviour
    {
        private const string ReportArgument = "-jwgbLiveSmokeReport";
        private const string ScreenshotArgument =
            "-jwgbLiveSmokeScreenshot";
        private const string MenuReportArgument =
            "-jwgbMenuSmokeReport";
        private const string MenuScreenshotArgument =
            "-jwgbMenuSmokeScreenshot";
        private const int CaptureTick = 120;

        [SerializeField]
        private LocalMatchRuntime runtime;

        private NetworkMatchRuntime networkRuntime;

        private readonly LiveFrameCapture frameCapture =
            new LiveFrameCapture();

        private IEnumerator Start()
        {
            var arguments = Environment.GetCommandLineArgs();
            var reportPath = ReadValue(arguments, ReportArgument);
            var screenshotPath = ReadValue(
                arguments,
                ScreenshotArgument);
            var menuReportPath = ReadValue(
                arguments,
                MenuReportArgument);
            var menuScreenshotPath = ReadValue(
                arguments,
                MenuScreenshotArgument);
            if (!string.IsNullOrWhiteSpace(menuReportPath) &&
                !string.IsNullOrWhiteSpace(menuScreenshotPath))
            {
                yield return CaptureMenu(
                    menuReportPath,
                    menuScreenshotPath);
                yield break;
            }
            if (string.IsNullOrWhiteSpace(reportPath) ||
                string.IsNullOrWhiteSpace(screenshotPath))
            {
                yield break;
            }

            var networkRequested =
                NetworkRuntimeOptions.Configuration.ClientEnabled ||
                Array.IndexOf(
                    arguments,
                    ClientBootstrap
                        .InteractiveAutoJoinArgument) >= 0;
            if (networkRequested)
            {
                networkRuntime =
                    FindFirstObjectByType<NetworkMatchRuntime>();
                if (networkRuntime == null)
                {
                    Fail(
                        "Live smoke capture cannot find " +
                        "NetworkMatchRuntime.");
                    yield break;
                }
            }
            else
            {
                if (runtime == null)
                {
                    runtime = FindFirstObjectByType<LocalMatchRuntime>();
                }
                if (runtime == null)
                {
                    Fail(
                        "Live smoke capture cannot find " +
                        "LocalMatchRuntime.");
                    yield break;
                }
            }

            var timeoutAt = Time.realtimeSinceStartup + 15f;
            while ((CurrentSnapshot == null ||
                    CurrentSnapshot.Tick < CaptureTick) &&
                   Time.realtimeSinceStartup < timeoutAt)
            {
                yield return null;
            }
            var snapshot = CurrentSnapshot;
            if (snapshot == null ||
                snapshot.Tick < CaptureTick)
            {
                Fail($"Live match did not reach tick {CaptureTick}.");
                yield break;
            }

            var fullReportPath = PreparePath(reportPath);
            var fullScreenshotPath = PreparePath(screenshotPath);
            yield return new WaitForEndOfFrame();
            File.WriteAllText(
                fullReportPath,
                JsonUtility.ToJson(
                    CreateReport(snapshot),
                    prettyPrint: true));
            while (frameCapture.Step(fullScreenshotPath))
            {
                yield return new WaitForEndOfFrame();
            }
            if (!File.Exists(fullScreenshotPath) ||
                new FileInfo(fullScreenshotPath).Length <= 0)
            {
                Fail("Live smoke screenshot was not written.");
                yield break;
            }
            Application.Quit(0);
        }

        private IEnumerator CaptureMenu(
            string reportPath,
            string screenshotPath)
        {
            if (NetworkRuntimeOptions.Configuration.ClientEnabled)
            {
                Fail("Menu smoke requires local client mode.");
                yield break;
            }
            if (runtime == null)
            {
                runtime = FindFirstObjectByType<LocalMatchRuntime>();
            }
            var document = GetComponent<UIDocument>();
            var timeoutAt = Time.realtimeSinceStartup + 10f;
            VisualElement menu = null;
            while (Time.realtimeSinceStartup < timeoutAt)
            {
                menu = document.rootVisualElement.Q(
                    "jwgb-main-menu");
                if (menu != null &&
                    runtime != null &&
                    !runtime.HasSession)
                {
                    break;
                }
                yield return null;
            }
            if (menu == null || runtime == null || runtime.HasSession)
            {
                Fail("Client main menu did not become ready.");
                yield break;
            }

            var heroSelector = document.rootVisualElement.Q<DropdownField>(
                "jwgb-hero-selector");
            var slider = document.rootVisualElement.Q<SliderInt>(
                "jwgb-competitor-slider");
            var startButton = document.rootVisualElement.Q<Button>(
                "jwgb-start-match");
            var localModeButton =
                document.rootVisualElement.Q<Button>(
                    "jwgb-mode-local");
            var onlineModeButton =
                document.rootVisualElement.Q<Button>(
                    "jwgb-mode-online");
            var serverAddress =
                document.rootVisualElement.Q<TextField>(
                    "jwgb-server-address");
            var serverPort =
                document.rootVisualElement.Q<IntegerField>(
                    "jwgb-server-port");
            var reconnectPanel =
                document.rootVisualElement.Q(
                    "jwgb-reconnect-panel");
            var reconnectStatus =
                document.rootVisualElement.Q<Label>(
                    "jwgb-reconnect-status");
            var abandonReconnectButton =
                document.rootVisualElement.Q<Button>(
                    "jwgb-abandon-reconnect");
            if (heroSelector == null ||
                heroSelector.choices.Count != GeneratedGameplayCatalog.HeroCount ||
                slider == null ||
                startButton == null ||
                localModeButton == null ||
                onlineModeButton == null ||
                serverAddress == null ||
                serverPort == null ||
                reconnectPanel == null ||
                reconnectStatus == null ||
                abandonReconnectButton == null)
            {
                Fail("Client main menu controls are incomplete.");
                yield break;
            }

            var firstHeroId = heroSelector.choices[0].Substring(0, 4);
            var lastHeroId = heroSelector.choices[
                heroSelector.choices.Count - 1].Substring(0, 4);
            heroSelector.value = heroSelector.choices[
                heroSelector.choices.Count - 1];
            var fullReportPath = PreparePath(reportPath);
            var fullScreenshotPath = PreparePath(screenshotPath);
            File.WriteAllText(
                fullReportPath,
                JsonUtility.ToJson(
                    new MenuSmokeReport
                    {
                        schema = "jwgb.unity.menu-smoke.v4",
                        unityVersion = Application.unityVersion,
                        heroChoiceCount = heroSelector.choices.Count,
                        firstHeroId = firstHeroId,
                        lastHeroId = lastHeroId,
                        selectedHeroId = heroSelector.value.Substring(0, 4),
                        localModeButtonPresent =
                            localModeButton != null,
                        onlineModeButtonPresent =
                            onlineModeButton != null,
                        onlineControlsPresent =
                            serverAddress != null &&
                            serverPort != null,
                        reconnectControlsPresent =
                            reconnectPanel != null &&
                            reconnectStatus != null &&
                            abandonReconnectButton != null,
                        competitorMinimum = slider.lowValue,
                        competitorMaximum = slider.highValue,
                        defaultCompetitorCount = slider.value,
                        startButtonVisible =
                            startButton.resolvedStyle.display !=
                            DisplayStyle.None,
                        hasActiveSession = runtime.HasSession,
                        screenWidth = Screen.width,
                        screenHeight = Screen.height
                    },
                    prettyPrint: true));
            yield return new WaitForEndOfFrame();
            while (frameCapture.Step(fullScreenshotPath))
            {
                yield return new WaitForEndOfFrame();
            }
            if (!File.Exists(fullScreenshotPath) ||
                new FileInfo(fullScreenshotPath).Length <= 0)
            {
                Fail("Menu smoke screenshot was not written.");
                yield break;
            }
            Application.Quit(0);
        }

        private LiveSmokeReport CreateReport(WorldSnapshot snapshot)
        {
            var remaining = 0;
            var localHp = 0;
            var localMaxHp = 0;
            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                var player = snapshot.Players[index];
                if (player.LifeState != LifeState.Eliminated)
                {
                    remaining += 1;
                }
                if (player.EntityId == LocalEntityId)
                {
                    localHp = player.Hp;
                    localMaxHp = player.MaxHp;
                }
            }

            return new LiveSmokeReport
            {
                schema = "jwgb.unity.live-smoke.v2",
                unityVersion = Application.unityVersion,
                mode = networkRuntime != null
                    ? "network-authoritative-runtime-ghosts"
                    : "local-authoritative-simulation",
                tick = snapshot.Tick,
                localEntityId = LocalEntityId,
                playerCount = snapshot.Players.Length,
                remainingCompetitors = remaining,
                projectileCount = snapshot.Projectiles.Length,
                windWallCount = snapshot.WindWalls.Length,
                localHp = localHp,
                localMaxHp = localMaxHp,
                stateHash = snapshot.StateHash,
                completeGhostSnapshotCount = networkRuntime != null
                    ? MatchNetworkRuntimeState
                        .ClientCompleteSnapshotCount
                    : 0,
                mapEnabled =
                    !string.IsNullOrEmpty(snapshot.MapGeometryHash),
                pveEnabled = snapshot.PveEnabled,
                monsterCount = snapshot.Monsters.Length,
                lootDropCount = snapshot.LootDrops.Length,
                shopCount = snapshot.Shops.Length,
                stormRadiusMm = snapshot.StormZone?.RadiusMm ?? 0,
                screenWidth = Screen.width,
                screenHeight = Screen.height
            };
        }

        private WorldSnapshot CurrentSnapshot => networkRuntime != null
            ? networkRuntime.Snapshot
            : runtime?.Snapshot;

        private int LocalEntityId => networkRuntime != null
            ? networkRuntime.LocalEntityId
            : runtime == null
                ? 0
                : runtime.LocalEntityId;

        private static string ReadValue(
            string[] arguments,
            string name)
        {
            var index = Array.IndexOf(arguments, name);
            return index >= 0 && index + 1 < arguments.Length
                ? arguments[index + 1]
                : null;
        }

        private static string PreparePath(string path)
        {
            var fullPath = Path.GetFullPath(path);
            var directory = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                throw new InvalidOperationException(
                    $"Output path has no parent directory: {path}");
            }
            Directory.CreateDirectory(directory);
            return fullPath;
        }

        private static void Fail(string message)
        {
            Debug.LogError(message);
            Application.Quit(2);
        }

        private void OnDestroy()
        {
            frameCapture.Dispose();
        }
    }
}
