using System.Collections.Generic;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/loot-runtime.ts. All authoritative
    /// runtime loot producers go through here so the optional runtime keys
    /// (kind/activeId/equipmentInstanceId/acquiredAtTick/permanentAttackBonus/
    /// stormCoveredSinceTick) are always present in the state hash.
    /// </summary>
    internal static class LootRuntime
    {
        /// <summary>Mirrors Number.MAX_SAFE_INTEGER in the TS oracle.</summary>
        public const long SafeZoneExpiry = 9_007_199_254_740_991;

        public const int CurrencyExpiryTicks =
            60 * SimulationConstants.TicksPerSecond;

        public const int LongExpiryTicks =
            120 * SimulationConstants.TicksPerSecond;

        public const int StormGraceTicks =
            60 * SimulationConstants.TicksPerSecond;

        public static bool IsPersistentKind(string kind)
        {
            return kind == "equipment" ||
                kind == "death-equipment" ||
                kind == "skill-book" ||
                kind == "active";
        }

        public static LootDropState CreateRuntimeLootDrop(
            SimulationState state,
            Int2Mm position,
            string kind,
            int gold = 0,
            int experience = 0,
            int gems = 0,
            string equipmentId = null,
            string bookPassiveId = null,
            string activeId = null,
            long? expiresAtTick = null,
            EquippedEquipmentInstance? equipmentInstance = null)
        {
            var drop = new LootDropState
            {
                EntityId = state.NextEntityId,
                Position = position,
                Gold = gold,
                Experience = experience,
                Gems = gems,
                EquipmentId = equipmentId,
                BookPassiveId = bookPassiveId,
                CreatedAtTick = state.Tick,
                ExpiresAtTick = expiresAtTick ??
                    (IsPersistentKind(kind)
                        ? SafeZoneExpiry
                        : state.Tick + CurrencyExpiryTicks),
                HasRuntimeFields = true,
                Kind = kind,
                ActiveId = activeId,
                EquipmentInstanceId = equipmentInstance?.InstanceId,
                AcquiredAtTick = equipmentInstance?.AcquiredAtTick,
                PermanentAttackBonus =
                    equipmentInstance?.PermanentAttackBonus ?? 0,
                StormCoveredSinceTick = null
            };
            state.NextEntityId += 1;
            state.LootDrops.Add(drop.EntityId, drop);
            return drop;
        }

        public static LootDropState CreateEquipmentLootDrop(
            SimulationState state,
            Int2Mm position,
            EquippedEquipmentInstance instance,
            string kind = "equipment")
        {
            return CreateRuntimeLootDrop(
                state,
                position,
                kind,
                equipmentId: instance.EquipmentId,
                expiresAtTick: SafeZoneExpiry,
                equipmentInstance: instance);
        }

        public static void EmitLootDropped(
            SimulationState state,
            List<SimEvent> events,
            LootDropState drop,
            int sourceEntityId)
        {
            // Mirror the fixture event normalizer: loot-dropped keeps only
            // entityId, sourceEntityId and amount (= gold); every other field
            // must stay at its default so the harness comparison passes.
            events.Add(
                new SimEvent
                {
                    Type = "loot-dropped",
                    Tick = state.Tick,
                    EntityId = drop.EntityId,
                    SourceEntityId = sourceEntityId,
                    Amount = drop.Gold
                });
        }
    }
}
