using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class StateHashValues
    {
        public static object BuildMonsterRespawns(SimulationState state)
        {
            var pending = new List<MonsterRespawnState>(
                state.MonsterRespawns);
            pending.Sort(
                (left, right) =>
                {
                    var result = left.RespawnAtTick.CompareTo(
                        right.RespawnAtTick);
                    if (result != 0)
                    {
                        return result;
                    }

                    result = string.Compare(
                        SimulationText.MonsterKind(left.Kind),
                        SimulationText.MonsterKind(right.Kind),
                        System.StringComparison.Ordinal);
                    if (result != 0)
                    {
                        return result;
                    }

                    result = string.Compare(
                        SimulationText.MonsterRing(left.Ring),
                        SimulationText.MonsterRing(right.Ring),
                        System.StringComparison.Ordinal);
                    if (result != 0)
                    {
                        return result;
                    }

                    result = string.Compare(
                        left.CourtId ?? string.Empty,
                        right.CourtId ?? string.Empty,
                        System.StringComparison.Ordinal);
                    if (result != 0)
                    {
                        return result;
                    }

                    result = left.HomePosition.X.CompareTo(
                        right.HomePosition.X);
                    return result != 0
                        ? result
                        : left.HomePosition.Z.CompareTo(
                            right.HomePosition.Z);
                });

            var values = new List<object>(pending.Count);
            for (var index = 0; index < pending.Count; index += 1)
            {
                var respawn = pending[index];
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["kind"] = SimulationText.MonsterKind(
                            respawn.Kind),
                        ["ring"] = SimulationText.MonsterRing(
                            respawn.Ring),
                        ["element"] = respawn.Element.HasValue
                            ? SimulationText.Element(respawn.Element.Value)
                            : null,
                        ["homePosition"] =
                            StateHashBuilder.BuildVector(
                                respawn.HomePosition.X,
                                respawn.HomePosition.Z),
                        ["courtId"] = respawn.CourtId,
                        ["respawnAtTick"] = respawn.RespawnAtTick
                    });
            }

            return values;
        }

        public static object BuildCoreBossRuntimes(SimulationState state)
        {
            var values = new List<object>(state.CoreBossRuntimes.Count);
            foreach (var runtime in state.CoreBossRuntimes.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["bossEntityId"] = runtime.BossEntityId,
                        ["courtId"] = runtime.CourtId,
                        ["nextRingCastTick"] = runtime.NextRingCastTick,
                        ["nextMeteorCastTick"] = runtime.NextMeteorCastTick,
                        ["nextSignatureCastTick"] =
                            runtime.NextSignatureCastTick,
                        ["signatureIndex"] = runtime.SignatureIndex
                    });
            }

            return values;
        }

        public static object BuildCoreBossHazards(SimulationState state)
        {
            var values = new List<object>(state.CoreBossHazards.Count);
            foreach (var hazard in state.CoreBossHazards.Values)
            {
                var marks = new List<CoreBossTargetMarkState>(
                    hazard.TargetMarks);
                marks.Sort(
                    (left, right) =>
                    {
                        var result = (left.TargetEntityId ?? 0).CompareTo(
                            right.TargetEntityId ?? 0);
                        if (result != 0)
                        {
                            return result;
                        }

                        result = left.Position.X.CompareTo(
                            right.Position.X);
                        return result != 0
                            ? result
                            : left.Position.Z.CompareTo(right.Position.Z);
                    });
                var markValues = new List<object>(marks.Count);
                for (var index = 0; index < marks.Count; index += 1)
                {
                    markValues.Add(
                        new Dictionary<string, object>
                        {
                            ["targetEntityId"] = marks[index].TargetEntityId,
                            ["position"] = StateHashBuilder.BuildVector(
                                marks[index].Position.X,
                                marks[index].Position.Z)
                        });
                }

                var hitIds = new List<int>(hazard.HitEntityIds);
                hitIds.Sort();
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = hazard.EntityId,
                        ["bossEntityId"] = hazard.BossEntityId,
                        ["abilityId"] = hazard.AbilityId,
                        ["createdAtTick"] = hazard.CreatedAtTick,
                        ["activatesAtTick"] = hazard.ActivatesAtTick,
                        ["expiresAtTick"] = hazard.ExpiresAtTick,
                        ["center"] = StateHashBuilder.BuildVector(
                            hazard.Center.X,
                            hazard.Center.Z),
                        ["direction"] = StateHashBuilder.BuildVector(
                            hazard.Direction.X,
                            hazard.Direction.Z),
                        ["radiusMm"] = hazard.RadiusMm,
                        ["lengthMm"] = hazard.LengthMm,
                        ["widthMm"] = hazard.WidthMm,
                        ["damage"] = hazard.Damage,
                        ["damagePerSecond"] = hazard.DamagePerSecond,
                        ["hardControlTicks"] = hazard.HardControlTicks,
                        ["displacementMm"] = hazard.DisplacementMm,
                        ["gapIndex"] = hazard.GapIndex,
                        ["resolved"] = hazard.Resolved,
                        ["nextPulseTick"] = hazard.NextPulseTick,
                        ["pulseIntervalTicks"] = hazard.PulseIntervalTicks,
                        ["targetMarks"] = markValues,
                        ["hitEntityIds"] = hitIds
                    });
            }

            return values;
        }

        public static object BuildCoreBossRevealAnchors(SimulationState state)
        {
            var values = new List<object>(
                state.CoreBossRevealAnchors.Count);
            foreach (var anchor in state.CoreBossRevealAnchors.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = anchor.EntityId,
                        ["bossEntityId"] = anchor.BossEntityId,
                        ["position"] = StateHashBuilder.BuildVector(
                            anchor.Position.X,
                            anchor.Position.Z),
                        ["expiresAtTick"] = anchor.ExpiresAtTick
                    });
            }

            return values;
        }

        public static object BuildCoreBossThreat(SimulationState state)
        {
            var values = new List<object>(state.CoreBossThreat.Count);
            foreach (var entry in state.CoreBossThreat)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = entry.Key,
                        ["threat"] = entry.Value
                    });
            }

            return values;
        }

        public static object BuildPendingActiveReplacements(
            SimulationState state)
        {
            var values = new List<object>(
                state.PendingActiveReplacements.Count);
            foreach (var pending in state.PendingActiveReplacements.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["playerEntityId"] = pending.PlayerEntityId,
                        ["lootEntityId"] = pending.LootEntityId,
                        ["activeId"] = pending.ActiveId,
                        ["requestedAtTick"] = pending.RequestedAtTick
                    });
            }

            return values;
        }

        public static object BuildPendingEquipmentPickups(
            SimulationState state)
        {
            var values = new List<object>(
                state.PendingEquipmentPickups.Count);
            foreach (var pending in state.PendingEquipmentPickups.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["playerEntityId"] = pending.PlayerEntityId,
                        ["lootEntityId"] = pending.LootEntityId,
                        ["equipmentId"] = pending.EquipmentId,
                        ["equipmentInstanceId"] =
                            pending.EquipmentInstanceId,
                        ["requestedAtTick"] = pending.RequestedAtTick
                    });
            }

            return values;
        }

        public static object BuildSummons(SimulationState state)
        {
            var values = new List<object>(state.Summons.Count);
            foreach (var summon in state.Summons.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = summon.EntityId,
                        ["ownerEntityId"] = summon.OwnerEntityId,
                        ["kind"] = SimulationText.SummonKind(summon.Kind),
                        ["position"] = StateHashBuilder.BuildVector(
                            summon.Position.X,
                            summon.Position.Z),
                        ["hp"] = summon.Hp,
                        ["maxHp"] = summon.MaxHp,
                        ["attackPower"] = summon.AttackPower,
                        ["targetable"] = summon.Targetable,
                        ["expiresAtTick"] = summon.ExpiresAtTick,
                        ["attackCooldownTicks"] =
                            summon.AttackCooldownTicks,
                        ["touchCooldownTicks"] =
                            summon.TouchCooldownTicks,
                        ["destroyedByHostileDamage"] =
                            summon.DestroyedByHostileDamage
                    });
            }

            return values;
        }

        public static object BuildAfterimages(SimulationState state)
        {
            var values = new List<object>(state.Afterimages.Count);
            foreach (var afterimage in state.Afterimages.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = afterimage.EntityId,
                        ["ownerEntityId"] = afterimage.OwnerEntityId,
                        ["position"] = StateHashBuilder.BuildVector(
                            afterimage.Position.X,
                            afterimage.Position.Z),
                        ["slowPercent"] = afterimage.SlowPercent,
                        ["slowDurationTicks"] =
                            afterimage.SlowDurationTicks,
                        ["explosionDamage"] =
                            afterimage.ExplosionDamage,
                        ["explosionRadiusMm"] =
                            afterimage.ExplosionRadiusMm,
                        ["expiresAtTick"] = afterimage.ExpiresAtTick
                    });
            }

            return values;
        }

        public static object BuildBountyMarks(SimulationState state)
        {
            var marks = new List<BountyMarkState>(state.BountyMarks);
            marks.Sort(
                (left, right) =>
                {
                    var result = left.SourceEntityId.CompareTo(
                        right.SourceEntityId);
                    if (result != 0)
                    {
                        return result;
                    }

                    result = left.TargetEntityId.CompareTo(
                        right.TargetEntityId);
                    return result != 0
                        ? result
                        : left.ExpiresAtTick.CompareTo(
                            right.ExpiresAtTick);
                });
            var values = new List<object>(marks.Count);
            for (var index = 0; index < marks.Count; index += 1)
            {
                var mark = marks[index];
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["sourceEntityId"] = mark.SourceEntityId,
                        ["targetEntityId"] = mark.TargetEntityId,
                        ["rewardGold"] = mark.RewardGold,
                        ["revealToAll"] = mark.RevealToAll,
                        ["expiresAtTick"] = mark.ExpiresAtTick
                    });
            }

            return values;
        }

        public static object BuildPassiveTargetStates(SimulationState state)
        {
            var values = new List<object>(
                state.PassiveTargetStates.Count);
            foreach (var targetState in state.PassiveTargetStates.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["sourceEntityId"] = targetState.SourceEntityId,
                        ["targetEntityId"] = targetState.TargetEntityId,
                        ["burnStacks"] = targetState.BurnStacks,
                        ["poisonStacks"] = targetState.PoisonStacks,
                        ["poisonExpiresAtTick"] =
                            targetState.PoisonExpiresAtTick,
                        ["poisonNextTick"] = targetState.PoisonNextTick,
                        ["fireBurnDamagePerSecond"] =
                            targetState.FireBurnDamagePerSecond,
                        ["fireBurnExpiresAtTick"] =
                            targetState.FireBurnExpiresAtTick,
                        ["fireBurnNextTick"] =
                            targetState.FireBurnNextTick,
                        ["fireBurnSourceEntityId"] =
                            targetState.FireBurnSourceEntityId,
                        ["equipmentBurnDamagePerSecond"] =
                            targetState.EquipmentBurnDamagePerSecond,
                        ["equipmentBurnExpiresAtTick"] =
                            targetState.EquipmentBurnExpiresAtTick,
                        ["equipmentBurnNextTick"] =
                            targetState.EquipmentBurnNextTick,
                        ["equipmentBurnSourceEntityId"] =
                            targetState.EquipmentBurnSourceEntityId,
                        ["revealExpiresAtTick"] =
                            targetState.RevealExpiresAtTick,
                        ["pickpocketCooldownTicks"] =
                            targetState.PickpocketCooldownTicks,
                        ["stunCooldownTicks"] =
                            targetState.StunCooldownTicks,
                        ["counterCooldownTicks"] =
                            targetState.CounterCooldownTicks,
                        ["lastBasicHitTick"] =
                            targetState.LastBasicHitTick,
                        ["comboShoesStacks"] =
                            targetState.ComboShoesStacks,
                        ["comboShoesExpiresAtTick"] =
                            targetState.ComboShoesExpiresAtTick
                    });
            }

            return values;
        }
    }
}
