using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class SummonSystem
    {
        private static void ResolveDeathEffects(
            SimulationState state,
            List<SimEvent> events,
            SummonState summon,
            PlayerState owner,
            bool destroyed)
        {
            if (destroyed &&
                PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Resonance,
                    out var resonance))
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.Resonance);
                var multiplier = resonance.Level == 5
                    ? definition.Level5EffectMultiplierBasisPoints
                    : 10_000;
                var heal = PassiveRuntimeSystem.ScaleMagnitude(
                    checked(
                        PassiveCatalog.LevelValue(
                            definition.HealByLevel,
                            resonance.Level) *
                        multiplier /
                        10_000),
                    owner);
                var damage = PassiveRuntimeSystem.ScaleMagnitude(
                    checked(
                        PassiveCatalog.LevelValue(
                            definition.AoeDamageByLevel,
                            resonance.Level) *
                        multiplier /
                        10_000),
                    owner);
                var before = owner.Hp;
                owner.Hp = Math.Min(owner.MaxHp, owner.Hp + heal);
                ApplyOwnerAreaDamage(
                    state,
                    events,
                    owner,
                    summon.Position,
                    definition.AoeRadiusMm,
                    damage);
                events.Add(
                    new SimEvent
                    {
                        Type = "passive-proc",
                        Tick = state.Tick,
                        PassiveId = GameplayIds.Resonance,
                        SourceEntityId = owner.EntityId,
                        TargetEntityId = summon.EntityId,
                        Detail = "summon-death",
                        Amount = owner.Hp - before
                    });
            }

            if (destroyed &&
                summon.Kind == SummonKind.StoneStatue)
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.StoneStatue);
                ApplyOwnerAreaDamage(
                    state,
                    events,
                    owner,
                    summon.Position,
                    definition.DestructionRadiusMm,
                    PassiveRuntimeSystem.ScaleMagnitude(
                        definition.DestructionDamage,
                        owner));
            }
        }

        private static void ApplyOwnerAreaDamage(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            Int2Mm center,
            int radiusMm,
            int amount)
        {
            if (amount <= 0)
            {
                return;
            }

            var radiusSquared = (long)radiusMm * radiusMm;
            foreach (var target in state.Players.Values)
            {
                if (target.EntityId == owner.EntityId ||
                    target.LifeState != LifeState.Alive ||
                    target.InvulnerableTicks > 0 ||
                    IntegerMath.DistanceSquared(
                        center,
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
                        amount,
                        DamageCause.Passive,
                        DamageForm.Skill));
            }

            foreach (var target in state.Monsters.Values)
            {
                if (target.Hp <= 0 ||
                    target.InvulnerableTicks > 0 ||
                    IntegerMath.DistanceSquared(
                        center,
                        target.Position) > radiusSquared)
                {
                    continue;
                }

                MonsterDamageSystem.Apply(
                    state,
                    events,
                    owner.EntityId,
                    target,
                    amount,
                    owner.Element);
            }

            var summonDamage = Math.Max(
                1,
                checked(
                    amount *
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
                        center,
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
