using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class BasicHitSystem
    {
        public static BasicAttackSnapshot CreateSnapshot(
            PlayerState owner,
            int outgoingDamageBasisPoints)
        {
            return new BasicAttackSnapshot(
                owner.EntityId,
                owner.Element,
                PassiveRuntimeSystem.EffectiveAttackPower(owner),
                outgoingDamageBasisPoints);
        }

        public static int Resolve(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            PlayerState target,
            BasicAttackSnapshot attack)
        {
            if (target.LifeState != LifeState.Alive ||
                target.InvulnerableTicks > 0 ||
                target.IceCoffinTicks > 0 ||
                PassiveRuntimeSystem.IsBasicAttackMissed(state, owner))
            {
                return 0;
            }

            var combatTarget = new CombatTarget(target);
            var modifier =
                PassiveRuntimeSystem.ResolveBasicAttackModifier(
                    state,
                    owner,
                    target);
            var critical = ResolveCritical(
                state,
                events,
                owner,
                combatTarget,
                modifier.GuaranteedCritical ||
                attack.ForcedCritical);
            var criticalDamage = checked(
                attack.BaseDamage * critical.DamagePercent / 100);
            var outgoingDamage = checked(
                (int)(
                    (long)criticalDamage *
                    attack.OutgoingDamageBasisPoints *
                    modifier.DamageBasisPoints /
                    100_000_000));
            var elementBasisPoints =
                GameplayRules.ElementDamageBasisPoints(
                    attack.SourceElement,
                    target.Element);
            var damage = Math.Max(
                1,
                checked(outgoingDamage * elementBasisPoints / 10_000));
            var applied = DamageSystem.Apply(
                state,
                events,
                new DamageRequest(
                    owner.EntityId,
                    target.EntityId,
                    damage,
                    DamageCause.Basic,
                    DamageForm.Basic,
                    10_000,
                    critical.IsCritical,
                    critical.ShieldBypassPercent * 100));
            if (applied > 0)
            {
                BasicHitEffectsSystem.Resolve(
                    state,
                    events,
                    owner,
                    combatTarget,
                    attack,
                    critical,
                    modifier,
                    applied);
            }

            return applied;
        }

        public static int ResolveMonster(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            MonsterState target,
            BasicAttackSnapshot attack)
        {
            if (target.InvulnerableTicks > 0 ||
                !state.Monsters.ContainsKey(target.EntityId) ||
                PassiveRuntimeSystem.IsBasicAttackMissed(state, owner))
            {
                return 0;
            }

            var combatTarget = new CombatTarget(target);
            var modifier =
                PassiveRuntimeSystem.ResolveBasicAttackModifier(
                    state,
                    owner,
                    target);
            var critical = ResolveCritical(
                state,
                events,
                owner,
                combatTarget,
                modifier.GuaranteedCritical ||
                attack.ForcedCritical);
            var damage = Math.Max(
                1,
                checked(
                    (int)(
                        (long)attack.BaseDamage *
                        critical.DamagePercent *
                        attack.OutgoingDamageBasisPoints *
                        modifier.DamageBasisPoints /
                        10_000_000_000L)));
            var applied = MonsterDamageSystem.Apply(
                state,
                events,
                owner.EntityId,
                target,
                damage,
                attack.SourceElement,
                10_000);
            if (applied > 0)
            {
                BasicHitEffectsSystem.Resolve(
                    state,
                    events,
                    owner,
                    combatTarget,
                    attack,
                    critical,
                    modifier,
                    applied);
            }

            return applied;
        }

        internal static CriticalResolution ResolveCritical(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            bool forced)
        {
            if (!PassiveRuntimeSystem.TryFind(
                owner,
                GameplayIds.Critical,
                out var loadout))
            {
                if (!forced)
                {
                    return new CriticalResolution(false, 100, 0);
                }

                events.Add(
                    new SimEvent
                    {
                        Type = "critical-hit",
                        Tick = state.Tick,
                        SourceEntityId = owner.EntityId,
                        TargetEntityId = target.EntityId,
                        PassiveId = GameplayIds.Backstab,
                        CriticalDamagePercent = 200
                    });
                return new CriticalResolution(true, 200, 0);
            }

            var definition = PassiveCatalog.Get(GameplayIds.Critical);
            var chance = PassiveCatalog.LevelValue(
                definition.ChancePercentByLevel,
                loadout.Level);
            var targetIsBlind = target.IsPlayer
                ? target.Player.BlindTicks > 0
                : target.Monster.BlindTicks > 0;
            if (!forced &&
                (targetIsBlind ||
                 state.Random.Combat.NextInt(100) >= chance))
            {
                return new CriticalResolution(false, 100, 0);
            }

            var damagePercent = PassiveRuntimeSystem.ScaleMagnitude(
                PassiveCatalog.LevelValue(
                    definition.CriticalDamagePercentByLevel,
                    loadout.Level),
                owner);
            var shieldBypassPercent = loadout.Level == 5
                ? Math.Min(
                    100,
                    PassiveRuntimeSystem.ScaleMagnitude(
                        definition.Level5ShieldBypassPercent,
                        owner))
                : 0;
            events.Add(
                new SimEvent
                {
                    Type = "critical-hit",
                    Tick = state.Tick,
                    SourceEntityId = owner.EntityId,
                    TargetEntityId = target.EntityId,
                    PassiveId = definition.Id,
                    CriticalDamagePercent = damagePercent,
                    ShieldBypassPercent = shieldBypassPercent
                });
            return new CriticalResolution(
                true,
                damagePercent,
                shieldBypassPercent);
        }

        internal static void TryCreateReactiveShield(
            SimulationState state,
            List<SimEvent> events,
            PlayerState target,
            int sourceEntityId)
        {
            if (!PassiveRuntimeSystem.TryFind(
                target,
                GameplayIds.ReactiveShield,
                out var loadout))
            {
                return;
            }

            var definition = PassiveCatalog.Get(
                GameplayIds.ReactiveShield);
            var chance = PassiveCatalog.LevelValue(
                definition.ChancePercentByLevel,
                loadout.Level);
            if (state.Random.Combat.NextInt(100) >= chance)
            {
                return;
            }

            var amount = PassiveRuntimeSystem.ScaleMagnitude(
                PassiveCatalog.LevelValue(
                    definition.ShieldAmountByLevel,
                    loadout.Level),
                target);
            ShieldBreakEffectState breakEffect = null;
            if (loadout.Level == 5)
            {
                breakEffect = new ShieldBreakEffectState
                {
                    SourceEntityId = target.EntityId,
                    SourceElement = target.Element,
                    Damage = PassiveRuntimeSystem.ScaleMagnitude(
                        definition.Level5BreakAoeDamage,
                        target),
                    RadiusMm = definition.Level5BreakAoeRadiusMm
                };
            }

            ShieldSystem.AddPassive(
                state,
                target,
                definition.Id,
                amount,
                definition.DurationTicks,
                breakEffect);
            events.Add(
                new SimEvent
                {
                    Type = "passive-shield-created",
                    Tick = state.Tick,
                    EntityId = target.EntityId,
                    SourceEntityId = sourceEntityId,
                    PassiveId = definition.Id,
                    Amount = amount,
                    DurationTicks = definition.DurationTicks
                });
        }
    }
}
