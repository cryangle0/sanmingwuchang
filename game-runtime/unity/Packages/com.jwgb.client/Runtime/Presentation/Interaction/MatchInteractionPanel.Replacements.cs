using Jwgb.Sim.Deterministic;

namespace Jwgb.Client.Presentation
{
    internal sealed partial class MatchInteractionPanel
    {
        private bool BuildPendingReplacements()
        {
            var built = false;
            for (var index = 0;
                index < snapshot.PendingActiveReplacements.Length;
                index += 1)
            {
                var pending =
                    snapshot.PendingActiveReplacements[index];
                if (pending.PlayerEntityId != player.EntityId)
                {
                    continue;
                }
                built = true;
                AddSection("ACTIVE REPLACEMENT");
                var row = AddRow(pending.ActiveId);
                AddAction(
                    row,
                    "REPLACE",
                    "Confirm active replacement",
                    () => Submit(
                        new SimulationTransactionRequest
                        {
                            Kind = SimulationTransactionKind
                                .ActiveLootReplace,
                            LootEntityId = pending.LootEntityId,
                            Confirm = true
                        }));
                AddAction(
                    row,
                    "KEEP",
                    "Keep current active ability",
                    () => Submit(
                        new SimulationTransactionRequest
                        {
                            Kind = SimulationTransactionKind
                                .ActiveLootReplace,
                            LootEntityId = pending.LootEntityId,
                            Confirm = false
                        }));
            }

            for (var index = 0;
                index < snapshot.PendingEquipmentPickups.Length;
                index += 1)
            {
                var pending =
                    snapshot.PendingEquipmentPickups[index];
                if (pending.PlayerEntityId != player.EntityId)
                {
                    continue;
                }
                var loot = FindLoot(pending.LootEntityId);
                if (loot == null)
                {
                    continue;
                }
                built = true;
                AddSection(
                    $"PICKUP {EquipmentName(loot.EquipmentId)}");
                BuildEquipmentPickupChoices(loot);
            }
            return built;
        }

        private void BuildEquipmentPickupChoices(LootSnapshot loot)
        {
            if (player.Equipment.Length < 3)
            {
                var row = AddRow("EQUIPPED SLOT");
                AddPickup(row, loot, "equipped", null, "EQUIP");
            }
            foreach (var equipped in player.Equipment)
            {
                var row = AddRow(
                    $"REPLACE {EquipmentName(equipped.EquipmentId)}");
                AddPickup(
                    row,
                    loot,
                    "equipped",
                    equipped.InstanceId,
                    "SWAP");
            }
            foreach (var hand in player.InventoryEquipment)
            {
                var row = AddRow(
                    $"DROP {EquipmentName(hand.EquipmentId)}");
                AddPickup(
                    row,
                    loot,
                    "inventory",
                    hand.InstanceId,
                    "PICK");
            }
            var cancel = AddRow("LEAVE ON GROUND");
            AddPickup(cancel, loot, "cancel", null, "CANCEL");
        }

        private void AddPickup(
            UnityEngine.UIElements.VisualElement row,
            LootSnapshot loot,
            string destination,
            int? replacement,
            string label)
        {
            AddAction(
                row,
                label,
                "Resolve equipment pickup",
                () => Submit(
                    new SimulationTransactionRequest
                    {
                        Kind = SimulationTransactionKind
                            .EquipmentLootPickup,
                        LootEntityId = loot.EntityId,
                        Destination = destination,
                        ReplacementInstanceId = replacement
                    }));
        }

        private void BuildNearbySkillBook()
        {
            if (player.Passives.Length < 4)
            {
                return;
            }
            for (var index = 0;
                index < snapshot.LootDrops.Length;
                index += 1)
            {
                var loot = snapshot.LootDrops[index];
                if (string.IsNullOrEmpty(loot.BookPassiveId) ||
                    DistanceSquared(player.Position, loot.Position) >
                        2_500L * 2_500L)
                {
                    continue;
                }

                AddSection($"SKILL BOOK {loot.BookPassiveId}");
                foreach (var passive in player.Passives)
                {
                    var row = AddRow(
                        $"REPLACE {passive.PassiveId}");
                    AddAction(
                        row,
                        "LEARN",
                        "Replace passive",
                        () => Submit(
                            new SimulationTransactionRequest
                            {
                                Kind = SimulationTransactionKind
                                    .SkillBookReplace,
                                LootEntityId = loot.EntityId,
                                PassiveId = passive.PassiveId
                            }));
                }
                return;
            }
        }

        private LootSnapshot FindLoot(int entityId)
        {
            for (var index = 0;
                index < snapshot.LootDrops.Length;
                index += 1)
            {
                if (snapshot.LootDrops[index].EntityId == entityId)
                {
                    return snapshot.LootDrops[index];
                }
            }
            return null;
        }
    }
}
