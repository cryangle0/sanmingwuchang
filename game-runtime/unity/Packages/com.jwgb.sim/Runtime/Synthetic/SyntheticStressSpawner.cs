using System;
using Jwgb.Content;
using Unity.Collections;
using Unity.Entities;

namespace Jwgb.Sim
{
    public static class SyntheticStressSpawner
    {
        private const int GridColumns = 24;
        private const int GridSpacingMm = 5_000;

        public static Entity Spawn(EntityManager entityManager, SyntheticStressProfile profile)
        {
            using var existing = entityManager.CreateEntityQuery(
                ComponentType.ReadOnly<SyntheticStressState>());
            if (!existing.IsEmptyIgnoreFilter)
            {
                throw new InvalidOperationException("Synthetic stress state already exists.");
            }

            var stateEntity = entityManager.CreateEntity(
                typeof(SimulationTick),
                typeof(SyntheticStressState));
            entityManager.SetComponentData(stateEntity, new SimulationTick());
            entityManager.SetComponentData(
                stateEntity,
                new SyntheticStressState
                {
                    PlayerCount = profile.PlayerCount,
                    MonsterCount = profile.MonsterCount,
                    SummonCount = profile.SummonCount,
                    ArenaRadiusMm = profile.ArenaRadiusMm
                });

            var archetype = entityManager.CreateArchetype(
                typeof(SimEntityId),
                typeof(SimPositionMm),
                typeof(SimMotionRemainder),
                typeof(SyntheticAgent));

            using var entities = entityManager.CreateEntity(
                archetype,
                profile.TotalAgentCount,
                Allocator.Temp);

            for (var index = 0; index < entities.Length; index += 1)
            {
                var entityId = index + 1;
                entityManager.SetComponentData(
                    entities[index],
                    new SimEntityId { Value = entityId });
                entityManager.SetComponentData(
                    entities[index],
                    CreatePosition(index, profile.TotalAgentCount));
                entityManager.SetComponentData(
                    entities[index],
                    new SimMotionRemainder());
                entityManager.SetComponentData(
                    entities[index],
                    CreateAgent(index, entityId, profile));
            }

            return stateEntity;
        }

        private static SimPositionMm CreatePosition(int index, int totalCount)
        {
            var rowCount = (totalCount + GridColumns - 1) / GridColumns;
            var column = index % GridColumns;
            var row = index / GridColumns;
            var centeredColumn = (column * 2) - (GridColumns - 1);
            var centeredRow = (row * 2) - (rowCount - 1);

            return new SimPositionMm
            {
                X = centeredColumn * GridSpacingMm / 2,
                Z = centeredRow * GridSpacingMm / 2
            };
        }

        private static SyntheticAgent CreateAgent(
            int index,
            int entityId,
            SyntheticStressProfile profile)
        {
            var kind = ResolveKind(index, profile);
            return new SyntheticAgent
            {
                Kind = kind,
                Phase = unchecked((ushort)(entityId * 17)),
                SpeedMmPerSecond = ResolveSpeed(kind)
            };
        }

        private static SyntheticAgentKind ResolveKind(int index, SyntheticStressProfile profile)
        {
            if (index < profile.PlayerCount)
            {
                return SyntheticAgentKind.Player;
            }

            return index < profile.PlayerCount + profile.MonsterCount
                ? SyntheticAgentKind.Monster
                : SyntheticAgentKind.Summon;
        }

        private static int ResolveSpeed(SyntheticAgentKind kind)
        {
            return kind switch
            {
                SyntheticAgentKind.Player => 7_500,
                SyntheticAgentKind.Monster => 5_500,
                SyntheticAgentKind.Summon => 9_000,
                _ => throw new ArgumentOutOfRangeException(nameof(kind))
            };
        }
    }
}
