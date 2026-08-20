using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class PassiveEconomySystem
    {
        private static readonly string[] GoldEquipmentPool =
        {
            GameplayIds.NineTurnPill,
            GameplayIds.PrimordialPearl,
            GameplayIds.TribulationBell,
            GameplayIds.CloudRide,
            GameplayIds.TreasureBasin,
            GameplayIds.DemonSubduingMace,
            GameplayIds.KeenEars,
            GameplayIds.ThunderChisel,
            GameplayIds.SoulDevouringRing
        };

        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            foreach (var player in state.Players.Values)
            {
                if (player.LifeState == LifeState.Eliminated ||
                    !PassiveRuntimeSystem.TryFind(
                        player,
                        GameplayIds.Interest,
                        out var interest))
                {
                    continue;
                }

                var definition = PassiveCatalog.Get(
                    GameplayIds.Interest);
                if (state.Tick == 0 ||
                    state.Tick % definition.IntervalTicks != 0)
                {
                    continue;
                }

                var percent = PassiveCatalog.LevelValue(
                    definition.InterestPercentByLevel,
                    interest.Level);
                var cap = PassiveCatalog.LevelValue(
                    definition.CapByLevel,
                    interest.Level);
                if (interest.Level == 5)
                {
                    cap *= definition.Level5CapMultiplier;
                }

                var amount = Math.Min(
                    cap,
                    player.Gold * percent / 100);
                if (amount <= 0)
                {
                    continue;
                }

                player.Gold += amount;
                Emit(
                    state,
                    events,
                    GameplayIds.Interest,
                    player.EntityId,
                    0,
                    "interest",
                    amount,
                    definition.IntervalTicks);
            }
        }

        public static void ResolvePickpocket(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            PlayerState target)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Pickpocket,
                    out var pickpocket))
            {
                return;
            }

            var targetState = PassiveRuntimeSystem.GetOrCreateTargetState(
                state,
                owner.EntityId,
                target.EntityId);
            if (targetState.PickpocketCooldownTicks > 0)
            {
                return;
            }

            var definition = PassiveCatalog.Get(
                GameplayIds.Pickpocket);
            if (state.Random.Combat.NextInt(100) >=
                PassiveCatalog.LevelValue(
                    definition.ChancePercentByLevel,
                    pickpocket.Level))
            {
                return;
            }

            targetState.PickpocketCooldownTicks =
                definition.InternalCooldownTicks;
            var transferred = Math.Min(
                target.Gold,
                PassiveCatalog.LevelValue(
                    definition.GoldByLevel,
                    pickpocket.Level));
            target.Gold -= transferred;
            owner.Gold += transferred;
            if (pickpocket.Level == 5 && transferred > 0)
            {
                owner.Hp = Math.Min(
                    owner.MaxHp,
                    owner.Hp +
                    PassiveRuntimeSystem.ScaleMagnitude(
                        transferred *
                        definition.Level5HealPercent /
                        100,
                        owner));
            }

            Emit(
                state,
                events,
                GameplayIds.Pickpocket,
                owner.EntityId,
                target.EntityId,
                "gold-transfer",
                transferred,
                definition.InternalCooldownTicks);
        }

        public static int ScavengerSaleGold(
            PlayerState player,
            int baseSellPrice)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.Scavenger,
                    out var scavenger))
            {
                return baseSellPrice;
            }

            var percent = PassiveCatalog.LevelValue(
                PassiveCatalog.Get(GameplayIds.Scavenger)
                    .SaleBonusPercentByLevel,
                scavenger.Level);
            return baseSellPrice + baseSellPrice * percent / 100;
        }

        public static int ScavengerPickupGold(
            PlayerState player,
            string equipmentId)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.Scavenger,
                    out var scavenger) ||
                scavenger.Level != 5)
            {
                return 0;
            }

            var definition = PassiveCatalog.Get(
                GameplayIds.Scavenger);
            return EquipmentCatalog.Get(equipmentId).SellPrice *
                definition.PickupGoldPercent /
                100;
        }

        public static LootDropState CreateTreasureHunterDrop(
            SimulationState state,
            int sourceEntityId,
            MonsterState monster)
        {
            if (!state.Players.TryGetValue(
                    sourceEntityId,
                    out var player) ||
                !PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.TreasureHunter,
                    out var treasure))
            {
                return null;
            }

            var definition = PassiveCatalog.Get(
                GameplayIds.TreasureHunter);
            if (state.Random.Combat.NextInt(100) >=
                PassiveCatalog.LevelValue(
                    definition.ChestChancePercentByLevel,
                    treasure.Level))
            {
                return null;
            }

            var gems = state.Random.Combat.NextInt(100) <
                PassiveCatalog.LevelValue(
                    definition.GemChancePercentByLevel,
                    treasure.Level)
                    ? 1
                    : 0;
            string equipmentId = null;
            if (treasure.Level == 5 &&
                state.Random.Combat.NextInt(100) <
                definition.GoldEquipmentChancePercent)
            {
                equipmentId = GoldEquipmentPool[
                    state.Random.Combat.NextInt(
                        (ulong)GoldEquipmentPool.Length)];
            }

            return LootRuntime.CreateRuntimeLootDrop(
                state,
                monster.Position,
                "chest",
                gold: PassiveCatalog.LevelValue(
                    definition.ChestGoldByLevel,
                    treasure.Level),
                gems: gems,
                equipmentId: equipmentId,
                expiresAtTick: state.Tick +
                    60 * SimulationConstants.TicksPerSecond);
        }

        private static void Emit(
            SimulationState state,
            List<SimEvent> events,
            string passiveId,
            int sourceEntityId,
            int targetEntityId,
            string detail,
            int amount,
            int durationTicks)
        {
            events.Add(
                new SimEvent
                {
                    Type = "passive-proc",
                    Tick = state.Tick,
                    PassiveId = passiveId,
                    SourceEntityId = sourceEntityId,
                    TargetEntityId = targetEntityId,
                    Detail = detail,
                    Amount = amount,
                    DurationTicks = durationTicks
                });
        }
    }
}
