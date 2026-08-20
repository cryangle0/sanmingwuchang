using System;
using Unity.Profiling;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    [DefaultExecutionOrder(200)]
    public sealed class SyntheticPerformanceSampler : MonoBehaviour
    {
        private const double NanosecondsToMilliseconds = 0.000001d;

        [SerializeField]
        private SyntheticStressPresenter presenter;

        [SerializeField]
        private double warmupSeconds = 3d;

        [SerializeField]
        private double sampleSeconds = 15d;

        [SerializeField]
        private int maxFrameSamples = 300_000;

        private double[] frameTimesMs;
        private double[] mainThreadTimesMs;
        private SyntheticPerformanceConfiguration configuration;
        private ProfilerRecorder mainThreadRecorder;
        private ProfilerRecorder gcAllocationRecorder;
        private ProfilerRecorder systemMemoryRecorder;
        private ProfilerRecorder gcMemoryRecorder;
        private double startedAt;
        private int frameCount;
        private int mainThreadFrameCount;
        private int droppedFrameSamples;
        private long totalGcAllocatedBytes;
        private long maxSystemUsedMemoryBytes;
        private long maxGcReservedMemoryBytes;
        private readonly SyntheticFrameCapture frameCapture =
            new SyntheticFrameCapture();
        private bool completed;

        private void OnEnable()
        {
            configuration = SyntheticPerformanceConfiguration.Resolve(
                warmupSeconds,
                sampleSeconds);
            frameTimesMs = new double[maxFrameSamples];
            mainThreadTimesMs = new double[maxFrameSamples];
            mainThreadRecorder = ProfilerRecorder.StartNew(
                ProfilerCategory.Internal,
                "Main Thread",
                capacity: 1);
            gcAllocationRecorder = ProfilerRecorder.StartNew(
                ProfilerCategory.Memory,
                "GC.Alloc",
                capacity: 1);
            systemMemoryRecorder = ProfilerRecorder.StartNew(
                ProfilerCategory.Memory,
                "System Used Memory",
                capacity: 1);
            gcMemoryRecorder = ProfilerRecorder.StartNew(
                ProfilerCategory.Memory,
                "GC Reserved Memory",
                capacity: 1);
            startedAt = Time.realtimeSinceStartupAsDouble;
        }

        private void LateUpdate()
        {
            if (completed || presenter == null)
            {
                return;
            }

            var elapsed = Time.realtimeSinceStartupAsDouble - startedAt;
            if (elapsed < configuration.WarmupSeconds)
            {
                return;
            }

            if (elapsed >=
                configuration.WarmupSeconds + configuration.SampleSeconds)
            {
                Complete();
                return;
            }

            CaptureFrame();
        }

        private void CaptureFrame()
        {
            if (frameCount >= frameTimesMs.Length)
            {
                droppedFrameSamples += 1;
                return;
            }

            if (frameCapture.Step(
                configuration.ScreenshotPath,
                presenter))
            {
                return;
            }

            frameTimesMs[frameCount] = Time.unscaledDeltaTime * 1000d;
            frameCount += 1;

            if (mainThreadRecorder.Valid && mainThreadRecorder.Count > 0)
            {
                mainThreadTimesMs[mainThreadFrameCount] =
                    mainThreadRecorder.LastValue * NanosecondsToMilliseconds;
                mainThreadFrameCount += 1;
            }

            if (gcAllocationRecorder.Valid && gcAllocationRecorder.Count > 0)
            {
                totalGcAllocatedBytes += Math.Max(
                    0L,
                    gcAllocationRecorder.LastValue);
            }

            maxSystemUsedMemoryBytes = MaxRecorderValue(
                systemMemoryRecorder,
                maxSystemUsedMemoryBytes);
            maxGcReservedMemoryBytes = MaxRecorderValue(
                gcMemoryRecorder,
                maxGcReservedMemoryBytes);
        }

        private void Complete()
        {
            completed = true;
            var report = new SyntheticPerformanceReport
            {
                capturedAtUtc = DateTime.UtcNow.ToString("o"),
                sampleLabel = configuration.SampleLabel,
                unityVersion = Application.unityVersion,
                platform = Application.platform.ToString(),
                developmentBuild = Debug.isDebugBuild,
                operatingSystem = SystemInfo.operatingSystem,
                processor = SystemInfo.processorType,
                graphicsDevice = SystemInfo.graphicsDeviceName,
                graphicsApi = SystemInfo.graphicsDeviceType.ToString(),
                qualityLevel = QualitySettings.names[
                    QualitySettings.GetQualityLevel()],
                renderWidth = Screen.width,
                renderHeight = Screen.height,
                vSyncCount = QualitySettings.vSyncCount,
                targetFrameRate = Application.targetFrameRate,
                systemMemoryMb = SystemInfo.systemMemorySize,
                graphicsMemoryMb = SystemInfo.graphicsMemorySize,
                playerCount = presenter.PlayerCount,
                monsterCount = presenter.MonsterCount,
                summonCount = presenter.SummonCount,
                renderedAgentCount = presenter.RenderedAgentCount,
                screenshotPath = configuration.ScreenshotPath,
                warmupSeconds = configuration.WarmupSeconds,
                sampleSeconds = configuration.SampleSeconds,
                droppedFrameSamples = droppedFrameSamples,
                mainThreadRecorderAvailable = mainThreadRecorder.Valid,
                gcAllocationRecorderAvailable = gcAllocationRecorder.Valid,
                systemMemoryRecorderAvailable = systemMemoryRecorder.Valid,
                gcMemoryRecorderAvailable = gcMemoryRecorder.Valid,
                frameTimeMs = PerformanceStatistics.Calculate(
                    frameTimesMs,
                    frameCount),
                mainThreadTimeMs = PerformanceStatistics.Calculate(
                    mainThreadTimesMs,
                    mainThreadFrameCount),
                totalGcAllocatedBytes = gcAllocationRecorder.Valid
                    ? totalGcAllocatedBytes
                    : -1,
                maxSystemUsedMemoryBytes = systemMemoryRecorder.Valid
                    ? maxSystemUsedMemoryBytes
                    : -1,
                maxGcReservedMemoryBytes = gcMemoryRecorder.Valid
                    ? maxGcReservedMemoryBytes
                    : -1
            };

            SyntheticPerformanceReportWriter.Write(
                report,
                configuration.ReportPath);
            Debug.Log(
                "JWGB synthetic performance report written: " +
                configuration.ReportPath);

            if (configuration.QuitAfterSample)
            {
                Application.Quit(0);
            }
        }

        private static long MaxRecorderValue(
            ProfilerRecorder recorder,
            long current)
        {
            return recorder.Valid && recorder.Count > 0
                ? Math.Max(current, recorder.LastValue)
                : current;
        }

        private void OnDisable()
        {
            frameCapture.Dispose();
            mainThreadRecorder.Dispose();
            gcAllocationRecorder.Dispose();
            systemMemoryRecorder.Dispose();
            gcMemoryRecorder.Dispose();
        }
    }
}
