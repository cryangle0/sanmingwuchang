using System;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public sealed class SimulationTickClock
    {
        private readonly double tickSeconds =
            1d / SimulationConstants.TicksPerSecond;
        private readonly int maximumCatchUpTicks;
        private double accumulatedSeconds;

        public SimulationTickClock(int maximumCatchUpTicks = 4)
        {
            if (maximumCatchUpTicks <= 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maximumCatchUpTicks));
            }

            this.maximumCatchUpTicks = maximumCatchUpTicks;
        }

        public double Alpha => Math.Min(
            1d,
            accumulatedSeconds / tickSeconds);

        public int Accumulate(double elapsedSeconds)
        {
            if (double.IsNaN(elapsedSeconds) ||
                double.IsInfinity(elapsedSeconds) ||
                elapsedSeconds < 0d)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(elapsedSeconds));
            }

            accumulatedSeconds += elapsedSeconds;
            var ticks = Math.Min(
                maximumCatchUpTicks,
                (int)(accumulatedSeconds / tickSeconds));
            accumulatedSeconds -= ticks * tickSeconds;
            if (ticks == maximumCatchUpTicks &&
                accumulatedSeconds > tickSeconds * maximumCatchUpTicks)
            {
                accumulatedSeconds = tickSeconds * maximumCatchUpTicks;
            }

            return ticks;
        }

        public void Reset()
        {
            accumulatedSeconds = 0d;
        }
    }
}
