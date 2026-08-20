using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class SnapshotFactory
    {
        private static MonsterSnapshot[] CreateMonsters(
            SimulationState state)
        {
            var snapshots = new MonsterSnapshot[state.Monsters.Count];
            var index = 0;
            foreach (var monster in state.Monsters.Values)
            {
                snapshots[index] = new MonsterSnapshot
                {
                    EntityId = monster.EntityId,
                    Kind = SimulationText.MonsterKind(monster.Kind),
                    Ring = SimulationText.MonsterRing(monster.Ring),
                    Element = monster.Element.HasValue
                        ? SimulationText.Element(monster.Element.Value)
                        : null,
                    Position = monster.Position,
                    HomePosition = monster.HomePosition,
                    Facing = monster.Facing,
                    Hp = monster.Hp,
                    MaxHp = monster.MaxHp,
                    AttackPower = monster.AttackPower,
                    MoveSpeedMmPerSecond =
                        monster.MoveSpeedMmPerSecond,
                    AttackRangeMm = monster.AttackRangeMm,
                    AttackPeriodTicks = monster.AttackPeriodTicks,
                    AttackCooldownTicks = monster.AttackCooldownTicks,
                    CollisionRadiusMm = monster.CollisionRadiusMm,
                    AggroRadiusMm = monster.AggroRadiusMm,
                    LeashRadiusMm = monster.LeashRadiusMm,
                    TargetEntityId = monster.TargetEntityId,
                    SpawnTick = monster.SpawnTick,
                    InvulnerableTicks = monster.InvulnerableTicks,
                    HardControlTicks = monster.HardControlTicks,
                    SlowTicks = monster.SlowTicks,
                    SlowBasisPoints = monster.SlowBasisPoints,
                    SilenceTicks = monster.SilenceTicks,
                    SilenceCooldownPenaltyTicks =
                        monster.SilenceCooldownPenaltyTicks,
                    BlindTicks = monster.BlindTicks,
                    BlindMissPercent = monster.BlindMissPercent
                };
                index += 1;
            }

            return snapshots;
        }

        private static LootSnapshot[] CreateLootDrops(
            SimulationState state)
        {
            var snapshots = new LootSnapshot[state.LootDrops.Count];
            var index = 0;
            foreach (var drop in state.LootDrops.Values)
            {
                snapshots[index] = new LootSnapshot
                {
                    EntityId = drop.EntityId,
                    Position = drop.Position,
                    Gold = drop.Gold,
                    Experience = drop.Experience,
                    Gems = drop.Gems,
                    EquipmentId = drop.EquipmentId,
                    BookPassiveId = drop.BookPassiveId,
                    CreatedAtTick = drop.CreatedAtTick,
                    ExpiresAtTick = drop.ExpiresAtTick,
                    Kind = drop.HasRuntimeFields
                        ? drop.Kind
                        : null,
                    ActiveId = drop.HasRuntimeFields
                        ? drop.ActiveId
                        : null,
                    EquipmentInstanceId = drop.HasRuntimeFields
                        ? drop.EquipmentInstanceId
                        : null,
                    AcquiredAtTick = drop.HasRuntimeFields
                        ? drop.AcquiredAtTick
                        : null,
                    PermanentAttackBonus = drop.HasRuntimeFields
                        ? drop.PermanentAttackBonus
                        : 0,
                    StormCoveredSinceTick = drop.HasRuntimeFields
                        ? drop.StormCoveredSinceTick
                        : null
                };
                index += 1;
            }

            return snapshots;
        }

        private static MonsterRespawnSnapshot[] CreateMonsterRespawns(
            SimulationState state)
        {
            var pending = new List<MonsterRespawnState>(
                state.MonsterRespawns);
            pending.Sort(
                (left, right) =>
                    left.RespawnAtTick.CompareTo(right.RespawnAtTick));
            var snapshots = new MonsterRespawnSnapshot[pending.Count];
            for (var index = 0; index < pending.Count; index += 1)
            {
                var respawn = pending[index];
                snapshots[index] = new MonsterRespawnSnapshot
                {
                    Kind = SimulationText.MonsterKind(respawn.Kind),
                    Ring = SimulationText.MonsterRing(respawn.Ring),
                    Element = respawn.Element.HasValue
                        ? SimulationText.Element(respawn.Element.Value)
                        : null,
                    HomePosition = respawn.HomePosition,
                    RespawnAtTick = respawn.RespawnAtTick
                };
            }

            return snapshots;
        }

        private static PassiveTargetSnapshot[] CreatePassiveTargetStates(
            SimulationState state)
        {
            var snapshots = new PassiveTargetSnapshot[
                state.PassiveTargetStates.Count];
            var index = 0;
            foreach (var targetState in state.PassiveTargetStates.Values)
            {
                snapshots[index] = new PassiveTargetSnapshot
                {
                    SourceEntityId = targetState.SourceEntityId,
                    TargetEntityId = targetState.TargetEntityId,
                    BurnStacks = targetState.BurnStacks,
                    PoisonStacks = targetState.PoisonStacks,
                    PoisonExpiresAtTick =
                        targetState.PoisonExpiresAtTick,
                    PoisonNextTick = targetState.PoisonNextTick,
                    FireBurnDamagePerSecond =
                        targetState.FireBurnDamagePerSecond,
                    FireBurnExpiresAtTick =
                        targetState.FireBurnExpiresAtTick,
                    FireBurnNextTick = targetState.FireBurnNextTick,
                    FireBurnSourceEntityId =
                        targetState.FireBurnSourceEntityId,
                    RevealExpiresAtTick =
                        targetState.RevealExpiresAtTick,
                    PickpocketCooldownTicks =
                        targetState.PickpocketCooldownTicks,
                    StunCooldownTicks = targetState.StunCooldownTicks,
                    CounterCooldownTicks =
                        targetState.CounterCooldownTicks,
                    LastBasicHitTick = targetState.LastBasicHitTick
                };
                index += 1;
            }

            return snapshots;
        }
    }
}
