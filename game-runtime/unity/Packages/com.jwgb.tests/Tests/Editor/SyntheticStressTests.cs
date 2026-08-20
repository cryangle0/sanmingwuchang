using System;
using Jwgb.Content;
using Jwgb.Sim;
using NUnit.Framework;
using Unity.Collections;
using Unity.Entities;

namespace Jwgb.Tests
{
    public sealed class SyntheticStressTests
    {
        [Test]
        public void BaselineSpawnsExpectedEntityMix()
        {
            using var world = new World("JWGB synthetic spawn test");
            SyntheticStressSpawner.Spawn(
                world.EntityManager,
                SyntheticStressProfile.Baseline);

            using var agentQuery = world.EntityManager.CreateEntityQuery(
                ComponentType.ReadOnly<SyntheticAgent>());
            using var stateQuery = world.EntityManager.CreateEntityQuery(
                ComponentType.ReadOnly<SyntheticStressState>());

            Assert.That(agentQuery.CalculateEntityCount(), Is.EqualTo(423));
            var state = stateQuery.GetSingleton<SyntheticStressState>();
            Assert.That(state.PlayerCount, Is.EqualTo(30));
            Assert.That(state.MonsterCount, Is.EqualTo(123));
            Assert.That(state.SummonCount, Is.EqualTo(270));
        }

        [Test]
        public void FixedTicksAreDeterministicAndStayInsideArena()
        {
            var first = RunTicks(200);
            var second = RunTicks(200);

            Assert.That(first.Length, Is.EqualTo(second.Length));
            for (var index = 0; index < first.Length; index += 1)
            {
                Assert.That(first[index].EntityId, Is.EqualTo(second[index].EntityId));
                Assert.That(first[index].Position.X, Is.EqualTo(second[index].Position.X));
                Assert.That(first[index].Position.Z, Is.EqualTo(second[index].Position.Z));
                Assert.That(first[index].Position.X, Is.InRange(-120_000, 120_000));
                Assert.That(first[index].Position.Z, Is.InRange(-120_000, 120_000));
            }
        }

        private static AgentSnapshot[] RunTicks(int tickCount)
        {
            using var world = new World("JWGB synthetic tick test");
            SyntheticStressSpawner.Spawn(
                world.EntityManager,
                SyntheticStressProfile.Baseline);
            var system = world.CreateSystem<SyntheticMotionSystem>();

            for (var tick = 0; tick < tickCount; tick += 1)
            {
                system.Update(world.Unmanaged);
            }

            world.EntityManager.CompleteAllTrackedJobs();
            using var query = world.EntityManager.CreateEntityQuery(
                ComponentType.ReadOnly<SimEntityId>(),
                ComponentType.ReadOnly<SimPositionMm>());
            using var entityIds = query.ToComponentDataArray<SimEntityId>(Allocator.Temp);
            using var positions = query.ToComponentDataArray<SimPositionMm>(Allocator.Temp);
            var snapshots = new AgentSnapshot[positions.Length];
            for (var index = 0; index < positions.Length; index += 1)
            {
                snapshots[index] = new AgentSnapshot(
                    entityIds[index].Value,
                    positions[index]);
            }

            Array.Sort(
                snapshots,
                (left, right) => left.EntityId.CompareTo(right.EntityId));
            return snapshots;
        }

        private readonly struct AgentSnapshot
        {
            public AgentSnapshot(int entityId, SimPositionMm position)
            {
                EntityId = entityId;
                Position = position;
            }

            public int EntityId { get; }

            public SimPositionMm Position { get; }
        }
    }
}
