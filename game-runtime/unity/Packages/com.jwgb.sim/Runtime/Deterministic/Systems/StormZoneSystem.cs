using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/storm-zone.ts for the classic
    /// arena (selectedCourtId is always null without the 840m map, so the
    /// safe-circle center stays at the origin).
    /// </summary>
    internal static class StormZoneSystem
    {
        private readonly struct RadiusStage
        {
            public RadiusStage(
                int startTick,
                int endTick,
                int startRadiusMm,
                int endRadiusMm)
            {
                StartTick = startTick;
                EndTick = endTick;
                StartRadiusMm = startRadiusMm;
                EndRadiusMm = endRadiusMm;
            }

            public int StartTick { get; }
            public int EndTick { get; }
            public int StartRadiusMm { get; }
            public int EndRadiusMm { get; }
        }

        private const int Tps = SimulationConstants.TicksPerSecond;

        private static readonly RadiusStage[] NormalStormStages =
        {
            new RadiusStage(0, 300 * Tps, 520_000, 520_000),
            new RadiusStage(300 * Tps, 450 * Tps, 520_000, 320_000),
            new RadiusStage(450 * Tps, 600 * Tps, 320_000, 320_000),
            new RadiusStage(600 * Tps, 750 * Tps, 320_000, 220_000),
            new RadiusStage(750 * Tps, 900 * Tps, 220_000, 220_000),
            new RadiusStage(900 * Tps, 1_050 * Tps, 220_000, 140_000),
            new RadiusStage(1_050 * Tps, 1_110 * Tps, 140_000, 90_000),
            new RadiusStage(1_110 * Tps, 1_140 * Tps, 90_000, 60_000),
            new RadiusStage(1_140 * Tps, 1_200 * Tps, 60_000, 0)
        };

        public static void InitializeStormZone(SimulationState state)
        {
            state.StormZone.SelectedCourtId = null;
            state.StormZone.CourtAnnouncementTick =
                GameplayRules.StormCourtAnnouncementTick;
            state.StormZone.WarningTick = GameplayRules.StormWarningTick;
            state.StormZone.Center = new Int2Mm(0, 0);
            state.StormZone.RadiusMm = 520_000;
            state.StormZone.CourtAnnounced = false;
            state.StormZone.ApocalypseWarning = false;
            state.StormZone.ApocalypseStarted = false;
        }

        public static int NormalStormSafeRadiusMm(int tick)
        {
            if (tick >= 1_200 * Tps)
            {
                return 0;
            }

            var stage = NormalStormStages[0];
            for (var index = 0; index < NormalStormStages.Length; index += 1)
            {
                var candidate = NormalStormStages[index];
                if (tick >= candidate.StartTick && tick < candidate.EndTick)
                {
                    stage = candidate;
                    break;
                }
            }

            if (stage.StartRadiusMm == stage.EndRadiusMm)
            {
                return stage.StartRadiusMm;
            }

            var elapsed = tick - stage.StartTick;
            var duration = stage.EndTick - stage.StartTick;
            return stage.StartRadiusMm +
                (int)((long)(stage.EndRadiusMm - stage.StartRadiusMm) *
                    elapsed / duration);
        }

        public static Int2Mm StormCenterAtTick(SimulationState state, int tick)
        {
            // Port of stormCenterAtTick: the safe-circle center walks
            // toward the selected court on the 840m map; the classic
            // arena (selectedCourtId == null) keeps it at the origin.
            if (!TrySelectedCourtCenter(state, out var courtCenter) ||
                tick < GameplayRules.StormCenterMoveStartTick)
            {
                return new Int2Mm(0, 0);
            }

            var firstMoveEnd = Math.Min(
                GameplayRules.StormCenterArrivalTick,
                15 * 60 * Tps);
            var third = new Int2Mm(courtCenter.X / 3, courtCenter.Z / 3);
            if (tick < firstMoveEnd)
            {
                return InterpolatePoint(
                    new Int2Mm(0, 0),
                    third,
                    tick - GameplayRules.StormCenterMoveStartTick,
                    firstMoveEnd - GameplayRules.StormCenterMoveStartTick);
            }

            return InterpolatePoint(
                third,
                courtCenter,
                tick - firstMoveEnd,
                GameplayRules.StormCenterArrivalTick - firstMoveEnd);
        }

        private static bool TrySelectedCourtCenter(
            SimulationState state,
            out Int2Mm center)
        {
            center = default;
            var courtId = state.StormZone.SelectedCourtId;
            if (courtId == null)
            {
                return false;
            }

            var courts = MapGeometryCatalog.Courts;
            for (var index = 0; index < courts.Length; index += 1)
            {
                if (courts[index].Id == courtId)
                {
                    center = new Int2Mm(
                        checked((int)courts[index].Center.X),
                        checked((int)courts[index].Center.Z));
                    return true;
                }
            }

            return false;
        }

        private static Int2Mm InterpolatePoint(
            Int2Mm from,
            Int2Mm to,
            int elapsed,
            int duration)
        {
            if (duration <= 0 || elapsed <= 0)
            {
                return from;
            }

            if (elapsed >= duration)
            {
                return to;
            }

            return new Int2Mm(
                from.X + (int)((long)(to.X - from.X) * elapsed / duration),
                from.Z + (int)((long)(to.Z - from.Z) * elapsed / duration));
        }

        public static void SafeCircleAtTick(
            SimulationState state,
            int tick,
            out Int2Mm center,
            out int radiusMm)
        {
            center = StormCenterAtTick(state, tick);
            radiusMm = NormalStormSafeRadiusMm(tick);
        }

        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            state.StormZone.RadiusMm =
                NormalStormSafeRadiusMm(state.Tick);
            state.StormZone.Center = StormCenterAtTick(state, state.Tick);

            if (!state.StormZone.CourtAnnounced &&
                state.StormZone.SelectedCourtId != null &&
                state.Tick >= state.StormZone.CourtAnnouncementTick)
            {
                state.StormZone.CourtAnnounced = true;
                events.Add(
                    new SimEvent
                    {
                        Type = "final-court-announced",
                        Tick = state.Tick
                    });
            }

            if (!state.StormZone.ApocalypseWarning &&
                state.Tick >= state.StormZone.WarningTick)
            {
                state.StormZone.ApocalypseWarning = true;
                events.Add(
                    new SimEvent
                    {
                        Type = "apocalypse-warning",
                        Tick = state.Tick
                    });
            }

            if (!state.StormZone.ApocalypseStarted &&
                state.Tick >= GameplayRules.ApocalypseStartTick)
            {
                state.StormZone.ApocalypseStarted = true;
                events.Add(
                    new SimEvent
                    {
                        Type = "apocalypse-started",
                        Tick = state.Tick
                    });
            }
        }

        public static bool IsInNormalStormZone(
            SimulationState state,
            Int2Mm position)
        {
            var radiusMm = state.StormZone.RadiusMm;
            if (radiusMm <= 0)
            {
                return true;
            }

            long dx = position.X - state.StormZone.Center.X;
            long dz = position.Z - state.StormZone.Center.Z;
            return (dx * dx) + (dz * dz) > (long)radiusMm * radiusMm;
        }

        public static bool IsInsideNormalStormSafeZone(
            SimulationState state,
            Int2Mm position)
        {
            return state.StormZone.RadiusMm > 0 &&
                !IsInNormalStormZone(state, position);
        }
    }
}
