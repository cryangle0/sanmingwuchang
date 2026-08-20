using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class AirdropSystem
    {
        private static void CompleteChannel(
            SimulationState state,
            List<SimEvent> events,
            AirdropChannelState channel,
            AirdropState airdrop,
            PlayerState player)
        {
            if (!airdrop.Position.HasValue ||
                airdrop.Phase != "available")
            {
                CancelChannel(state, events, channel, "expired");
                return;
            }

            var equipmentId = EquipmentPool[
                (int)state.Random.Airdrop.NextInt(
                    (ulong)EquipmentPool.Length)];
            var instance =
                EquipmentInventorySystem.CreateEquipmentInstance(
                    state,
                    equipmentId);
            var drop = LootRuntime.CreateEquipmentLootDrop(
                state,
                airdrop.Position.Value,
                instance);
            var rewardGold =
                EquipmentEconomySystem.GrantGeneratedGold(
                    player,
                    RewardGold);

            airdrop.Phase = "opened";
            airdrop.OpenedAtTick = state.Tick;
            airdrop.OpenedByEntityId = player.EntityId;
            airdrop.EquipmentId = equipmentId;
            airdrop.LootEntityId = drop.EntityId;
            state.AirdropChannels.Remove(player.EntityId);
            player.WorldInteractionLockTicks = 0;
            events.Add(
                new SimEvent
                {
                    Type = "airdrop-channel",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    AirdropId = airdrop.Id,
                    Outcome = "completed"
                });
            LootRuntime.EmitLootDropped(
                state,
                events,
                drop,
                player.EntityId);
            events.Add(
                new SimEvent
                {
                    Type = "airdrop-opened",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    AirdropId = airdrop.Id,
                    EquipmentId = equipmentId,
                    TargetEntityId = drop.EntityId,
                    Amount = rewardGold
                });
            CancelCompetingChannels(
                state,
                events,
                airdrop.Id);
        }

        private static void CancelCompetingChannels(
            SimulationState state,
            List<SimEvent> events,
            string airdropId)
        {
            var channels = new List<AirdropChannelState>(
                state.AirdropChannels.Values);
            for (var index = 0; index < channels.Count; index += 1)
            {
                if (channels[index].AirdropId == airdropId)
                {
                    CancelChannel(
                        state,
                        events,
                        channels[index],
                        "opened-by-other");
                }
            }
        }
    }
}
