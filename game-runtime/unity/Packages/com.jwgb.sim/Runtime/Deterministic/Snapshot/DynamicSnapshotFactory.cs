using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class SnapshotFactory
    {
        private static SummonSnapshot[] CreateSummons(
            SimulationState state)
        {
            var snapshots = new SummonSnapshot[state.Summons.Count];
            var index = 0;
            foreach (var summon in state.Summons.Values)
            {
                snapshots[index] = new SummonSnapshot
                {
                    EntityId = summon.EntityId,
                    OwnerEntityId = summon.OwnerEntityId,
                    Kind = SimulationText.SummonKind(summon.Kind),
                    Position = summon.Position,
                    Hp = summon.Hp,
                    MaxHp = summon.MaxHp,
                    AttackPower = summon.AttackPower,
                    Targetable = summon.Targetable,
                    ExpiresAtTick = summon.ExpiresAtTick,
                    AttackCooldownTicks = summon.AttackCooldownTicks,
                    TouchCooldownTicks = summon.TouchCooldownTicks,
                    DestroyedByHostileDamage =
                        summon.DestroyedByHostileDamage
                };
                index += 1;
            }

            return snapshots;
        }

        private static AfterimageSnapshot[] CreateAfterimages(
            SimulationState state)
        {
            var snapshots =
                new AfterimageSnapshot[state.Afterimages.Count];
            var index = 0;
            foreach (var afterimage in state.Afterimages.Values)
            {
                snapshots[index] = new AfterimageSnapshot
                {
                    EntityId = afterimage.EntityId,
                    OwnerEntityId = afterimage.OwnerEntityId,
                    Position = afterimage.Position,
                    SlowPercent = afterimage.SlowPercent,
                    SlowDurationTicks = afterimage.SlowDurationTicks,
                    ExplosionDamage = afterimage.ExplosionDamage,
                    ExplosionRadiusMm = afterimage.ExplosionRadiusMm,
                    ExpiresAtTick = afterimage.ExpiresAtTick
                };
                index += 1;
            }

            return snapshots;
        }

        private static BountyMarkSnapshot[] CreateBountyMarks(
            SimulationState state)
        {
            var marks = new List<BountyMarkState>(state.BountyMarks);
            marks.Sort(
                (left, right) =>
                {
                    var result = left.SourceEntityId.CompareTo(
                        right.SourceEntityId);
                    if (result != 0)
                    {
                        return result;
                    }

                    result = left.TargetEntityId.CompareTo(
                        right.TargetEntityId);
                    return result != 0
                        ? result
                        : left.ExpiresAtTick.CompareTo(
                            right.ExpiresAtTick);
                });
            var snapshots = new BountyMarkSnapshot[marks.Count];
            for (var index = 0; index < marks.Count; index += 1)
            {
                var mark = marks[index];
                snapshots[index] = new BountyMarkSnapshot
                {
                    SourceEntityId = mark.SourceEntityId,
                    TargetEntityId = mark.TargetEntityId,
                    RewardGold = mark.RewardGold,
                    RevealToAll = mark.RevealToAll,
                    ExpiresAtTick = mark.ExpiresAtTick
                };
            }

            return snapshots;
        }
    }
}
