using Jwgb.Client.Presentation;
using NUnit.Framework;
using UnityEngine.UIElements;

namespace Jwgb.Tests
{
    public sealed class MatchHudConnectionControlsTests
    {
        [Test]
        public void MenuContainsHiddenReconnectControls()
        {
            var root = new VisualElement();

            var elements = MatchHudBuilder.Build(root);

            Assert.That(elements.ReconnectPanel, Is.Not.Null);
            Assert.That(
                elements.ReconnectPanel.name,
                Is.EqualTo("jwgb-reconnect-panel"));
            Assert.That(elements.ReconnectStatus, Is.Not.Null);
            Assert.That(elements.AbandonReconnectButton, Is.Not.Null);
            Assert.That(
                elements.ReconnectPanel.style.display.value,
                Is.EqualTo(DisplayStyle.None));
        }
    }
}
