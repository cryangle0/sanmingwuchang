using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class WhirlwindSystem
    {
        public static void ResolvePulses(
            SimulationState state,
            List<SimEvent> events)
        {
            foreach (var owner in state.Players.Values)
            {
                if (owner.LifeState != LifeState.Alive ||
                    owner.WhirlwindNextPulseTick == 0 ||
                    state.Tick < owner.WhirlwindNextPulseTick)
                {
                    continue;
                }

                var definition = ActiveCatalog.Get(
                    owner.ActiveAbilityId);
                if (definition.Effect !=
                    ActiveEffect.MobileChannelAreaDamage)
                {
                    throw new InvalidOperationException(
                        $"{owner.ActiveAbilityId} is not a whirlwind.");
                }

                var baseDamage = checked(
                    definition.FixedDamage +
                    owner.AttackPower *
                    definition.AttackCoefficientBasisPoints /
                    10_000);
                foreach (var target in state.Players.Values)
                {
                    if (target.EntityId == owner.EntityId ||
                        target.LifeState != LifeState.Alive ||
                        IntegerMath.DistanceSquared(
                            owner.Position,
                            target.Position) >
                        (long)definition.RadiusMm *
                        definition.RadiusMm)
                    {
                        continue;
                    }

                    var elementBasisPoints =
                        GameplayRules.ElementDamageBasisPoints(
                            owner.Element,
                            target.Element);
                    var damage = Math.Max(
                        1,
                        checked(
                            baseDamage *
                            elementBasisPoints /
                            10_000));
                    DamageSystem.Apply(
                        state,
                        events,
                        new DamageRequest(
                            owner.EntityId,
                            target.EntityId,
                            damage,
                            DamageCause.Active,
                            DamageForm.Skill));
                }

                owner.WhirlwindNextPulseTick +=
                    definition.PulseIntervalTicks;
                if (owner.WhirlwindTicks == 0)
                {
                    owner.WhirlwindNextPulseTick = 0;
                }
            }
        }
    }
}
