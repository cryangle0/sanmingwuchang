using Jwgb.Content;
using NUnit.Framework;

namespace Jwgb.Tests.Editor
{
    public sealed class MapEngineeringCatalogTests
    {
        [Test]
        public void CanonicalMapMatchesEngineeringJson()
        {
            Assert.That(MapEngineeringCatalog.SourceSchema, Is.EqualTo(
                "jwgb.authoritative-content.v1"));
            Assert.That(MapEngineeringCatalog.Nodes, Has.Length.EqualTo(199));
            Assert.That(MapEngineeringCatalog.Edges, Has.Length.EqualTo(342));
            Assert.That(MapEngineeringCatalog.Walls, Has.Length.EqualTo(42));
            Assert.That(MapEngineeringCatalog.Shops, Has.Length.EqualTo(48));
            Assert.That(MapEngineeringCatalog.Spawns, Has.Length.EqualTo(30));
        }

        [Test]
        public void CanonicalMapWallsHaveStableIds()
        {
            for (var index = 0;
                index < MapEngineeringCatalog.Walls.Length;
                index += 1)
            {
                Assert.That(
                    MapEngineeringCatalog.Walls[index].Id,
                    Is.EqualTo($"W{(index + 1):D3}"));
            }
        }
    }
}
