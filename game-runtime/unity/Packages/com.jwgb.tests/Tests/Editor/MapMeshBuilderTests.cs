using Jwgb.Client.Presentation;
using Jwgb.Content;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class MapMeshBuilderTests
    {
        [Test]
        public void BuilderProducesDeterministicMeshCounts()
        {
            var first = MapMeshBuilder.Build();
            var second = MapMeshBuilder.Build();
            try
            {
                var firstMeshes = first.All;
                var secondMeshes = second.All;
                Assert.That(
                    firstMeshes.Length,
                    Is.EqualTo(secondMeshes.Length));
                for (var index = 0;
                    index < firstMeshes.Length;
                    index += 1)
                {
                    Assert.That(
                        firstMeshes[index].vertexCount,
                        Is.GreaterThan(0),
                        firstMeshes[index].name);
                    Assert.That(
                        firstMeshes[index].vertexCount,
                        Is.EqualTo(
                            secondMeshes[index].vertexCount),
                        firstMeshes[index].name);
                    Assert.That(
                        firstMeshes[index].triangles.Length,
                        Is.EqualTo(
                            secondMeshes[index].triangles.Length),
                        firstMeshes[index].name);
                }
            }
            finally
            {
                first.Dispose();
                second.Dispose();
            }
        }

        [Test]
        public void BuilderMatchesCatalogShapes()
        {
            var meshes = MapMeshBuilder.Build();
            try
            {
                Assert.That(
                    meshes.Ground.vertexCount,
                    Is.EqualTo(MapGeometryCatalog.Boundary.Length));
                Assert.That(
                    meshes.Ground.triangles.Length,
                    Is.EqualTo(
                        MapGeometryCatalog
                            .BoundaryTriangles.Length));
                Assert.That(
                    meshes.SpawnPads.vertexCount,
                    Is.EqualTo(
                        MapGeometryCatalog.SpawnPoints.Length * 4));
                Assert.That(
                    MapGeometryCatalog.SpawnPoints.Length,
                    Is.EqualTo(30));
            }
            finally
            {
                meshes.Dispose();
            }
        }
    }
}
