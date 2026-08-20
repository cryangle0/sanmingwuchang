using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class AfterimageSystem
    {
        private const int TriggerRadiusMm = 1_000;

        public static void ResetTimer(PlayerState player)
        {
            player.B30NextAfterimageTick = 0;
        }

        public static void MaybeSpawn(
            SimulationState state,
            PlayerState player,
            Int2Mm previousPosition)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.Afterimage,
                    out var loadout))
            {
                return;
            }

            var definition = PassiveCatalog.Get(
                GameplayIds.Afterimage);
            var intervalTicks = PassiveCatalog.LevelValue(
                definition.IntervalTicksByLevel,
                loadout.Level);
            if (player.B30NextAfterimageTick == 0)
            {
                player.B30NextAfterimageTick =
                    checked(state.Tick + intervalTicks);
                return;
            }

            if (state.Tick < player.B30NextAfterimageTick)
            {
                return;
            }

            var durationTicks = PassiveCatalog.LevelValue(
                definition.DurationTicksByLevel,
                loadout.Level);
            var afterimage = new AfterimageState
            {
                EntityId = state.NextEntityId,
                OwnerEntityId = player.EntityId,
                Position = previousPosition,
                SlowPercent = PassiveCatalog.LevelValue(
                    definition.SlowPercentByLevel,
                    loadout.Level),
                SlowDurationTicks = durationTicks,
                ExplosionDamage = loadout.Level == 5
                    ? definition.Level5ExplosionDamage
                    : 0,
                ExplosionRadiusMm =
                    definition.Level5ExplosionRadiusMm,
                ExpiresAtTick = checked(state.Tick + durationTicks)
            };
            state.NextEntityId += 1;
            state.Afterimages.Add(afterimage.EntityId, afterimage);
            player.B30NextAfterimageTick = checked(
                player.B30NextAfterimageTick + intervalTicks);
        }

        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            var afterimages = new List<AfterimageState>(
                state.Afterimages.Values);
            for (var index = 0; index < afterimages.Count; index += 1)
            {
                var afterimage = afterimages[index];
                if (!state.Players.TryGetValue(
                        afterimage.OwnerEntityId,
                        out var owner) ||
                    owner.LifeState == LifeState.Eliminated ||
                    afterimage.ExpiresAtTick <= state.Tick)
                {
                    state.Afterimages.Remove(afterimage.EntityId);
                    continue;
                }

                var target = FindNearestTarget(
                    state,
                    owner,
                    afterimage.Position);
                if (!target.HasValue)
                {
                    continue;
                }

                var selected = target.Value;
                if (selected.IsPlayer)
                {
                    PassiveRuntimeSystem.MaxSlow(
                        selected.Player,
                        afterimage.SlowPercent,
                        afterimage.SlowDurationTicks);
                }
                else if (selected.IsMonster)
                {
                    PassiveRuntimeSystem.MaxSlow(
                        selected.Monster,
                        afterimage.SlowPercent,
                        afterimage.SlowDurationTicks);
                }

                ApplyExplosionDamage(
                    state,
                    events,
                    afterimage,
                    owner);
                state.Afterimages.Remove(afterimage.EntityId);
                events.Add(
                    new SimEvent
                    {
                        Type = "passive-proc",
                        Tick = state.Tick,
                        PassiveId = GameplayIds.Afterimage,
                        SourceEntityId = owner.EntityId,
                        TargetEntityId = selected.EntityId,
                        Detail = "afterimage-triggered",
                        Amount = afterimage.ExplosionDamage,
                        DurationTicks = afterimage.SlowDurationTicks
                    });
            }
        }

        private static CombatTarget? FindNearestTarget(
            SimulationState state,
            PlayerState owner,
            Int2Mm position)
        {
            CombatTarget? best = null;
            var bestDistance = long.MaxValue;
            foreach (var player in state.Players.Values)
            {
                if (player.EntityId == owner.EntityId ||
                    player.LifeState != LifeState.Alive)
                {
                    continue;
                }

                Consider(
                    position,
                    new CombatTarget(player),
                    ref best,
                    ref bestDistance);
            }

            foreach (var monster in state.Monsters.Values)
            {
                if (monster.Hp <= 0)
                {
                    continue;
                }

                Consider(
                    position,
                    new CombatTarget(monster),
                    ref best,
                    ref bestDistance);
            }

            foreach (var summon in state.Summons.Values)
            {
                if (summon.OwnerEntityId == owner.EntityId ||
                    !summon.Targetable ||
                    summon.Hp <= 0)
                {
                    continue;
                }

                Consider(
                    position,
                    new CombatTarget(summon),
                    ref best,
                    ref bestDistance);
            }

            return best;
        }

        private static void Consider(
            Int2Mm position,
            CombatTarget candidate,
            ref CombatTarget? best,
            ref long bestDistance)
        {
            var distance = IntegerMath.DistanceSquared(
                position,
                candidate.Position);
            if (distance > TriggerRadiusMm * (long)TriggerRadiusMm)
            {
                return;
            }

            if (distance < bestDistance ||
                (distance == bestDistance &&
                 (!best.HasValue ||
                  candidate.EntityId < best.Value.EntityId)))
            {
                best = candidate;
                bestDistance = distance;
            }
        }

    }
}
