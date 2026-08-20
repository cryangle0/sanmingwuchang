using System;

namespace Jwgb.Server
{
    internal static class ServerRuntimeOptions
    {
        private const int DefaultRootSeed = 20260724;
        private const int DefaultCompetitorCount = 30;
        private const int DefaultSmokeTick = 120;
        private const string ClassicArenaArgument = "-jwgbClassicArena";

        public static int RootSeed =>
            ReadInteger("-jwgbSeed", DefaultRootSeed, int.MinValue, int.MaxValue);

        /// <summary>
        /// Map mode with full PVE population is the default authoritative
        /// match. Pass -jwgbClassicArena to run the legacy arena without
        /// map geometry or PVE.
        /// </summary>
        public static bool MapEnabled => !HasFlag(ClassicArenaArgument);

        public static bool PveEnabled => MapEnabled;

        public static int CompetitorCount =>
            ReadInteger("-jwgbCompetitors", DefaultCompetitorCount, 2, 30);

        public static string SmokeReportPath =>
            ReadString("-jwgbServerSmokeReport");

        public static int SmokeTick =>
            ReadInteger("-jwgbServerSmokeTick", DefaultSmokeTick, 20, 10_000);

        public static int RematchSmokeFinishTick =>
            ReadInteger("-jwgbServerRematchFinishTick", 0, 0, 10_000);

        private static bool HasFlag(string argument)
        {
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length; index += 1)
            {
                if (string.Equals(
                    arguments[index],
                    argument,
                    StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }

        private static int ReadInteger(
            string argument,
            int fallback,
            int minimum,
            int maximum)
        {
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length - 1; index += 1)
            {
                if (!string.Equals(
                    arguments[index],
                    argument,
                    StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (int.TryParse(arguments[index + 1], out var value) &&
                    value >= minimum &&
                    value <= maximum)
                {
                    return value;
                }

                throw new ArgumentException(
                    $"Invalid value for {argument}: {arguments[index + 1]}");
            }

            return fallback;
        }

        private static string ReadString(string argument)
        {
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length - 1; index += 1)
            {
                if (string.Equals(
                    arguments[index],
                    argument,
                    StringComparison.OrdinalIgnoreCase))
                {
                    return arguments[index + 1];
                }
            }

            return null;
        }
    }
}
