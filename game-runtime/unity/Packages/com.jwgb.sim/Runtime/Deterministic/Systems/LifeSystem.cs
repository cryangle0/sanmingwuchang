using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/life.ts for the classic arena
    /// (no map field, no final court: respawn candidates are the M0
    /// spawn points and the court checks always pass).
    /// </summary>
    internal static class LifeSystem
    {
        private const int RespawnEnemyBufferMm = 12_000;
        private const int RespawnEnemyVisionBufferMm = 30_000;

        public static void BeginTrueDeath(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            EquipmentStateSystem.ClearEquipmentStateOnTrueDeath(
                state,
                player);
            player.Hp = 0;
            player.TrueDeaths += 1;
            player.LivesRemaining -= 1;
            var droppedEquipment = new List<EquippedEquipmentInstance>(
                player.InventoryEquipment);
            if (player.TrueDeaths >= 3)
            {
                droppedEquipment.AddRange(player.Equipment);
            }

            player.InventoryEquipment.Clear();
            if (player.TrueDeaths >= 3)
            {
                player.Equipment.Clear();
                EquipmentInventorySystem.RebuildEquipmentStats(player);
            }

            DropEquipmentInstances(state, events, player, droppedEquipment);
            ResetOnTrueDeath(player);
            player.Intent = PlayerIntent.Neutral(player.Intent.Sequence);
            for (var index = state.BountyMarks.Count - 1;
                index >= 0;
                index -= 1)
            {
                var mark = state.BountyMarks[index];
                if (mark.SourceEntityId == player.EntityId &&
                    mark.TargetEntityId != player.EntityId)
                {
                    state.BountyMarks.RemoveAt(index);
                }
            }

            WindWallSystem.RemoveOwned(state, player.EntityId);
            events.Add(
                new SimEvent
                {
                    Type = "true-death",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    TrueDeaths = player.TrueDeaths,
                    LivesRemaining = player.LivesRemaining
                });

            if (player.LivesRemaining <= 0)
            {
                player.LifeState = LifeState.Eliminated;
                player.RespawnTarget = null;
                player.RespawnFlightDeadlineTick = 0;
                player.RespawnRetryUntilTick = 0;
                player.RespawnAttemptCount = 0;
                state.EliminationOrder.Add(player.EntityId);
                state.EliminationTicks[player.EntityId] = state.Tick;
                events.Add(
                    new SimEvent
                    {
                        Type = "eliminated",
                        Tick = state.Tick,
                        EntityId = player.EntityId,
                        Reason = "third-true-death"
                    });
                return;
            }

            player.LifeState = LifeState.SoulFlight;
            player.RespawnAttemptCount = 0;
            AssignRespawnTarget(state, player, null);
        }

        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            var soulStepMm =
                GameplayRules.SoulSpeedMmPerSecond /
                SimulationConstants.TicksPerSecond;
            foreach (var player in state.Players.Values)
            {
                if (player.LifeState == LifeState.Eliminated)
                {
                    continue;
                }

                AdvanceTimers(player);
                ReleaseProtectionForIntent(state.Tick, player, events);
                if (player.LifeState == LifeState.ReviveProtection)
                {
                    player.ReviveProtectionTicks =
                        Math.Max(0, player.ReviveProtectionTicks - 1);
                    if (player.ReviveProtectionTicks == 0)
                    {
                        player.LifeState = LifeState.Alive;
                        events.Add(
                            new SimEvent
                            {
                                Type = "revive-protection-ended",
                                Tick = state.Tick,
                                EntityId = player.EntityId,
                                Reason = "timeout"
                            });
                    }

                    continue;
                }

                if (player.LifeState != LifeState.SoulFlight)
                {
                    continue;
                }

                if (!player.RespawnTarget.HasValue)
                {
                    throw new InvalidOperationException(
                        "Soul-flight player must have a respawn target.");
                }

                var target = player.RespawnTarget.Value;
                var remainingTicks = Math.Max(
                    1,
                    (player.RespawnRetryUntilTick > state.Tick
                        ? player.RespawnRetryUntilTick
                        : player.RespawnFlightDeadlineTick) - state.Tick);
                var distanceRemaining = (int)Math.Truncate(
                    Math.Sqrt(
                        IntegerMath.DistanceSquared(
                            player.Position,
                            target)));
                var adaptiveSoulStepMm = Math.Max(
                    Math.Max(
                        1,
                        (int)Math.Ceiling(
                            (double)distanceRemaining / remainingTicks)),
                    remainingTicks <= 1 ? soulStepMm : 0);
                player.Position = IntegerMath.MoveToward(
                    player.Position,
                    target,
                    adaptiveSoulStepMm);
                if (!player.Position.Equals(target))
                {
                    continue;
                }

                if (!IsRespawnPointLegal(state, player, target) &&
                    state.Tick < player.RespawnRetryUntilTick)
                {
                    var nextTarget = SelectRespawnTarget(
                        state,
                        player,
                        target);
                    player.RespawnTarget = nextTarget;
                    player.RespawnAttemptCount += 1;
                    continue;
                }

                if (!IsRespawnPointLegal(state, player, target))
                {
                    player.Position = SafeFallbackPoint(state, player);
                }

                player.LifeState = LifeState.ReviveProtection;
                player.Hp = player.MaxHp;
                ResetOnRespawn(player);
                player.ReviveProtectionTicks =
                    GameplayRules.ReviveProtectionTicks;
                player.RespawnTarget = null;
                player.RespawnFlightDeadlineTick = 0;
                player.RespawnRetryUntilTick = 0;
                player.RespawnAttemptCount = 0;
                events.Add(
                    new SimEvent
                    {
                        Type = "respawn",
                        Tick = state.Tick,
                        EntityId = player.EntityId,
                        Position = player.Position
                    });
            }
        }

        private static void ResetSharedCombatState(PlayerState player)
        {
            player.AttackCooldownTicks = 0;
            player.ActiveCooldownTicks = 0;
            player.ActiveBuffTicks = 0;
            player.ArmedCriticalTicks = 0;
            player.ArmedMissingHpDamagePercent = 0;
            player.ArmedActiveId = null;
            player.ActiveLifestealTicks = 0;
            player.ActiveLifestealPercent = 0;
            player.ActiveDamageReductionTicks = 0;
            player.ActiveDamageReductionBasisPoints = 10_000;
            player.ActiveSpeedBonusTicks = 0;
            player.ActiveSpeedBonusPercent = 0;
            player.WorldInteractionLockTicks = 0;
            player.PolymorphTicks = 0;
            player.PolymorphSpeedBonusPercent = 0;
            player.StealthTicks = 0;
            player.DisplacementLockTicks = 0;
            player.TreasureSenseTicks = 0;
            player.HardControlTicks = 0;
            player.SlowTicks = 0;
            player.SlowBasisPoints = 10_000;
            player.SilenceTicks = 0;
            player.SilenceCooldownPenaltyTicks = 0;
            player.BlindTicks = 0;
            player.BlindMissPercent = 0;
            player.BlindPreventsCritical = false;
            player.B15SpeedBoostTicks = 0;
            player.B15SpeedBonusPercent = 0;
            player.B25NextBasicBonusPercent = 0;
            player.B25AttackSpeedBoostTicks = 0;
            player.B25AttackSpeedBonusPercent = 0;
            player.B27SpeedBoostTicks = 0;
            player.B27SpeedBonusPercent = 0;
            player.B36Stacks = 0;
            player.B36MovingTicks = 0;
            player.B38NextHealTick = 0;
            player.WhirlwindTicks = 0;
            player.WhirlwindNextPulseTick = 0;
            player.B20ReviveBuffTicks = 0;
            player.InvulnerableTicks = 0;
            player.PvpCombatTicks = 0;
            player.IceCoffinTicks = 0;
            player.TaibaiChannelTicks = 0;
            player.TaibaiTargetHeroId = null;
            player.ConsumableVisionTicks = 0;
            player.ConsumableRevealTicks = 0;
            player.Shields.Clear();
            player.ReviveProtectionTicks = 0;
        }

        private static void ResetOnTrueDeath(PlayerState player)
        {
            ResetSharedCombatState(player);
            player.MoveRemainderX = 0;
            player.MoveRemainderZ = 0;
        }

        private static void ResetOnRespawn(PlayerState player)
        {
            ResetSharedCombatState(player);
        }

        private static void AdvanceTimers(PlayerState player)
        {
            player.AttackCooldownTicks = Math.Max(
                0,
                player.AttackCooldownTicks - 1);
            player.ActiveCooldownTicks = Math.Max(
                0,
                player.ActiveCooldownTicks - 1);
            player.ActiveBuffTicks = Math.Max(0, player.ActiveBuffTicks - 1);
            player.ArmedCriticalTicks = Math.Max(
                0,
                player.ArmedCriticalTicks - 1);
            if (player.ArmedCriticalTicks == 0)
            {
                player.ArmedMissingHpDamagePercent = 0;
                player.ArmedActiveId = null;
            }

            player.ActiveLifestealTicks = Math.Max(
                0,
                player.ActiveLifestealTicks - 1);
            player.ActiveDamageReductionTicks = Math.Max(
                0,
                player.ActiveDamageReductionTicks - 1);
            player.ActiveSpeedBonusTicks = Math.Max(
                0,
                player.ActiveSpeedBonusTicks - 1);
            player.WorldInteractionLockTicks = Math.Max(
                0,
                player.WorldInteractionLockTicks - 1);
            player.PolymorphTicks = Math.Max(0, player.PolymorphTicks - 1);
            player.StealthTicks = Math.Max(0, player.StealthTicks - 1);
            player.DisplacementLockTicks = Math.Max(
                0,
                player.DisplacementLockTicks - 1);
            player.TreasureSenseTicks = Math.Max(
                0,
                player.TreasureSenseTicks - 1);
            player.HardControlTicks = Math.Max(0, player.HardControlTicks - 1);
            player.B19RetriggerLockTicks = Math.Max(
                0,
                player.B19RetriggerLockTicks - 1);
            player.B20ReviveBuffTicks = Math.Max(
                0,
                player.B20ReviveBuffTicks - 1);
            player.InvulnerableTicks = Math.Max(
                0,
                player.InvulnerableTicks - 1);
            player.PvpCombatTicks = Math.Max(
                0,
                player.PvpCombatTicks - 1);
            player.IceCoffinTicks = Math.Max(0, player.IceCoffinTicks - 1);
            player.ConsumableVisionTicks = Math.Max(
                0,
                player.ConsumableVisionTicks - 1);
            player.ConsumableRevealTicks = Math.Max(
                0,
                player.ConsumableRevealTicks - 1);
        }

        private static void ReleaseProtectionForIntent(
            int tick,
            PlayerState player,
            List<SimEvent> events)
        {
            if (player.LifeState != LifeState.ReviveProtection ||
                (!player.Intent.Attack &&
                 !player.Intent.CastActive &&
                 !player.Intent.Interact))
            {
                return;
            }

            player.LifeState = LifeState.Alive;
            player.ReviveProtectionTicks = 0;
            events.Add(
                new SimEvent
                {
                    Type = "revive-protection-ended",
                    Tick = tick,
                    EntityId = player.EntityId,
                    Reason = "intent"
                });
        }

        private static void DropEquipmentInstances(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            List<EquippedEquipmentInstance> instances)
        {
            for (var index = 0; index < instances.Count; index += 1)
            {
                var instance = instances[index];
                var drop = new LootDropState
                {
                    EntityId = state.NextEntityId,
                    Position = player.Position,
                    EquipmentId = instance.EquipmentId,
                    CreatedAtTick = state.Tick,
                    ExpiresAtTick = 9_007_199_254_740_991L,
                    HasRuntimeFields = true,
                    Kind = "death-equipment",
                    ActiveId = null,
                    EquipmentInstanceId = instance.InstanceId,
                    AcquiredAtTick = instance.AcquiredAtTick,
                    PermanentAttackBonus = instance.PermanentAttackBonus,
                    StormCoveredSinceTick = null
                };
                state.NextEntityId += 1;
                state.LootDrops.Add(drop.EntityId, drop);
                events.Add(
                    new SimEvent
                    {
                        Type = "loot-dropped",
                        Tick = state.Tick,
                        EntityId = drop.EntityId,
                        SourceEntityId = player.EntityId
                    });
            }
        }

        private static void AssignRespawnTarget(
            SimulationState state,
            PlayerState player,
            Int2Mm? excluded)
        {
            var target = SelectRespawnTarget(state, player, excluded);
            player.RespawnTarget = target;
            player.RespawnFlightDeadlineTick = state.Tick +
                RespawnFlightTicks(player.Position, target);
            player.RespawnRetryUntilTick =
                player.RespawnFlightDeadlineTick +
                (3 * SimulationConstants.TicksPerSecond);
            player.RespawnAttemptCount += 1;
        }

        private static int RespawnFlightTicks(Int2Mm from, Int2Mm to)
        {
            var distance = (int)Math.Truncate(
                Math.Sqrt(IntegerMath.DistanceSquared(from, to)));
            var seconds = Math.Min(10d, Math.Max(3d, distance / 18_000d));
            return Math.Max(
                1,
                (int)Math.Ceiling(
                    seconds * SimulationConstants.TicksPerSecond));
        }

        private static Int2Mm[] mapSpawnCandidates;

        private static IReadOnlyList<Int2Mm> RespawnCandidates(
            SimulationState state)
        {
            if (state.MapField != null &&
                state.StormZone.CourtAnnounced &&
                TryGetSelectedCourt(state, out var court))
            {
                var revivePoints = new Int2Mm[court.RevivePoints.Length];
                for (var index = 0; index < revivePoints.Length; index += 1)
                {
                    revivePoints[index] = new Int2Mm(
                        checked((int)court.RevivePoints[index].X),
                        checked((int)court.RevivePoints[index].Z));
                }

                return revivePoints;
            }

            if (state.MapField != null)
            {
                if (mapSpawnCandidates == null)
                {
                    var spawns = MapGeometryCatalog.SpawnPoints;
                    mapSpawnCandidates = new Int2Mm[spawns.Length];
                    for (var index = 0; index < spawns.Length; index += 1)
                    {
                        mapSpawnCandidates[index] = new Int2Mm(
                            checked((int)spawns[index].Position.X),
                            checked((int)spawns[index].Position.Z));
                    }
                }

                return mapSpawnCandidates;
            }

            return GameplayRules.SpawnPoints;
        }

        private static bool TryGetSelectedCourt(
            SimulationState state,
            out MapCourtGeometryRecord court)
        {
            court = default;
            var courtId = state.StormZone.SelectedCourtId;
            if (courtId == null)
            {
                return false;
            }

            var courts = MapGeometryCatalog.Courts;
            for (var index = 0; index < courts.Length; index += 1)
            {
                if (courts[index].Id == courtId)
                {
                    court = courts[index];
                    return true;
                }
            }

            return false;
        }

        private static bool PointInsideFinalCourt(
            SimulationState state,
            Int2Mm point)
        {
            if (state.MapField == null || !state.StormZone.CourtAnnounced)
            {
                return true;
            }

            if (!TryGetSelectedCourt(state, out var court))
            {
                return false;
            }

            return IntegerGeometry.RingContainsPoint(
                court.HexVertices,
                MapCollisionAdapter.ToMapPoint(point));
        }

        private static bool IsRespawnPointLegal(
            SimulationState state,
            PlayerState player,
            Int2Mm point)
        {
            if (!StormZoneSystem.IsInsideNormalStormSafeZone(state, point) ||
                !PointInsideFinalCourt(state, point))
            {
                return false;
            }

            if (state.MapField != null &&
                state.MapField.IsCircleBlocked(
                    MapCollisionAdapter.ToMapPoint(point),
                    GameplayRules.PlayerCapsuleRadiusMm))
            {
                return false;
            }

            foreach (var enemy in state.Players.Values)
            {
                if (enemy.EntityId == player.EntityId ||
                    enemy.LifeState == LifeState.Eliminated ||
                    enemy.LifeState == LifeState.SoulFlight)
                {
                    continue;
                }

                var distance = IntegerMath.DistanceSquared(
                    enemy.Position,
                    point);
                if (distance <=
                    (long)RespawnEnemyBufferMm * RespawnEnemyBufferMm)
                {
                    return false;
                }

                if (distance <= (long)RespawnEnemyVisionBufferMm *
                        RespawnEnemyVisionBufferMm &&
                    LineOfSightSystem.HasDirectLineOfSight(
                        state,
                        enemy.Position,
                        point))
                {
                    return false;
                }
            }

            return true;
        }

        private static Int2Mm SafeFallbackPoint(
            SimulationState state,
            PlayerState player)
        {
            var candidates = RespawnCandidates(state);
            for (var index = 0; index < candidates.Count; index += 1)
            {
                if (IsRespawnPointLegal(state, player, candidates[index]))
                {
                    return candidates[index];
                }
            }

            if (state.MapField != null &&
                state.StormZone.CourtAnnounced &&
                TryGetSelectedCourt(state, out var court))
            {
                var center = new Int2Mm(
                    checked((int)court.Center.X),
                    checked((int)court.Center.Z));
                if (StormZoneSystem.IsInsideNormalStormSafeZone(
                        state,
                        center) &&
                    PointInsideFinalCourt(state, center) &&
                    !state.MapField.IsCircleBlocked(
                        MapCollisionAdapter.ToMapPoint(center),
                        GameplayRules.PlayerCapsuleRadiusMm))
                {
                    return center;
                }
            }

            for (var index = 0; index < candidates.Count; index += 1)
            {
                var point = candidates[index];
                if (StormZoneSystem.IsInsideNormalStormSafeZone(
                        state,
                        point) &&
                    PointInsideFinalCourt(state, point) &&
                    (state.MapField == null ||
                     !state.MapField.IsCircleBlocked(
                         MapCollisionAdapter.ToMapPoint(point),
                         GameplayRules.PlayerCapsuleRadiusMm)))
                {
                    return point;
                }
            }

            return player.Position;
        }

        private static Int2Mm SelectRespawnTarget(
            SimulationState state,
            PlayerState player,
            Int2Mm? excluded)
        {
            var livingEnemies = new List<PlayerState>();
            foreach (var candidate in state.Players.Values)
            {
                if (candidate.EntityId != player.EntityId &&
                    candidate.LifeState != LifeState.Eliminated &&
                    candidate.LifeState != LifeState.SoulFlight)
                {
                    livingEnemies.Add(candidate);
                }
            }

            var candidates = RespawnCandidates(state);
            var bestIndex = -1;
            var bestNearestEnemy = long.MinValue;
            var bestFromDeath = long.MinValue;
            for (var index = 0; index < candidates.Count; index += 1)
            {
                var point = candidates[index];
                if (excluded.HasValue &&
                    point.X == excluded.Value.X &&
                    point.Z == excluded.Value.Z)
                {
                    continue;
                }

                if (!IsRespawnPointLegal(state, player, point))
                {
                    continue;
                }

                var fromDeath = IntegerMath.DistanceSquared(
                    player.Position,
                    point);
                var nearestEnemy = long.MaxValue;
                for (var enemyIndex = 0;
                    enemyIndex < livingEnemies.Count;
                    enemyIndex += 1)
                {
                    nearestEnemy = Math.Min(
                        nearestEnemy,
                        IntegerMath.DistanceSquared(
                            livingEnemies[enemyIndex].Position,
                            point));
                }

                if (nearestEnemy > bestNearestEnemy ||
                    (nearestEnemy == bestNearestEnemy &&
                     fromDeath > bestFromDeath))
                {
                    bestIndex = index;
                    bestNearestEnemy = nearestEnemy;
                    bestFromDeath = fromDeath;
                }
            }

            return bestIndex >= 0
                ? candidates[bestIndex]
                : SafeFallbackPoint(state, player);
        }
    }
}
