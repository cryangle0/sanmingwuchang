namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// What a given actor or query is allowed to pass through on the map.
    /// Mirrors packages/sim/src/geometry/wall-traversal.ts.
    ///
    /// Wall permissions are authored per wall in the map source and compiled
    /// into every convex piece. They are never inferred from wall height: a
    /// wall is crossable by blink only when the source marked it 可越障级, and
    /// crossable by flight only when the source marked it 可越障级 AND the
    /// flying actor's own height budget covers it. Walking passes nothing.
    /// </summary>
    public readonly struct WallTraversal
    {
        public WallTraversal(bool blinkPassable, long flightHeightBudgetMm)
        {
            BlinkPassable = blinkPassable;
            FlightHeightBudgetMm = flightHeightBudgetMm;
        }

        /// <summary>May cross pieces the map source marked blink-passable.</summary>
        public bool BlinkPassable { get; }

        /// <summary>
        /// May cross flight-passable pieces no taller than this, in millimeters.
        /// </summary>
        public long FlightHeightBudgetMm { get; }

        /// <summary>
        /// Ordinary ground movement and ground line of sight: every wall is
        /// solid. This is also <c>default(WallTraversal)</c>, so every optional
        /// traversal parameter on the collision field defaults to walking just
        /// like the TypeScript <c>WALK_TRAVERSAL</c> default.
        /// </summary>
        public static WallTraversal Walk => new WallTraversal(false, 0);

        /// <summary>D6 blink: crosses 可越障级 walls, never 封界级 walls.</summary>
        public static WallTraversal Blink => new WallTraversal(true, 0);

        /// <summary>
        /// Flight from equipment. A zero budget collapses to <see cref="Walk"/>,
        /// so callers can pass an unconditional budget without branching.
        /// </summary>
        public static WallTraversal Flight(long heightBudgetMm)
        {
            return heightBudgetMm <= 0
                ? Walk
                : new WallTraversal(false, heightBudgetMm);
        }

        /// <summary>
        /// The single place that decides whether one wall piece stops one
        /// traversal; mirrors wallPieceBlocks in wall-traversal.ts.
        /// </summary>
        public static bool Blocks(
            long pieceHeightMm,
            bool pieceBlinkPassable,
            bool pieceFlightPassable,
            WallTraversal traversal)
        {
            if (traversal.BlinkPassable && pieceBlinkPassable)
            {
                return false;
            }

            if (pieceFlightPassable &&
                pieceHeightMm <= traversal.FlightHeightBudgetMm)
            {
                return false;
            }

            return true;
        }
    }
}
