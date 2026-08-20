using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of the terminal-court shop placement branch from
    /// packages/sim/src/systems/shop.ts (ensureTerminalAssignments,
    /// selectTerminalPlacement and the terminal-window legality check).
    /// Only reachable on the 840m map once a final court is selected.
    /// </summary>
    internal static partial class ShopSystem
    {
        private static bool TryGetSelectedFinalCourt(
            SimulationState state,
            out MapCourtGeometryRecord court)
        {
            court = default;
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
                    court = courts[index];
                    return true;
                }
            }

            return false;
        }

        private static void EnsureTerminalAssignments(
            SimulationState state)
        {
            if (state.TerminalShopAssignments.ContainsKey(
                    ShopCatalog.LandGodA) &&
                state.TerminalShopAssignments.ContainsKey(
                    ShopCatalog.Taibai))
            {
                return;
            }

            var firstIndex = (int)state.Random.Shop.NextInt(2);
            state.TerminalShopAssignments[ShopCatalog.LandGodA] =
                firstIndex;
            state.TerminalShopAssignments[ShopCatalog.Taibai] =
                1 - firstIndex;
        }

        private static ShopPlacement SelectTerminalPlacement(
            SimulationState state,
            ShopSpec spec,
            ShopWindow shopWindow,
            MapCourtGeometryRecord court)
        {
            if (!IsTerminalShop(spec.ShopId))
            {
                return null;
            }

            EnsureTerminalAssignments(state);
            if (!state.TerminalShopAssignments.TryGetValue(
                    spec.ShopId,
                    out var pointIndex) ||
                pointIndex < 0 ||
                pointIndex >= court.FinalShops.Length)
            {
                return null;
            }

            var point = court.FinalShops[pointIndex];
            var placement = new ShopPlacement(
                "final:" + court.Id + ":" + pointIndex,
                "final:" + court.Id,
                new Int2Mm(
                    checked((int)point.X),
                    checked((int)point.Z)));
            var courtCenter = new Int2Mm(
                checked((int)court.Center.X),
                checked((int)court.Center.Z));
            if (ShopNavigation.LinearDistanceMm(
                    placement.Position,
                    courtCenter) < 25_000 ||
                !PointInsideSafeCircleAtTick(
                    state,
                    placement.Position,
                    state.Tick) ||
                !SafeForPlacementWindow(
                    state,
                    placement.Position,
                    shopWindow.CloseAtTick) ||
                !StaticPadIsClear(
                    state,
                    placement.Position,
                    ShopCatalog.TerminalClearRadiusMm) ||
                !PlacementHasLegalSeparation(state, spec, placement))
            {
                return null;
            }

            return placement;
        }

        private static bool TerminalPlacementIsLegal(
            SimulationState state,
            ShopSpec spec,
            ShopPlacement placement,
            MapCourtGeometryRecord court)
        {
            if (!state.TerminalShopAssignments.TryGetValue(
                    spec.ShopId,
                    out var pointIndex) ||
                pointIndex < 0 ||
                pointIndex >= court.FinalShops.Length)
            {
                return false;
            }

            var point = court.FinalShops[pointIndex];
            return placement.Position.X == checked((int)point.X) &&
                placement.Position.Z == checked((int)point.Z) &&
                PointInsideSafeCircleAtTick(
                    state,
                    placement.Position,
                    state.Tick) &&
                StaticPadIsClear(
                    state,
                    placement.Position,
                    ShopCatalog.TerminalClearRadiusMm) &&
                PlacementHasLegalSeparation(state, spec, placement);
        }
    }
}
