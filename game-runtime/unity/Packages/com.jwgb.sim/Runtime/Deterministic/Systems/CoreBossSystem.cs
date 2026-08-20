using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/core-boss.ts.
    /// </summary>
    internal static class CoreBossSystem
    {
        private const int TrueSightRadiusMm = 10_000;
        private const int PublicRingRadiusMm = 10_000;
        private const int MeteorRadiusMm = 6_000;
        private const int EarthbreakLengthMm = 20_000;
        private const int EarthbreakWidthMm = 2_000;
        private const int EarthbreakGapMm = 3_000;
        private const int FirelaneLengthMm = 18_000;
        private const int FirelaneWidthMm = 3_000;
        private const int WindchargeLengthMm = 18_000;
        private const int WindchargeWidthMm = 3_000;
        private const int PoisonRadiusMm = 5_000;
        private const int MirrorDurationTicks =
            10 * SimulationConstants.TicksPerSecond;

        /// <summary>ceil(TICKS_PER_SECOND / 0.8) = 25.</summary>
        private const int MirrorAttackPeriodTicks = 25;

        private static readonly string[] Signatures =
        {
            "earthbreak",
            "firelane",
            "poisonpool",
            "windcharge",
            "thunderchain",
            "mirrorshadow"
        };

        private static readonly int[] SignatureCooldownSeconds =
        {
            16, 18, 20, 16, 18, 24
        };

        private static readonly Int2Mm[] RotatedDirections =
        {
            new Int2Mm(1_000, 0),
            new Int2Mm(-500, 866),
            new Int2Mm(-500, -866)
        };

        public static void Initialize(
            SimulationState state,
            MonsterState boss)
        {
            state.CoreBossRuntimes[boss.EntityId] = new CoreBossRuntimeState
            {
                BossEntityId = boss.EntityId,
                CourtId = boss.CourtId,
                NextRingCastTick = state.Tick +
                    5 * SimulationConstants.TicksPerSecond,
                NextMeteorCastTick = state.Tick +
                    10 * SimulationConstants.TicksPerSecond,
                NextSignatureCastTick = state.Tick +
                    16 * SimulationConstants.TicksPerSecond,
                SignatureIndex = 0
            };
        }

        public static void RecordThreat(
            SimulationState state,
            int sourceEntityId,
            int amount)
        {
            if (amount <= 0)
            {
                return;
            }

            PlayerState sourcePlayer = null;
            if (!state.Players.TryGetValue(
                    sourceEntityId,
                    out sourcePlayer))
            {
                if (state.Summons.TryGetValue(
                        sourceEntityId,
                        out var summon))
                {
                    state.Players.TryGetValue(
                        summon.OwnerEntityId,
                        out sourcePlayer);
                }
            }

            if (sourcePlayer == null)
            {
                return;
            }

            state.CoreBossThreat.TryGetValue(
                sourcePlayer.EntityId,
                out var existing);
            state.CoreBossThreat[sourcePlayer.EntityId] = existing + amount;
        }

        public static void HandleDefeated(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss)
        {
            CreateRevealAnchor(state, events, boss);
            state.CoreBossRuntimes.Remove(boss.EntityId);
            state.CoreBossThreat.Clear();
            RemoveBossHazards(state, boss.EntityId);
            var mirrors = OwnedMirrors(state, boss.EntityId);
            for (var index = 0; index < mirrors.Count; index += 1)
            {
                state.Summons.Remove(mirrors[index].EntityId);
                events.Add(
                    new SimEvent
                    {
                        Type = "summon-expired",
                        Tick = state.Tick,
                        EntityId = mirrors[index].EntityId,
                        SourceEntityId = boss.EntityId,
                        Detail = "core-mirror"
                    });
            }
        }

        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            CleanupExpired(state);
            var bosses = new List<MonsterState>();
            foreach (var monster in state.Monsters.Values)
            {
                if (monster.Kind == MonsterKind.CoreBoss)
                {
                    bosses.Add(monster);
                }
            }

            for (var bossIndex = 0; bossIndex < bosses.Count; bossIndex += 1)
            {
                var boss = bosses[bossIndex];
                if (!state.CoreBossRuntimes.ContainsKey(boss.EntityId))
                {
                    Initialize(state, boss);
                }

                if (!state.CoreBossRuntimes.TryGetValue(
                        boss.EntityId,
                        out var runtime))
                {
                    continue;
                }

                MigrateIfNeeded(state, events, boss, runtime);
                var hazards = new List<CoreBossHazardState>();
                foreach (var hazard in state.CoreBossHazards.Values)
                {
                    if (hazard.BossEntityId == boss.EntityId)
                    {
                        hazards.Add(hazard);
                    }
                }

                for (var index = 0; index < hazards.Count; index += 1)
                {
                    if (state.CoreBossHazards.ContainsKey(
                            hazards[index].EntityId))
                    {
                        ResolveHazard(state, events, boss, hazards[index]);
                    }
                }

                AdvanceMirrors(state, events, boss);
                if (boss.InvulnerableTicks > 0)
                {
                    continue;
                }

                var scaled = state.Tick >=
                    10 * 60 * SimulationConstants.TicksPerSecond;
                if (state.Tick >= runtime.NextRingCastTick)
                {
                    CastPublicRing(state, events, boss);
                    runtime.NextRingCastTick = state.Tick +
                        ScaledSecondsToTicks(10, scaled);
                }

                if (state.Tick >= runtime.NextMeteorCastTick)
                {
                    CastPublicMeteor(state, events, boss);
                    runtime.NextMeteorCastTick = state.Tick +
                        ScaledSecondsToTicks(20, scaled);
                }

                if (state.Tick >= runtime.NextSignatureCastTick)
                {
                    var index = runtime.SignatureIndex % Signatures.Length;
                    CastSignature(state, events, boss, Signatures[index]);
                    runtime.SignatureIndex =
                        (runtime.SignatureIndex + 1) % Signatures.Length;
                    runtime.NextSignatureCastTick = state.Tick +
                        ScaledSecondsToTicks(
                            SignatureCooldownSeconds[index],
                            scaled);
                }
            }
        }

        public static CoreBossRevealAnchorState CreateRevealAnchor(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss)
        {
            var anchor = new CoreBossRevealAnchorState
            {
                EntityId = state.NextEntityId,
                BossEntityId = boss.EntityId,
                Position = boss.Position,
                ExpiresAtTick = state.Tick +
                    10 * SimulationConstants.TicksPerSecond
            };
            state.NextEntityId += 1;
            state.CoreBossRevealAnchors[anchor.EntityId] = anchor;
            events.Add(
                new SimEvent
                {
                    Type = "core-boss-reveal-anchor",
                    Tick = state.Tick,
                    EntityId = anchor.EntityId,
                    SourceEntityId = boss.EntityId
                });
            return anchor;
        }

        /// <summary>
        /// ceil(seconds * TICKS_PER_SECOND * scale) with scale in {1, 0.9};
        /// both products are exact integers for the seconds used here.
        /// </summary>
        private static int ScaledSecondsToTicks(int seconds, bool scaled)
        {
            return Math.Max(
                1,
                scaled
                    ? seconds * 18
                    : seconds * SimulationConstants.TicksPerSecond);
        }

        private static void CleanupExpired(SimulationState state)
        {
            var expiredAnchors = new List<int>();
            foreach (var anchor in state.CoreBossRevealAnchors.Values)
            {
                if (anchor.ExpiresAtTick <= state.Tick)
                {
                    expiredAnchors.Add(anchor.EntityId);
                }
            }

            for (var index = 0; index < expiredAnchors.Count; index += 1)
            {
                state.CoreBossRevealAnchors.Remove(expiredAnchors[index]);
            }

            var expiredHazards = new List<int>();
            foreach (var hazard in state.CoreBossHazards.Values)
            {
                if (hazard.ExpiresAtTick <= state.Tick)
                {
                    expiredHazards.Add(hazard.EntityId);
                }
            }

            for (var index = 0; index < expiredHazards.Count; index += 1)
            {
                state.CoreBossHazards.Remove(expiredHazards[index]);
            }
        }

        private static void RemoveBossHazards(
            SimulationState state,
            int bossEntityId)
        {
            var removed = new List<int>();
            foreach (var hazard in state.CoreBossHazards.Values)
            {
                if (hazard.BossEntityId == bossEntityId)
                {
                    removed.Add(hazard.EntityId);
                }
            }

            for (var index = 0; index < removed.Count; index += 1)
            {
                state.CoreBossHazards.Remove(removed[index]);
            }
        }

        private static List<SummonState> OwnedMirrors(
            SimulationState state,
            int bossEntityId)
        {
            var mirrors = new List<SummonState>();
            foreach (var summon in state.Summons.Values)
            {
                if (summon.Kind == SummonKind.CoreMirror &&
                    summon.OwnerEntityId == bossEntityId)
                {
                    mirrors.Add(summon);
                }
            }

            return mirrors;
        }

        private static void MigrateIfNeeded(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            CoreBossRuntimeState runtime)
        {
            var finalCourtId = state.StormZone.SelectedCourtId;
            if (state.MapField == null ||
                finalCourtId == null ||
                boss.CourtId == finalCourtId ||
                !StormZoneSystem.IsInNormalStormZone(state, boss.Position))
            {
                return;
            }

            MapCourtGeometryRecord court = default;
            var found = false;
            var courts = MapGeometryCatalog.Courts;
            for (var index = 0; index < courts.Length; index += 1)
            {
                if (courts[index].Id == finalCourtId)
                {
                    court = courts[index];
                    found = true;
                    break;
                }
            }

            if (!found)
            {
                return;
            }

            var healthBasisPoints = Math.Max(
                0,
                (int)((long)boss.Hp * 10_000 / Math.Max(1, boss.MaxHp)));
            boss.CourtId = finalCourtId;
            boss.HomePosition = new Int2Mm(
                checked((int)court.Center.X),
                checked((int)court.Center.Z));
            boss.Position = boss.HomePosition;
            boss.Hp = Math.Max(
                1,
                (int)((long)boss.MaxHp * healthBasisPoints / 10_000));
            boss.TargetEntityId = null;
            boss.InvulnerableTicks = SimulationConstants.TicksPerSecond;
            runtime.CourtId = finalCourtId;
            RemoveBossHazards(state, boss.EntityId);
            var mirrors = OwnedMirrors(state, boss.EntityId);
            for (var index = 0; index < mirrors.Count; index += 1)
            {
                state.Summons.Remove(mirrors[index].EntityId);
            }

            events.Add(
                new SimEvent
                {
                    Type = "core-boss-migrated",
                    Tick = state.Tick,
                    EntityId = boss.EntityId
                });
        }

        private static List<PlayerState> LivingPlayers(
            SimulationState state)
        {
            var players = new List<PlayerState>();
            foreach (var player in state.Players.Values)
            {
                if (player.LifeState == LifeState.Alive &&
                    player.InvulnerableTicks <= 0)
                {
                    players.Add(player);
                }
            }

            return players;
        }

        private static bool BossCanSeePlayer(
            SimulationState state,
            MonsterState boss,
            PlayerState player)
        {
            if (player.LifeState != LifeState.Alive)
            {
                return false;
            }

            if (!LineOfSightSystem.HasDirectLineOfSight(
                    state,
                    boss.Position,
                    player.Position,
                    boss.CollisionRadiusMm +
                    GameplayRules.PlayerCapsuleRadiusMm))
            {
                return false;
            }

            var hidden = player.StealthTicks > 0 ||
                player.NightCloakStealthed;
            return !hidden ||
                IntegerMath.DistanceSquared(
                    boss.Position,
                    player.Position) <=
                (long)TrueSightRadiusMm * TrueSightRadiusMm;
        }

        private static List<PlayerState> TargetCandidates(
            SimulationState state,
            MonsterState boss)
        {
            var candidates = new List<PlayerState>();
            var living = LivingPlayers(state);
            for (var index = 0; index < living.Count; index += 1)
            {
                var player = living[index];
                if (IntegerMath.DistanceSquared(
                        boss.Position,
                        player.Position) >
                    (long)boss.AggroRadiusMm * boss.AggroRadiusMm)
                {
                    continue;
                }

                if (IntegerMath.DistanceSquared(
                        boss.HomePosition,
                        player.Position) >
                    (long)boss.LeashRadiusMm * boss.LeashRadiusMm)
                {
                    continue;
                }

                if (BossCanSeePlayer(state, boss, player))
                {
                    candidates.Add(player);
                }
            }

            return candidates;
        }

        private static int ThreatValue(
            SimulationState state,
            PlayerState player)
        {
            state.CoreBossThreat.TryGetValue(
                player.EntityId,
                out var threat);
            return threat;
        }

        private static PlayerState SelectThreatTarget(
            SimulationState state,
            MonsterState boss)
        {
            var candidates = TargetCandidates(state, boss);
            candidates.Sort(
                (left, right) =>
                {
                    var result = ThreatValue(state, right).CompareTo(
                        ThreatValue(state, left));
                    if (result != 0)
                    {
                        return result;
                    }

                    result = IntegerMath.DistanceSquared(
                        boss.Position,
                        left.Position).CompareTo(
                        IntegerMath.DistanceSquared(
                            boss.Position,
                            right.Position));
                    return result != 0
                        ? result
                        : left.EntityId.CompareTo(right.EntityId);
                });
            return candidates.Count > 0 ? candidates[0] : null;
        }

        private static PlayerState SelectRandomTarget(
            SimulationState state,
            MonsterState boss)
        {
            var candidates = TargetCandidates(state, boss);
            if (candidates.Count == 0)
            {
                return null;
            }

            candidates.Sort(
                (left, right) =>
                {
                    var result = ThreatValue(state, right).CompareTo(
                        ThreatValue(state, left));
                    return result != 0
                        ? result
                        : left.EntityId.CompareTo(right.EntityId);
                });
            return candidates[
                (int)state.Random.Combat.NextInt(
                    (ulong)candidates.Count)];
        }

        private static Int2Mm DirectionBetween(
            Int2Mm from,
            Int2Mm to,
            Int2Mm fallback)
        {
            var dx = to.X - from.X;
            var dz = to.Z - from.Z;
            if (dx == 0 && dz == 0)
            {
                return IntegerMath.NormalizeAxisPair(
                    fallback.X,
                    fallback.Z);
            }

            return IntegerMath.NormalizeAxisPair(dx, dz);
        }

        private static Int2Mm PointAlong(
            Int2Mm origin,
            Int2Mm direction,
            int distanceMm)
        {
            return new Int2Mm(
                origin.X + (int)((long)direction.X * distanceMm / 1_000),
                origin.Z + (int)((long)direction.Z * distanceMm / 1_000));
        }

        private static long PointDistanceToSegmentSquared(
            Int2Mm point,
            Int2Mm start,
            Int2Mm end)
        {
            long dx = end.X - start.X;
            long dz = end.Z - start.Z;
            var lengthSquared = (dx * dx) + (dz * dz);
            if (lengthSquared == 0)
            {
                return IntegerMath.DistanceSquared(point, start);
            }

            var projection = Math.Max(
                0L,
                Math.Min(
                    lengthSquared,
                    ((point.X - start.X) * dx) +
                    ((point.Z - start.Z) * dz)));
            var closest = new Int2Mm(
                start.X + (int)(dx * projection / lengthSquared),
                start.Z + (int)(dz * projection / lengthSquared));
            return IntegerMath.DistanceSquared(point, closest);
        }

        private static bool PointInLine(
            Int2Mm point,
            Int2Mm start,
            Int2Mm direction,
            int lengthMm,
            int widthMm)
        {
            var end = PointAlong(start, direction, lengthMm);
            var half = widthMm / 2;
            return PointDistanceToSegmentSquared(point, start, end) <=
                (long)half * half;
        }

        private static bool PointInCenteredLine(
            Int2Mm point,
            Int2Mm center,
            Int2Mm direction,
            int lengthMm,
            int widthMm)
        {
            var halfStart = PointAlong(
                center,
                direction,
                -(lengthMm / 2));
            var halfEnd = PointAlong(center, direction, lengthMm / 2);
            var half = widthMm / 2;
            return PointDistanceToSegmentSquared(
                    point,
                    halfStart,
                    halfEnd) <=
                (long)half * half;
        }

        private static CoreBossHazardState CreateHazard(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            string abilityId,
            Int2Mm center,
            Int2Mm? direction,
            int delayTicks,
            int durationTicks,
            int radiusMm = 0,
            int lengthMm = 0,
            int widthMm = 0,
            int damage = 0,
            int damagePerSecond = 0,
            int hardControlTicks = 0,
            int displacementMm = 0,
            int gapIndex = -1,
            int pulseIntervalTicks = 0,
            List<CoreBossTargetMarkState> targetMarks = null)
        {
            var hazard = new CoreBossHazardState
            {
                EntityId = state.NextEntityId,
                BossEntityId = boss.EntityId,
                AbilityId = abilityId,
                CreatedAtTick = state.Tick,
                ActivatesAtTick = state.Tick + delayTicks,
                ExpiresAtTick = state.Tick + delayTicks + durationTicks,
                Center = center,
                Direction = IntegerMath.NormalizeAxisPair(
                    direction?.X ?? boss.Facing.X,
                    direction?.Z ?? boss.Facing.Z),
                RadiusMm = radiusMm,
                LengthMm = lengthMm,
                WidthMm = widthMm,
                Damage = damage,
                DamagePerSecond = damagePerSecond,
                HardControlTicks = hardControlTicks,
                DisplacementMm = displacementMm,
                GapIndex = gapIndex,
                Resolved = false,
                NextPulseTick = state.Tick + delayTicks,
                PulseIntervalTicks = pulseIntervalTicks
            };
            state.NextEntityId += 1;
            if (targetMarks != null)
            {
                hazard.TargetMarks.AddRange(targetMarks);
            }

            state.CoreBossHazards[hazard.EntityId] = hazard;
            events.Add(
                new SimEvent
                {
                    Type = "core-boss-cast",
                    Tick = state.Tick,
                    EntityId = hazard.EntityId,
                    SourceEntityId = boss.EntityId,
                    ActiveAbilityId = abilityId,
                    Reason = "warning"
                });
            return hazard;
        }

        private static void MarkResolved(
            SimulationState state,
            List<SimEvent> events,
            CoreBossHazardState hazard)
        {
            if (hazard.Resolved)
            {
                return;
            }

            hazard.Resolved = true;
            events.Add(
                new SimEvent
                {
                    Type = "core-boss-cast",
                    Tick = state.Tick,
                    EntityId = hazard.EntityId,
                    SourceEntityId = hazard.BossEntityId,
                    ActiveAbilityId = hazard.AbilityId,
                    Reason = "resolved"
                });
        }

        private static int ApplyBossDamage(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            PlayerState target,
            int amount,
            bool dot)
        {
            return DamageSystem.Apply(
                state,
                events,
                new DamageRequest(
                    boss.EntityId,
                    target.EntityId,
                    Math.Max(1, amount),
                    DamageCause.Monster,
                    dot ? DamageForm.Dot : DamageForm.Skill,
                    periodic: dot,
                    ignoreSourceBonuses: true));
        }

        private static int EquipmentDisplacementBasisPoints(
            PlayerState target)
        {
            var basisPoints = 10_000;
            if (MonsterDamageSystem.HasEquipment(target, "B4"))
            {
                basisPoints = Math.Min(basisPoints, 5_000);
            }

            if (MonsterDamageSystem.HasEquipment(target, "P18"))
            {
                basisPoints = Math.Min(basisPoints, 3_000);
            }

            return basisPoints;
        }

        private static void KnockBack(
            SimulationState state,
            MonsterState boss,
            PlayerState target,
            int distanceMm)
        {
            var direction = DirectionBetween(
                boss.Position,
                target.Position,
                boss.Facing);
            var requested = PointAlong(
                target.Position,
                direction,
                distanceMm);
            var basisPoints = EquipmentDisplacementBasisPoints(target);
            var origin = target.Position;
            var adjusted = new Int2Mm(
                origin.X + (int)(
                    (long)(requested.X - origin.X) * basisPoints / 10_000),
                origin.Z + (int)(
                    (long)(requested.Z - origin.Z) * basisPoints / 10_000));
            target.Position = DisplacementSystem.ResolveForced(
                state,
                origin,
                adjusted,
                GameplayRules.PlayerCapsuleRadiusMm);
        }

        private static void ApplyHardControl(
            PlayerState target,
            int durationTicks)
        {
            if (durationTicks <= 0)
            {
                return;
            }

            // equipmentAdjustedHardControlTicks: bedrock boots P18 reduce
            // hard control to 30% (minimum 6 ticks).
            var adjusted = MonsterDamageSystem.HasEquipment(target, "P18")
                ? Math.Max(6, durationTicks * 3 / 10)
                : durationTicks;
            PassiveRuntimeSystem.ApplyTargetHardControl(target, adjusted);
        }

        private static void ResolveRing(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            CoreBossHazardState hazard)
        {
            var players = LivingPlayers(state);
            for (var index = 0; index < players.Count; index += 1)
            {
                var target = players[index];
                if (IntegerMath.DistanceSquared(
                        target.Position,
                        hazard.Center) <=
                    (long)PublicRingRadiusMm * PublicRingRadiusMm &&
                    LineOfSightSystem.HasDirectLineOfSight(
                        state,
                        boss.Position,
                        target.Position))
                {
                    ApplyBossDamage(
                        state,
                        events,
                        boss,
                        target,
                        hazard.Damage,
                        false);
                }
            }
        }

        private static void ResolveMeteor(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            CoreBossHazardState hazard)
        {
            var players = LivingPlayers(state);
            for (var index = 0; index < players.Count; index += 1)
            {
                var target = players[index];
                if (IntegerMath.DistanceSquared(
                        target.Position,
                        hazard.Center) <=
                    (long)MeteorRadiusMm * MeteorRadiusMm)
                {
                    ApplyBossDamage(
                        state,
                        events,
                        boss,
                        target,
                        hazard.Damage,
                        false);
                }
            }
        }

        private static void ResolveEarthbreak(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            CoreBossHazardState hazard)
        {
            var perpendicular = new Int2Mm(
                -hazard.Direction.Z,
                hazard.Direction.X);
            var players = LivingPlayers(state);
            for (var index = 0; index < players.Count; index += 1)
            {
                var target = players[index];
                var hit = false;
                for (var offset = -1; offset <= 1 && !hit; offset += 1)
                {
                    var lineCenter = PointAlong(
                        hazard.Center,
                        perpendicular,
                        offset * EarthbreakGapMm);
                    hit = PointInCenteredLine(
                        target.Position,
                        lineCenter,
                        hazard.Direction,
                        EarthbreakLengthMm,
                        EarthbreakWidthMm);
                }

                if (!hit)
                {
                    continue;
                }

                var applied = ApplyBossDamage(
                    state,
                    events,
                    boss,
                    target,
                    hazard.Damage,
                    false);
                if (applied > 0)
                {
                    ApplyHardControl(target, hazard.HardControlTicks);
                }
            }
        }

        private static Int2Mm RotatedDirection(
            Int2Mm direction,
            int index)
        {
            var baseDirection =
                RotatedDirections[index % RotatedDirections.Length];
            var x = (int)(
                ((long)direction.X * baseDirection.X -
                 (long)direction.Z * baseDirection.Z) / 1_000);
            var z = (int)(
                ((long)direction.X * baseDirection.Z +
                 (long)direction.Z * baseDirection.X) / 1_000);
            return IntegerMath.NormalizeAxisPair(x, z);
        }

        private static bool TargetInHazardLine(
            SimulationState state,
            MonsterState boss,
            PlayerState player,
            Int2Mm start,
            Int2Mm direction,
            int lengthMm,
            int widthMm)
        {
            return PointInLine(
                    player.Position,
                    start,
                    direction,
                    lengthMm,
                    widthMm) &&
                LineOfSightSystem.HasDirectLineOfSight(
                    state,
                    boss.Position,
                    player.Position,
                    boss.CollisionRadiusMm +
                    GameplayRules.PlayerCapsuleRadiusMm);
        }

        private static void ResolveFirelane(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            CoreBossHazardState hazard)
        {
            var players = LivingPlayers(state);
            for (var index = 0; index < players.Count; index += 1)
            {
                var target = players[index];
                var hit = false;
                for (var lane = 0; lane < 3 && !hit; lane += 1)
                {
                    if (lane == hazard.GapIndex)
                    {
                        continue;
                    }

                    hit = TargetInHazardLine(
                        state,
                        boss,
                        target,
                        hazard.Center,
                        RotatedDirection(hazard.Direction, lane),
                        FirelaneLengthMm,
                        FirelaneWidthMm);
                }

                if (hit)
                {
                    ApplyBossDamage(
                        state,
                        events,
                        boss,
                        target,
                        hazard.DamagePerSecond,
                        true);
                }
            }
        }

        private static void UpdateFollowingMarks(
            SimulationState state,
            CoreBossHazardState hazard)
        {
            for (var index = 0; index < hazard.TargetMarks.Count; index += 1)
            {
                var mark = hazard.TargetMarks[index];
                if (!mark.TargetEntityId.HasValue)
                {
                    continue;
                }

                if (state.Players.TryGetValue(
                        mark.TargetEntityId.Value,
                        out var target) &&
                    target.LifeState == LifeState.Alive)
                {
                    mark.Position = target.Position;
                }
            }
        }

        private static void ResolvePoisonpool(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            CoreBossHazardState hazard)
        {
            UpdateFollowingMarks(state, hazard);
            for (var markIndex = 0;
                markIndex < hazard.TargetMarks.Count;
                markIndex += 1)
            {
                var mark = hazard.TargetMarks[markIndex];
                var players = LivingPlayers(state);
                for (var index = 0; index < players.Count; index += 1)
                {
                    var target = players[index];
                    if (IntegerMath.DistanceSquared(
                            target.Position,
                            mark.Position) <=
                        (long)PoisonRadiusMm * PoisonRadiusMm)
                    {
                        ApplyBossDamage(
                            state,
                            events,
                            boss,
                            target,
                            hazard.DamagePerSecond,
                            true);
                    }
                }
            }
        }

        private static void ResolveWindcharge(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            CoreBossHazardState hazard)
        {
            var players = LivingPlayers(state);
            for (var index = 0; index < players.Count; index += 1)
            {
                var target = players[index];
                if (!TargetInHazardLine(
                        state,
                        boss,
                        target,
                        hazard.Center,
                        hazard.Direction,
                        WindchargeLengthMm,
                        WindchargeWidthMm))
                {
                    continue;
                }

                var applied = ApplyBossDamage(
                    state,
                    events,
                    boss,
                    target,
                    hazard.Damage,
                    false);
                if (applied > 0)
                {
                    KnockBack(state, boss, target, hazard.DisplacementMm);
                }
            }
        }

        private static void ResolveThunderchain(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            CoreBossHazardState hazard)
        {
            PlayerState previous = null;
            if (hazard.TargetMarks.Count > 0 &&
                hazard.TargetMarks[0].TargetEntityId.HasValue)
            {
                state.Players.TryGetValue(
                    hazard.TargetMarks[0].TargetEntityId.Value,
                    out previous);
            }

            var hit = new HashSet<int>();
            for (var jump = 0; jump < 4 && previous != null; jump += 1)
            {
                if (previous.LifeState != LifeState.Alive ||
                    hit.Contains(previous.EntityId))
                {
                    break;
                }

                hit.Add(previous.EntityId);
                hazard.HitEntityIds.Add(previous.EntityId);
                // trunc(300 * 8^jump / 10^jump).
                var damage = jump switch
                {
                    0 => 300,
                    1 => 240,
                    2 => 192,
                    _ => 153
                };
                ApplyBossDamage(state, events, boss, previous, damage, false);
                var from = previous;
                PlayerState next = null;
                long nextDistance = long.MaxValue;
                var players = LivingPlayers(state);
                for (var index = 0; index < players.Count; index += 1)
                {
                    var candidate = players[index];
                    if (hit.Contains(candidate.EntityId))
                    {
                        continue;
                    }

                    var distance = IntegerMath.DistanceSquared(
                        candidate.Position,
                        from.Position);
                    if (distance > 6_000L * 6_000L)
                    {
                        continue;
                    }

                    if (!LineOfSightSystem.HasDirectLineOfSight(
                            state,
                            from.Position,
                            candidate.Position))
                    {
                        continue;
                    }

                    if (distance < nextDistance ||
                        (distance == nextDistance &&
                         (next == null ||
                          candidate.EntityId < next.EntityId)))
                    {
                        next = candidate;
                        nextDistance = distance;
                    }
                }

                previous = next;
                if (previous != null)
                {
                    hazard.TargetMarks.Add(
                        new CoreBossTargetMarkState
                        {
                            TargetEntityId = previous.EntityId,
                            Position = previous.Position
                        });
                }
            }
        }

        private static void SpawnMirrors(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss)
        {
            var perpendicular = new Int2Mm(
                -boss.Facing.Z,
                boss.Facing.X);
            for (var side = -1; side <= 1; side += 2)
            {
                var mirror = new SummonState
                {
                    EntityId = state.NextEntityId,
                    OwnerEntityId = boss.EntityId,
                    Kind = SummonKind.CoreMirror,
                    Position = PointAlong(
                        boss.Position,
                        perpendicular,
                        side * 2_500),
                    Hp = 2_000,
                    MaxHp = 2_000,
                    AttackPower = 60,
                    Targetable = true,
                    ExpiresAtTick = state.Tick + MirrorDurationTicks,
                    AttackCooldownTicks = MirrorAttackPeriodTicks,
                    TouchCooldownTicks = 0,
                    DestroyedByHostileDamage = false
                };
                state.NextEntityId += 1;
                state.Summons.Add(mirror.EntityId, mirror);
                events.Add(
                    new SimEvent
                    {
                        Type = "summon-spawned",
                        Tick = state.Tick,
                        EntityId = mirror.EntityId,
                        SourceEntityId = boss.EntityId,
                        Detail = "core-mirror"
                    });
            }
        }

        private static PlayerState MirrorTarget(
            SimulationState state,
            MonsterState boss,
            SummonState mirror)
        {
            var candidates = TargetCandidates(state, boss);
            PlayerState best = null;
            for (var index = 0; index < candidates.Count; index += 1)
            {
                var candidate = candidates[index];
                if (IntegerMath.DistanceSquared(
                        mirror.Position,
                        candidate.Position) > 12_000L * 12_000L)
                {
                    continue;
                }

                if (best == null)
                {
                    best = candidate;
                    continue;
                }

                var threatDelta = ThreatValue(state, candidate) -
                    ThreatValue(state, best);
                if (threatDelta > 0)
                {
                    best = candidate;
                    continue;
                }

                if (threatDelta < 0)
                {
                    continue;
                }

                var distanceDelta = IntegerMath.DistanceSquared(
                    mirror.Position,
                    candidate.Position) -
                    IntegerMath.DistanceSquared(
                        mirror.Position,
                        best.Position);
                if (distanceDelta < 0 ||
                    (distanceDelta == 0 &&
                     candidate.EntityId < best.EntityId))
                {
                    best = candidate;
                }
            }

            return best;
        }

        private static void AdvanceMirrors(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss)
        {
            var mirrors = OwnedMirrors(state, boss.EntityId);
            for (var index = 0; index < mirrors.Count; index += 1)
            {
                var mirror = mirrors[index];
                if (!state.Summons.ContainsKey(mirror.EntityId))
                {
                    continue;
                }

                if (mirror.Hp <= 0 || mirror.ExpiresAtTick <= state.Tick)
                {
                    state.Summons.Remove(mirror.EntityId);
                    events.Add(
                        new SimEvent
                        {
                            Type = "summon-expired",
                            Tick = state.Tick,
                            EntityId = mirror.EntityId,
                            SourceEntityId = boss.EntityId,
                            Detail = "core-mirror"
                        });
                    continue;
                }

                mirror.AttackCooldownTicks = Math.Max(
                    0,
                    mirror.AttackCooldownTicks - 1);
                var target = MirrorTarget(state, boss, mirror);
                if (target == null)
                {
                    continue;
                }

                var distance = IntegerMath.DistanceSquared(
                    mirror.Position,
                    target.Position);
                if (distance > 1_800L * 1_800L)
                {
                    var requested = IntegerMath.MoveToward(
                        mirror.Position,
                        target.Position,
                        2_600 / SimulationConstants.TicksPerSecond);
                    mirror.Position = WorldMovement.Resolve(
                        state,
                        mirror.Position,
                        requested,
                        650);
                    continue;
                }

                if (mirror.AttackCooldownTicks > 0)
                {
                    continue;
                }

                mirror.AttackCooldownTicks = MirrorAttackPeriodTicks;
                DamageSystem.Apply(
                    state,
                    events,
                    new DamageRequest(
                        mirror.EntityId,
                        target.EntityId,
                        mirror.AttackPower,
                        DamageCause.Monster,
                        DamageForm.Basic,
                        ignoreSourceBonuses: true));
            }
        }

        private static void ResolveHazard(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            CoreBossHazardState hazard)
        {
            if (state.Tick < hazard.ActivatesAtTick ||
                state.Tick >= hazard.ExpiresAtTick)
            {
                return;
            }

            if (!hazard.Resolved)
            {
                MarkResolved(state, events, hazard);
            }

            if (hazard.AbilityId == "firelane" &&
                hazard.PulseIntervalTicks > 0 &&
                state.Tick >= hazard.NextPulseTick)
            {
                ResolveFirelane(state, events, boss, hazard);
                hazard.NextPulseTick += hazard.PulseIntervalTicks;
            }
            else if (hazard.AbilityId == "poisonpool" &&
                hazard.PulseIntervalTicks > 0 &&
                state.Tick >= hazard.NextPulseTick)
            {
                ResolvePoisonpool(state, events, boss, hazard);
                hazard.NextPulseTick += hazard.PulseIntervalTicks;
            }

            if (state.Tick != hazard.ActivatesAtTick)
            {
                return;
            }

            switch (hazard.AbilityId)
            {
                case "ring-shockwave":
                    ResolveRing(state, events, boss, hazard);
                    break;
                case "meteor":
                    ResolveMeteor(state, events, boss, hazard);
                    break;
                case "earthbreak":
                    ResolveEarthbreak(state, events, boss, hazard);
                    break;
                case "windcharge":
                    ResolveWindcharge(state, events, boss, hazard);
                    break;
                case "thunderchain":
                    ResolveThunderchain(state, events, boss, hazard);
                    break;
                case "mirrorshadow":
                    SpawnMirrors(state, events, boss);
                    break;
                default:
                    break;
            }
        }

        private static List<CoreBossTargetMarkState> MarksFor(
            params PlayerState[] targets)
        {
            var marks = new List<CoreBossTargetMarkState>(targets.Length);
            for (var index = 0; index < targets.Length; index += 1)
            {
                if (targets[index] == null)
                {
                    continue;
                }

                marks.Add(
                    new CoreBossTargetMarkState
                    {
                        TargetEntityId = targets[index].EntityId,
                        Position = targets[index].Position
                    });
            }

            return marks;
        }

        private static void CastSignature(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss,
            string abilityId)
        {
            var target = SelectThreatTarget(state, boss);
            switch (abilityId)
            {
                case "earthbreak":
                    CreateHazard(
                        state,
                        events,
                        boss,
                        abilityId,
                        boss.Position,
                        DirectionBetween(
                            boss.Position,
                            target?.Position ??
                            PointAlong(boss.Position, boss.Facing, 1_000),
                            boss.Facing),
                        delayTicks: 24,
                        durationTicks: 2,
                        lengthMm: EarthbreakLengthMm,
                        widthMm: EarthbreakWidthMm,
                        damage: 350,
                        hardControlTicks: 12);
                    break;
                case "firelane":
                    CreateHazard(
                        state,
                        events,
                        boss,
                        abilityId,
                        boss.Position,
                        boss.Facing,
                        delayTicks: 24,
                        durationTicks: 120,
                        lengthMm: FirelaneLengthMm,
                        widthMm: FirelaneWidthMm,
                        damagePerSecond: 100,
                        pulseIntervalTicks:
                            SimulationConstants.TicksPerSecond,
                        gapIndex: (int)state.Random.Combat.NextInt(3));
                    break;
                case "poisonpool":
                {
                    var candidates = TargetCandidates(state, boss);
                    candidates.Sort(
                        (left, right) =>
                        {
                            var result = ThreatValue(state, right)
                                .CompareTo(ThreatValue(state, left));
                            return result != 0
                                ? result
                                : left.EntityId.CompareTo(right.EntityId);
                        });
                    var marks = new List<CoreBossTargetMarkState>();
                    for (var index = 0;
                        index < candidates.Count && index < 3;
                        index += 1)
                    {
                        marks.Add(
                            new CoreBossTargetMarkState
                            {
                                TargetEntityId =
                                    candidates[index].EntityId,
                                Position = candidates[index].Position
                            });
                    }

                    CreateHazard(
                        state,
                        events,
                        boss,
                        abilityId,
                        boss.Position,
                        null,
                        delayTicks: 30,
                        durationTicks: 160,
                        radiusMm: PoisonRadiusMm,
                        damagePerSecond: 70,
                        pulseIntervalTicks:
                            SimulationConstants.TicksPerSecond,
                        targetMarks: marks);
                    break;
                }

                case "windcharge":
                    CreateHazard(
                        state,
                        events,
                        boss,
                        abilityId,
                        boss.Position,
                        DirectionBetween(
                            boss.Position,
                            target?.Position ??
                            PointAlong(boss.Position, boss.Facing, 1_000),
                            boss.Facing),
                        delayTicks: 24,
                        durationTicks: 2,
                        lengthMm: WindchargeLengthMm,
                        widthMm: WindchargeWidthMm,
                        damage: 350,
                        displacementMm: 5_000);
                    break;
                case "thunderchain":
                {
                    var selected = SelectRandomTarget(state, boss);
                    CreateHazard(
                        state,
                        events,
                        boss,
                        abilityId,
                        selected?.Position ?? boss.Position,
                        null,
                        delayTicks: 30,
                        durationTicks: 2,
                        damage: 300,
                        targetMarks: MarksFor(selected));
                    break;
                }

                case "mirrorshadow":
                    CreateHazard(
                        state,
                        events,
                        boss,
                        abilityId,
                        boss.Position,
                        null,
                        delayTicks: 30,
                        durationTicks: 200);
                    break;
                default:
                    break;
            }
        }

        private static void CastPublicRing(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss)
        {
            CreateHazard(
                state,
                events,
                boss,
                "ring-shockwave",
                boss.Position,
                null,
                delayTicks: 30,
                durationTicks: 2,
                radiusMm: PublicRingRadiusMm,
                damage: 400);
        }

        private static void CastPublicMeteor(
            SimulationState state,
            List<SimEvent> events,
            MonsterState boss)
        {
            var target = SelectRandomTarget(state, boss);
            if (target == null)
            {
                return;
            }

            CreateHazard(
                state,
                events,
                boss,
                "meteor",
                target.Position,
                null,
                delayTicks: 40,
                durationTicks: 2,
                radiusMm: MeteorRadiusMm,
                damage: 500,
                targetMarks: MarksFor(target));
        }
    }
}
