using System;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal readonly struct BasicAttackModifier
    {
        public BasicAttackModifier(int damageBasisPoints, bool guaranteedCritical)
        {
            DamageBasisPoints = damageBasisPoints;
            GuaranteedCritical = guaranteedCritical;
        }

        public int DamageBasisPoints { get; }
        public bool GuaranteedCritical { get; }
    }

    internal readonly struct IncomingDamageModifier
    {
        public IncomingDamageModifier(int amount, bool avoided)
        {
            Amount = amount;
            Avoided = avoided;
        }

        public int Amount { get; }
        public bool Avoided { get; }
    }

    internal static partial class PassiveRuntimeSystem
    {
        public static void MaxSlow(
            PlayerState target,
            int slowPercent,
            int durationTicks)
        {
            if (TryFind(
                    target,
                    GameplayIds.Sprint,
                    out var sprint) &&
                sprint.Level == 5 &&
                target.B27SpeedBoostTicks > 0)
            {
                return;
            }

            var basisPoints = Math.Max(0, 10_000 - slowPercent * 100);
            if (basisPoints < target.SlowBasisPoints ||
                (basisPoints == target.SlowBasisPoints &&
                 durationTicks > target.SlowTicks))
            {
                target.SlowBasisPoints = basisPoints;
                target.SlowTicks = durationTicks;
            }
        }

        public static void MaxSlow(
            MonsterState target,
            int slowPercent,
            int durationTicks)
        {
            var basisPoints = Math.Max(0, 10_000 - slowPercent * 100);
            if (basisPoints < target.SlowBasisPoints ||
                (basisPoints == target.SlowBasisPoints &&
                 durationTicks > target.SlowTicks))
            {
                target.SlowBasisPoints = basisPoints;
                target.SlowTicks = durationTicks;
            }
        }

        public static bool IsBasicAttackMissed(
            SimulationState state,
            PlayerState attacker)
        {
            return attacker.BlindTicks > 0 &&
                attacker.BlindMissPercent > 0 &&
                state.Random.Combat.NextInt(100) <
                attacker.BlindMissPercent;
        }

        public static bool IsBasicAttackMissed(
            SimulationState state,
            MonsterState attacker)
        {
            return attacker.BlindTicks > 0 &&
                attacker.BlindMissPercent > 0 &&
                state.Random.Combat.NextInt(100) <
                attacker.BlindMissPercent;
        }

        public static int EffectiveAttackPower(PlayerState player)
        {
            var basisPoints = 10_000;
            if (TryFind(
                    player,
                    GameplayIds.Bloodlust,
                    out var loadout))
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.Bloodlust);
                var missingSteps = Math.Max(
                    0,
                    ((player.MaxHp - player.Hp) * 10) /
                    Math.Max(1, player.MaxHp));
                basisPoints += missingSteps *
                    PassiveCatalog.LevelValue(
                        definition.AttackBonusPerMissingTenPercentByLevel,
                        loadout.Level) *
                    100;
            }

            return Math.Max(
                1,
                player.AttackPower * basisPoints / 10_000);
        }

        public static int ScalePassiveMagnitude(
            int value,
            PlayerState player)
        {
            return value * GetPassiveEffectMagnitudeBasisPoints(player) /
                10_000;
        }

        public static int GetPassiveEffectMagnitudeBasisPoints(
            PlayerState player)
        {
            if (player.ActiveBuffTicks <= 0)
            {
                return 10_000;
            }

            var active = ActiveCatalog.Get(player.ActiveAbilityId);
            return active.Effect == ActiveEffect.SelfCombatBuff
                ? active.PassiveEffectMagnitudeBasisPoints
                : 10_000;
        }

        public static BasicAttackModifier ResolveBasicAttackModifier(
            SimulationState state,
            PlayerState owner,
            PlayerState target)
        {
            return ResolveBasicAttackModifier(
                state,
                owner,
                target.Position,
                target.Facing,
                target.EntityId,
                target.Hp,
                target.MaxHp);
        }

        public static BasicAttackModifier ResolveBasicAttackModifier(
            SimulationState state,
            PlayerState owner,
            MonsterState target)
        {
            return ResolveBasicAttackModifier(
                state,
                owner,
                target.Position,
                target.Facing,
                target.EntityId,
                target.Hp,
                target.MaxHp);
        }

        private static BasicAttackModifier ResolveBasicAttackModifier(
            SimulationState state,
            PlayerState owner,
            Int2Mm targetPosition,
            Int2Mm targetFacing,
            int targetEntityId,
            int targetHp,
            int targetMaxHp)
        {
            var damageBasisPoints = 10_000;
            var guaranteedCritical = false;
            if (TryFind(
                    owner,
                    GameplayIds.Backstab,
                    out var backstab) &&
                IsBehind(owner, targetPosition, targetFacing))
            {
                var bonus = new[] { 35, 42, 50, 58, 70 }[
                    backstab.Level - 1];
                damageBasisPoints += bonus * 100;
                guaranteedCritical = backstab.Level == 5;
            }

            if (TryFind(
                    owner,
                    GameplayIds.Ambush,
                    out var ambush))
            {
                var targetState = GetOrCreateTargetState(
                    state,
                    owner.EntityId,
                    targetEntityId);
                var definition = PassiveCatalog.Get(
                    GameplayIds.Ambush);
                var threshold = PassiveCatalog.LevelValue(
                    definition.OutOfCombatTicksByLevel,
                    ambush.Level);
                if (targetState.LastBasicHitTick < 0 ||
                    state.Tick - targetState.LastBasicHitTick >= threshold)
                {
                    damageBasisPoints += PassiveCatalog.LevelValue(
                        definition.DamageBonusPercentByLevel,
                        ambush.Level) * 100;
                    if (ambush.Level == 5)
                    {
                        targetState.RevealExpiresAtTick =
                            state.Tick + definition.Level5RevealTicks;
                    }
                }
            }

            if (owner.B21FirstHitReady)
            {
                damageBasisPoints += 3_000;
                owner.B21FirstHitReady = false;
            }

            if (TryFind(
                    owner,
                    GameplayIds.StormWard,
                    out var stormWard) &&
                stormWard.Level == 5 &&
                StormSystem.IsInNormalStormZone(
                    state,
                    owner.Position))
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.StormWard);
                damageBasisPoints +=
                    definition.Level5BasicDamageBonusPercent * 100;
            }

            if (owner.B25NextBasicBonusPercent > 0)
            {
                damageBasisPoints +=
                    owner.B25NextBasicBonusPercent * 100;
                owner.B25NextBasicBonusPercent = 0;
            }

            return new BasicAttackModifier(
                damageBasisPoints,
                guaranteedCritical);
        }

    }
}
