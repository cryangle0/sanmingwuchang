namespace Jwgb.Sim.Deterministic
{
    public enum SimulationTransactionKind : byte
    {
        ShopPurchase = 1,
        ShopSale = 2,
        HeroSwap = 3,
        GamblePassive = 4,
        GambleEquipment = 5,
        GambleActive = 6,
        GambleGold = 7,
        SpendGem = 8,
        SkillBookReplace = 9,
        EquipmentLootPickup = 10,
        ActiveLootReplace = 11,
        EquipmentEquip = 12,
        EquipmentUnequip = 13,
        EquipmentDiscard = 14,
        AirdropOpen = 15
    }

    public sealed class SimulationTransactionRequest
    {
        public SimulationTransactionKind Kind { get; set; }

        public int PlayerEntityId { get; set; }

        public string ShopId { get; set; }

        public string ListingId { get; set; }

        public int ExpectedVersion { get; set; }

        public string Destination { get; set; }

        public int InstanceId { get; set; }

        public int? ReplacementInstanceId { get; set; }

        public string PassiveId { get; set; }

        public int LootEntityId { get; set; }

        public bool Confirm { get; set; }

        public string HeroId { get; set; }

        public int WagerGold { get; set; }

        public string Mode { get; set; }

        public string AirdropId { get; set; }
    }

    public sealed class SimulationTransactionResult
    {
        public SimulationTransactionKind Kind { get; set; }

        public bool Accepted { get; set; }

        public string Code { get; set; }

        public int? LootEntityId { get; set; }

        public WorldSnapshot Snapshot { get; set; }
    }
}
