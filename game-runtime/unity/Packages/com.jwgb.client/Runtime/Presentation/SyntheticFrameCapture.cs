using System;
using System.IO;
using UnityEngine;
using UnityEngine.Rendering;

namespace Jwgb.Client.Presentation
{
    internal sealed class SyntheticFrameCapture : IDisposable
    {
        private RenderTexture renderTexture;
        private string outputPath;
        private int remainingSettleFrames;
        private bool completed;

        public bool Step(
            string path,
            SyntheticStressPresenter presenter)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return false;
            }

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
                Begin(path, presenter);
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

        private void Begin(
            string path,
            SyntheticStressPresenter presenter)
        {
            var camera = Camera.main;
            if (camera == null)
            {
                throw new InvalidOperationException(
                    "Synthetic frame capture requires a Main Camera.");
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

            presenter.RenderForCamera(camera);
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
                ReleaseRenderTexture();
            }
        }

        private void ReleaseRenderTexture()
        {
            if (renderTexture == null)
            {
                return;
            }

            renderTexture.Release();
            UnityEngine.Object.Destroy(renderTexture);
            renderTexture = null;
        }
    }
}
