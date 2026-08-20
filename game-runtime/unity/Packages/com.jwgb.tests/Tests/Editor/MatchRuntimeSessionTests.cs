using System.Collections.Generic;
using Jwgb.Client;
using Jwgb.Content;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using Jwgb.Server;
using NUnit.Framework;
using UnityEngine;

namespace Jwgb.Tests
{
    public sealed class MatchRuntimeSessionTests
    {
        [Test]
        public void LocalSessionRunsEightCompetitorsDeterministically()
        {
            var first = new LocalMatchSession(20260724);
            var second = new LocalMatchSession(20260724);

            for (var tick = 0; tick < 120; tick += 1)
            {
                var command = new LocalMatchCommand(
                    tick < 60 ? 1_000 : 0,
                    tick < 60 ? 250 : -1_000,
                    1_000,
                    0,
                    attack: tick >= 40,
                    castActive: tick == 80);
                first.Step(command);
                second.Step(command);
            }

            Assert.That(first.Snapshot.Tick, Is.EqualTo(120));
            Assert.That(first.Snapshot.Players, Has.Length.EqualTo(8));
            Assert.That(
                first.Snapshot.Match.Status,
                Is.EqualTo(MatchStatus.Running));
            Assert.That(first.StateHash, Is.EqualTo(second.StateHash));
        }

        [Test]
        public void LocalSessionUsesTheSelectedHero()
        {
            var session = new LocalMatchSession(
                20260724,
                8,
                GameplayIds.BullDemonKing);

            Assert.That(
                session.Snapshot.Players[0].HeroId,
                Is.EqualTo(GameplayIds.BullDemonKing));
        }

        [Test]
        public void LocalSessionForwardsInteractionIntentToSimulation()
        {
            var session = new LocalMatchSession(
                20260724,
                2,
                GameplayIds.SunWukong,
                mapEnabled: false,
                pveEnabled: false);

            session.Step(
                new LocalMatchCommand(
                    0,
                    0,
                    0,
                    1_000,
                    attack: false,
                    castActive: false,
                    interact: true));

            Assert.That(
                session.Snapshot.Players[0].Intent.Interact,
                Is.True);
        }

        [Test]
        public void LocalTransactionServiceBindsAndReportsLocalPlayer()
        {
            var session = new LocalMatchSession(
                20260724,
                2,
                GameplayIds.SunWukong,
                mapEnabled: false,
                pveEnabled: false);
            ClientTransactionResult observed = null;
            session.Transactions.Completed +=
                result => observed = result;

            var result = session.Transactions.Execute(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.SpendGem,
                    PassiveId = GameplayIds.Critical
                });

            Assert.That(result.TransactionId, Is.EqualTo(1));
            Assert.That(result.Accepted, Is.False);
            Assert.That(result.Code, Is.EqualTo("no-gems"));
            Assert.That(result.CommitTick, Is.EqualTo(0));
            Assert.That(result.StateHash, Is.EqualTo(session.StateHash));
            Assert.That(observed, Is.SameAs(result));
        }

        [Test]
        public void LocalRuntimeSupportsMenuStartRestartAndReturn()
        {
            var runtimeObject = new GameObject("Local Runtime Test");
            try
            {
                var runtime =
                    runtimeObject.AddComponent<LocalMatchRuntime>();
                Assert.That(runtime.HasSession, Is.False);

                runtime.StartLocalMatch(
                    GameplayIds.IronFanPrincess,
                    4);
                Assert.That(runtime.HasSession, Is.True);
                Assert.That(runtime.Snapshot.Players, Has.Length.EqualTo(4));
                Assert.That(
                    runtime.Snapshot.Players[0].HeroId,
                    Is.EqualTo(GameplayIds.IronFanPrincess));

                runtime.RestartLocalMatch();
                Assert.That(runtime.HasSession, Is.True);
                Assert.That(runtime.Snapshot.Tick, Is.EqualTo(0));
                Assert.That(
                    runtime.Snapshot.Players[0].HeroId,
                    Is.EqualTo(GameplayIds.IronFanPrincess));

                runtime.ReturnToMenu();
                Assert.That(runtime.HasSession, Is.False);
                Assert.That(runtime.Snapshot, Is.Null);
            }
            finally
            {
                Object.DestroyImmediate(runtimeObject);
            }
        }

        [Test]
        public void ServerSessionRunsThirtyCompetitorsDeterministically()
        {
            var first = new AuthoritativeMatchSession(20260724);
            var second = new AuthoritativeMatchSession(20260724);
            for (var tick = 0; tick < 120; tick += 1)
            {
                first.Step();
                second.Step();
            }

            Assert.That(first.Snapshot.Tick, Is.EqualTo(120));
            Assert.That(
                first.Snapshot.Players,
                Has.Length.EqualTo(30));
            Assert.That(
                first.Snapshot.Match.Status,
                Is.EqualTo(MatchStatus.Running));
            Assert.That(
                first.Snapshot.StateHash,
                Is.Not.Null.And.Not.Empty);
            Assert.That(
                first.Snapshot.StateHash,
                Is.EqualTo(second.Snapshot.StateHash));
        }

        [Test]
        public void ServerSessionDefaultsToMapModeWithFullPve()
        {
            var first = new AuthoritativeMatchSession(20260724);
            var second = new AuthoritativeMatchSession(20260724);

            Assert.That(first.MapEnabled, Is.True);
            Assert.That(first.PveEnabled, Is.True);
            Assert.That(
                first.Snapshot.MapGeometryHash,
                Is.EqualTo(MapGeometryCatalog.GeometryHash));
            Assert.That(first.Snapshot.PveEnabled, Is.True);
            Assert.That(
                first.Snapshot.Monsters.Length,
                Is.GreaterThan(30));
            Assert.That(first.Snapshot.StormZone, Is.Not.Null);
            Assert.That(
                first.Snapshot.StormZone.RadiusMm,
                Is.GreaterThan(0));

            for (var tick = 0; tick < 120; tick += 1)
            {
                first.Step();
                second.Step();
            }

            Assert.That(first.Snapshot.Tick, Is.EqualTo(120));
            Assert.That(
                first.Snapshot.Monsters.Length,
                Is.GreaterThan(0));
            Assert.That(
                first.Snapshot.StateHash,
                Is.EqualTo(second.Snapshot.StateHash));
        }

        [Test]
        public void ServerSessionSupportsClassicArenaWithoutPve()
        {
            var session = new AuthoritativeMatchSession(
                20260724,
                30,
                mapEnabled: false,
                pveEnabled: false);

            Assert.That(session.MapEnabled, Is.False);
            Assert.That(session.PveEnabled, Is.False);
            Assert.That(
                session.Snapshot.MapGeometryHash,
                Is.Null.Or.Empty);
            Assert.That(session.Snapshot.Monsters, Is.Empty);

            session.Step();
            Assert.That(session.Snapshot.Tick, Is.EqualTo(1));
        }

        [Test]
        public void ExternalInputUsesInternalSequenceAfterBotControl()
        {
            var session = new AuthoritativeMatchSession(
                20260724,
                2,
                mapEnabled: false,
                pveEnabled: false);
            var entityId = session.GetCompetitorEntityIds()[0];
            var controlled = new HashSet<int> { entityId };

            for (var tick = 0;
                tick < MatchNetworkDefaults.BotTakeoverDelayTicks;
                tick += 1)
            {
                session.Step();
            }
            session.Step(
                new Dictionary<int, PlayerIntent>
                {
                    [entityId] = PlayerIntent.Create(
                        sequence: 1,
                        moveX: 1_000,
                        moveZ: 0)
                },
                controlled);

            var player = FindPlayer(session.Snapshot, entityId);
            Assert.That(player.Intent.Movement.X, Is.EqualTo(1_000));
            Assert.That(
                player.Intent.Sequence,
                Is.GreaterThan(
                    MatchNetworkDefaults.BotTakeoverDelayTicks));
            Assert.That(session.AppliedExternalInputCount, Is.EqualTo(1));
            Assert.That(
                session.LastAppliedExternalInputSequence,
                Is.EqualTo(1));
        }

        [Test]
        public void DisconnectNeutralIntentStopsThePreviousExternalAction()
        {
            var session = new AuthoritativeMatchSession(
                20260724,
                2,
                mapEnabled: false,
                pveEnabled: false);
            var entityId = session.GetCompetitorEntityIds()[0];
            var controlled = new HashSet<int> { entityId };

            session.Step(
                new Dictionary<int, PlayerIntent>
                {
                    [entityId] = PlayerIntent.Create(
                        sequence: 1,
                        moveX: 1_000,
                        moveZ: 0)
                },
                controlled);
            var neutralSequence =
                session.SubmitDisconnectNeutralIntent(entityId);
            session.Step(null, controlled);

            var player = FindPlayer(session.Snapshot, entityId);
            Assert.That(player.Intent.Sequence, Is.EqualTo(neutralSequence));
            Assert.That(player.Intent.Movement.X, Is.Zero);
            Assert.That(player.Intent.Attack, Is.False);
            Assert.That(player.Intent.CastActive, Is.False);
        }

        [Test]
        public void ServerSessionAcceptsDeterministicExternalIntent()
        {
            // Classic arena keeps the movement assertion independent of
            // map spawn-pad wall adjacency; external-intent determinism
            // itself is mode-agnostic.
            var first = new AuthoritativeMatchSession(
                20260724,
                30,
                mapEnabled: false,
                pveEnabled: false);
            var second = new AuthoritativeMatchSession(
                20260724,
                30,
                mapEnabled: false,
                pveEnabled: false);
            var firstEntityId = first.GetCompetitorEntityIds()[0];
            var secondEntityId = second.GetCompetitorEntityIds()[0];
            var firstStart = first.Snapshot.Players[0].Position.X;
            var firstControlled = new HashSet<int> { firstEntityId };
            var secondControlled = new HashSet<int> { secondEntityId };

            for (var tick = 1; tick <= 20; tick += 1)
            {
                first.Step(
                    new Dictionary<int, PlayerIntent>
                    {
                        [firstEntityId] = PlayerIntent.Create(
                            tick,
                            1_000,
                            0)
                    },
                    firstControlled);
                second.Step(
                    new Dictionary<int, PlayerIntent>
                    {
                        [secondEntityId] = PlayerIntent.Create(
                            tick,
                            1_000,
                            0)
                    },
                    secondControlled);
            }

            Assert.That(
                first.Snapshot.Players[0].Position.X,
                Is.GreaterThan(firstStart));
            Assert.That(
                first.Snapshot.StateHash,
                Is.EqualTo(second.Snapshot.StateHash));
        }

        private static PlayerSnapshot FindPlayer(
            WorldSnapshot snapshot,
            int entityId)
        {
            for (var index = 0;
                index < snapshot.Players.Length;
                index += 1)
            {
                if (snapshot.Players[index].EntityId == entityId)
                {
                    return snapshot.Players[index];
                }
            }
            return null;
        }

    }
}
