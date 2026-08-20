using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class ShieldBreakSystem
    {
        public static void Resolve(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            IReadOnlyList<ShieldState> brokenShields)
        {
            var ordered = new List<ShieldState>(brokenShields);
            ordered.Sort(
                (left, right) =>
                    left.CreationSequence.CompareTo(
                        right.CreationSequence));
            for (var shieldIndex = 0;
                shieldIndex < ordered.Count;
                shieldIndex += 1)
            {
                var effect = ordered[shieldIndex].BreakEffect;
                if (effect == null)
                {
                    continue;
                }

                foreach (var target in state.Players.Values)
                {
                    if (target.EntityId == owner.EntityId ||
                        target.LifeState != LifeState.Alive ||
                        IntegerMath.DistanceSquared(
                            owner.Position,
                            target.Position) >
                        (long)effect.RadiusMm * effect.RadiusMm)
                    {
                        continue;
                    }

                    var outgoingDamage = checked(
                        effect.Damage *
                        LethalProtectionSystem
                            .GetOutgoingDamageBasisPoints(owner) /
                        10_000);
                    var elementBasisPoints =
                        GameplayRules.ElementDamageBasisPoints(
                            effect.SourceElement,
                            target.Element);
                    var damage = System.Math.Max(
                        1,
                        checked(
                            outgoingDamage *
                            elementBasisPoints /
                            10_000));
                    DamageSystem.Apply(
                        state,
                        events,
                        new DamageRequest(
                            effect.SourceEntityId,
                            target.EntityId,
                            damage,
                            DamageCause.Passive,
                            DamageForm.Skill,
                            10_000));
                }
            }
        }
    }
}
