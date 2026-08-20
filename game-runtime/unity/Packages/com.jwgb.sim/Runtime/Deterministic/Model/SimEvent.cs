using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public sealed class SimEvent
    {
        public string Type { get; set; }

        public int Tick { get; set; }

        public int EntityId { get; set; }

        public int? SourceEntityId { get; set; }

        public int TargetEntityId { get; set; }

        public string PlayerId { get; set; }

        public string HeroId { get; set; }

        public int CompetitorCount { get; set; }

        public int TrueDeaths { get; set; }

        public int LivesRemaining { get; set; }

        public int Amount { get; set; }

        public int ShieldDamage { get; set; }

        public int HpDamage { get; set; }

        public int RemainingHp { get; set; }

        public int RemainingShield { get; set; }

        public int ShieldBypassHpDamage { get; set; }

        public string Cause { get; set; }

        public string Form { get; set; }

        public bool IsCritical { get; set; }

        public string Reason { get; set; }

        public string Outcome { get; set; }

        public int? WinnerEntityId { get; set; }

        public int[] Placements { get; set; }

        public string ActiveAbilityId { get; set; }

        public string ActiveName { get; set; }

        public Int2Mm Position { get; set; }

        public string PassiveId { get; set; }

        public int CriticalDamagePercent { get; set; }

        public int ShieldBypassPercent { get; set; }

        public int DurationTicks { get; set; }

        public int ProjectileEntityId { get; set; }

        public int WallEntityId { get; set; }

        public string ProjectileKind { get; set; }

        public Int2Mm PreviousPosition { get; set; }

        public Int2Mm NewPosition { get; set; }

        public int RequestedDistanceMm { get; set; }

        public int ActualDistanceMm { get; set; }

        public string BlockingSolidId { get; set; }

        public string Protection { get; set; }

        public int HpRestored { get; set; }

        public bool DidBlink { get; set; }

        public int BuffTicks { get; set; }

        public int ConsumedEquipmentInstanceId { get; set; }

        public int InvulnerableTicks { get; set; }

        public string Kind { get; set; }

        public string SummonKind { get; set; }

        public int OwnerEntityId { get; set; }

        public int CollectorEntityId { get; set; }

        public int Gold { get; set; }

        public int Experience { get; set; }

        public int Gems { get; set; }

        public string EquipmentId { get; set; }

        public string BookPassiveId { get; set; }

        public string ShopId { get; set; }

        public string ListingId { get; set; }

        public int InstanceId { get; set; }

        public int? ReplacementInstanceId { get; set; }

        public string AirdropId { get; set; }

        public int Level { get; set; }

        public string Source { get; set; }

        public string Detail { get; set; }
    }
}
