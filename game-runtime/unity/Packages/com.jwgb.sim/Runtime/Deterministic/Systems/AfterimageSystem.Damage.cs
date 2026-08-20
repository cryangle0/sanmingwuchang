using System;
using System.Collections.Generic;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class AfterimageSystem
    {
        private static void ApplyExplosionDamage(
            SimulationState state,
            List<SimEvent> events,
            AfterimageState afterimage,
            PlayerState owner)
        {
            if (afterimage.ExplosionDamage <= 0)
            {
                return;
            }

            var radiusSquared =
                (long)afterimage.ExplosionRadiusMm *
                afterimage.ExplosionRadiusMm;
            var players = new List<PlayerState>(state.Players.Values);
            for (var index = 0; index < players.Count; index += 1)
            {
                var target = players[index];
                if (target.EntityId == owner.EntityId ||
                    target.LifeState != LifeState.Alive ||
                    IntegerMath.DistanceSquared(
                        afterimage.Position,
                        target.Position) > radiusSquared)
                {
                    continue;
                }

                DamageSystem.Apply(
                    state,
                    events,
                    new DamageRequest(
                        owner.EntityId,
                        target.EntityId,
                        afterimage.ExplosionDamage,
                        DamageCause.Passive,
                        DamageForm.Skill));
            }

            var monsters = new List<MonsterState>(state.Monsters.Values);
            for (var index = 0; index < monsters.Count; index += 1)
            {
                var target = monsters[index];
                if (target.Hp <= 0 ||
                    IntegerMath.DistanceSquared(
                        afterimage.Position,
                        target.Position) > radiusSquared)
                {
                    continue;
                }

                MonsterDamageSystem.Apply(
                    state,
                    events,
                    owner.EntityId,
                    target,
                    afterimage.ExplosionDamage,
                    owner.Element);
            }

            var summonDamage = Math.Max(
                1,
                checked(
                    afterimage.ExplosionDamage *
                    LethalProtectionSystem
                        .GetOutgoingDamageBasisPoints(owner) /
                    10_000));
            var summons = new List<SummonState>(state.Summons.Values);
            for (var index = 0; index < summons.Count; index += 1)
            {
                var target = summons[index];
                if (target.OwnerEntityId == owner.EntityId ||
                    !target.Targetable ||
                    target.Hp <= 0 ||
                    IntegerMath.DistanceSquared(
                        afterimage.Position,
                        target.Position) > radiusSquared)
                {
                    continue;
                }

                SummonHealthSystem.Apply(
                    state,
                    events,
                    owner.EntityId,
                    target,
                    summonDamage);
            }
        }
    }
}
