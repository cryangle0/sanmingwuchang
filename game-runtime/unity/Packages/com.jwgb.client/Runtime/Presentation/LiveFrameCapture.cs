using System;
using System.IO;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    internal sealed class LiveFrameCapture : IDisposable
    {
        private RenderTexture renderTexture;
        private string outputPath;
        private int remainingSettleFrames;
        private bool completed;
        private PanelSettings panelSettings;
        private RenderTexture previousTargetTexture;
        private bool previousClearColor;
        private bool previousClearDepthStencil;

        public bool Step(string path)
        {
            if (completed)
            {
                if (remainingSettleFrames <= 0)
                {
                    return false;
                }
                remainingSettleFrames -= 1;
                return true;
            }

            if (renderTexture == null)
            {
                Begin(path);
            }
            else
            {
                Complete();
            }
            return true;
        }

        public void Dispose()
        {
            ReleaseRenderTexture();
        }

        private void Begin(string path)
        {
            var camera = Camera.main;
            if (camera == null)
            {
                throw new InvalidOperationException(
                    "Live frame capture requires a Main Camera.");
            }

            outputPath = Path.GetFullPath(path);
            var directory = Path.GetDirectoryName(outputPath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                throw new InvalidOperationException(
                    "Screenshot path has no parent directory.");
            }

            Directory.CreateDirectory(directory);
            renderTexture = new RenderTexture(
                Screen.width,
                Screen.height,
                depth: 24,
                RenderTextureFormat.ARGB32);
            renderTexture.Create();
            ConfigureUiTarget();
            var request = new RenderPipeline.StandardRequest
            {
                destination = renderTexture
            };
            RenderPipeline.SubmitRenderRequest(camera, request);
        }

        private void Complete()
        {
            var previousActive = RenderTexture.active;
            var texture = new Texture2D(
                renderTexture.width,
                renderTexture.height,
                TextureFormat.RGB24,
                mipChain: false);
            try
            {
                RenderTexture.active = renderTexture;
                texture.ReadPixels(
                    new Rect(
                        0f,
                        0f,
                        renderTexture.width,
                        renderTexture.height),
                    destX: 0,
                    destY: 0);
                texture.Apply(updateMipmaps: false);
                File.WriteAllBytes(
                    outputPath,
                    ImageConversion.EncodeToPNG(texture));
                remainingSettleFrames = 1;
                completed = true;
            }
            finally
            {
                RenderTexture.active = previousActive;
                UnityEngine.Object.Destroy(texture);
                RestoreUiTarget();
                ReleaseRenderTexture();
            }
        }

        private void ConfigureUiTarget()
        {
            var document =
                UnityEngine.Object.FindFirstObjectByType<UIDocument>();
            panelSettings = document?.panelSettings;
            if (panelSettings == null)
            {
                return;
            }

            previousTargetTexture = panelSettings.targetTexture;
            previousClearColor = panelSettings.clearColor;
            previousClearDepthStencil =
                panelSettings.clearDepthStencil;
            panelSettings.clearColor = false;
            panelSettings.clearDepthStencil = false;
            panelSettings.targetTexture = renderTexture;
        }

        private void RestoreUiTarget()
        {
            if (panelSettings == null)
            {
                return;
            }

            panelSettings.targetTexture = previousTargetTexture;
            panelSettings.clearColor = previousClearColor;
            panelSettings.clearDepthStencil =
                previousClearDepthStencil;
            panelSettings = null;
        }

        private void ReleaseRenderTexture()
        {
            if (renderTexture == null)
            {
                return;
            }

            RestoreUiTarget();
            renderTexture.Release();
            UnityEngine.Object.Destroy(renderTexture);
            renderTexture = null;
        }
    }
}
