using System.Linq;
using Jwgb.Client;
using Jwgb.Client.Presentation;
using Jwgb.Server;
using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Jwgb.Tests
{
    public sealed class BootstrapSceneTests
    {
        private const string ClientScenePath =
            "Assets/Jwgb/Scenes/Bootstrap.unity";
        private const string ServerScenePath =
            "Assets/Jwgb/Scenes/ServerBootstrap.unity";
        private const string SyntheticStressScenePath =
            "Assets/Jwgb/Scenes/SyntheticStress.unity";

        [Test]
        public void ClientSceneContainsPlayableLocalMatchRuntime()
        {
            var scene = EditorSceneManager.OpenScene(
                ClientScenePath,
                OpenSceneMode.Single);

            Assert.That(FindComponents<ClientBootstrap>(scene), Has.Length.EqualTo(1));
            Assert.That(FindComponents<ServerBootstrap>(scene), Is.Empty);
            Assert.That(FindComponents<Camera>(scene), Has.Length.EqualTo(1));
            Assert.That(
                FindComponents<LocalMatchRuntime>(scene),
                Has.Length.EqualTo(1));
            Assert.That(
                FindComponents<LocalMatchPresenter>(scene),
                Has.Length.EqualTo(1));
            Assert.That(
                FindComponents<MatchHud>(scene),
                Has.Length.EqualTo(1));
            Assert.That(
                FindComponents<LiveSmokeCapture>(scene),
                Has.Length.EqualTo(1));
            Assert.That(
                FindComponents<ArenaCameraController>(scene),
                Has.Length.EqualTo(1));
            Assert.That(
                FindComponents<SyntheticStressPresenter>(scene),
                Is.Empty);
            Assert.That(
                FindComponents<SyntheticPerformanceSampler>(scene),
                Is.Empty);
        }

        [Test]
        public void SyntheticSceneContainsClientPresentationAndSampler()
        {
            var scene = EditorSceneManager.OpenScene(
                SyntheticStressScenePath,
                OpenSceneMode.Single);

            Assert.That(FindComponents<ClientBootstrap>(scene), Has.Length.EqualTo(1));
            Assert.That(FindComponents<LocalMatchRuntime>(scene), Is.Empty);
            Assert.That(
                FindComponents<SyntheticStressPresenter>(scene),
                Has.Length.EqualTo(1));
            Assert.That(
                FindComponents<SyntheticPerformanceSampler>(scene),
                Has.Length.EqualTo(1));
            Assert.That(FindComponents<Camera>(scene), Has.Length.EqualTo(1));
        }

        [Test]
        public void ServerSceneContainsNoPresentationObjects()
        {
            var scene = EditorSceneManager.OpenScene(
                ServerScenePath,
                OpenSceneMode.Single);

            Assert.That(FindComponents<ServerBootstrap>(scene), Has.Length.EqualTo(1));
            Assert.That(FindComponents<ClientBootstrap>(scene), Is.Empty);
            Assert.That(FindComponents<Camera>(scene), Is.Empty);
            Assert.That(FindComponents<Light>(scene), Is.Empty);
            Assert.That(FindComponents<Renderer>(scene), Is.Empty);
            Assert.That(
                FindComponents<SyntheticStressPresenter>(scene),
                Is.Empty);
            Assert.That(
                FindComponents<SyntheticPerformanceSampler>(scene),
                Is.Empty);
        }

        private static T[] FindComponents<T>(Scene scene)
            where T : Component
        {
            return scene
                .GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<T>(true))
                .ToArray();
        }
    }
}
