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

                var blocks = piece.WallClass == "BOUND";
                Assert.That(
                    Blocks(piece, WallTraversal.Walk),
                    Is.EqualTo(blocks),
                    $"{piece.PieceId}: only BOUND remains a hard wall");
                Assert.That(
                    Blocks(piece, WallTraversal.Blink),
                    Is.EqualTo(blocks),
                    $"{piece.PieceId}: VAULT is walkable terrain");
                Assert.That(
                    Blocks(piece, WallTraversal.Flight(piece.HeightMm)),
                    Is.EqualTo(blocks),
                    $"{piece.PieceId}: VAULT is walkable terrain");
                Assert.That(
                    Blocks(piece, WallTraversal.Flight(piece.HeightMm - 1)),
                    Is.EqualTo(blocks),
                    $"{piece.PieceId}: VAULT is independent of flight budget");
            }
        }

        [Test]
        public void VaultFootprintsNeverAppearAsWallCollision()
        {
            var checkedCount = 0;
            foreach (var piece in MapGeometryCatalog.WallPieces)
            {
                if (piece.WallClass != "VAULT")
                {
                    continue;
                }

                long x = 0;
                long z = 0;
                foreach (var vertex in piece.Vertices)
                {
                    x += vertex.X;
                    z += vertex.Z;
                }

                var center = new MapPointMmRecord(
                    x / piece.Vertices.Length,
                    z / piece.Vertices.Length);
                if (!field.IsCircleInsideBoundary(center, 450))
                {
                    continue;
                }

                Assert.That(
                    field.FirstWallPieceAt(center, 450, WallTraversal.Walk),
                    Is.Null,
                    piece.PieceId);
                checkedCount += 1;
            }

            Assert.That(checkedCount, Is.GreaterThan(0));
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
                piece.WallClass,
                piece.HeightMm,
                piece.BlinkPassable,
                piece.FlightPassable,
                traversal);
        }
    }
}
