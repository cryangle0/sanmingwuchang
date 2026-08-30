using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/content/src/terrain-height.ts. Integer millimetre
    /// height shared by the TypeScript sim, the web renderer, and this C#
    /// slice. Every constant, every truncation and every traversal order here
    /// mirrors that file; where the two disagree the TypeScript side is the
    /// oracle and this one is wrong.
    /// </summary>
    internal static class TerrainHeight
    {
        /// <summary>
        /// Terrain profile revision, carried in the state hash beside the
        /// geometry hash so a cross-language mismatch is attributable to
        /// terrain rather than to the compiled map.
        /// </summary>
        public const int ProfileVersion = 4;

        /// <summary>
        /// Peak-to-trough of the wilderness noise before stamps.
        /// Read with <see cref="NoiseCellMm"/>: a 14 m wavelength carrying
        /// 5.2 m of amplitude measured as a p95 slope of 39 degrees and
        /// blocked 37% of 25 m sightlines on relief smaller than the render
        /// grid. 110 m and 18 m give 3.4x the relief for 40% of the occlusion.
        /// </summary>
        public const int AmplitudeMm = 18_000;
        public const int WaterLevelMm = -550;
        public const int EyeHeightMm = 1_500;
        private const int SightClearanceMm = 220;
        private const int SightStepMm = 2_000;

        /// <summary>Coarsest noise octave; the dominant landform scale.</summary>
        private const int NoiseCellMm = 110_000;

        /// <summary>
        /// Finest noise octave, matched to the renderer's 4 m ground grid. A
        /// finer floor only produces sub-grid bumps the player never sees but
        /// that still clip the line-of-sight ray.
        /// </summary>
        private const int NoiseMinCellMm = 4_000;

        /// <summary>
        /// Narrowest transition a stamp may fall off over: two ground cells.
        /// Anything sharper is relief the ground mesh cannot carry, and the
        /// sim and the drawn surface then disagree about where the floor is.
        /// </summary>
        private const int MinStampEdgeMm = 8_000;

        /// <summary>
        /// Grid the authoritative height is quantised to. Must equal the
        /// renderer's ground cell size.
        /// </summary>
        public const int LatticeMm = 4_000;

        private const int Unit = 10_000;
        private const int RoadCamberMm = 180;
        private const int RoadEdgeMm = 8_000;
        private const int CourtEdgeMm = 8_000;
        private const int HighlandEdgeMm = 8_000;
        private const int PadRadiusMm = 7_000;
        private const int PadEdgeMm = 8_000;
        private const int ShopRadiusMm = 8_000;
        private const int MaxStampSegmentMm = 30_000;
        private const int RoadGridMm = 16_000;
        private const int InteriorHillMinReliefMm = 3_200;
        private const int InteriorHillMaxReliefMm = 8_500;
        private const int InteriorHillBaseShoulderMm = 24_000;
        private const int InteriorHillReliefPerWidthPerMille = 120;

        /// <summary>Steepest grade a road may hold, in per mille of run.</summary>
        private const int RoadMaxGradePerMille = 120;

        /// <summary>Relaxation sweeps over the route graph; fixed so the result is reproducible.</summary>
        private const int RoadRelaxSweeps = 24;

        private const int SpawnFairnessBandMm = 1_500;
        private const int SpawnPadMaxEdgeMm = 40_000;
        private const int RockPadLiftMm = 550;
        private const int RockMoatMm = -350;
        private const int MixFull = 1_000;

        private static readonly int TerrainSeed =
            (int)Convert.ToUInt32(MapGeometryCatalog.GeometryHash.Substring(0, 8), 16);

        private static StampIndex stamps;

        private static readonly Dictionary<long, int> LatticeCache = new Dictionary<long, int>();

        private static Dictionary<string, MapPointMmRecord> routeNodeCache;

        /// <summary>
        /// Authoritative walkable height, defined as the ground mesh's own
        /// triangle interpolation over the lattice.
        ///
        /// The quantisation is the point, not an optimisation: the renderer can
        /// only draw a mesh sampled on this grid, so relief finer than a cell
        /// would exist for the sim and not for the player.
        /// </summary>
        public static int HeightMm(int xMm, int zMm)
        {
            var cellX = FloorDiv(xMm, LatticeMm);
            var cellZ = FloorDiv(zMm, LatticeMm);
            var localX = xMm - (cellX * LatticeMm);
            var localZ = zMm - (cellZ * LatticeMm);

            // Corner names and the diagonal match the renderer's winding, which
            // emits triangles (a, b, c) and (a, c, d).
            var a = LatticeHeightMm(cellX, cellZ);
            var b = LatticeHeightMm(cellX, cellZ + 1);
            var c = LatticeHeightMm(cellX + 1, cellZ + 1);
            var d = LatticeHeightMm(cellX + 1, cellZ);
            if (localX <= localZ)
            {
                return a
                    + (int)(((long)(b - a) * localZ) / LatticeMm)
                    + (int)(((long)(c - b) * localX) / LatticeMm);
            }

            return a
                + (int)(((long)(d - a) * localX) / LatticeMm)
                + (int)(((long)(c - d) * localZ) / LatticeMm);
        }

        private static int LatticeHeightMm(int cellX, int cellZ)
        {
            var key = ((long)cellX * 1_000_003L) + cellZ;
            if (LatticeCache.TryGetValue(key, out var cached))
            {
                return cached;
            }

            var height = ContinuousHeightMm(cellX * LatticeMm, cellZ * LatticeMm);
            LatticeCache[key] = height;
            return height;
        }

        /// <summary>Relief before lattice quantisation. Stamp targets are authored against this.</summary>
        private static int ContinuousHeightMm(int xMm, int zMm)
        {
            var index = GetStamps();
            var height = HeightBeforeFeatures(xMm, zMm, index);
            height = ApplyCircleStamps(height, xMm, zMm, index.Features);
            height = ApplyCircleStamps(height, xMm, zMm, index.Bowls);

            // Roads are laid last on purpose: the corridor carries both
            // connectivity and sightlines along a route, so nothing below may
            // cut into it. Dens keep their hollows because they are dug beside
            // the route rather than on it (see DenCentreMm).
            height = ApplyRoadStamps(height, xMm, zMm, index);

            // Spawn fairness outranks the corridor: a road may not hand one of
            // the 30 starts a height advantage.
            height = ApplyCircleStamps(height, xMm, zMm, index.SpawnPads);
            // Boss compounds are built from several independently positioned
            // parts. Their common floor outranks roads so the corridor grade
            // cannot tear one compound into different elevations.
            height = ApplyCircleStamps(height, xMm, zMm, index.ArenaStamps);
            height = ApplyPolyStamps(height, xMm, zMm, index.Highlands);
            height = ApplyPolyStamps(height, xMm, zMm, index.Courts);
            return height;
        }

        public static bool BlocksLineOfSight(
            MapPointMmRecord start,
            MapPointMmRecord end,
            int eyeHeightMm = EyeHeightMm)
        {
            var startY = HeightMm((int)start.X, (int)start.Z) + eyeHeightMm;
            var endY = HeightMm((int)end.X, (int)end.Z) + eyeHeightMm;
            var deltaX = (int)(end.X - start.X);
            var deltaZ = (int)(end.Z - start.Z);
            var distanceMm = ISqrt(((long)deltaX * deltaX) + ((long)deltaZ * deltaZ));
            if (distanceMm <= SightStepMm)
            {
                return false;
            }

            for (var walked = SightStepMm; walked < distanceMm; walked += SightStepMm)
            {
                var x = (int)(start.X + (((long)deltaX * walked) / distanceMm));
                var z = (int)(start.Z + (((long)deltaZ * walked) / distanceMm));
                var rayY = startY + (int)(((long)(endY - startY) * walked) / distanceMm);
                if (HeightMm(x, z) + SightClearanceMm > rayY)
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Where a den's hollow is actually dug, given its authored anchor.
        ///
        /// Every one of the 48 nest anchors measures as sitting inside a route
        /// corridor: the compiled anchors are waypoints on the road network,
        /// not clearings in the wild. Sliding the hollow perpendicular to the
        /// nearest route keeps the road a road and gives the den real ground.
        /// </summary>
        public static MapPointMmRecord DenCentreMm(MapPointMmRecord anchor, int floorRadiusMm)
        {
            var nodes = RouteNodePositions();
            var bestDistance = long.MaxValue;
            var normalX = 0;
            var normalZ = 0;
            var halfWidthMm = 0;
            for (var index = 0; index < MapGeometryCatalog.RouteEdges.Length; index += 1)
            {
                var edge = MapGeometryCatalog.RouteEdges[index];
                if (!nodes.TryGetValue(edge.A, out var a) || !nodes.TryGetValue(edge.B, out var b))
                {
                    continue;
                }

                var distanceMm = (long)ISqrt(IntegerGeometry.DistanceSquaredToSegment(anchor, a, b));
                if (distanceMm >= bestDistance)
                {
                    continue;
                }

                var deltaX = (int)(b.X - a.X);
                var deltaZ = (int)(b.Z - a.Z);
                var lengthMm = ISqrt(((long)deltaX * deltaX) + ((long)deltaZ * deltaZ));
                if (lengthMm == 0)
                {
                    continue;
                }

                bestDistance = distanceMm;
                normalX = (int)((-(long)deltaZ * 1_000) / lengthMm);
                normalZ = (int)(((long)deltaX * 1_000) / lengthMm);
                halfWidthMm = (int)(edge.WidthMm / 2);
            }

            if (normalX == 0 && normalZ == 0)
            {
                return anchor;
            }

            var reachMm = halfWidthMm + MinStampEdgeMm + floorRadiusMm;
            var positive = new MapPointMmRecord(
                anchor.X + (((long)normalX * reachMm) / 1_000),
                anchor.Z + (((long)normalZ * reachMm) / 1_000));
            var negative = new MapPointMmRecord(
                anchor.X - (((long)normalX * reachMm) / 1_000),
                anchor.Z - (((long)normalZ * reachMm) / 1_000));
            return DistanceToRouteNetworkMm(negative) > DistanceToRouteNetworkMm(positive)
                ? negative
                : positive;
        }

        private static Dictionary<string, MapPointMmRecord> RouteNodePositions()
        {
            if (routeNodeCache != null)
            {
                return routeNodeCache;
            }

            var nodes = new Dictionary<string, MapPointMmRecord>(
                MapGeometryCatalog.RouteNodes.Length);
            for (var index = 0; index < MapGeometryCatalog.RouteNodes.Length; index += 1)
            {
                var node = MapGeometryCatalog.RouteNodes[index];
                nodes[node.Id] = node.Position;
            }

            routeNodeCache = nodes;
            return routeNodeCache;
        }

        private static long DistanceToRouteNetworkMm(MapPointMmRecord point)
        {
            var nodes = RouteNodePositions();
            var best = long.MaxValue;
            for (var index = 0; index < MapGeometryCatalog.RouteEdges.Length; index += 1)
            {
                var edge = MapGeometryCatalog.RouteEdges[index];
                if (!nodes.TryGetValue(edge.A, out var a) || !nodes.TryGetValue(edge.B, out var b))
                {
                    continue;
                }

                var distance = ISqrt(IntegerGeometry.DistanceSquaredToSegment(point, a, b))
                    - (int)(edge.WidthMm / 2);
                best = Math.Min(best, distance);
            }

            return best;
        }

        /// <summary>
        /// Graded surface height at each route node.
        ///
        /// A fixed number of sweeps pulls neighbouring nodes together until no
        /// edge exceeds the grade limit. Roads then interpolate between node
        /// heights instead of draping over the noise, so a road crossing a
        /// ridge cuts through it. Sweeps run in compiled edge order for a fixed
        /// count, so the result is a pure function of the map.
        /// </summary>
        private static Dictionary<string, int> RelaxRouteNodeHeights(
            Dictionary<string, MapPointMmRecord> nodes,
            HillStamp[] hills)
        {
            var heights = new Dictionary<string, int>(MapGeometryCatalog.RouteNodes.Length);
            for (var index = 0; index < MapGeometryCatalog.RouteNodes.Length; index += 1)
            {
                var node = MapGeometryCatalog.RouteNodes[index];
                heights[node.Id] = ApplyHillStamps(
                    BaseHeightMm((int)node.Position.X, (int)node.Position.Z),
                    (int)node.Position.X,
                    (int)node.Position.Z,
                    hills);
            }

            for (var sweep = 0; sweep < RoadRelaxSweeps; sweep += 1)
            {
                var adjusted = false;
                for (var index = 0; index < MapGeometryCatalog.RouteEdges.Length; index += 1)
                {
                    var edge = MapGeometryCatalog.RouteEdges[index];
                    if (!heights.TryGetValue(edge.A, out var heightA)
                        || !heights.TryGetValue(edge.B, out var heightB)
                        || !nodes.ContainsKey(edge.A))
                    {
                        continue;
                    }

                    var allowedMm = (int)((edge.LengthMm * (long)RoadMaxGradePerMille) / 1_000);
                    var delta = heightB - heightA;
                    var excess = Math.Abs(delta) - allowedMm;
                    if (excess <= 0)
                    {
                        continue;
                    }

                    // Split the correction across both ends, rounding away from
                    // zero so the sweep always makes progress on odd excesses.
                    var shift = (excess / 2) + (excess % 2);
                    if (delta > 0)
                    {
                        heights[edge.A] = heightA + shift;
                        heights[edge.B] = heightB - shift;
                    }
                    else
                    {
                        heights[edge.A] = heightA - shift;
                        heights[edge.B] = heightB + shift;
                    }

                    adjusted = true;
                }

                if (!adjusted)
                {
                    break;
                }
            }

            return heights;
        }

        private static HillStamp[] BuildInteriorHillStamps()
        {
            var pointsByWall = new Dictionary<string, List<MapPointMmRecord>>();
            var wallOrder = new List<string>();
            for (var index = 0; index < MapGeometryCatalog.WallPieces.Length; index += 1)
            {
                var piece = MapGeometryCatalog.WallPieces[index];
                if (piece.WallClass != "VAULT")
                {
                    continue;
                }

                if (!pointsByWall.TryGetValue(piece.WallId, out var points))
                {
                    points = new List<MapPointMmRecord>();
                    pointsByWall[piece.WallId] = points;
                    wallOrder.Add(piece.WallId);
                }

                points.AddRange(piece.Vertices);
            }

            var hills = new List<HillStamp>(wallOrder.Count);
            for (var wallIndex = 0; wallIndex < wallOrder.Count; wallIndex += 1)
            {
                var points = pointsByWall[wallOrder[wallIndex]];
                if (points.Count < 2)
                {
                    continue;
                }

                var axisStart = points[0];
                var axisEnd = points[0];
                long longestSquared = 0;
                for (var left = 0; left < points.Count; left += 1)
                {
                    var a = points[left];
                    for (var right = left + 1; right < points.Count; right += 1)
                    {
                        var b = points[right];
                        var dx = b.X - a.X;
                        var dz = b.Z - a.Z;
                        var distanceSquared = (dx * dx) + (dz * dz);
                        if (distanceSquared > longestSquared)
                        {
                            longestSquared = distanceSquared;
                            axisStart = a;
                            axisEnd = b;
                        }
                    }
                }

                var axisLengthMm = ISqrt(longestSquared);
                if (axisLengthMm <= 0)
                {
                    continue;
                }

                var axisXPerMille = (int)(((axisEnd.X - axisStart.X) * 1_000) / axisLengthMm);
                var axisZPerMille = (int)(((axisEnd.Z - axisStart.Z) * 1_000) / axisLengthMm);
                var minAlongMm = int.MaxValue;
                var maxAlongMm = int.MinValue;
                var minAcrossMm = int.MaxValue;
                var maxAcrossMm = int.MinValue;
                for (var pointIndex = 0; pointIndex < points.Count; pointIndex += 1)
                {
                    var point = points[pointIndex];
                    var dx = point.X - axisStart.X;
                    var dz = point.Z - axisStart.Z;
                    var alongMm = (int)(((dx * axisXPerMille) + (dz * axisZPerMille)) / 1_000);
                    var acrossMm = (int)(((-dx * axisZPerMille) + (dz * axisXPerMille)) / 1_000);
                    minAlongMm = Math.Min(minAlongMm, alongMm);
                    maxAlongMm = Math.Max(maxAlongMm, alongMm);
                    minAcrossMm = Math.Min(minAcrossMm, acrossMm);
                    maxAcrossMm = Math.Max(maxAcrossMm, acrossMm);
                }

                var centerAlongMm = (minAlongMm + maxAlongMm) / 2;
                var centerAcrossMm = (minAcrossMm + maxAcrossMm) / 2;
                var halfAlongMm = Math.Max(LatticeMm, (maxAlongMm - minAlongMm) / 2);
                var halfAcrossMm = Math.Max(LatticeMm, (maxAcrossMm - minAcrossMm) / 2);
                var reliefMm = Math.Max(
                    InteriorHillMinReliefMm,
                    Math.Min(
                        InteriorHillMaxReliefMm,
                        (int)(((long)halfAcrossMm * 2 * InteriorHillReliefPerWidthPerMille) / 1_000)));

                hills.Add(new HillStamp(
                    (int)(axisStart.X +
                        (((long)axisXPerMille * centerAlongMm -
                          (long)axisZPerMille * centerAcrossMm) / 1_000)),
                    (int)(axisStart.Z +
                        (((long)axisZPerMille * centerAlongMm +
                          (long)axisXPerMille * centerAcrossMm) / 1_000)),
                    axisXPerMille,
                    axisZPerMille,
                    halfAlongMm + InteriorHillBaseShoulderMm,
                    halfAcrossMm + InteriorHillBaseShoulderMm,
                    reliefMm));
            }

            return hills.ToArray();
        }

        private static StampIndex GetStamps()
        {
            if (stamps != null)
            {
                return stamps;
            }

            var hills = BuildInteriorHillStamps();
            var nodes = RouteNodePositions();
            var nodeHeights = RelaxRouteNodeHeights(nodes, hills);

            var roads = new List<SegmentStamp>();
            for (var index = 0; index < MapGeometryCatalog.RouteEdges.Length; index += 1)
            {
                var edge = MapGeometryCatalog.RouteEdges[index];
                if (!nodes.TryGetValue(edge.A, out var a) || !nodes.TryGetValue(edge.B, out var b))
                {
                    continue;
                }

                var heightA = nodeHeights.TryGetValue(edge.A, out var ha)
                    ? ha
                    : BaseHeightMm((int)a.X, (int)a.Z);
                var heightB = nodeHeights.TryGetValue(edge.B, out var hb)
                    ? hb
                    : BaseHeightMm((int)b.X, (int)b.Z);
                var halfWidthMm = (int)(edge.WidthMm / 2) + 1_000;
                var parts = SubdivideSegment(a, b);
                for (var part = 0; part < parts.Count; part += 1)
                {
                    roads.Add(new SegmentStamp(
                        parts[part].Item1,
                        parts[part].Item2,
                        halfWidthMm,
                        BandLimitEdge(RoadEdgeMm),
                        heightA + (int)(((long)(heightB - heightA) * part) / parts.Count),
                        heightA + (int)(((long)(heightB - heightA) * (part + 1)) / parts.Count)));
                }
            }

            var roadCells = new Dictionary<long, List<int>>();
            for (var roadIndex = 0; roadIndex < roads.Count; roadIndex += 1)
            {
                var road = roads[roadIndex];
                var pad = road.HalfWidthMm + road.EdgeMm;
                var minX = (int)Math.Min(road.A.X, road.B.X) - pad;
                var maxX = (int)Math.Max(road.A.X, road.B.X) + pad;
                var minZ = (int)Math.Min(road.A.Z, road.B.Z) - pad;
                var maxZ = (int)Math.Max(road.A.Z, road.B.Z) + pad;
                var minCellX = FloorDiv(minX, RoadGridMm);
                var maxCellX = FloorDiv(maxX, RoadGridMm);
                var minCellZ = FloorDiv(minZ, RoadGridMm);
                var maxCellZ = FloorDiv(maxZ, RoadGridMm);
                for (var cellX = minCellX; cellX <= maxCellX; cellX += 1)
                {
                    for (var cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1)
                    {
                        var key = CellKey(cellX, cellZ);
                        if (!roadCells.TryGetValue(key, out var bucket))
                        {
                            bucket = new List<int>();
                            roadCells[key] = bucket;
                        }

                        bucket.Add(roadIndex);
                    }
                }
            }

            var spawnBases = new int[MapGeometryCatalog.SpawnPoints.Length];
            for (var index = 0; index < MapGeometryCatalog.SpawnPoints.Length; index += 1)
            {
                var spawn = MapGeometryCatalog.SpawnPoints[index];
                spawnBases[index] = ApplyHillStamps(
                    BaseHeightMm((int)spawn.Position.X, (int)spawn.Position.Z),
                    (int)spawn.Position.X,
                    (int)spawn.Position.Z,
                    hills);
            }

            var spawnMedianMm = MedianOf(spawnBases);
            var spawnPads = new CircleStamp[MapGeometryCatalog.SpawnPoints.Length];
            for (var index = 0; index < MapGeometryCatalog.SpawnPoints.Length; index += 1)
            {
                var spawn = MapGeometryCatalog.SpawnPoints[index];
                var groundMm = spawnBases[index];

                // Nobody starts the match looking down on the other 29. The
                // approach is only as long as the correction needs at road
                // grade: a fixed long skirt made every pad a 47 m radius
                // terrain modifier that swamped the graded corridors past it.
                var targetMm = ClampToBand(groundMm, spawnMedianMm, SpawnFairnessBandMm);
                var rampMm = (int)((Math.Abs((long)targetMm - groundMm) * 1_000) / RoadMaxGradePerMille);
                spawnPads[index] = new CircleStamp(
                    (int)spawn.Position.X,
                    (int)spawn.Position.Z,
                    PadRadiusMm,
                    Math.Min(SpawnPadMaxEdgeMm, BandLimitEdge(rampMm)),
                    targetMm);
            }

            var shopPads = new CircleStamp[MapGeometryCatalog.Shops.Length];
            for (var index = 0; index < MapGeometryCatalog.Shops.Length; index += 1)
            {
                var shop = MapGeometryCatalog.Shops[index];
                shopPads[index] = new CircleStamp(
                    (int)shop.Position.X,
                    (int)shop.Position.Z,
                    ShopRadiusMm,
                    BandLimitEdge(PadEdgeMm),
                    ApplyHillStamps(
                        BaseHeightMm((int)shop.Position.X, (int)shop.Position.Z),
                        (int)shop.Position.X,
                        (int)shop.Position.Z,
                        hills));
            }

            var courts = new PolyStamp[MapGeometryCatalog.Courts.Length];
            for (var index = 0; index < MapGeometryCatalog.Courts.Length; index += 1)
            {
                var court = MapGeometryCatalog.Courts[index];
                courts[index] = new PolyStamp(court.HexVertices, 0, CourtEdgeMm);
            }

            var highlands = new PolyStamp[MapGeometryCatalog.Highlands.Length];
            for (var index = 0; index < MapGeometryCatalog.Highlands.Length; index += 1)
            {
                var highland = MapGeometryCatalog.Highlands[index];
                highlands[index] = new PolyStamp(
                    highland.Vertices,
                    (int)highland.TopHeightMm,
                    HighlandEdgeMm);
            }

            var draft = new StampIndex(
                hills,
                roads,
                roadCells,
                courts,
                highlands,
                shopPads,
                spawnPads,
                Array.Empty<CircleStamp>(),
                Array.Empty<CircleStamp>(),
                Array.Empty<CircleStamp>());

            var features = new List<CircleStamp>();
            var bowls = new List<CircleStamp>();
            var arenaStamps = new List<CircleStamp>();

            // 24 伏石圈 read as raised daises rather than discs pressed into the
            // ground: a flat lifted pad for the stones, ringed by a worn trench.
            for (var index = 0; index < MapGeometryCatalog.Rocks.Length; index += 1)
            {
                var rock = MapGeometryCatalog.Rocks[index];
                var x = (int)rock.Position.X;
                var z = (int)rock.Position.Z;
                var groundMm = TerraceAt(draft, features, x, z, 7_000, 8_000, RockPadLiftMm);
                bowls.Add(new CircleStamp(x, z, 10_500, BandLimitEdge(0), groundMm + RockMoatMm));
                bowls.Add(new CircleStamp(x, z, 7_000, BandLimitEdge(0), groundMm + RockPadLiftMm));
            }

            // 48 nests become real bowls with a lip. Depth grows toward the
            // inner band so a den's danger reads from its silhouette alone.
            for (var index = 0; index < MapGeometryCatalog.Nests.Length; index += 1)
            {
                var nest = MapGeometryCatalog.Nests[index];
                var inner = nest.Band == "内";
                var mid = nest.Band == "中";
                var floorRadiusMm = inner ? 8_000 : mid ? 7_000 : 6_000;
                var centre = DenCentreMm(nest.BasePoint, floorRadiusMm);
                var x = (int)centre.X;
                var z = (int)centre.Z;
                var groundMm = TerraceAt(
                    draft,
                    features,
                    x,
                    z,
                    inner ? 12_000 : mid ? 10_500 : 9_000,
                    8_000,
                    0);
                DenAt(
                    draft,
                    bowls,
                    x,
                    z,
                    groundMm,
                    floorRadiusMm,
                    inner ? -4_000 : mid ? -2_800 : -1_800,
                    inner ? 1_200 : mid ? 900 : 600);
            }

            for (var index = 0; index < MapGeometryCatalog.Pigs.Length; index += 1)
            {
                var pig = MapGeometryCatalog.Pigs[index];
                var centre = DenCentreMm(pig.Position, 6_500);
                var x = (int)centre.X;
                var z = (int)centre.Z;
                var groundMm = TerraceAt(draft, features, x, z, 12_000, 8_000, 0);
                DenAt(draft, bowls, x, z, groundMm, 6_500, -2_200, 700);
            }

            // Boss sites stop being flat discs and become arenas: a sunken
            // floor walled by its own rim, which makes them legible outside.
            for (var index = 0; index < MapGeometryCatalog.Dragons.Length; index += 1)
            {
                var dragon = MapGeometryCatalog.Dragons[index];
                var x = (int)dragon.Position.X;
                var z = (int)dragon.Position.Z;
                var groundMm = TerraceAt(draft, arenaStamps, x, z, 14_500, 8_000, 0);
                DenAt(draft, arenaStamps, x, z, groundMm, 16_000, -5_000, 2_000);
                arenaStamps.Add(new CircleStamp(
                    x,
                    z,
                    22_000,
                    BandLimitEdge(0),
                    groundMm - 5_000));
            }

            for (var index = 0; index < MapGeometryCatalog.Elites.Length; index += 1)
            {
                var elite = MapGeometryCatalog.Elites[index];
                var x = (int)elite.Position.X;
                var z = (int)elite.Position.Z;
                var groundMm = TerraceAt(draft, arenaStamps, x, z, 12_500, 8_000, 0);
                DenAt(draft, arenaStamps, x, z, groundMm, 13_000, -3_500, 1_500);
                arenaStamps.Add(new CircleStamp(
                    x,
                    z,
                    17_000,
                    BandLimitEdge(0),
                    groundMm - 3_500));
            }

            stamps = new StampIndex(
                hills,
                roads,
                roadCells,
                courts,
                highlands,
                shopPads,
                spawnPads,
                arenaStamps.ToArray(),
                features.ToArray(),
                bowls.ToArray());
            return stamps;
        }

        /// <summary>Level a disc onto the surrounding hillside, optionally lifting or sinking it.</summary>
        private static int TerraceAt(
            StampIndex draft,
            List<CircleStamp> features,
            int x,
            int z,
            int radiusMm,
            int edgeMm,
            int liftMm)
        {
            var groundMm = HeightBeforeFeatures(x, z, draft);
            features.Add(new CircleStamp(x, z, radiusMm, BandLimitEdge(edgeMm), groundMm + liftMm));
            return groundMm;
        }

        /// <summary>
        /// A hollow with a raised lip. Order does the work of a ring stamp: the
        /// berm covers the whole disc first, then the floor overwrites its
        /// interior, leaving the lip standing as a rim.
        /// </summary>
        private static void DenAt(
            StampIndex draft,
            List<CircleStamp> bowls,
            int x,
            int z,
            int groundMm,
            int floorRadiusMm,
            int floorMm,
            int bermMm)
        {
            if (InsideHighland(x, z, draft))
            {
                return;
            }

            var wallMm = BandLimitEdge(0);
            if (bermMm != 0)
            {
                bowls.Add(new CircleStamp(
                    x,
                    z,
                    floorRadiusMm + wallMm + 3_000,
                    wallMm,
                    groundMm + bermMm));
            }

            bowls.Add(new CircleStamp(x, z, floorRadiusMm, wallMm, groundMm + floorMm));
        }

        private static int HeightBeforeFeatures(int xMm, int zMm, StampIndex index)
        {
            var height = BaseHeightMm(xMm, zMm);
            height = ApplyHillStamps(height, xMm, zMm, index.Hills);
            height = ApplyCircleStamps(height, xMm, zMm, index.ShopPads);
            return height;
        }

        private static bool InsideHighland(int xMm, int zMm, StampIndex index)
        {
            var point = new MapPointMmRecord(xMm, zMm);
            for (var index2 = 0; index2 < index.Highlands.Length; index2 += 1)
            {
                if (IntegerGeometry.RingContainsPoint(index.Highlands[index2].Vertices, point))
                {
                    return true;
                }
            }

            return false;
        }

        private static int BaseHeightMm(int xMm, int zMm)
        {
            var warp = WarpedUnit(xMm, zMm, TerrainSeed);
            var centered = warp - 5_000;
            var ridge = RidgeUnit(xMm, zMm, TerrainSeed + 5_000);
            var hi = SmoothRange(centered, 1_000, 4_500);
            var rolling = (int)(((long)centered * (Unit - (((long)hi * 5_000) / Unit))) / Unit);
            var peaks = (int)(((long)ridge * (((long)hi * 9_000) / Unit)) / Unit);
            return (int)((((long)rolling + peaks) * AmplitudeMm) / 5_000);
        }

        private static int WarpedUnit(int xMm, int zMm, int seed)
        {
            var qx = FbmUnit(xMm, zMm, seed + 1_000, 3);
            var qy = FbmUnit(xMm + 5_200, zMm + 1_300, seed + 2_000, 3);
            var warpedX = xMm + (int)((12_000L * (qx - 5_000)) / Unit);
            var warpedZ = zMm + (int)((12_000L * (qy - 5_000)) / Unit);
            return FbmUnit(warpedX, warpedZ, seed + 3_000, 5);
        }

        private static int FbmUnit(int xMm, int zMm, int seed, int octaves)
        {
            var sum = 0L;
            var norm = 0L;
            var amplitude = Unit;
            var cell = NoiseCellMm;
            for (var octave = 0; octave < octaves; octave += 1)
            {
                sum += ((long)ValueNoiseUnit(xMm, zMm, cell, seed + (octave * 1_013)) * amplitude)
                    / Unit;
                norm += amplitude;
                amplitude /= 2;
                cell = Math.Max(NoiseMinCellMm, cell / 2);
            }

            return norm == 0 ? 5_000 : (int)((sum * Unit) / norm);
        }

        private static int RidgeUnit(int xMm, int zMm, int seed)
        {
            var sum = 0L;
            var norm = 0L;
            var amplitude = (long)Unit;
            var cell = (int)((NoiseCellMm * 25L) / 10L);
            var signal = (long)Unit;
            for (var octave = 0; octave < 4; octave += 1)
            {
                var n = ValueNoiseUnit(xMm, zMm, cell, seed + (octave * 777));
                var ridge = Unit - Math.Abs((2 * n) - Unit);
                var squared = ((long)ridge * ridge) / Unit;
                var weighted = (squared * amplitude * signal) / ((long)Unit * Unit);
                sum += weighted;
                norm += (amplitude * signal) / Unit;
                signal = squared;
                amplitude /= 2;
                cell = Math.Max(NoiseMinCellMm, (int)(((long)cell * 10) / 21));
            }

            return norm == 0 ? 0 : (int)((sum * Unit) / norm);
        }

        private static int ValueNoiseUnit(int xMm, int zMm, int cellMm, int seed)
        {
            var cellX = FloorDiv(xMm, cellMm);
            var cellZ = FloorDiv(zMm, cellMm);
            var localX = xMm - (cellX * cellMm);
            var localZ = zMm - (cellZ * cellMm);
            var u = Smoothstep(localX, cellMm);
            var v = Smoothstep(localZ, cellMm);
            var a = HashUnit(cellX, cellZ, seed);
            var b = HashUnit(cellX + 1, cellZ, seed);
            var c = HashUnit(cellX, cellZ + 1, seed);
            var d = HashUnit(cellX + 1, cellZ + 1, seed);
            return Lerp(Lerp(a, b, u, cellMm), Lerp(c, d, u, cellMm), v, cellMm);
        }

        private static uint Hash2(int x, int y, int seed)
        {
            unchecked
            {
                var hash = (x * 374761393) + (y * 668265263) + (seed * 1274126177);
                hash = (hash ^ (int)((uint)hash >> 13)) * 1274126177;
                hash ^= (int)((uint)hash >> 16);
                return (uint)hash;
            }
        }

        private static int HashUnit(int x, int y, int seed)
        {
            return (int)(((ulong)Hash2(x, y, seed) * Unit) / 4_294_967_296UL);
        }

        private static int Smoothstep(int t, int denom)
        {
            if (t <= 0)
            {
                return 0;
            }

            if (t >= denom)
            {
                return denom;
            }

            return (int)(((long)t * t * ((3L * denom) - (2L * t))) / ((long)denom * denom));
        }

        private static int SmoothRange(int value, int edge0, int edge1)
        {
            if (value <= edge0)
            {
                return 0;
            }

            if (value >= edge1)
            {
                return Unit;
            }

            var t = (int)(((long)(value - edge0) * Unit) / (edge1 - edge0));
            return (int)(((long)t * t * ((3L * Unit) - (2L * t))) / ((long)Unit * Unit));
        }

        private static int Lerp(int a, int b, int t, int denom)
        {
            return a + (int)(((long)(b - a) * t) / denom);
        }

        private static int MixToward(int current, int target, int weight)
        {
            if (weight <= 0)
            {
                return current;
            }

            if (weight >= MixFull)
            {
                return target;
            }

            return current + (int)(((long)(target - current) * weight) / MixFull);
        }

        /// <summary>Widen any stamp falloff the 4 m ground mesh could not represent.</summary>
        private static int BandLimitEdge(int edgeMm)
        {
            return Math.Max(MinStampEdgeMm, edgeMm);
        }

        private static int MedianOf(int[] values)
        {
            if (values.Length == 0)
            {
                return 0;
            }

            var sorted = (int[])values.Clone();
            Array.Sort(sorted);
            var middle = sorted.Length >> 1;
            return sorted.Length % 2 == 1
                ? sorted[middle]
                : (int)(((long)sorted[middle - 1] + sorted[middle]) / 2);
        }

        private static int ClampToBand(int value, int centre, int bandMm)
        {
            return Math.Max(centre - bandMm, Math.Min(centre + bandMm, value));
        }

        private static int StampWeight(int distanceMm, int innerMm, int edgeMm)
        {
            if (distanceMm <= innerMm)
            {
                return MixFull;
            }

            var outer = innerMm + edgeMm;
            if (distanceMm >= outer)
            {
                return 0;
            }

            return (int)((1_000L * (outer - distanceMm)) / edgeMm);
        }

        private static int ApplyHillStamps(int height, int xMm, int zMm, HillStamp[] hills)
        {
            var highestRiseMm = 0;
            for (var index = 0; index < hills.Length; index += 1)
            {
                var hill = hills[index];
                var dx = (long)xMm - hill.CenterX;
                var dz = (long)zMm - hill.CenterZ;
                var alongMm = Math.Abs(
                    (int)(((dx * hill.AxisXPerMille) + (dz * hill.AxisZPerMille)) / 1_000));
                var acrossMm = Math.Abs(
                    (int)(((-dx * hill.AxisZPerMille) + (dz * hill.AxisXPerMille)) / 1_000));
                if (alongMm >= hill.RadiusAlongMm || acrossMm >= hill.RadiusAcrossMm)
                {
                    continue;
                }

                var alongPerMille = (alongMm * 1_000) / hill.RadiusAlongMm;
                var acrossPerMille = (acrossMm * 1_000) / hill.RadiusAcrossMm;
                var radialSquared =
                    (alongPerMille * alongPerMille) + (acrossPerMille * acrossPerMille);
                if (radialSquared >= 1_000_000)
                {
                    continue;
                }

                var radialPerMille = ISqrt(radialSquared);
                var weightPerMille = 1_000 - Smoothstep(radialPerMille, 1_000);
                highestRiseMm = Math.Max(
                    highestRiseMm,
                    (hill.ReliefMm * weightPerMille) / 1_000);
            }

            return height + highestRiseMm;
        }

        private static int ApplyPolyStamps(int height, int xMm, int zMm, PolyStamp[] polys)
        {
            var output = height;
            var point = new MapPointMmRecord(xMm, zMm);
            for (var index = 0; index < polys.Length; index += 1)
            {
                var poly = polys[index];
                var inside = IntegerGeometry.RingContainsPoint(poly.Vertices, point);
                var distanceMm = inside ? 0 : DistanceToRingMm(point, poly.Vertices);
                output = MixToward(output, poly.TargetMm, StampWeight(distanceMm, 0, poly.EdgeMm));
            }

            return output;
        }

        /// <summary>
        /// Corridors overlap wherever routes meet. Blending every corridor that
        /// covers this point by weight keeps junctions smooth and makes the
        /// result independent of traversal order; mixing them one after another
        /// let the last corridor win outright and left steps in the surface.
        /// </summary>
        private static int ApplyRoadStamps(int height, int xMm, int zMm, StampIndex index)
        {
            var cellX = FloorDiv(xMm, RoadGridMm);
            var cellZ = FloorDiv(zMm, RoadGridMm);
            var seen = new HashSet<int>();
            var point = new MapPointMmRecord(xMm, zMm);
            var weightSum = 0L;
            var targetSum = 0L;
            for (var offsetX = -1; offsetX <= 1; offsetX += 1)
            {
                for (var offsetZ = -1; offsetZ <= 1; offsetZ += 1)
                {
                    if (!index.RoadCells.TryGetValue(
                            CellKey(cellX + offsetX, cellZ + offsetZ),
                            out var bucket))
                    {
                        continue;
                    }

                    for (var item = 0; item < bucket.Count; item += 1)
                    {
                        var roadIndex = bucket[item];
                        if (!seen.Add(roadIndex))
                        {
                            continue;
                        }

                        var road = index.Roads[roadIndex];
                        SegmentProjection(
                            point,
                            road.A,
                            road.B,
                            out var distanceMm,
                            out var alongPerMille);
                        var weight = StampWeight(distanceMm, road.HalfWidthMm, road.EdgeMm);
                        if (weight <= 0)
                        {
                            continue;
                        }

                        var gradedMm = road.TargetAMm
                            + (int)(((long)(road.TargetBMm - road.TargetAMm) * alongPerMille)
                                / 1_000);
                        weightSum += weight;
                        targetSum += (long)weight * (gradedMm + RoadCamberMm);
                    }
                }
            }

            if (weightSum <= 0)
            {
                return height;
            }

            return MixToward(
                height,
                (int)(targetSum / weightSum),
                (int)Math.Min(MixFull, weightSum));
        }

        private static int ApplyCircleStamps(int height, int xMm, int zMm, CircleStamp[] circles)
        {
            var output = height;
            for (var index = 0; index < circles.Length; index += 1)
            {
                var circle = circles[index];
                var dx = (long)(xMm - circle.X);
                var dz = (long)(zMm - circle.Z);
                var distanceMm = ISqrt((dx * dx) + (dz * dz));
                output = MixToward(
                    output,
                    circle.TargetMm,
                    StampWeight(distanceMm, circle.RadiusMm, circle.EdgeMm));
            }

            return output;
        }

        /// <summary>Distance to a segment plus how far along it the closest point lies, per mille.</summary>
        private static void SegmentProjection(
            MapPointMmRecord point,
            MapPointMmRecord start,
            MapPointMmRecord end,
            out int distanceMm,
            out int alongPerMille)
        {
            var deltaX = end.X - start.X;
            var deltaZ = end.Z - start.Z;
            var lengthSquared = (deltaX * deltaX) + (deltaZ * deltaZ);
            if (lengthSquared == 0)
            {
                var dx0 = point.X - start.X;
                var dz0 = point.Z - start.Z;
                distanceMm = ISqrt((dx0 * dx0) + (dz0 * dz0));
                alongPerMille = 0;
                return;
            }

            var projection = Math.Max(
                0L,
                Math.Min(
                    lengthSquared,
                    ((point.X - start.X) * deltaX) + ((point.Z - start.Z) * deltaZ)));
            var closestX = start.X + ((deltaX * projection) / lengthSquared);
            var closestZ = start.Z + ((deltaZ * projection) / lengthSquared);
            var dx = point.X - closestX;
            var dz = point.Z - closestZ;
            distanceMm = ISqrt((dx * dx) + (dz * dz));
            alongPerMille = (int)((projection * 1_000) / lengthSquared);
        }

        private static List<Tuple<MapPointMmRecord, MapPointMmRecord>> SubdivideSegment(
            MapPointMmRecord a,
            MapPointMmRecord b)
        {
            var parts = new List<Tuple<MapPointMmRecord, MapPointMmRecord>>();
            var span = Math.Max(Math.Abs(b.X - a.X), Math.Abs(b.Z - a.Z));
            var chunks = (int)Math.Max(1, (span + MaxStampSegmentMm - 1) / MaxStampSegmentMm);
            if (chunks == 1)
            {
                parts.Add(Tuple.Create(a, b));
                return parts;
            }

            for (var chunk = 0; chunk < chunks; chunk += 1)
            {
                var start = new MapPointMmRecord(
                    a.X + (((b.X - a.X) * chunk) / chunks),
                    a.Z + (((b.Z - a.Z) * chunk) / chunks));
                var end = chunk + 1 == chunks
                    ? b
                    : new MapPointMmRecord(
                        a.X + (((b.X - a.X) * (chunk + 1)) / chunks),
                        a.Z + (((b.Z - a.Z) * (chunk + 1)) / chunks));
                parts.Add(Tuple.Create(start, end));
            }

            return parts;
        }

        private static int DistanceToRingMm(MapPointMmRecord point, MapPointMmRecord[] ring)
        {
            var best = long.MaxValue;
            for (var index = 0; index < ring.Length; index += 1)
            {
                var a = ring[index];
                var b = ring[(index + 1) % ring.Length];
                best = Math.Min(best, IntegerGeometry.DistanceSquaredToSegment(point, a, b));
            }

            return ISqrt(best);
        }

        private static int FloorDiv(int value, int denom)
        {
            var quotient = value / denom;
            var remainder = value % denom;
            if (remainder != 0 && value < 0)
            {
                quotient -= 1;
            }

            return quotient;
        }

        private static long CellKey(int cellX, int cellZ)
        {
            return (cellX * 100_003L) + cellZ;
        }

        private static int ISqrt(long value)
        {
            if (value <= 0)
            {
                return 0;
            }

            return (int)Math.Sqrt(value);
        }

        private sealed class StampIndex
        {
            public StampIndex(
                HillStamp[] hills,
                List<SegmentStamp> roads,
                Dictionary<long, List<int>> roadCells,
                PolyStamp[] courts,
                PolyStamp[] highlands,
                CircleStamp[] shopPads,
                CircleStamp[] spawnPads,
                CircleStamp[] arenaStamps,
                CircleStamp[] features,
                CircleStamp[] bowls)
            {
                Hills = hills;
                Roads = roads;
                RoadCells = roadCells;
                Courts = courts;
                Highlands = highlands;
                ShopPads = shopPads;
                SpawnPads = spawnPads;
                ArenaStamps = arenaStamps;
                Features = features;
                Bowls = bowls;
            }

            public HillStamp[] Hills { get; }

            public List<SegmentStamp> Roads { get; }

            public Dictionary<long, List<int>> RoadCells { get; }

            public PolyStamp[] Courts { get; }

            public PolyStamp[] Highlands { get; }

            /// <summary>Stall levelling, laid before roads so a graded corridor still wins.</summary>
            public CircleStamp[] ShopPads { get; }

            /// <summary>Spawn fairness, laid after roads because it is a guarantee, not dressing.</summary>
            public CircleStamp[] SpawnPads { get; }

            /// <summary>Boss compounds, laid after roads so every part shares one floor.</summary>
            public CircleStamp[] ArenaStamps { get; }

            public CircleStamp[] Features { get; }

            public CircleStamp[] Bowls { get; }
        }

        private readonly struct HillStamp
        {
            public HillStamp(
                int centerX,
                int centerZ,
                int axisXPerMille,
                int axisZPerMille,
                int radiusAlongMm,
                int radiusAcrossMm,
                int reliefMm)
            {
                CenterX = centerX;
                CenterZ = centerZ;
                AxisXPerMille = axisXPerMille;
                AxisZPerMille = axisZPerMille;
                RadiusAlongMm = radiusAlongMm;
                RadiusAcrossMm = radiusAcrossMm;
                ReliefMm = reliefMm;
            }

            public int CenterX { get; }

            public int CenterZ { get; }

            public int AxisXPerMille { get; }

            public int AxisZPerMille { get; }

            public int RadiusAlongMm { get; }

            public int RadiusAcrossMm { get; }

            public int ReliefMm { get; }
        }

        private readonly struct SegmentStamp
        {
            public SegmentStamp(
                MapPointMmRecord a,
                MapPointMmRecord b,
                int halfWidthMm,
                int edgeMm,
                int targetAMm,
                int targetBMm)
            {
                A = a;
                B = b;
                HalfWidthMm = halfWidthMm;
                EdgeMm = edgeMm;
                TargetAMm = targetAMm;
                TargetBMm = targetBMm;
            }

            public MapPointMmRecord A { get; }

            public MapPointMmRecord B { get; }

            public int HalfWidthMm { get; }

            public int EdgeMm { get; }

            /// <summary>Graded surface at each end; the road lerps between them along its run.</summary>
            public int TargetAMm { get; }

            public int TargetBMm { get; }
        }

        private readonly struct PolyStamp
        {
            public PolyStamp(MapPointMmRecord[] vertices, int targetMm, int edgeMm)
            {
                Vertices = vertices;
                TargetMm = targetMm;
                EdgeMm = edgeMm;
            }

            public MapPointMmRecord[] Vertices { get; }

            public int TargetMm { get; }

            public int EdgeMm { get; }
        }

        private readonly struct CircleStamp
        {
            public CircleStamp(int x, int z, int radiusMm, int edgeMm, int targetMm)
            {
                X = x;
                Z = z;
                RadiusMm = radiusMm;
                EdgeMm = edgeMm;
                TargetMm = targetMm;
            }

            public int X { get; }

            public int Z { get; }

            public int RadiusMm { get; }

            public int EdgeMm { get; }

            public int TargetMm { get; }
        }
    }
}
