using System;
using System.IO;
using System.Text;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    [Serializable]
    public sealed class SyntheticPerformanceReport
    {
        public string schema = "jwgb.unity.synthetic-performance.v1";
        public string capturedAtUtc;
        public string sampleLabel;
        public string unityVersion;
        public string platform;
        public bool developmentBuild;
        public string operatingSystem;
        public string processor;
        public string graphicsDevice;
        public string graphicsApi;
        public string qualityLevel;
        public int renderWidth;
        public int renderHeight;
        public int vSyncCount;
        public int targetFrameRate;
        public int systemMemoryMb;
        public int graphicsMemoryMb;
        public int playerCount;
        public int monsterCount;
        public int summonCount;
        public int renderedAgentCount;
        public string screenshotPath;
        public double warmupSeconds;
        public double sampleSeconds;
        public int droppedFrameSamples;
        public bool mainThreadRecorderAvailable;
        public bool gcAllocationRecorderAvailable;
        public bool systemMemoryRecorderAvailable;
        public bool gcMemoryRecorderAvailable;
        public PerformanceDistribution frameTimeMs;
        public PerformanceDistribution mainThreadTimeMs;
        public long totalGcAllocatedBytes;
        public long maxSystemUsedMemoryBytes;
        public long maxGcReservedMemoryBytes;
    }

    internal static class SyntheticPerformanceReportWriter
    {
        public static void Write(
            SyntheticPerformanceReport report,
            string path)
        {
            var fullPath = Path.GetFullPath(path);
            var directory = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                throw new InvalidOperationException(
                    "Performance report path has no parent directory.");
            }

            Directory.CreateDirectory(directory);
            var json = NormalizeIndentation(JsonUtility
                .ToJson(report, prettyPrint: true)
                .Replace("\r\n", "\n"));
            File.WriteAllText(
                fullPath,
                json + "\n",
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        }

        private static string NormalizeIndentation(string json)
        {
            var lines = json.Split('\n');
            for (var index = 0; index < lines.Length; index += 1)
            {
                var spaces = 0;
                while (spaces < lines[index].Length &&
                    lines[index][spaces] == ' ')
                {
                    spaces += 1;
                }

                if (spaces > 0)
                {
                    lines[index] = new string(' ', spaces / 2) +
                        lines[index].Substring(spaces);
                }
            }

            return string.Join("\n", lines);
        }
    }
}
