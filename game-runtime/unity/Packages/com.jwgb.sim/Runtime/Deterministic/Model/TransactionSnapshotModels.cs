using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public sealed class PendingActiveReplacementSnapshot
    {
        public int PlayerEntityId { get; set; }
        public int LootEntityId { get; set; }
        public string ActiveId { get; set; }
        public int RequestedAtTick { get; set; }
    }

    public sealed class PendingEquipmentPickupSnapshot
    {
        public int PlayerEntityId { get; set; }
        public int LootEntityId { get; set; }
        public string EquipmentId { get; set; }
        public int? EquipmentInstanceId { get; set; }
        public int RequestedAtTick { get; set; }
    }

    public sealed class AirdropSnapshot
    {
        public string Id { get; set; }
        public int Sequence { get; set; }
        public int ScheduledElapsedTick { get; set; }
        public string Phase { get; set; }
        public Int2Mm? Position { get; set; }
        public int? AnnouncedAtTick { get; set; }
        public int? LandedAtTick { get; set; }
        public int? ExpiresAtTick { get; set; }
        public int? OpenedAtTick { get; set; }
        public int? OpenedByEntityId { get; set; }
        public string EquipmentId { get; set; }
        public int? LootEntityId { get; set; }
    }

    public sealed class AirdropChannelSnapshot
    {
        public int Sequence { get; set; }
        public int PlayerEntityId { get; set; }
        public string AirdropId { get; set; }
        public int StartedAtTick { get; set; }
        public int CompletesAtTick { get; set; }
        public Int2Mm OriginPosition { get; set; }
    }
}
