using NUnit.Framework;
using UnityEditor;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Jwgb.Tests
{
    public sealed class RenderPipelineSetupTests
    {
        private const string RendererAssetPath =
            "Assets/Jwgb/Settings/Rendering/JwgbUniversalRenderer.asset";
        private const string PipelineAssetPath =
            "Assets/Jwgb/Settings/Rendering/JwgbUniversalPipeline.asset";

        [Test]
        public void ProjectUsesCommittedUrpAssets()
        {
            var renderer = AssetDatabase.LoadAssetAtPath<
                UniversalRendererData>(RendererAssetPath);
            var pipeline = AssetDatabase.LoadAssetAtPath<
                UniversalRenderPipelineAsset>(PipelineAssetPath);

            Assert.That(renderer, Is.Not.Null);
            Assert.That(pipeline, Is.Not.Null);
            Assert.That(
                GraphicsSettings.defaultRenderPipeline,
                Is.SameAs(pipeline));
            Assert.That(pipeline.scriptableRenderer, Is.Not.Null);
        }

        [Test]
        public void BaselinePipelineAvoidsUnnecessaryFullScreenBuffers()
        {
            var pipeline = AssetDatabase.LoadAssetAtPath<
                UniversalRenderPipelineAsset>(PipelineAssetPath);

            Assert.That(pipeline, Is.Not.Null);
            Assert.That(pipeline.supportsCameraDepthTexture, Is.False);
            Assert.That(pipeline.supportsCameraOpaqueTexture, Is.False);
            Assert.That(pipeline.supportsHDR, Is.False);
            Assert.That(pipeline.msaaSampleCount, Is.EqualTo(1));
            Assert.That(pipeline.renderScale, Is.EqualTo(1f));
            Assert.That(pipeline.useSRPBatcher, Is.True);
        }
    }
}
