using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal sealed class MonsterState
    {
        public int EntityId;
        public MonsterKind Kind;
        public MonsterRing Ring;
        public FiveElement? Element;
        public Int2Mm Position;
        public Int2Mm HomePosition;
        public Int2Mm Facing;
        public int Hp;
        public int MaxHp;
        public int AttackPower;
        public int MoveSpeedMmPerSecond;
        public int AttackRangeMm;
        public int AttackPeriodTicks;
        public int AttackCooldownTicks;
        public int CollisionRadiusMm;
        public int AggroRadiusMm;
        public int LeashRadiusMm;
        public int? TargetEntityId;
        public int SpawnTick;
        public int InvulnerableTicks;
        public int HardControlTicks;
        public int SlowTicks;
        public int SlowBasisPoints = 10_000;
        public int SilenceTicks;
        public int SilenceCooldownPenaltyTicks;
        public int BlindTicks;
        public int BlindMissPercent;
        public bool BlindPreventsCritical;
        public int PolymorphTicks;
        public int PolymorphSpeedBonusPercent;
        public int DisplacementLockTicks;
        public string CourtId;
    }

    internal sealed class MonsterRespawnState
    {
        public MonsterKind Kind;
        public MonsterRing Ring;
        public FiveElement? Element;
        public Int2Mm HomePosition;
        public string CourtId;
        public int RespawnAtTick;
    }

    internal sealed class CoreBossTargetMarkState
    {
        public int? TargetEntityId;
        public Int2Mm Position;
    }

    internal sealed class CoreBossHazardState
    {
        public int EntityId;
        public int BossEntityId;
        public string AbilityId;
        public int CreatedAtTick;
        public int ActivatesAtTick;
        public int ExpiresAtTick;
        public Int2Mm Center;
        public Int2Mm Direction;
        public int RadiusMm;
        public int LengthMm;
        public int WidthMm;
        public int Damage;
        public int DamagePerSecond;
        public int HardControlTicks;
        public int DisplacementMm;
        public int GapIndex = -1;
        public bool Resolved;
        public int NextPulseTick;
        public int PulseIntervalTicks;
        public readonly System.Collections.Generic.List<CoreBossTargetMarkState>
            TargetMarks =
                new System.Collections.Generic.List<CoreBossTargetMarkState>();
        public readonly System.Collections.Generic.List<int> HitEntityIds =
            new System.Collections.Generic.List<int>();
    }

    internal sealed class CoreBossRuntimeState
    {
        public int BossEntityId;
        public string CourtId;
        public int NextRingCastTick;
        public int NextMeteorCastTick;
        public int NextSignatureCastTick;
        public int SignatureIndex;
    }

    internal sealed class CoreBossRevealAnchorState
    {
        public int EntityId;
        public int BossEntityId;
        public Int2Mm Position;
        public int ExpiresAtTick;
    }

    internal sealed class PendingActiveReplacementState
    {
        public int PlayerEntityId;
        public int LootEntityId;
        public string ActiveId;
        public int RequestedAtTick;
    }

    internal sealed class PendingEquipmentPickupState
    {
        public int PlayerEntityId;
        public int LootEntityId;
        public string EquipmentId;
        public int? EquipmentInstanceId;
        public int RequestedAtTick;
    }

    internal sealed class LootDropState
    {
        public int EntityId;
        public Int2Mm Position;
        public int Gold;
        public int Experience;
        public int Gems;
        public string EquipmentId;
        public string BookPassiveId;
        public int CreatedAtTick;
        public long ExpiresAtTick;

        /// <summary>
        /// Optional runtime fields; when HasRuntimeFields is false the
        /// serialized snapshot omits them entirely (legacy loot shape).
        /// </summary>
        public bool HasRuntimeFields;
        public string Kind;
        public string ActiveId;
        public int? EquipmentInstanceId;
        public int? AcquiredAtTick;
        public int PermanentAttackBonus;
        public int? StormCoveredSinceTick;
    }
}
