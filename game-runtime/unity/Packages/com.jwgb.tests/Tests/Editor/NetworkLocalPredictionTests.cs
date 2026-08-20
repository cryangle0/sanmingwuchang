using System.Collections.Generic;
using Jwgb.Client;
using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class NetworkLocalPredictionTests
    {
        [Test]
        public void ReplaysPendingMovementFromAuthoritativeState()
        {
            var prediction = new NetworkLocalPrediction();
            var pending = new List<PredictedNetworkInput>
            {
                CreateInput(1, 1_000, 0)
            };

            prediction.ApplyAuthoritative(
                1,
                CreatePlayer(0, 0),
                0,
                null,
                0,
                0,
                0,
                0,
                pending);

            Assert.That(prediction.Position.X, Is.EqualTo(250));
            Assert.That(prediction.Position.Z, Is.EqualTo(0));
            Assert.That(prediction.LastPredictedSequence, Is.EqualTo(1));
            Assert.That(prediction.PredictedInputCount, Is.EqualTo(1));
            Assert.That(prediction.PredictionReplayCount, Is.EqualTo(1));
        }

        [Test]
        public void SeparatesUniqueInputsFromReconciliationReplayWork()
        {
            var prediction = new NetworkLocalPrediction();
            var pending = new List<PredictedNetworkInput>
            {
                CreateInput(1, 1_000, 0)
            };

            prediction.ApplyAuthoritative(
                1,
                CreatePlayer(0, 0),
                0,
                null,
                0,
                0,
                0,
                0,
                pending);
            prediction.ApplyAuthoritative(
                2,
                CreatePlayer(0, 0),
                0,
                null,
                0,
                0,
                0,
                0,
                pending);

            Assert.That(prediction.PredictedInputCount, Is.EqualTo(1));
            Assert.That(prediction.PredictionReplayCount, Is.EqualTo(2));
        }

        [Test]
        public void ReconciliationMeasuresCorrectionAndHardSnaps()
        {
            var prediction = new NetworkLocalPrediction();
            var pending = new List<PredictedNetworkInput>
            {
                CreateInput(1, 1_000, 0)
            };
            prediction.ApplyAuthoritative(
                1,
                CreatePlayer(0, 0),
                0,
                null,
                0,
                0,
                0,
                0,
                pending);

            prediction.ApplyAuthoritative(
                2,
                CreatePlayer(100, 0),
                0,
                null,
                0,
                0,
                0,
                0,
                pending);
            Assert.That(prediction.Position.X, Is.EqualTo(250));
            Assert.That(
                prediction.SimulatedPosition.X,
                Is.EqualTo(350));
            Assert.That(prediction.CorrectionCount, Is.EqualTo(1));
            Assert.That(prediction.MaxErrorMm, Is.EqualTo(100));

            prediction.ApplyAuthoritative(
                3,
                CreatePlayer(10_000, 0),
                0,
                null,
                0,
                0,
                0,
                1,
                new List<PredictedNetworkInput>());
            Assert.That(
                prediction.ReconciliationHardCorrectionCount,
                Is.EqualTo(1));
            Assert.That(prediction.HardSnapCount, Is.EqualTo(0));
            Assert.That(prediction.SimulatedPosition.X, Is.EqualTo(10_000));
            Assert.That(prediction.Position.X, Is.EqualTo(250));
        }

        [Test]
        public void ControlTimersAdvanceBeforePredictedMovement()
        {
            var prediction = new NetworkLocalPrediction();
            prediction.ApplyAuthoritative(
                1,
                CreatePlayer(0, 0),
                2,
                null,
                0,
                0,
                0,
                0,
                new List<PredictedNetworkInput>());

            prediction.ApplyInput(CreateInput(1, 1_000, 0));
            Assert.That(prediction.Position, Is.EqualTo(new Int2Mm(0, 0)));

            prediction.ApplyInput(CreateInput(2, 1_000, 0));
            Assert.That(prediction.Position, Is.EqualTo(new Int2Mm(250, 0)));
        }

        [Test]
        public void ExpiringWhirlwindUsesNormalMovementSpeed()
        {
            var prediction = new NetworkLocalPrediction();
            var player = CreatePlayer(0, 0);
            player.ActiveAbilityId = GameplayIds.BullDemonKing;
            player.WhirlwindTicks = 1;
            prediction.ApplyAuthoritative(
                1,
                player,
                0,
                null,
                0,
                0,
                0,
                0,
                new List<PredictedNetworkInput>());

            prediction.ApplyInput(CreateInput(1, 1_000, 0));

            Assert.That(prediction.Position, Is.EqualTo(new Int2Mm(250, 0)));
        }

        [Test]
        public void ReplaysSoulFlightTowardAuthoritativeRespawnTarget()
        {
            var prediction = new NetworkLocalPrediction();
            var player = CreatePlayer(0, 0);
            player.LifeState = LifeState.SoulFlight;
            var pending = new List<PredictedNetworkInput>
            {
                CreateInput(1, 1_000, 0),
                CreateInput(2, 1_000, 0),
                CreateInput(3, 1_000, 0)
            };

            prediction.ApplyAuthoritative(
                10,
                player,
                0,
                new Int2Mm(9_000, 0),
                0,
                0,
                0,
                0,
                pending);

            Assert.That(
                prediction.Position,
                Is.EqualTo(new Int2Mm(2_700, 0)));
        }

        [Test]
        public void SoulFlightCanRespawnAndMoveOnTheArrivalTick()
        {
            var prediction = new NetworkLocalPrediction();
            var player = CreatePlayer(0, 0);
            player.LifeState = LifeState.SoulFlight;

            prediction.ApplyAuthoritative(
                10,
                player,
                0,
                new Int2Mm(1_000, 0),
                0,
                0,
                0,
                0,
                new List<PredictedNetworkInput>());
            prediction.ApplyInput(CreateInput(1, 1_000, 0));
            prediction.ApplyInput(CreateInput(2, 1_000, 0));

            Assert.That(
                prediction.Position,
                Is.EqualTo(new Int2Mm(1_250, 0)));
        }

        [Test]
        public void LargeReconciliationRecoversWithoutAVisualHardSnap()
        {
            var prediction = new NetworkLocalPrediction();
            prediction.ApplyAuthoritative(
                1,
                CreatePlayer(0, 0),
                0,
                null,
                0,
                0,
                0,
                0,
                new List<PredictedNetworkInput>());
            prediction.ApplyAuthoritative(
                2,
                CreatePlayer(20_000, 0),
                0,
                null,
                0,
                0,
                0,
                0,
                new List<PredictedNetworkInput>());

            Assert.That(prediction.Position, Is.EqualTo(new Int2Mm(0, 0)));
            Assert.That(
                prediction.SimulatedPosition,
                Is.EqualTo(new Int2Mm(20_000, 0)));

            prediction.RecordFrame(1f / 60f);

            Assert.That(prediction.Position.X, Is.InRange(1, 250));
            Assert.That(prediction.HardSnapCount, Is.EqualTo(0));
            Assert.That(prediction.MaxVisualStepMm, Is.LessThan(250));
        }

        private static PlayerSnapshot CreatePlayer(int x, int z)
        {
            return new PlayerSnapshot
            {
                EntityId = 1,
                PlayerId = "prediction-player",
                HeroId = GameplayIds.SunWukong,
                ActiveAbilityId = GameplayIds.SunWukong,
                Position = new Int2Mm(x, z),
                Facing = new Int2Mm(0, 1_000),
                MoveSpeedMmPerSecond = 5_000,
                LifeState = LifeState.Alive
            };
        }

        private static PredictedNetworkInput CreateInput(
            int sequence,
            int moveX,
            int moveZ)
        {
            return new PredictedNetworkInput(
                new MatchInputRpc
                {
                    Sequence = sequence,
                    MoveX = moveX,
                    MoveZ = moveZ,
                    AimX = moveX,
                    AimZ = moveZ
                });
        }
    }
}
