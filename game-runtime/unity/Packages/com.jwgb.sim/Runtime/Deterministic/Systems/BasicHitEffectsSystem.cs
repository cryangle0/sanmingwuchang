using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class BasicHitEffectsSystem
    {
        private static readonly HashSet<string> ComboForcedPassives =
            new HashSet<string>(StringComparer.Ordinal)
            {
                GameplayIds.Frost,
                GameplayIds.Paralysis,
                GameplayIds.Knockback,
                GameplayIds.Blind,
                GameplayIds.Stun,
                GameplayIds.Splash,
                GameplayIds.Burn,
                GameplayIds.Poison,
                GameplayIds.WolfSpirit,
                GameplayIds.FireSpirit,
                GameplayIds.ColdArrow,
                GameplayIds.Thunderstorm
            };

        public static void Resolve(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            BasicAttackSnapshot attack,
            CriticalResolution critical,
            BasicAttackModifier modifier,
            int appliedDamage)
        {
            if (appliedDamage <= 0)
            {
                return;
            }

            if (IsAlive(state, target))
            {
                ResolveMomentum(
                    state,
                    events,
                    owner,
                    target,
                    critical);
                EquipmentRuntimeSystem.ApplyEquipmentBurn(
                    state,
                    owner,
                    target.EntityId);
                PassiveHitSystem.ApplyStatuses(
                    state,
                    events,
                    owner,
                    target,
                    critical.IsCritical,
                    attack.ForcedPassiveId);
            }

            if (target.IsPlayer && attack.ComboDepth == 0)
            {
                PassiveEconomySystem.ResolvePickpocket(
                    state,
                    events,
                    owner,
                    target.Player);
            }
            if (target.IsPlayer)
            {
                PassiveHitSystem.ResolveIncoming(
                    state,
                    events,
                    target.Player,
                    owner.EntityId,
                    critical.IsCritical);
            }

            var effects = PassiveHitSystem.ResolveEffects(
                state,
                events,
                owner,
                target,
                attack.ForcedPassiveId,
                attack.ComboDepth == 0);
            SummonSystem.TrySpawnPassiveSummons(
                state,
                events,
                owner,
                attack.ForcedPassiveId);

            if (effects.BurnDetonationDamage > 0 &&
                IsAlive(state, target))
            {
                ApplyRawPassiveDamage(
                    state,
                    events,
                    owner,
                    target,
                    effects.BurnDetonationDamage,
                    DamageForm.Dot,
                    true);
            }

            if (effects.SplashTriggered)
            {
                var splashDamage = Math.Max(
                    1,
                    checked(
                        (int)(
                            (long)attack.BaseDamage *
                            modifier.DamageBasisPoints *
                            effects.SplashPercent /
                            1_000_000)));
                ApplyAreaDamage(
                    state,
                    events,
                    owner,
                    target.Position,
                    target.EntityId,
                    effects.SplashRadiusMm,
                    splashDamage,
                    false,
                    PassiveRuntimeSystem.TryFind(
                        owner,
                        GameplayIds.Splash,
                        out var splash) &&
                    splash.Level == 5);
            }

            if (effects.ThunderstormTriggered)
            {
                ApplyAreaDamage(
                    state,
                    events,
                    owner,
                    target.Position,
                    target.EntityId,
                    effects.ThunderstormRadiusMm,
                    effects.ThunderstormDamage,
                    true,
                    true);
            }

            var lifesteal = PassiveRuntimeSystem.BasicLifestealPercent(
                owner);
            if (lifesteal > 0)
            {
                owner.Hp = Math.Min(
                    owner.MaxHp,
                    owner.Hp + appliedDamage * lifesteal / 100);
            }

            if (effects.ColdArrowDamage > 0 && IsAlive(state, target))
            {
                ProjectileSystem.LaunchColdArrow(
                    state,
                    owner,
                    target,
                    effects.ColdArrowDamage,
                    50_000);
            }

            for (var extraHit = 0;
                extraHit < effects.ComboExtraHits;
                extraHit += 1)
            {
                if (!IsAlive(state, target))
                {
                    break;
                }

                var forcedPassiveId =
                    extraHit == effects.ComboExtraHits - 1
                        ? SelectComboForcedPassive(state, owner)
                        : null;
                var chained = new BasicAttackSnapshot(
                    attack.SourceEntityId,
                    attack.SourceElement,
                    attack.BaseDamage,
                    attack.OutgoingDamageBasisPoints,
                    attack.ComboDepth + 1,
                    attack.ForcedCritical,
                    forcedPassiveId);
                if (target.IsPlayer)
                {
                    BasicHitSystem.Resolve(
                        state,
                        events,
                        owner,
                        target.Player,
                        chained);
                }
                else
                {
                    BasicHitSystem.ResolveMonster(
                        state,
                        events,
                        owner,
                        target.Monster,
                        chained);
                }
            }
        }

        private static void ResolveMomentum(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            CriticalResolution critical)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Momentum,
                    out var momentum) ||
                momentum.Level != 5 ||
                owner.B36Stacks < 8)
            {
                return;
            }

            var gameSpeed = PlayerSpeedSystem.Current(
                state,
                owner) /
                10;
            var damage = PassiveRuntimeSystem.ScaleMagnitude(
                gameSpeed * 20 / 100,
                owner);
            if (damage <= 0)
            {
                return;
            }

            ApplyElementalPassiveDamage(
                state,
                events,
                owner,
                target,
                Math.Max(
                    1,
                    damage * critical.DamagePercent / 100),
                critical.IsCritical,
                critical.ShieldBypassPercent);
        }

        private static string SelectComboForcedPassive(
            SimulationState state,
            PlayerState owner)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Combo,
                    out var combo) ||
                combo.Level != 5 ||
                state.Random.Combat.NextInt(100) >=
                PassiveCatalog.Get(GameplayIds.Combo)
                    .Level5ForcedPassiveChancePercent)
            {
                return null;
            }

            var candidates = new List<string>();
            for (var index = 0; index < owner.Passives.Count; index += 1)
            {
                var passiveId = owner.Passives[index].PassiveId;
                if (passiveId != GameplayIds.Combo &&
                    ComboForcedPassives.Contains(passiveId))
                {
                    candidates.Add(passiveId);
                }
            }

            return candidates.Count == 0
                ? null
                : candidates[(int)state.Random.Combat.NextInt(
                    (ulong)candidates.Count)];
        }

        private static bool IsAlive(
            SimulationState state,
            CombatTarget target)
        {
            return target.IsPlayer
                ? target.Player.LifeState == LifeState.Alive
                : target.Monster.Hp > 0 &&
                    state.Monsters.ContainsKey(target.EntityId);
        }
    }
}
