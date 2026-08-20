using System;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public sealed class MonsterSnapshot
    {
        public int EntityId { get; set; }
        public string Kind { get; set; }
        public string Ring { get; set; }
        public string Element { get; set; }
        public Int2Mm Position { get; set; }
        public Int2Mm HomePosition { get; set; }
        public Int2Mm Facing { get; set; }
        public int Hp { get; set; }
        public int MaxHp { get; set; }
        public int AttackPower { get; set; }
        public int MoveSpeedMmPerSecond { get; set; }
        public int AttackRangeMm { get; set; }
        public int AttackPeriodTicks { get; set; }
        public int AttackCooldownTicks { get; set; }
        public int CollisionRadiusMm { get; set; }
        public int AggroRadiusMm { get; set; }
        public int LeashRadiusMm { get; set; }
        public int? TargetEntityId { get; set; }
        public int SpawnTick { get; set; }
        public int InvulnerableTicks { get; set; }
        public int HardControlTicks { get; set; }
        public int SlowTicks { get; set; }
        public int SlowBasisPoints { get; set; }
        public int SilenceTicks { get; set; }
        public int SilenceCooldownPenaltyTicks { get; set; }
        public int BlindTicks { get; set; }
        public int BlindMissPercent { get; set; }
    }

    public sealed class LootSnapshot
    {
        public int EntityId { get; set; }
        public Int2Mm Position { get; set; }
        public int Gold { get; set; }
        public int Experience { get; set; }
        public int Gems { get; set; }
        public string EquipmentId { get; set; }
        public string BookPassiveId { get; set; }
        public int CreatedAtTick { get; set; }
        public long ExpiresAtTick { get; set; }
        public string Kind { get; set; }
        public string ActiveId { get; set; }
        public int? EquipmentInstanceId { get; set; }
        public int? AcquiredAtTick { get; set; }
        public int PermanentAttackBonus { get; set; }
        public int? StormCoveredSinceTick { get; set; }
    }

    public sealed class MonsterRespawnSnapshot
    {
        public string Kind { get; set; }
        public string Ring { get; set; }
        public string Element { get; set; }
        public Int2Mm HomePosition { get; set; }
        public int RespawnAtTick { get; set; }
    }
}
