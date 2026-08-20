using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveRuntimeSystem
    {
        public static int TargetDamageBonusBasisPoints(
            PlayerState source,
            int targetHp,
            int targetMaxHp,
            Int2Mm targetPosition,
            bool ignoreExecute = false)
        {
            var basisPoints = 10_000;
            if (!ignoreExecute &&
                TryFind(
                    source,
                    GameplayIds.Execute,
                    out var execute))
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.Execute);
                var threshold = PassiveCatalog.LevelValue(
                    definition.ThresholdPercentByLevel,
                    execute.Level);
                if ((long)targetHp * 100 <=
                    (long)targetMaxHp * threshold)
                {
                    basisPoints += PassiveCatalog.LevelValue(
                        definition.DamageBonusPercentByLevel,
                        execute.Level) * 100;
                }
            }

            if (TryFind(
                    source,
                    GameplayIds.Hunt,
                    out var hunt) &&
                hunt.Level == 5 &&
                (long)targetHp * 100 < (long)targetMaxHp * 30)
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.Hunt);
                var range = PassiveCatalog.LevelValue(
                    definition.RangeMmByLevel,
                    hunt.Level);
                if (IntegerMath.DistanceSquared(
                        source.Position,
                        targetPosition) <= (long)range * range)
                {
                    basisPoints += definition.Level5DamageBonusPercent * 100;
                }
            }

            return basisPoints;
        }

        private static bool IsBehind(
            PlayerState source,
            Int2Mm targetPosition,
            Int2Mm targetFacing)
        {
            var toSourceX = source.Position.X - targetPosition.X;
            var toSourceZ = source.Position.Z - targetPosition.Z;
            var facingDot = targetFacing.X * toSourceX +
                targetFacing.Z * toSourceZ;
            if (facingDot >= 0)
            {
                return false;
            }

            var sourceMagnitude = (long)toSourceX * toSourceX +
                (long)toSourceZ * toSourceZ;
            var facingMagnitude = (long)targetFacing.X * targetFacing.X +
                (long)targetFacing.Z * targetFacing.Z;
            return 4L * facingDot * facingDot >=
                (long)sourceMagnitude * facingMagnitude;
        }
    }
}
