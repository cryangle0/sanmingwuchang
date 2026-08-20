using Jwgb.Content;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client.Presentation
{
    internal sealed partial class MatchInteractionPanel
    {
        private void BuildLoadoutContent()
        {
            BuildPendingReplacements();
            BuildNearbySkillBook();
            AddSection($"PASSIVES  GEMS {player.Gems}");
            for (var index = 0; index < player.Passives.Length; index += 1)
            {
                var passive = player.Passives[index];
                var row = AddRow(
                    $"{PassiveCatalog.Get(passive.PassiveId).Name} " +
                    $"LV.{passive.Level}");
                var enabled = player.Gems > 0 &&
                    passive.Level < 5 &&
                    player.LifeState == LifeState.Alive &&
                    player.PvpCombatTicks <= 0;
                AddAction(
                    row,
                    "UP",
                    "Spend one gem",
                    () => Submit(
                        new SimulationTransactionRequest
                        {
                            Kind = SimulationTransactionKind.SpendGem,
                            PassiveId = passive.PassiveId
                        }),
                    enabled,
                    passive.Level >= 5
                        ? "Passive is maxed"
                        : player.Gems <= 0
                            ? "No gems"
                            : "Player unavailable");
            }

            AddSection("EQUIPPED");
            foreach (var instance in player.Equipment)
            {
                var row = AddRow(EquipmentName(instance.EquipmentId));
                AddAction(
                    row,
                    "HAND",
                    "Move to hand",
                    () => Submit(
                        new SimulationTransactionRequest
                        {
                            Kind = SimulationTransactionKind
                                .EquipmentUnequip,
                            InstanceId = instance.InstanceId
                        }));
                AddDiscard(row, instance);
            }

            AddSection("HAND");
            foreach (var instance in player.InventoryEquipment)
            {
                var row = AddRow(EquipmentName(instance.EquipmentId));
                if (player.Equipment.Length < 3)
                {
                    AddEquip(row, instance, null);
                }
                else
                {
                    foreach (var equipped in player.Equipment)
                    {
                        AddEquip(
                            row,
                            instance,
                            equipped.InstanceId);
                    }
                }
                AddDiscard(row, instance);
            }
        }

        private void AddEquip(
            UnityEngine.UIElements.VisualElement row,
            EquippedEquipmentInstance instance,
            int? replacementInstanceId)
        {
            AddAction(
                row,
                replacementInstanceId.HasValue
                    ? "SWAP"
                    : "EQUIP",
                replacementInstanceId.HasValue
                    ? "Replace equipped item"
                    : "Equip item",
                () => Submit(
                    new SimulationTransactionRequest
                    {
                        Kind = SimulationTransactionKind
                            .EquipmentEquip,
                        InstanceId = instance.InstanceId,
                        ReplacementInstanceId =
                            replacementInstanceId
                    }));
        }

        private void AddDiscard(
            UnityEngine.UIElements.VisualElement row,
            EquippedEquipmentInstance instance)
        {
            AddAction(
                row,
                "DROP",
                "Drop equipment",
                () => Submit(
                    new SimulationTransactionRequest
                    {
                        Kind = SimulationTransactionKind
                            .EquipmentDiscard,
                        InstanceId = instance.InstanceId
                    }));
        }

        private static string EquipmentName(string equipmentId)
        {
            return string.IsNullOrEmpty(equipmentId)
                ? "EQUIPMENT"
                : EquipmentCatalog.Get(equipmentId).Name;
        }
    }
}
