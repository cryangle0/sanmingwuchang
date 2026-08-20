using System.Collections.Generic;
using System.IO;
using Jwgb.Content;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using UnityEngine;

namespace Jwgb.Tests
{
    /// <summary>
    /// Cross-language parity: the C# MapCollisionField must answer every
    /// TypeScript-exported geometry query with an identical result.
    /// </summary>
    public sealed class MapGeometryParityTests
    {
        private MapFixtureDocument fixture;
        private MapCollisionField field;

        [OneTimeSetUp]
        public void LoadFixture()
        {
            var fixturePath = Path.GetFullPath(
                Path.Combine(
                    Application.dataPath,
                    "..",
                    "..",
                    "migration",
                    "fixtures",
                    "map-v1.json"));
            Assert.That(File.Exists(fixturePath), Is.True, fixturePath);
            fixture = JsonUtility.FromJson<MapFixtureDocument>(
                File.ReadAllText(fixturePath));
            field = new MapCollisionField(
                MapGeometryCatalog.GeometryHash,
                MapGeometryCatalog.Boundary,
                MapGeometryCatalog.WallPieces);
        }

        [Test]
        public void CatalogMatchesFixtureContract()
        {
            Assert.That(fixture.schema, Is.EqualTo("jwgb.map.fixture.v1"));
            Assert.That(
                MapGeometryCatalog.GeometryHash,
                Is.EqualTo(fixture.geometryHash));
            Assert.That(
                MapGeometryCatalog.Boundary.Length,
                Is.EqualTo(fixture.boundaryVertexCount));
            Assert.That(
                MapGeometryCatalog.WallPieces.Length,
                Is.EqualTo(fixture.wallPieceCount));
            Assert.That(
                MapGeometryCatalog.SpawnPoints.Length,
                Is.EqualTo(fixture.spawnPointCount));
        }

        [Test]
        public void BlockedQueriesMatchTypeScript()
        {
            Assert.That(fixture.blockedQueries.Length, Is.GreaterThan(0));
            foreach (var query in fixture.blockedQueries)
            {
                var point = new MapPointMmRecord(query.x, query.z);
                Assert.That(
                    field.IsCircleInsideBoundary(point, query.radiusMm),
                    Is.EqualTo(query.insideBoundary),
                    $"insideBoundary({query.x}, {query.z})");
                Assert.That(
                    field.FirstWallPieceAt(point, query.radiusMm) ?? string.Empty,
                    Is.EqualTo(query.wallPieceId),
                    $"wallPieceAt({query.x}, {query.z})");
            }
        }

        [Test]
        public void MovementResolutionMatchesTypeScript()
        {
            Assert.That(fixture.movementQueries.Length, Is.GreaterThan(0));
            foreach (var query in fixture.movementQueries)
            {
                var result = field.ResolveMovement(
                    new MapPointMmRecord(query.fromX, query.fromZ),
                    new MapPointMmRecord(query.toX, query.toZ),
                    query.radiusMm);
                Assert.That(
                    result.X,
                    Is.EqualTo(query.resultX),
                    $"move({query.fromX},{query.fromZ})->({query.toX},{query.toZ}).x");
                Assert.That(
                    result.Z,
                    Is.EqualTo(query.resultZ),
                    $"move({query.fromX},{query.fromZ})->({query.toX},{query.toZ}).z");
            }
        }

        [Test]
        public void SweepContactsMatchTypeScript()
        {
            Assert.That(fixture.sweepQueries.Length, Is.GreaterThan(0));
            foreach (var query in fixture.sweepQueries)
            {
                var hit = field.TrySweepCircleFirstWallContact(
                    new MapPointMmRecord(query.startX, query.startZ),
                    new MapPointMmRecord(query.endX, query.endZ),
                    query.sweepDistanceMm,
                    query.radiusMm,
                    out var distanceMm,
                    out var pieceId);
                Assert.That(
                    hit,
                    Is.EqualTo(query.hit),
                    $"sweep({query.startX},{query.startZ})");
                if (query.hit)
                {
                    Assert.That(
                        distanceMm,
                        Is.EqualTo(query.distanceMm),
                        $"sweep({query.startX},{query.startZ}).distance");
                    Assert.That(
                        pieceId,
                        Is.EqualTo(query.pieceId),
                        $"sweep({query.startX},{query.startZ}).piece");
                }
            }
        }

        /// <summary>
        /// Traversal permissions are compiled data, not a height inference, so
        /// every piece must agree with its authored wall class and with the
        /// shared predicate in wall-traversal.ts.
        /// </summary>
        [Test]
        public void WallPassabilityIsExplicitCatalogData()
        {
            Assert.That(MapGeometryCatalog.WallPieces.Length, Is.GreaterThan(0));
            foreach (var piece in MapGeometryCatalog.WallPieces)
            {
                if (piece.WallClass == "BOUND")
                {
                    Assert.That(piece.BlinkPassable, Is.False, piece.PieceId);
                    Assert.That(piece.FlightPassable, Is.False, piece.PieceId);
                }
                else if (piece.WallClass == "VAULT")
                {
                    Assert.That(piece.BlinkPassable, Is.True, piece.PieceId);
                    Assert.That(piece.FlightPassable, Is.True, piece.PieceId);
                }
                else
                {
                    Assert.Fail(
                        $"{piece.PieceId}: unknown wall class {piece.WallClass}");
                }

                Assert.That(
                    Blocks(piece, WallTraversal.Walk),
                    Is.True,
                    $"{piece.PieceId}: walking never passes a wall");
                Assert.That(
                    Blocks(piece, WallTraversal.Blink),
                    Is.EqualTo(!piece.BlinkPassable),
                    $"{piece.PieceId}: blink follows the compiled flag");
                Assert.That(
                    Blocks(piece, WallTraversal.Flight(piece.HeightMm)),
                    Is.EqualTo(!piece.FlightPassable),
                    $"{piece.PieceId}: flight needs the flag and the budget");
                Assert.That(
                    Blocks(piece, WallTraversal.Flight(piece.HeightMm - 1)),
                    Is.True,
                    $"{piece.PieceId}: a short budget never clears a wall");
            }
        }

        [Test]
        public void BlinkTraversalOnlyRelaxesBlinkPassablePieces()
        {
            var blinkPassableById = new Dictionary<string, bool>();
            foreach (var piece in MapGeometryCatalog.WallPieces)
            {
                blinkPassableById[piece.PieceId] = piece.BlinkPassable;
            }

            var relaxedCount = 0;
            foreach (var query in fixture.blockedQueries)
            {
                var point = new MapPointMmRecord(query.x, query.z);
                var blinkPieceId = field.FirstWallPieceAt(
                    point,
                    query.radiusMm,
                    WallTraversal.Blink);
                if (blinkPieceId != null)
                {
                    Assert.That(
                        blinkPassableById[blinkPieceId],
                        Is.False,
                        $"blinkWallPieceAt({query.x}, {query.z})");
                }

                if (query.wallPieceId.Length == 0)
                {
                    Assert.That(
                        blinkPieceId,
                        Is.Null,
                        $"blink blocks where walking is clear ({query.x}, {query.z})");
                }
                else if (blinkPieceId == null)
                {
                    relaxedCount += 1;
                }
            }

            Assert.That(
                relaxedCount,
                Is.GreaterThan(0),
                "the fixture must sample at least one 可越障级 wall");
        }

        [Test]
        public void SpawnPointsAreLegalForThePlayerCapsule()
        {
            foreach (var spawn in MapGeometryCatalog.SpawnPoints)
            {
                Assert.That(
                    field.IsCircleBlocked(spawn.Position, 450),
                    Is.False,
                    spawn.Id);
            }
        }

        private static bool Blocks(
            MapConvexPieceGeometryRecord piece,
            WallTraversal traversal)
        {
            return WallTraversal.Blocks(
                piece.HeightMm,
                piece.BlinkPassable,
                piece.FlightPassable,
                traversal);
        }
    }
}
