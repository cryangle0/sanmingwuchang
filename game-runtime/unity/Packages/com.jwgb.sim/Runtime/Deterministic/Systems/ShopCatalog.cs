using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal readonly struct ShopWindow
    {
        public ShopWindow(int openAtTick, int closeAtTick)
        {
            OpenAtTick = openAtTick;
            CloseAtTick = closeAtTick;
        }

        public int OpenAtTick { get; }

        public int CloseAtTick { get; }
    }

    internal sealed class ShopSpec
    {
        public ShopSpec(string shopId, string kind, ShopWindow[] windows)
        {
            ShopId = shopId;
            Kind = kind;
            Windows = windows;
        }

        public string ShopId { get; }

        public string Kind { get; }

        public ShopWindow[] Windows { get; }
    }

    internal sealed class ShopAnchor
    {
        public ShopAnchor(string anchorId, string macroId, Int2Mm position)
        {
            AnchorId = anchorId;
            MacroId = macroId;
            Position = position;
        }

        public string AnchorId { get; }

        public string MacroId { get; }

        public Int2Mm Position { get; }
    }

    /// <summary>
    /// Port of the shop schedule and anchor tables from
    /// packages/sim/src/systems/shop.ts.
    /// </summary>
    internal static class ShopCatalog
    {
        public const string LandGodA = "land-god-a";
        public const string ShoemakerA = "shoemaker-a";
        public const string Taibai = "taibai";
        public const string Heishan = "heishan";
        public const string LandGodB = "land-god-b";
        public const string ShoemakerB = "shoemaker-b";

        public const int InteractionRadiusMm = 2_500;
        public const int PlacementPadRadiusMm = 2_500;
        public const int TerminalClearRadiusMm = 6_000;
        public const int RelocationRetryTicks =
            5 * SimulationConstants.TicksPerSecond;
        public const int PlacementSafetyTicks =
            120 * SimulationConstants.TicksPerSecond;
        public const int PlayerWeightRadiusMm = 120_000;
        public const int SameTypeMinNavDistanceMm = 100_000;
        public const int PermanentCloseTick =
            1_200 * SimulationConstants.TicksPerSecond;
        public const int TerminalWindowOpenTick =
            900 * SimulationConstants.TicksPerSecond;

        public static readonly ShopSpec[] Specs =
        {
            new ShopSpec(
                LandGodA,
                "land-god",
                Windows(
                    new[] { 30, 210 },
                    new[] { 210, 390 },
                    new[] { 390, 570 },
                    new[] { 570, 750 },
                    new[] { 750, 900 },
                    new[] { 900, 1_200 })),
            new ShopSpec(
                ShoemakerA,
                "shoemaker",
                Windows(
                    new[] { 45, 225 },
                    new[] { 225, 405 },
                    new[] { 405, 585 },
                    new[] { 585, 795 })),
            new ShopSpec(
                Taibai,
                "taibai",
                Windows(
                    new[] { 60, 240 },
                    new[] { 240, 420 },
                    new[] { 420, 600 },
                    new[] { 600, 780 },
                    new[] { 780, 900 },
                    new[] { 900, 1_200 })),
            new ShopSpec(
                Heishan,
                "heishan",
                Windows(
                    new[] { 75, 255 },
                    new[] { 255, 435 },
                    new[] { 435, 615 },
                    new[] { 615, 750 })),
            new ShopSpec(
                LandGodB,
                "land-god",
                Windows(
                    new[] { 90, 270 },
                    new[] { 270, 450 },
                    new[] { 450, 630 },
                    new[] { 630, 885 })),
            new ShopSpec(
                ShoemakerB,
                "shoemaker",
                Windows(
                    new[] { 105, 285 },
                    new[] { 285, 465 },
                    new[] { 465, 645 },
                    new[] { 645, 840 }))
        };

        public static readonly HashSet<string> TaibaiMacroIds =
            new HashSet<string>(StringComparer.Ordinal)
            {
                "S02",
                "S03",
                "S06",
                "S07",
                "S10",
                "S11",
                "S14"
            };

        public static readonly ShopAnchor[] Anchors = BuildAnchors();

        private static ShopWindow[] Windows(params int[][] seconds)
        {
            var result = new ShopWindow[seconds.Length];
            for (var index = 0; index < seconds.Length; index += 1)
            {
                result[index] = new ShopWindow(
                    seconds[index][0] * SimulationConstants.TicksPerSecond,
                    seconds[index][1] * SimulationConstants.TicksPerSecond);
            }

            return result;
        }

        private static ShopAnchor[] BuildAnchors()
        {
            var records = MapGeometryCatalog.Shops;
            var anchors = new ShopAnchor[records.Length];
            for (var index = 0; index < records.Length; index += 1)
            {
                var record = records[index];
                anchors[index] = new ShopAnchor(
                    record.Id,
                    record.MacroId,
                    new Int2Mm(
                        checked((int)record.Position.X),
                        checked((int)record.Position.Z)));
            }

            Array.Sort(
                anchors,
                (left, right) => string.CompareOrdinal(
                    left.AnchorId,
                    right.AnchorId));
            return anchors;
        }
    }
}
