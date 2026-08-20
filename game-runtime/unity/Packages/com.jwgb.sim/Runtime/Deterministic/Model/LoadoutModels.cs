namespace Jwgb.Sim.Deterministic
{
    public readonly struct PassiveLoadoutEntry
    {
        public PassiveLoadoutEntry(string passiveId, int level)
        {
            PassiveId = passiveId;
            Level = level;
        }

        public string PassiveId { get; }

        public int Level { get; }
    }

    public readonly struct EquippedEquipmentInstance
    {
        public EquippedEquipmentInstance(int instanceId, string equipmentId)
            : this(instanceId, equipmentId, 0, 0)
        {
        }

        public EquippedEquipmentInstance(
            int instanceId,
            string equipmentId,
            int acquiredAtTick,
            int permanentAttackBonus)
        {
            InstanceId = instanceId;
            EquipmentId = equipmentId;
            AcquiredAtTick = acquiredAtTick;
            PermanentAttackBonus = permanentAttackBonus;
        }

        public int InstanceId { get; }

        public string EquipmentId { get; }

        public int AcquiredAtTick { get; }

        public int PermanentAttackBonus { get; }
    }
}
