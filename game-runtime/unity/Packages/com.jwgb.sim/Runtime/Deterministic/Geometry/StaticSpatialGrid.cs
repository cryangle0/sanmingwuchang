using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Deterministic uniform grid over static map geometry; mirrors
    /// packages/sim/src/geometry/spatial-grid.ts.
    /// </summary>
    internal sealed class StaticSpatialGrid
    {
        private readonly long cellSizeMm;
        private readonly long originX;
        private readonly long originZ;
        private readonly int columns;
        private readonly int rows;
        private readonly List<int>[] cells;

        public readonly struct Aabb
        {
            public Aabb(long minimumX, long maximumX, long minimumZ, long maximumZ)
            {
                MinimumX = minimumX;
                MaximumX = maximumX;
                MinimumZ = minimumZ;
                MaximumZ = maximumZ;
            }

            public long MinimumX { get; }
            public long MaximumX { get; }
            public long MinimumZ { get; }
            public long MaximumZ { get; }
        }

        public StaticSpatialGrid(Aabb bounds, long cellSizeMm, IReadOnlyList<Aabb> items)
        {
            this.cellSizeMm = cellSizeMm;
            originX = bounds.MinimumX;
            originZ = bounds.MinimumZ;
            columns = (int)System.Math.Max(
                1,
                CeilDiv(bounds.MaximumX - bounds.MinimumX, cellSizeMm));
            rows = (int)System.Math.Max(
                1,
                CeilDiv(bounds.MaximumZ - bounds.MinimumZ, cellSizeMm));
            cells = new List<int>[columns * rows];
            for (var index = 0; index < cells.Length; index += 1)
            {
                cells[index] = new List<int>();
            }

            for (var itemIndex = 0; itemIndex < items.Count; itemIndex += 1)
            {
                foreach (var cellIndex in CellsInRange(items[itemIndex]))
                {
                    cells[cellIndex].Add(itemIndex);
                }
            }
        }

        /// <summary>Ascending unique item indices whose AABB may reach the range.</summary>
        public List<int> Query(Aabb range)
        {
            var seen = new HashSet<int>();
            var result = new List<int>();
            foreach (var cellIndex in CellsInRange(range))
            {
                foreach (var itemIndex in cells[cellIndex])
                {
                    if (seen.Add(itemIndex))
                    {
                        result.Add(itemIndex);
                    }
                }
            }

            result.Sort();
            return result;
        }

        private IEnumerable<int> CellsInRange(Aabb range)
        {
            var firstColumn = ClampColumn(FloorDiv(range.MinimumX - originX, cellSizeMm));
            var lastColumn = ClampColumn(FloorDiv(range.MaximumX - originX, cellSizeMm));
            var firstRow = ClampRow(FloorDiv(range.MinimumZ - originZ, cellSizeMm));
            var lastRow = ClampRow(FloorDiv(range.MaximumZ - originZ, cellSizeMm));
            for (var row = firstRow; row <= lastRow; row += 1)
            {
                for (var column = firstColumn; column <= lastColumn; column += 1)
                {
                    yield return (row * columns) + column;
                }
            }
        }

        private int ClampColumn(long column)
        {
            return (int)System.Math.Min(columns - 1, System.Math.Max(0, column));
        }

        private int ClampRow(long row)
        {
            return (int)System.Math.Min(rows - 1, System.Math.Max(0, row));
        }

        /// <summary>Floor division matching JavaScript Math.floor semantics.</summary>
        private static long FloorDiv(long numerator, long denominator)
        {
            var quotient = numerator / denominator;
            if ((numerator % denominator != 0) && ((numerator < 0) != (denominator < 0)))
            {
                quotient -= 1;
            }

            return quotient;
        }

        private static long CeilDiv(long numerator, long denominator)
        {
            return -FloorDiv(-numerator, denominator);
        }
    }
}
