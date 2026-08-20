using System;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client
{
    public sealed class RemoteTransformInterpolator
    {
        private const int Capacity = 8;
        private readonly int interpolationDelayTicks;
        private readonly int[] ticks = new int[Capacity];
        private readonly Int2Mm[] positions = new Int2Mm[Capacity];
        private readonly Int2Mm[] facings = new Int2Mm[Capacity];
        private int count;
        private double renderTick;

        public RemoteTransformInterpolator(
            int interpolationDelayTicks = 4)
        {
            if (interpolationDelayTicks < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(interpolationDelayTicks));
            }
            this.interpolationDelayTicks =
                interpolationDelayTicks;
        }

        public bool IsInitialized => count > 0;

        public int BufferedSampleCount => count;

        public Int2Mm CurrentPosition { get; private set; }

        public Int2Mm CurrentFacing { get; private set; } =
            new Int2Mm(0, 1_000);

        public bool HeldLastFrame { get; private set; }

        public int LastStepMm { get; private set; }

        public int FrameCount { get; private set; }

        public int HoldFrameCount { get; private set; }

        public int MaxStepMm { get; private set; }

        public void AddSample(
            int tick,
            Int2Mm position,
            Int2Mm facing)
        {
            if (tick < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(tick));
            }
            if (count > 0 && tick <= ticks[count - 1])
            {
                if (tick == ticks[count - 1])
                {
                    positions[count - 1] = position;
                    facings[count - 1] = facing;
                }
                return;
            }

            if (count == Capacity)
            {
                Array.Copy(ticks, 1, ticks, 0, Capacity - 1);
                Array.Copy(
                    positions,
                    1,
                    positions,
                    0,
                    Capacity - 1);
                Array.Copy(
                    facings,
                    1,
                    facings,
                    0,
                    Capacity - 1);
                count -= 1;
            }

            ticks[count] = tick;
            positions[count] = position;
            facings[count] = facing;
            count += 1;
            if (count != 1)
            {
                return;
            }

            renderTick = tick;
            CurrentPosition = position;
            CurrentFacing = facing;
        }

        public void Advance(double deltaSeconds)
        {
            if (deltaSeconds < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(deltaSeconds));
            }
            if (count == 0)
            {
                return;
            }

            FrameCount += 1;
            var previousPosition = CurrentPosition;
            var targetRenderTick = Math.Max(
                ticks[0],
                ticks[count - 1] - interpolationDelayTicks);
            var backlog = targetRenderTick - renderTick;
            var speedMultiplier = backlog > 4d
                ? 1.5d
                : backlog > 2d
                    ? 1.25d
                    : 1d;
            var nextRenderTick = Math.Min(
                targetRenderTick,
                renderTick +
                    (deltaSeconds *
                     SimulationConstants.TicksPerSecond *
                     speedMultiplier));
            HeldLastFrame =
                nextRenderTick <= renderTick + 0.000001d;
            if (HeldLastFrame)
            {
                HoldFrameCount += 1;
            }
            renderTick = nextRenderTick;
            Evaluate();
            LastStepMm = checked((int)IntegerMath.IntegerSquareRoot(
                IntegerMath.DistanceSquared(
                    previousPosition,
                    CurrentPosition)));
            MaxStepMm = Math.Max(MaxStepMm, LastStepMm);
        }

        public void Reset()
        {
            count = 0;
            renderTick = 0d;
            CurrentPosition = default;
            CurrentFacing = new Int2Mm(0, 1_000);
            HeldLastFrame = false;
            LastStepMm = 0;
            FrameCount = 0;
            HoldFrameCount = 0;
            MaxStepMm = 0;
        }

        private void Evaluate()
        {
            if (count == 1 || renderTick <= ticks[0])
            {
                CurrentPosition = positions[0];
                CurrentFacing = facings[0];
                return;
            }

            for (var index = 1; index < count; index += 1)
            {
                if (renderTick > ticks[index])
                {
                    continue;
                }

                var previousTick = ticks[index - 1];
                var tickSpan = ticks[index] - previousTick;
                var ratio = tickSpan <= 0
                    ? 1d
                    : (renderTick - previousTick) / tickSpan;
                CurrentPosition = Lerp(
                    positions[index - 1],
                    positions[index],
                    ratio);
                CurrentFacing = Lerp(
                    facings[index - 1],
                    facings[index],
                    ratio);
                return;
            }

            CurrentPosition = positions[count - 1];
            CurrentFacing = facings[count - 1];
        }

        private static Int2Mm Lerp(
            Int2Mm from,
            Int2Mm to,
            double ratio)
        {
            var clamped = Math.Max(0d, Math.Min(1d, ratio));
            return new Int2Mm(
                checked(
                    from.X +
                    (int)Math.Round(
                        (to.X - from.X) * clamped)),
                checked(
                    from.Z +
                    (int)Math.Round(
                        (to.Z - from.Z) * clamped)));
        }
    }
}
