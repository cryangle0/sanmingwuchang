using System;
using System.Collections.Generic;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveHitSystem
    {
        private static bool ShouldProc(
            SimulationState state,
            bool forced,
            int percent)
        {
            return forced ||
                state.Random.Combat.NextInt(100) < percent;
        }

        private static void MaxSlow(
            CombatTarget target,
            int slowPercent,
            int durationTicks)
        {
            if (target.IsPlayer)
            {
                PassiveRuntimeSystem.MaxSlow(
                    target.Player,
                    slowPercent,
                    durationTicks);
            }
            else
            {
                PassiveRuntimeSystem.MaxSlow(
                    target.Monster,
                    slowPercent,
                    durationTicks);
            }
        }

        private static void SetSilence(
            CombatTarget target,
            int durationTicks)
        {
            if (target.IsPlayer)
            {
                target.Player.SilenceTicks = Math.Max(
                    target.Player.SilenceTicks,
                    durationTicks);
            }
            else
            {
                target.Monster.SilenceTicks = Math.Max(
                    target.Monster.SilenceTicks,
                    durationTicks);
            }
        }

        private static void AddSilencePenalty(
            CombatTarget target,
            int penaltyTicks)
        {
            if (target.IsPlayer)
            {
                target.Player.SilenceCooldownPenaltyTicks +=
                    penaltyTicks;
            }
            else
            {
                target.Monster.SilenceCooldownPenaltyTicks +=
                    penaltyTicks;
            }
        }

        private static void SetBlind(
            CombatTarget target,
            int durationTicks,
            int missPercent)
        {
            if (target.IsPlayer)
            {
                target.Player.BlindTicks = Math.Max(
                    target.Player.BlindTicks,
                    durationTicks);
                target.Player.BlindMissPercent = Math.Max(
                    target.Player.BlindMissPercent,
                    missPercent);
            }
            else
            {
                target.Monster.BlindTicks = Math.Max(
                    target.Monster.BlindTicks,
                    durationTicks);
                target.Monster.BlindMissPercent = Math.Max(
                    target.Monster.BlindMissPercent,
                    missPercent);
            }
        }

        private static void ApplyControl(
            CombatTarget target,
            int durationTicks)
        {
            if (target.IsPlayer)
            {
                PassiveRuntimeSystem.ApplyTargetHardControl(
                    target.Player,
                    durationTicks);
            }
            else
            {
                target.Monster.HardControlTicks = Math.Max(
                    target.Monster.HardControlTicks,
                    durationTicks);
            }
        }

        private static void MoveAway(
            SimulationState state,
            Int2Mm origin,
            CombatTarget target,
            int distanceMm)
        {
            var dx = target.Position.X - origin.X;
            var dz = target.Position.Z - origin.Z;
            var magnitude = Math.Max(1, Math.Abs(dx) + Math.Abs(dz));
            var requested = new Int2Mm(
                target.Position.X + dx * distanceMm / magnitude,
                target.Position.Z + dz * distanceMm / magnitude);
            var resolved = DisplacementSystem.ResolveForced(
                state,
                target.Position,
                requested,
                target.CollisionRadiusMm);
            if (target.IsPlayer)
            {
                target.Player.Position = resolved;
            }
            else
            {
                target.Monster.Position = resolved;
            }
        }

        private static List<CombatTarget> NearbyTargets(
            SimulationState state,
            Int2Mm center,
            int radiusMm)
        {
            var result = new List<CombatTarget>();
            var radiusSquared = (long)radiusMm * radiusMm;
            foreach (var player in state.Players.Values)
            {
                if (player.LifeState == LifeState.Alive &&
                    IntegerMath.DistanceSquared(
                        center,
                        player.Position) <= radiusSquared)
                {
                    result.Add(new CombatTarget(player));
                }
            }

            foreach (var monster in state.Monsters.Values)
            {
                if (monster.Hp > 0 &&
                    IntegerMath.DistanceSquared(
                        center,
                        monster.Position) <= radiusSquared)
                {
                    result.Add(new CombatTarget(monster));
                }
            }

            return result;
        }

        private static void Emit(
            SimulationState state,
            List<SimEvent> events,
            string passiveId,
            int sourceEntityId,
            int targetEntityId,
            string detail,
            int amount,
            int durationTicks)
        {
            events.Add(
                new SimEvent
                {
                    Type = "passive-proc",
                    Tick = state.Tick,
                    PassiveId = passiveId,
                    SourceEntityId = sourceEntityId,
                    TargetEntityId = targetEntityId,
                    Detail = detail,
                    Amount = amount,
                    DurationTicks = durationTicks
                });
        }
    }
}
