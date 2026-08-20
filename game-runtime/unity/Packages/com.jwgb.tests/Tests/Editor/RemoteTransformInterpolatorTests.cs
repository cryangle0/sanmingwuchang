using Jwgb.Client;
using Jwgb.Core;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class RemoteTransformInterpolatorTests
    {
        [Test]
        public void InterpolatesAlongTheBufferedAuthoritativeTimeline()
        {
            var interpolator =
                new RemoteTransformInterpolator(
                    interpolationDelayTicks: 4);
            interpolator.AddSample(
                0,
                new Int2Mm(0, 0),
                new Int2Mm(0, 1_000));
            interpolator.AddSample(
                2,
                new Int2Mm(200, 0),
                new Int2Mm(0, 1_000));
            interpolator.AddSample(
                4,
                new Int2Mm(400, 0),
                new Int2Mm(0, 1_000));
            interpolator.AddSample(
                6,
                new Int2Mm(600, 0),
                new Int2Mm(0, 1_000));

            interpolator.Advance(0.05d);

            Assert.That(
                interpolator.CurrentPosition.X,
                Is.EqualTo(100));
            Assert.That(
                interpolator.LastStepMm,
                Is.EqualTo(100));
            Assert.That(
                interpolator.HeldLastFrame,
                Is.False);
        }

        [Test]
        public void IgnoresOutOfOrderSamples()
        {
            var interpolator =
                new RemoteTransformInterpolator(
                    interpolationDelayTicks: 0);
            interpolator.AddSample(
                10,
                new Int2Mm(1_000, 0),
                new Int2Mm(0, 1_000));
            interpolator.AddSample(
                8,
                new Int2Mm(8_000, 0),
                new Int2Mm(1_000, 0));
            interpolator.Advance(0.1d);

            Assert.That(
                interpolator.CurrentPosition.X,
                Is.EqualTo(1_000));
            Assert.That(
                interpolator.BufferedSampleCount,
                Is.EqualTo(1));
        }

        [Test]
        public void ReportsBufferHoldsAndResetsMetrics()
        {
            var interpolator =
                new RemoteTransformInterpolator();
            interpolator.AddSample(
                20,
                new Int2Mm(500, 600),
                new Int2Mm(0, 1_000));

            interpolator.Advance(0.1d);

            Assert.That(interpolator.HeldLastFrame, Is.True);
            Assert.That(interpolator.HoldFrameCount, Is.EqualTo(1));

            interpolator.Reset();

            Assert.That(interpolator.IsInitialized, Is.False);
            Assert.That(interpolator.FrameCount, Is.Zero);
            Assert.That(interpolator.HoldFrameCount, Is.Zero);
        }
    }
}
