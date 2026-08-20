using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class SimulationRuntimeTests
    {
        [Test]
        public void TickClockUsesTwentyHertzAndCapsCatchUp()
        {
            var clock = new SimulationTickClock(3);

            Assert.That(clock.Accumulate(0.049d), Is.EqualTo(0));
            Assert.That(clock.Accumulate(0.001d), Is.EqualTo(1));
            Assert.That(clock.Accumulate(1d), Is.EqualTo(3));
            Assert.That(clock.Alpha, Is.InRange(0d, 1d));
            clock.Reset();
            Assert.That(clock.Alpha, Is.EqualTo(0d));
        }

        [Test]
        public void BotMovesTowardAndAttacksTheNearestLivingTarget()
        {
            var simulation = new GameSimulation(44);
            var bot = simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = "runtime-bot",
                    HeroId = GameplayIds.SunWukong,
                    HasPosition = true,
                    Position = new Int2Mm(0, 0)
                });
            var target = simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = "runtime-target",
                    HeroId = GameplayIds.BullDemonKing,
                    HasPosition = true,
                    Position = new Int2Mm(4_000, 0)
                });

            var intent = BotIntentPlanner.Create(
                simulation.GetSnapshot(),
                bot,
                1);
            Assert.That(intent.TargetEntityId, Is.EqualTo(target));
            Assert.That(intent.Attack, Is.True);
            Assert.That(intent.Aim, Is.EqualTo(new Int2Mm(1_000, 0)));
        }

        [Test]
        public void BotPlanningIsDeterministic()
        {
            var simulation = new GameSimulation(45);
            var bot = simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = "deterministic-bot",
                    HeroId = GameplayIds.IronFanPrincess,
                    HasPosition = true,
                    Position = new Int2Mm(0, 0)
                });
            simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = "deterministic-target",
                    HeroId = GameplayIds.BullDemonKing,
                    HasPosition = true,
                    Position = new Int2Mm(12_000, 4_000)
                });
            var snapshot = simulation.GetSnapshot();

            var first = BotIntentPlanner.Create(snapshot, bot, 9);
            var second = BotIntentPlanner.Create(snapshot, bot, 9);
            Assert.That(first.Sequence, Is.EqualTo(second.Sequence));
            Assert.That(first.Movement, Is.EqualTo(second.Movement));
            Assert.That(first.Aim, Is.EqualTo(second.Aim));
            Assert.That(first.Attack, Is.EqualTo(second.Attack));
            Assert.That(
                first.TargetEntityId,
                Is.EqualTo(second.TargetEntityId));
            Assert.That(first.CastActive, Is.EqualTo(second.CastActive));
        }
    }
}
