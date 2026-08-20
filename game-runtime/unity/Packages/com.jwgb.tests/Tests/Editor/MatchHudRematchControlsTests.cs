using Jwgb.Client;
using Jwgb.Client.Presentation;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using UnityEngine.UIElements;

namespace Jwgb.Tests
{
    public sealed class MatchHudRematchControlsTests
    {
        [Test]
        public void OnlineResultShowsEnabledRematchControl()
        {
            var elements = MatchHudBuilder.Build(new VisualElement());
            var controller = new MatchHudOutcomeController();

            controller.ShowFinished(
                elements,
                FinishedSnapshot(),
                isNetwork: true,
                localEntityId: 1);

            Assert.That(
                elements.PlayAgainButton.style.display.value,
                Is.EqualTo(DisplayStyle.Flex));
            Assert.That(elements.PlayAgainButton.text, Is.EqualTo("REMATCH"));
            Assert.That(elements.PlayAgainButton.enabledSelf, Is.True);
            Assert.That(
                elements.NetworkOutcomeNote.style.display.value,
                Is.EqualTo(DisplayStyle.Flex));
        }

        [Test]
        public void SubmittedRematchDisablesControlAndShowsWaitingState()
        {
            var elements = MatchHudBuilder.Build(new VisualElement());
            var controller = new MatchHudOutcomeController();
            controller.ShowFinished(
                elements,
                FinishedSnapshot(),
                isNetwork: true,
                localEntityId: 1);

            controller.MarkRematchRequested(elements);

            Assert.That(controller.IsRematchRequested, Is.True);
            Assert.That(elements.PlayAgainButton.enabledSelf, Is.False);
            Assert.That(
                elements.NetworkOutcomeNote.text,
                Is.EqualTo(
                    "REMATCH REQUESTED | WAITING FOR PLAYERS"));
        }

        [Test]
        public void NewMatchTickRestoresRematchControl()
        {
            var elements = MatchHudBuilder.Build(new VisualElement());
            var controller = new MatchHudOutcomeController();
            controller.MarkRematchRequested(elements);

            Assert.That(
                NetworkMatchRuntime.IsNewMatchTick(120, 2),
                Is.True);
            controller.ResetForActiveMatch(elements);

            Assert.That(controller.IsRematchRequested, Is.False);
            Assert.That(elements.PlayAgainButton.enabledSelf, Is.True);
        }

        private static WorldSnapshot FinishedSnapshot()
        {
            return new WorldSnapshot
            {
                Match = new MatchSnapshot
                {
                    Status = MatchStatus.Finished,
                    WinnerEntityId = 1
                }
            };
        }
    }
}
