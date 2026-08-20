using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class BasicHitSystem
    {
        public static int ResolveColdArrow(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            int baseDamage)
        {
            if (!target.IsAlive ||
                target.IsPlayer &&
                (target.Player.InvulnerableTicks > 0 ||
                 target.Player.IceCoffinTicks > 0) ||
                target.IsMonster &&
                target.Monster.InvulnerableTicks > 0)
            {
                return 0;
            }

            var critical = new CriticalResolution(false, 100, 0);
            if (PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.ColdArrow,
                    out var coldArrow) &&
                coldArrow.Level == 5)
            {
                critical = ResolveCritical(
                    state,
                    events,
                    owner,
                    target,
                    false);
            }

            var damage = Math.Max(
                1,
                checked(baseDamage * critical.DamagePercent / 100));
            if (target.IsPlayer)
            {
                var elementBasisPoints =
                    GameplayRules.ElementDamageBasisPoints(
                        owner.Element,
                        target.Player.Element);
                return DamageSystem.Apply(
                    state,
                    events,
                    new DamageRequest(
                        owner.EntityId,
                        target.EntityId,
                        Math.Max(
                            1,
                            checked(
                                damage *
                                elementBasisPoints /
                                10_000)),
                        DamageCause.Passive,
                        DamageForm.Skill,
                        null,
                        critical.IsCritical,
                        critical.ShieldBypassPercent * 100));
            }

            return MonsterDamageSystem.Apply(
                state,
                events,
                owner.EntityId,
                target.Monster,
                damage,
                owner.Element);
        }
    }
}
