using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class StateHashValues
    {
        public static object BuildMonsters(SimulationState state)
        {
            var values = new List<object>(state.Monsters.Count);
            foreach (var monster in state.Monsters.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = monster.EntityId,
                        ["kind"] = SimulationText.MonsterKind(monster.Kind),
                        ["ring"] = SimulationText.MonsterRing(monster.Ring),
                        ["element"] = monster.Element.HasValue
                            ? SimulationText.Element(monster.Element.Value)
                            : null,
                        ["position"] = StateHashBuilder.BuildVector(
                            monster.Position.X,
                            monster.Position.Z),
                        ["homePosition"] = StateHashBuilder.BuildVector(
                            monster.HomePosition.X,
                            monster.HomePosition.Z),
                        ["courtId"] = monster.CourtId,
                        ["facing"] = StateHashBuilder.BuildVector(
                            monster.Facing.X,
                            monster.Facing.Z),
                        ["hp"] = monster.Hp,
                        ["maxHp"] = monster.MaxHp,
                        ["attackPower"] = monster.AttackPower,
                        ["moveSpeedMmPerSecond"] =
                            monster.MoveSpeedMmPerSecond,
                        ["attackRangeMm"] = monster.AttackRangeMm,
                        ["attackCooldownTicks"] =
                            monster.AttackCooldownTicks,
                        ["collisionRadiusMm"] =
                            monster.CollisionRadiusMm,
                        ["targetEntityId"] = monster.TargetEntityId,
                        ["spawnTick"] = monster.SpawnTick,
                        ["invulnerableTicks"] = monster.InvulnerableTicks,
                        ["hardControlTicks"] = monster.HardControlTicks,
                        ["slowTicks"] = monster.SlowTicks,
                        ["slowBasisPoints"] = monster.SlowBasisPoints,
                        ["silenceTicks"] = monster.SilenceTicks,
                        ["silenceCooldownPenaltyTicks"] =
                            monster.SilenceCooldownPenaltyTicks,
                        ["blindTicks"] = monster.BlindTicks,
                        ["blindMissPercent"] = monster.BlindMissPercent,
                        ["blindPreventsCritical"] =
                            monster.BlindPreventsCritical,
                        ["polymorphTicks"] = monster.PolymorphTicks,
                        ["polymorphSpeedBonusPercent"] =
                            monster.PolymorphSpeedBonusPercent,
                        ["displacementLockTicks"] =
                            monster.DisplacementLockTicks,
                        ["attackPeriodTicks"] =
                            monster.AttackPeriodTicks,
                        ["aggroRadiusMm"] = monster.AggroRadiusMm,
                        ["leashRadiusMm"] = monster.LeashRadiusMm
                    });
            }

            return values;
        }

        public static object BuildLootDrops(SimulationState state)
        {
            var values = new List<object>(state.LootDrops.Count);
            foreach (var drop in state.LootDrops.Values)
            {
                var entry = new Dictionary<string, object>
                {
                    ["entityId"] = drop.EntityId,
                    ["position"] = StateHashBuilder.BuildVector(
                        drop.Position.X,
                        drop.Position.Z),
                    ["gold"] = drop.Gold,
                    ["experience"] = drop.Experience,
                    ["gems"] = drop.Gems,
                    ["equipmentId"] = drop.EquipmentId,
                    ["bookPassiveId"] = drop.BookPassiveId,
                    ["createdAtTick"] = drop.CreatedAtTick,
                    ["expiresAtTick"] = drop.ExpiresAtTick
                };
                if (drop.HasRuntimeFields)
                {
                    entry["kind"] = drop.Kind;
                    entry["activeId"] = drop.ActiveId;
                    entry["equipmentInstanceId"] = drop.EquipmentInstanceId;
                    entry["acquiredAtTick"] = drop.AcquiredAtTick;
                    entry["permanentAttackBonus"] =
                        drop.PermanentAttackBonus;
                    entry["stormCoveredSinceTick"] =
                        drop.StormCoveredSinceTick;
                }

                values.Add(entry);
            }

            return values;
        }

        private static object BuildPassives(PlayerState player)
        {
            var values = new List<object>(player.Passives.Count);
            for (var index = 0; index < player.Passives.Count; index += 1)
            {
                var passive = player.Passives[index];
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["passiveId"] = passive.PassiveId,
                        ["level"] = passive.Level
                    });
            }

            return values;
        }

        private static object BuildEquipment(PlayerState player)
        {
            return BuildEquipment(player.Equipment);
        }

        private static object BuildEquipment(
            IReadOnlyList<EquippedEquipmentInstance> equipment)
        {
            var values = new List<object>(equipment.Count);
            for (var index = 0; index < equipment.Count; index += 1)
            {
                var instance = equipment[index];
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["instanceId"] = instance.InstanceId,
                        ["equipmentId"] = instance.EquipmentId,
                        ["acquiredAtTick"] = instance.AcquiredAtTick,
                        ["permanentAttackBonus"] =
                            instance.PermanentAttackBonus
                    });
            }

            return values;
        }

        private static object BuildShields(PlayerState player)
        {
            var ordered = new List<ShieldState>(player.Shields);
            ordered.Sort(
                (left, right) =>
                    left.CreationSequence.CompareTo(
                        right.CreationSequence));
            var values = new List<object>(ordered.Count);
            for (var index = 0; index < ordered.Count; index += 1)
            {
                var shield = ordered[index];
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["source"] = BuildShieldSource(shield),
                        ["expiresAtTick"] = shield.ExpiresAtTick,
                        ["creationSequence"] = shield.CreationSequence,
                        ["absorbs"] = BuildAbsorbs(shield),
                        ["breakEffect"] = BuildBreakEffect(
                            shield.BreakEffect),
                        ["remainingAmount"] = shield.RemainingAmount
                    });
            }

            return values;
        }

        private static object BuildShieldSource(ShieldState shield)
        {
            var source = new Dictionary<string, object>
            {
                ["kind"] = shield.SourceKind
            };
            source[shield.SourceKind == "active"
                ? "activeId"
                : "passiveId"] = shield.SourceId;
            return source;
        }

        private static object BuildAbsorbs(ShieldState shield)
        {
            var values = new List<string>(shield.Absorbs.Count);
            for (var index = 0; index < shield.Absorbs.Count; index += 1)
            {
                values.Add(SimulationText.DamageForm(shield.Absorbs[index]));
            }

            return values;
        }

        private static object BuildBreakEffect(
            ShieldBreakEffectState effect)
        {
            if (effect == null)
            {
                return null;
            }

            return new Dictionary<string, object>
            {
                ["sourceEntityId"] = effect.SourceEntityId,
                ["sourceElement"] =
                    SimulationText.Element(effect.SourceElement),
                ["damage"] = effect.Damage,
                ["radiusMm"] = effect.RadiusMm
            };
        }
    }
}
