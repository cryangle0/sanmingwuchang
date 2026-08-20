using System;
using System.Globalization;
using System.IO;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    internal readonly struct SyntheticPerformanceConfiguration
    {
        private const string ReportArgument = "-jwgbPerformanceReport";
        private const string ScreenshotArgument =
            "-jwgbPerformanceScreenshot";
        private const string SampleLabelArgument =
            "-jwgbPerformanceSampleLabel";
        private const string WarmupArgument = "-jwgbPerformanceWarmupSeconds";
        private const string SampleArgument = "-jwgbPerformanceSampleSeconds";
        private const string QuitArgument = "-jwgbQuitAfterPerformanceSample";

        public SyntheticPerformanceConfiguration(
            string reportPath,
            string screenshotPath,
            string sampleLabel,
            double warmupSeconds,
            double sampleSeconds,
            bool quitAfterSample)
        {
            ReportPath = reportPath;
            ScreenshotPath = screenshotPath;
            SampleLabel = sampleLabel;
            WarmupSeconds = warmupSeconds;
            SampleSeconds = sampleSeconds;
            QuitAfterSample = quitAfterSample;
        }

        public string ReportPath { get; }

        public string ScreenshotPath { get; }

        public string SampleLabel { get; }

        public double WarmupSeconds { get; }

        public double SampleSeconds { get; }

        public bool QuitAfterSample { get; }

        public static SyntheticPerformanceConfiguration Resolve(
            double defaultWarmupSeconds,
            double defaultSampleSeconds)
        {
            var arguments = Environment.GetCommandLineArgs();
            var reportPath = ReadValue(arguments, ReportArgument);
            if (string.IsNullOrWhiteSpace(reportPath))
            {
                reportPath = Path.Combine(
                    Application.persistentDataPath,
                    $"jwgb-synthetic-{DateTime.UtcNow:yyyyMMdd-HHmmss}.json");
            }

            return new SyntheticPerformanceConfiguration(
                reportPath,
                ReadValue(arguments, ScreenshotArgument),
                ReadValue(arguments, SampleLabelArgument) ?? "unspecified",
                ReadPositiveDouble(
                    arguments,
                    WarmupArgument,
                    defaultWarmupSeconds,
                    allowZero: true),
                ReadPositiveDouble(
                    arguments,
                    SampleArgument,
                    defaultSampleSeconds,
                    allowZero: false),
                Array.IndexOf(arguments, QuitArgument) >= 0);
        }

        private static string ReadValue(string[] arguments, string name)
        {
            var index = Array.IndexOf(arguments, name);
            return index >= 0 && index + 1 < arguments.Length
                ? arguments[index + 1]
                : null;
        }

        private static double ReadPositiveDouble(
            string[] arguments,
            string name,
            double fallback,
            bool allowZero)
        {
            var value = ReadValue(arguments, name);
            var minimum = allowZero ? 0d : double.Epsilon;
            return double.TryParse(
                    value,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out var parsed) &&
                parsed >= minimum
                ? parsed
                : fallback;
        }
    }
}
