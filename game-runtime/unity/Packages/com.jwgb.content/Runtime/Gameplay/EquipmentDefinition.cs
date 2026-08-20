namespace Jwgb.Content
{
    public sealed class EquipmentDefinition
    {
        public string Id { get; set; }

        public string Name { get; set; }

        public EquipmentRarity Rarity { get; set; }

        public int? Price { get; set; }

        public int SellPrice { get; set; }

        public int AttackFlat { get; set; }

        public int MaxHpFlat { get; set; }

        public int MoveSpeedFlat { get; set; }

        public int AttackSpeedPercent { get; set; }

        public EquipmentEffect Effect { get; set; }

        public string ModifierId { get; set; }

        public int RestoreHpPercent { get; set; }

        public int InvulnerableTicks { get; set; }

        public int RangeBonusMm { get; set; }
    }

    public readonly struct EquipmentStatTotals
    {
        public EquipmentStatTotals(
            int attackFlat,
            int maxHpFlat,
            int moveSpeedFlat,
            int attackSpeedPercent,
            int basicAttackRangeFlatMm)
        {
            AttackFlat = attackFlat;
            MaxHpFlat = maxHpFlat;
            MoveSpeedFlat = moveSpeedFlat;
            AttackSpeedPercent = attackSpeedPercent;
            BasicAttackRangeFlatMm = basicAttackRangeFlatMm;
        }

        public int AttackFlat { get; }

        public int MaxHpFlat { get; }

        public int MoveSpeedFlat { get; }

        public int AttackSpeedPercent { get; }

        public int BasicAttackRangeFlatMm { get; }
    }

    public enum EquipmentRarity : byte
    {
        White = 1,
        Blue = 2,
        Purple = 3,
        Gold = 4
    }
}
