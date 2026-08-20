using Jwgb.Core;
using Unity.Burst;
using Unity.Entities;

namespace Jwgb.Sim
{
    [BurstCompile]
    public partial struct SyntheticMotionJob : IJobEntity
    {
        private const int DirectionScale = 1_000;
        private const int MovementDenominator =
            DirectionScale * SimulationConstants.TicksPerSecond;
        private const uint DirectionChangeTicks = 64;

        public uint Tick;
        public int ArenaRadiusMm;

        private void Execute(
            ref SimPositionMm position,
            ref SimMotionRemainder remainder,
            in SimEntityId entityId,
            in SyntheticAgent agent)
        {
            ResolveDirection(
                (int)(((Tick + agent.Phase) / DirectionChangeTicks + (uint)entityId.Value) & 7),
                out var directionX,
                out var directionZ);

            var numeratorX = (agent.SpeedMmPerSecond * directionX) + remainder.X;
            var numeratorZ = (agent.SpeedMmPerSecond * directionZ) + remainder.Z;
            var stepX = numeratorX / MovementDenominator;
            var stepZ = numeratorZ / MovementDenominator;

            remainder.X = numeratorX - (stepX * MovementDenominator);
            remainder.Z = numeratorZ - (stepZ * MovementDenominator);
            position.X = Wrap(position.X + stepX, ArenaRadiusMm);
            position.Z = Wrap(position.Z + stepZ, ArenaRadiusMm);
        }

        private static int Wrap(int value, int radius)
        {
            if (value > radius)
            {
                return -radius + (value - radius - 1);
            }

            return value < -radius
                ? radius - (-radius - value - 1)
                : value;
        }

        private static void ResolveDirection(int index, out int x, out int z)
        {
            switch (index)
            {
                case 0:
                    x = DirectionScale;
                    z = 0;
                    return;
                case 1:
                    x = 707;
                    z = 707;
                    return;
                case 2:
                    x = 0;
                    z = DirectionScale;
                    return;
                case 3:
                    x = -707;
                    z = 707;
                    return;
                case 4:
                    x = -DirectionScale;
                    z = 0;
                    return;
                case 5:
                    x = -707;
                    z = -707;
                    return;
                case 6:
                    x = 0;
                    z = -DirectionScale;
                    return;
                default:
                    x = 707;
                    z = -707;
                    return;
            }
        }
    }
}
