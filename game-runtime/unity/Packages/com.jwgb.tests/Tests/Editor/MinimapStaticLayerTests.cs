using System.Collections.Generic;
using Jwgb.Client.Presentation;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class MinimapStaticLayerTests
    {
        [Test]
        public void SameCatalogProducesIdenticalBuffers()
        {
            var first = MinimapStaticLayer.Render(
                MinimapProjection.Create());
            var second = MinimapStaticLayer.Render(
                MinimapProjection.Create());
            Assert.That(
                first.Buffer.Length,
                Is.EqualTo(second.Buffer.Length));
            Assert.That(
                MinimapStaticLayer.Checksum(first.Buffer),
                Is.EqualTo(
                    MinimapStaticLayer.Checksum(second.Buffer)));
            for (var index = 0;
                index < first.Buffer.Length;
                index += 1)
            {
                Assert.That(
                    first.Buffer[index],
                    Is.EqualTo(second.Buffer[index]),
                    $"pixel {index}");
            }
        }

        [Test]
        public void BufferMatchesProjectionDimensions()
        {
            var surface = MinimapStaticLayer.Render(
                MinimapProjection.Create());
            Assert.That(
                surface.Width,
                Is.EqualTo(MinimapProjection.Width));
            Assert.That(
                surface.Height,
                Is.EqualTo(MinimapProjection.Height));
            Assert.That(
                surface.Buffer.Length,
                Is.EqualTo(
                    MinimapProjection.Width *
                    MinimapProjection.Height));
        }

        [Test]
        public void StaticLayerContainsAllFeatureLayers()
        {
            var surface = MinimapStaticLayer.Render(
                MinimapProjection.Create());
            var distinct = new HashSet<uint>();
            for (var index = 0;
                index < surface.Buffer.Length;
                index += 1)
            {
                var color = surface.Buffer[index];
                distinct.Add(
                    ((uint)color.r << 24) |
                    ((uint)color.g << 16) |
                    ((uint)color.b << 8) |
                    color.a);
            }
            // Background, ground, boundary edge, roads, highlands,
            // walls, and court outlines must all be present.
            Assert.That(distinct.Count, Is.GreaterThanOrEqualTo(7));
        }

        [Test]
        public void ProjectionKeepsMapInsideCanvas()
        {
            var projection = MinimapProjection.Create();
            var boundary =
                Jwgb.Content.MapGeometryCatalog.Boundary;
            for (var index = 0;
                index < boundary.Length;
                index += 1)
            {
                var point = projection.Project(boundary[index]);
                Assert.That(point.x, Is.InRange(
                    0f,
                    MinimapProjection.Width));
                Assert.That(point.y, Is.InRange(
                    0f,
                    MinimapProjection.Height));
            }
        }
    }
}
