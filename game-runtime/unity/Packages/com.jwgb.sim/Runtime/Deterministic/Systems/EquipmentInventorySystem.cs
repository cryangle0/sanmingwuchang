using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of the stat-rebuild path from
    /// packages/sim/src/systems/equipment-inventory.ts.
    /// </summary>
    internal static partial class EquipmentInventorySystem
    {
        public static EquippedEquipmentInstance CreateEquipmentInstance(
            SimulationState state,
            string equipmentId,
            int? acquiredAtTick = null,
            int permanentAttackBonus = 0)
        {
            var instance = new EquippedEquipmentInstance(
                state.NextEquipmentInstanceId,
                equipmentId,
                acquiredAtTick ?? state.Tick,
                permanentAttackBonus);
            state.NextEquipmentInstanceId += 1;
            return instance;
        }

        public static void DropHandOverflow(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            var capacity = LootSystem.EquipmentHandCapacity(player);
            if (player.InventoryEquipment.Count <= capacity)
            {
                return;
            }

            var ordered = new List<EquippedEquipmentInstance>(
                player.InventoryEquipment);
            ordered.Sort(
                (left, right) =>
                {
                    var result = left.AcquiredAtTick.CompareTo(
                        right.AcquiredAtTick);
                    return result != 0
                        ? result
                        : left.InstanceId.CompareTo(right.InstanceId);
                });
            player.InventoryEquipment.Clear();
            for (var index = 0; index < capacity; index += 1)
            {
                player.InventoryEquipment.Add(ordered[index]);
            }

            for (var index = capacity; index < ordered.Count; index += 1)
            {
                var drop = LootRuntime.CreateEquipmentLootDrop(
                    state,
                    player.Position,
                    ordered[index]);
                LootRuntime.EmitLootDropped(
                    state,
                    events,
                    drop,
                    player.EntityId);
            }
        }

        public static void RebuildEquipmentStats(PlayerState player)
        {
            var hero = HeroCatalog.Get(player.HeroId);
            var attack = InterpolateLevelStat(
                hero.Level1.Attack,
                hero.Level15.Attack,
                player.Level);
            var maxHpBase = InterpolateLevelStat(
                hero.Level1.MaxHp,
                hero.Level15.MaxHp,
                player.Level);
            var moveSpeed = InterpolateLevelStat(
                hero.Level1.MoveSpeedMmPerSecond,
                hero.Level15.MoveSpeedMmPerSecond,
                player.Level);
            var attackRange = InterpolateLevelStat(
                hero.Level1.AttackRangeMm,
                hero.Level15.AttackRangeMm,
                player.Level);
            var attacksPerSecondMilli = InterpolateLevelStat(
                hero.Level1.AttacksPerSecondMilli,
                hero.Level15.AttacksPerSecondMilli,
                player.Level);

            var equipmentIds = new List<string>(player.Equipment.Count);
            var permanentAttackBonus = 0;
            for (var index = 0; index < player.Equipment.Count; index += 1)
            {
                equipmentIds.Add(player.Equipment[index].EquipmentId);
                permanentAttackBonus +=
                    player.Equipment[index].PermanentAttackBonus;
            }

            var totals = EquipmentCatalog.GetStatTotals(equipmentIds);
            var previousMaxHp = player.MaxHp;
            var nextMaxHp = maxHpBase + totals.MaxHpFlat + player.B40BonusMaxHp;
            player.MaxHp = nextMaxHp;
            if (nextMaxHp > previousMaxHp &&
                player.LifeState == LifeState.Alive)
            {
                player.Hp = Math.Min(
                    nextMaxHp,
                    player.Hp + nextMaxHp - previousMaxHp);
            }
            else
            {
                player.Hp = Math.Min(player.Hp, nextMaxHp);
            }

            player.AttackPower =
                attack + totals.AttackFlat + permanentAttackBonus;
            player.MoveSpeedMmPerSecond = moveSpeed + totals.MoveSpeedFlat;
            player.AttackRangeMm =
                attackRange + totals.BasicAttackRangeFlatMm;
            player.AttacksPerSecondMilli =
                attacksPerSecondMilli *
                (100 + totals.AttackSpeedPercent) /
                100;
            player.AttackPeriodTicks = Math.Max(
                1,
                (int)Math.Ceiling(
                    SimulationConstants.TicksPerSecond * 1_000d /
                    player.AttacksPerSecondMilli));
        }

        private static int InterpolateLevelStat(
            int level1,
            int level15,
            int level)
        {
            var boundedLevel = Math.Max(1, Math.Min(15, level));
            return level1 + ((level15 - level1) * (boundedLevel - 1) / 14);
        }
    }
}
