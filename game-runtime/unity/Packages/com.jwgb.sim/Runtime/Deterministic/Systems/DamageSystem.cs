using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class DamageSystem
    {
        public static int ApplyDebugDamage(
            SimulationState state,
            List<SimEvent> events,
            int targetEntityId,
            int amount,
            int? sourceEntityId,
            DamageForm form)
        {
            return Apply(
                state,
                events,
                new DamageRequest(
                    sourceEntityId,
                    targetEntityId,
                    amount,
                    DamageCause.Debug,
                    form));
        }

        public static int Apply(
            SimulationState state,
            List<SimEvent> events,
            DamageRequest request)
        {
            if (request.Amount < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(request));
            }

            var target = StateQueries.GetRequiredPlayer(
                state,
                request.TargetEntityId);
            var targetHpBefore = target.Hp;
            if (request.Amount == 0 ||
                target.LifeState != LifeState.Alive ||
                target.InvulnerableTicks > 0 ||
                target.IceCoffinTicks > 0)
            {
                return 0;
            }

            var source =
                request.SourceEntityId.HasValue &&
                state.Players.TryGetValue(
                    request.SourceEntityId.Value,
                    out var sourcePlayer)
                    ? sourcePlayer
                    : null;
            var outgoingBasisPoints = request.IgnoreSourceBonuses
                ? 10_000
                : request.OutgoingDamageBasisPointsOverride ??
                    ResolveOutgoingBasisPoints(
                        state,
                        request.SourceEntityId);
            if (outgoingBasisPoints < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(request));
            }

            var targetBasisPoints =
                source != null && !request.IgnoreSourceBonuses
                    ? PassiveRuntimeSystem.TargetDamageBonusBasisPoints(
                        source,
                        target.Hp,
                        target.MaxHp,
                        target.Position,
                        request.IgnoreExecute)
                    : 10_000;
            var outgoingDamage = checked(
                (int)(
                    (long)request.Amount *
                    outgoingBasisPoints *
                    targetBasisPoints /
                    100_000_000));
            var active = ActiveCatalog.Get(target.ActiveAbilityId);
            var incomingBasisPoints =
                target.ActiveBuffTicks > 0 &&
                active.Effect == ActiveEffect.SelfCombatBuff
                    ? active.IncomingDamageBasisPoints
                    : 10_000;
            var amplifiedDamage = checked(
                outgoingDamage * incomingBasisPoints / 10_000);
            var incomingModifier =
                PassiveRuntimeSystem.ResolveIncomingDamageModifier(
                    state,
                    target,
                    new DamageRequest(
                        request.SourceEntityId,
                        request.TargetEntityId,
                        amplifiedDamage,
                        request.Cause,
                        request.Form,
                        request.OutgoingDamageBasisPointsOverride,
                        request.IsCritical,
                        request.ShieldBypassBasisPoints,
                        request.Periodic,
                        request.IgnoreExecute,
                        request.IgnoreSourceBonuses));
            if (incomingModifier.Avoided)
            {
                return 0;
            }

            var modifiedDamage = incomingModifier.Amount;
            if (request.Form == DamageForm.Basic &&
                request.SourceEntityId.HasValue &&
                request.SourceEntityId.Value != target.EntityId)
            {
                BasicHitSystem.TryCreateReactiveShield(
                    state,
                    events,
                    target,
                    request.SourceEntityId.Value);
            }
            if (request.ShieldBypassBasisPoints < 0 ||
                request.ShieldBypassBasisPoints > 10_000)
            {
                throw new ArgumentOutOfRangeException(nameof(request));
            }

            var requestedBypassDamage = checked(
                modifiedDamage *
                request.ShieldBypassBasisPoints /
                10_000);
            var shieldableDamage =
                modifiedDamage - requestedBypassDamage;
            var shieldResult = ShieldSystem.Absorb(
                target,
                request.Form,
                shieldableDamage);
            var bypassHpDamage = Math.Min(
                target.Hp,
                requestedBypassDamage);
            target.Hp -= bypassHpDamage;
            var regularHpDamage = Math.Min(
                target.Hp,
                shieldResult.RemainingDamage);
            target.Hp -= regularHpDamage;
            var hpDamage = bypassHpDamage + regularHpDamage;
            var actualDamage = shieldResult.Absorbed + hpDamage;
            if (actualDamage == 0)
            {
                return 0;
            }

            AirdropSystem.Interrupt(
                state,
                events,
                target.EntityId,
                "damaged");
            if (request.SourceEntityId.HasValue &&
                request.SourceEntityId.Value != target.EntityId)
            {
                var creditedSource = PlayerOwnerForDamageSource(
                    state,
                    request.SourceEntityId.Value);
                if (creditedSource != null &&
                    creditedSource.EntityId != target.EntityId)
                {
                    ShopSystem.CancelHeroSwapOnDamage(
                        state,
                        events,
                        target);
                }
            }

            if (request.SourceEntityId.HasValue &&
                request.SourceEntityId.Value != target.EntityId &&
                 state.Players.TryGetValue(
                     request.SourceEntityId.Value,
                     out var combatSource))
            {
                combatSource.PvpCombatTicks =
                    5 * SimulationConstants.TicksPerSecond;
                target.PvpCombatTicks =
                    5 * SimulationConstants.TicksPerSecond;
            }

            PassiveRuntimeSystem.MarkCombatActivity(
                state,
                request.SourceEntityId,
                target.EntityId);

            events.Add(
                new SimEvent
                {
                    Type = "damage",
                    Tick = state.Tick,
                    SourceEntityId = request.SourceEntityId,
                    TargetEntityId = target.EntityId,
                    Cause = SimulationText.DamageCause(request.Cause),
                    Form = SimulationText.DamageForm(request.Form),
                    IsCritical = request.IsCritical,
                    Amount = actualDamage,
                    ShieldDamage = shieldResult.Absorbed,
                    HpDamage = hpDamage,
                    ShieldBypassHpDamage = bypassHpDamage,
                    RemainingHp = target.Hp,
                    RemainingShield = ShieldSystem.GetTotal(target)
                });

            ShieldBreakSystem.Resolve(
                state,
                events,
                target,
                shieldResult.BrokenShields);
            if (target.Hp == 0 &&
                !LethalProtectionSystem.Resolve(state, events, target))
            {
                LifeSystem.BeginTrueDeath(state, events, target);
                if (request.SourceEntityId.HasValue)
                {
                    PassiveKillSystem.Resolve(
                        state,
                        events,
                        new PassiveKillContext(
                            request.SourceEntityId.Value,
                            target.EntityId,
                            PassiveKillVictimKind.Hero,
                            targetHpBefore,
                            target.MaxHp,
                            target));
                }
            }

            return actualDamage;
        }

        private static int ResolveOutgoingBasisPoints(
            SimulationState state,
            int? sourceEntityId)
        {
            if (!sourceEntityId.HasValue ||
                !state.Players.TryGetValue(
                    sourceEntityId.Value,
                    out var source))
            {
                return 10_000;
            }

            return LethalProtectionSystem
                .GetOutgoingDamageBasisPoints(source);
        }

        private static PlayerState PlayerOwnerForDamageSource(
            SimulationState state,
            int sourceEntityId)
        {
            if (state.Players.TryGetValue(sourceEntityId, out var player))
            {
                return player;
            }

            if (state.Summons.TryGetValue(sourceEntityId, out var summon) &&
                state.Players.TryGetValue(
                    summon.OwnerEntityId,
                    out var owner))
            {
                return owner;
            }

            return null;
        }
    }
}
