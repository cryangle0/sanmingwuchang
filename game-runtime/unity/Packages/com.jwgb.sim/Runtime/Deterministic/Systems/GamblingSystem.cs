using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/gambling.ts (heishan shop, driven by
    /// the black-mountain RNG stream).
    /// </summary>
    internal static class GamblingSystem
    {
        private const int InteractionRadiusMm = 2_500;

        private static string Validate(
            SimulationState state,
            PlayerState player,
            string shopId,
            int expectedVersion)
        {
            state.Shops.TryGetValue(shopId, out var shop);
            if (shop == null || shop.Kind != "heishan")
            {
                return "shop-unavailable";
            }

            if (shop.Version != expectedVersion)
            {
                return "shop-version-mismatch";
            }

            if (state.Tick < shop.OpenAtTick ||
                state.Tick >= shop.CloseAtTick)
            {
                return "shop-unavailable";
            }

            if (!LootSystem.CanUseWorldResources(player))
            {
                return "player-not-alive";
            }

            if (player.PvpCombatTicks > 0)
            {
                return "pvp-combat-lock";
            }

            if (IntegerMath.DistanceSquared(
                    player.Position,
                    shop.Position) >
                (long)InteractionRadiusMm * InteractionRadiusMm)
            {
                return "shop-too-far";
            }

            if (!LineOfSightSystem.HasDirectLineOfSight(
                    state,
                    player.Position,
                    shop.Position))
            {
                return "shop-too-far";
            }

            if (player.HeishanGambleCount >= 3)
            {
                return "gamble-limit";
            }

            return null;
        }

        /// <summary>"big-win" / "flat" / "loss".</summary>
        private static string OutcomeFor(
            SimulationState state,
            PlayerState player,
            int baseBigWinPercent,
            int flatPercent)
        {
            var medalMultiplier = MonsterDamageSystem.HasEquipment(
                player,
                GameplayIds.GamblingMedal)
                ? 2
                : 1;
            var bigWinPercent = Math.Min(
                90,
                baseBigWinPercent * medalMultiplier);
            var roll = (int)state.Random.BlackMountain.NextInt(100);
            if (roll < bigWinPercent)
            {
                return "big-win";
            }

            return roll < Math.Min(100, bigWinPercent + flatPercent)
                ? "flat"
                : "loss";
        }

        private static string Emit(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            string outcome,
            int rewardGold = 0,
            string equipmentId = null,
            string passiveId = null,
            string activeId = null)
        {
            player.HeishanGambleCount += 1;
            events.Add(
                new SimEvent
                {
                    Type = "gamble-resolved",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    Outcome = outcome,
                    Amount = rewardGold,
                    EquipmentId = equipmentId,
                    PassiveId = passiveId,
                    ActiveAbilityId = activeId
                });
            return "accepted";
        }

        public static string GamblePassiveResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string shopId,
            int expectedVersion,
            string passiveId)
        {
            var player = RequirePlayer(state, playerEntityId);
            var failure = Validate(state, player, shopId, expectedVersion);
            if (failure != null)
            {
                return failure;
            }

            var index = -1;
            for (var i = 0; i < player.Passives.Count; i += 1)
            {
                if (player.Passives[i].PassiveId == passiveId)
                {
                    index = i;
                    break;
                }
            }

            if (index < 0)
            {
                return "passive-not-learned";
            }

            var selected = player.Passives[index];
            var outcome = OutcomeFor(state, player, 15, 50);
            string resultPassiveId = null;
            if (outcome == "loss")
            {
                LoadoutCleanupSystem.ClearRemovedPassiveState(
                    state,
                    events,
                    player,
                    selected.PassiveId);
                player.Passives.RemoveAt(index);
            }
            else
            {
                var owned = new HashSet<string>(StringComparer.Ordinal);
                for (var i = 0; i < player.Passives.Count; i += 1)
                {
                    owned.Add(player.Passives[i].PassiveId);
                }

                var candidates = new List<PassiveDefinition>();
                var all = GeneratedGameplayCatalog.Passives;
                for (var i = 0; i < all.Length; i += 1)
                {
                    if (!owned.Contains(all[i].Id))
                    {
                        candidates.Add(all[i]);
                    }
                }

                if (candidates.Count > 0)
                {
                    var replacement = candidates[
                        (int)state.Random.BlackMountain.NextInt(
                            (ulong)candidates.Count)];
                    resultPassiveId = replacement.Id;
                    LoadoutCleanupSystem.ClearRemovedPassiveState(
                        state,
                        events,
                        player,
                        selected.PassiveId);
                    player.Passives[index] = new PassiveLoadoutEntry(
                        replacement.Id,
                        outcome == "big-win"
                            ? Math.Min(5, selected.Level + 1)
                            : selected.Level);
                }
                else
                {
                    resultPassiveId = selected.PassiveId;
                    if (outcome == "big-win")
                    {
                        player.Passives[index] = new PassiveLoadoutEntry(
                            selected.PassiveId,
                            Math.Min(5, selected.Level + 1));
                    }
                }
            }

            return Emit(
                state,
                events,
                player,
                outcome,
                passiveId: resultPassiveId);
        }

        public static string GambleEquipmentResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string shopId,
            int expectedVersion,
            int instanceId)
        {
            var player = RequirePlayer(state, playerEntityId);
            var failure = Validate(state, player, shopId, expectedVersion);
            if (failure != null)
            {
                return failure;
            }

            var equipped = true;
            var index = FindIn(player.Equipment, instanceId);
            if (index < 0)
            {
                equipped = false;
                index = FindIn(player.InventoryEquipment, instanceId);
            }

            if (index < 0)
            {
                return "equipment-not-found";
            }

            var collection = equipped
                ? player.Equipment
                : player.InventoryEquipment;
            var selected = collection[index];
            var selectedDefinition = EquipmentCatalog.Get(
                selected.EquipmentId);
            if (selectedDefinition.Rarity != EquipmentRarity.White &&
                selectedDefinition.Rarity != EquipmentRarity.Blue &&
                selectedDefinition.Rarity != EquipmentRarity.Purple)
            {
                return "equipment-not-eligible";
            }

            var outcome = OutcomeFor(state, player, 15, 40);
            string resultEquipmentId = null;
            if (outcome == "loss")
            {
                if (equipped)
                {
                    EquipmentStateSystem.ClearRemovedEquipmentState(
                        state,
                        player,
                        selected.EquipmentId);
                }

                collection.RemoveAt(index);
            }
            else
            {
                var targetRarity = selectedDefinition.Rarity;
                if (outcome == "big-win" &&
                    targetRarity != EquipmentRarity.Gold)
                {
                    targetRarity = (EquipmentRarity)(
                        (byte)targetRarity + 1);
                }

                var candidates = new List<EquipmentDefinition>();
                var all = GeneratedGameplayCatalog.Equipment;
                for (var i = 0; i < all.Length; i += 1)
                {
                    if (all[i].Rarity == targetRarity &&
                        all[i].Id != selected.EquipmentId &&
                        all[i].Id != GameplayIds.GoldenCudgel)
                    {
                        candidates.Add(all[i]);
                    }
                }

                candidates.Sort(
                    (left, right) => string.CompareOrdinal(
                        left.Id,
                        right.Id));
                if (equipped)
                {
                    var equippedIds = new HashSet<string>(
                        StringComparer.Ordinal);
                    for (var i = 0; i < player.Equipment.Count; i += 1)
                    {
                        if (player.Equipment[i].InstanceId !=
                            selected.InstanceId)
                        {
                            equippedIds.Add(
                                player.Equipment[i].EquipmentId);
                        }
                    }

                    candidates.RemoveAll(
                        candidate => equippedIds.Contains(candidate.Id));
                }

                if (candidates.Count > 0)
                {
                    var replacement = candidates[
                        (int)state.Random.BlackMountain.NextInt(
                            (ulong)candidates.Count)];
                    resultEquipmentId = replacement.Id;
                    if (equipped)
                    {
                        EquipmentStateSystem.ClearRemovedEquipmentState(
                            state,
                            player,
                            selected.EquipmentId);
                    }

                    collection[index] = new EquippedEquipmentInstance(
                        selected.InstanceId,
                        replacement.Id,
                        selected.AcquiredAtTick,
                        selected.PermanentAttackBonus);
                }
            }

            EquipmentInventorySystem.RebuildEquipmentStats(player);
            EquipmentInventorySystem.DropHandOverflow(
                state,
                events,
                player);
            return Emit(
                state,
                events,
                player,
                outcome,
                equipmentId: resultEquipmentId);
        }

        public static string GambleActiveResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string shopId,
            int expectedVersion)
        {
            var player = RequirePlayer(state, playerEntityId);
            var failure = Validate(state, player, shopId, expectedVersion);
            if (failure != null)
            {
                return failure;
            }

            var outcome = OutcomeFor(state, player, 10, 50);
            LoadoutCleanupSystem.ClearOwnedActiveStateForReplacement(
                state,
                events,
                player,
                player.ActiveAbilityId);
            if (outcome == "big-win")
            {
                var heroes = GeneratedGameplayCatalog.Heroes;
                var currentHeroExclusive =
                    HeroCatalog.Get(player.HeroId).Active.Id;
                var currentExclusive = currentHeroExclusive;
                for (var i = 0; i < heroes.Length; i += 1)
                {
                    if (heroes[i].Active.Id == player.ActiveAbilityId)
                    {
                        currentExclusive = player.ActiveAbilityId;
                        break;
                    }
                }

                var candidates = new List<string>();
                for (var i = 0; i < heroes.Length; i += 1)
                {
                    if (heroes[i].Active.Id != currentExclusive)
                    {
                        candidates.Add(heroes[i].Active.Id);
                    }
                }

                candidates.Sort(StringComparer.Ordinal);
                if (candidates.Count > 0)
                {
                    player.ActiveAbilityId = candidates[
                        (int)state.Random.BlackMountain.NextInt(
                            (ulong)candidates.Count)];
                }
            }
            else if (outcome == "flat")
            {
                var candidates = new List<string>();
                var generics = MonsterDamageSystem.GenericActiveIds;
                for (var i = 0; i < generics.Length; i += 1)
                {
                    if (generics[i] != player.ActiveAbilityId)
                    {
                        candidates.Add(generics[i]);
                    }
                }

                candidates.Sort(StringComparer.Ordinal);
                if (candidates.Count > 0)
                {
                    player.ActiveAbilityId = candidates[
                        (int)state.Random.BlackMountain.NextInt(
                            (ulong)candidates.Count)];
                }
            }
            else
            {
                player.ActiveAbilityId =
                    HeroCatalog.Get(player.HeroId).Active.Id;
            }

            player.ActiveCooldownTicks =
                ActiveReplacementSystem.EquipmentActiveCooldownTicks(
                    player,
                    ActiveCatalog.Get(player.ActiveAbilityId)
                        .CooldownTicks);
            return Emit(
                state,
                events,
                player,
                outcome,
                activeId: player.ActiveAbilityId);
        }

        public static string GambleGoldResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string shopId,
            int expectedVersion,
            int wagerGold,
            string mode)
        {
            var player = RequirePlayer(state, playerEntityId);
            var failure = Validate(state, player, shopId, expectedVersion);
            if (failure != null)
            {
                return failure;
            }

            var wager = mode == "purple" ? 2_000 : wagerGold;
            if ((mode == "double" &&
                 (wager < 500 || wager > 5_000 || wager % 100 != 0)) ||
                (mode == "purple" && wagerGold != 2_000) ||
                (mode != "double" && mode != "purple") ||
                wager > player.Gold)
            {
                return "invalid-wager";
            }

            var outcome = OutcomeFor(state, player, 10, 40);
            player.Gold -= wager;
            var rewardGold = 0;
            string equipmentId = null;
            if (mode == "double")
            {
                if (outcome == "big-win")
                {
                    player.Gold += wager;
                    rewardGold = EquipmentEconomySystem.GrantGeneratedGold(
                        player,
                        wager);
                }
                else if (outcome == "flat")
                {
                    player.Gold += wager;
                }
                else
                {
                    player.Gold += wager / 2;
                }
            }
            else
            {
                if (outcome == "big-win")
                {
                    var purple = new List<EquipmentDefinition>();
                    var all = GeneratedGameplayCatalog.Equipment;
                    for (var i = 0; i < all.Length; i += 1)
                    {
                        if (all[i].Rarity == EquipmentRarity.Purple)
                        {
                            purple.Add(all[i]);
                        }
                    }

                    purple.Sort(
                        (left, right) => string.CompareOrdinal(
                            left.Id,
                            right.Id));
                    if (purple.Count > 0)
                    {
                        equipmentId = purple[
                            (int)state.Random.BlackMountain.NextInt(
                                (ulong)purple.Count)].Id;
                        var instance = EquipmentInventorySystem
                            .CreateEquipmentInstance(state, equipmentId);
                        if (player.InventoryEquipment.Count <
                            LootSystem.EquipmentHandCapacity(player))
                        {
                            player.InventoryEquipment.Add(instance);
                        }
                        else
                        {
                            var drop = LootRuntime.CreateEquipmentLootDrop(
                                state,
                                player.Position,
                                instance);
                            LootRuntime.EmitLootDropped(
                                state,
                                events,
                                drop,
                                player.EntityId);
                        }
                    }
                }
                else if (outcome == "flat")
                {
                    player.Gold += 2_000;
                }
                else
                {
                    player.Gold += 1_000;
                }
            }

            return Emit(
                state,
                events,
                player,
                outcome,
                rewardGold: rewardGold,
                equipmentId: equipmentId);
        }

        private static int FindIn(
            List<EquippedEquipmentInstance> collection,
            int instanceId)
        {
            for (var index = 0; index < collection.Count; index += 1)
            {
                if (collection[index].InstanceId == instanceId)
                {
                    return index;
                }
            }

            return -1;
        }

        private static PlayerState RequirePlayer(
            SimulationState state,
            int playerEntityId)
        {
            if (!state.Players.TryGetValue(playerEntityId, out var player))
            {
                throw new InvalidOperationException(
                    "unknown player " + playerEntityId);
            }

            return player;
        }
    }
}
