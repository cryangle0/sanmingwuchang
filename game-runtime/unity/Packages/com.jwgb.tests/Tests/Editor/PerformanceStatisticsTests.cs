using Jwgb.Client.Presentation;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class PerformanceStatisticsTests
    {
        [Test]
        public void CalculatesNearestRankPercentiles()
        {
            var samples = new[]
            {
                9d,
                1d,
                5d,
                3d,
                7d
            };

            var distribution = PerformanceStatistics.Calculate(
                samples,
                samples.Length);

            Assert.That(distribution.count, Is.EqualTo(5));
            Assert.That(distribution.average, Is.EqualTo(5d));
            Assert.That(distribution.p50, Is.EqualTo(5d));
            Assert.That(distribution.p95, Is.EqualTo(9d));
            Assert.That(distribution.p99, Is.EqualTo(9d));
            Assert.That(distribution.max, Is.EqualTo(9d));
        }

        [Test]
        public void EmptyInputProducesAnEmptyDistribution()
        {
            var distribution = PerformanceStatistics.Calculate(
                new double[4],
                count: 0);

            Assert.That(distribution.count, Is.Zero);
            Assert.That(distribution.average, Is.Zero);
            Assert.That(distribution.max, Is.Zero);
        }
    }
}
