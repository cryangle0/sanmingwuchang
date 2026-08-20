using System;
using Jwgb.Sim.Deterministic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Corner minimap. The static map layer is rasterized once at
    /// construction (MinimapStaticLayer); every refresh copies that
    /// buffer, stamps entity dots and the storm circle on top, and
    /// uploads one small texture at a low rate (10 Hz). Reads
    /// WorldSnapshot only, so it works identically in local and
    /// network mode. Anchored top-right and rescaled against the
    /// panel width for small screens.
    /// </summary>
    internal sealed class MinimapView
    {
        private const float RefreshIntervalSeconds = 0.1f;
        private const float PanelWidthFraction = 0.22f;
        private const float MinPixelWidth = 132f;

        private static readonly Color32 MonsterColor =
            new Color32(96, 104, 96, 255);
        private static readonly Color32 StormColor =
            new Color32(242, 159, 72, 255);
        private static readonly Color32 LocalOutlineColor =
            new Color32(33, 26, 6, 255);

        private readonly VisualElement container;
        private readonly Image image;
        private readonly MinimapProjection projection;
        private readonly Color32[] staticBuffer;
        private readonly MinimapSurface surface;
        private readonly Texture2D texture;
        private float refreshCountdown;

        public MinimapView(VisualElement parentLayer)
        {
            projection = MinimapProjection.Create();
            var staticSurface = MinimapStaticLayer.Render(projection);
            staticBuffer = staticSurface.Buffer;
            surface = new MinimapSurface(
                MinimapProjection.Width,
                MinimapProjection.Height);
            Array.Copy(
                staticBuffer,
                surface.Buffer,
                staticBuffer.Length);

            texture = new Texture2D(
                MinimapProjection.Width,
                MinimapProjection.Height,
                TextureFormat.RGBA32,
                false)
            {
                name = "MinimapTexture",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp
            };
            texture.SetPixels32(surface.Buffer);
            texture.Apply(false);

            container = new VisualElement();
            container.name = "jwgb-minimap";
            container.pickingMode = PickingMode.Ignore;
            container.style.position = Position.Absolute;
            container.style.top = 16;
            container.style.right = 16;
            container.style.width = MinimapProjection.Width;
            container.style.height = MinimapProjection.Height;
            var border = new Color(0.35f, 0.4f, 0.4f, 0.65f);
            container.style.borderLeftWidth = 1;
            container.style.borderRightWidth = 1;
            container.style.borderTopWidth = 1;
            container.style.borderBottomWidth = 1;
            container.style.borderLeftColor = border;
            container.style.borderRightColor = border;
            container.style.borderTopColor = border;
            container.style.borderBottomColor = border;

            image = new Image
            {
                image = texture,
                scaleMode = ScaleMode.StretchToFill,
                pickingMode = PickingMode.Ignore
            };
            image.style.width = Length.Percent(100);
            image.style.height = Length.Percent(100);
            container.Add(image);
            parentLayer.Add(container);
            parentLayer.RegisterCallback<GeometryChangedEvent>(
                OnParentGeometryChanged);
        }

        public void Update(
            WorldSnapshot snapshot,
            int localEntityId,
            float deltaTime)
        {
            if (snapshot == null)
            {
                return;
            }
            refreshCountdown -= deltaTime;
            if (refreshCountdown > 0f)
            {
                return;
            }
            refreshCountdown = RefreshIntervalSeconds;

            Array.Copy(
                staticBuffer,
                surface.Buffer,
                staticBuffer.Length);
            DrawStorm(snapshot);
            DrawMonsters(snapshot);
            DrawPlayers(snapshot, localEntityId);
            texture.SetPixels32(surface.Buffer);
            texture.Apply(false);
        }

        public void Dispose()
        {
            container.RemoveFromHierarchy();
            if (texture != null)
            {
                UnityEngine.Object.Destroy(texture);
            }
        }

        private void DrawStorm(WorldSnapshot snapshot)
        {
            var storm = snapshot.StormZone;
            if (storm == null || storm.RadiusMm <= 0)
            {
                return;
            }
            surface.DrawCircleOutline(
                projection.Project(
                    storm.Center.X,
                    storm.Center.Z),
                storm.RadiusMm * projection.PixelsPerMm,
                StormColor);
        }

        private void DrawMonsters(WorldSnapshot snapshot)
        {
            var monsters = snapshot.Monsters;
            for (var index = 0; index < monsters.Length; index += 1)
            {
                var monster = monsters[index];
                if (monster.Hp <= 0)
                {
                    continue;
                }
                surface.FillCircle(
                    projection.Project(
                        monster.Position.X,
                        monster.Position.Z),
                    1f,
                    MonsterColor);
            }
        }

        private void DrawPlayers(
            WorldSnapshot snapshot,
            int localEntityId)
        {
            var players = snapshot.Players;
            for (var index = 0; index < players.Length; index += 1)
            {
                var player = players[index];
                if (player.LifeState == LifeState.Eliminated ||
                    player.EntityId == localEntityId)
                {
                    continue;
                }
                surface.FillCircle(
                    projection.Project(
                        player.Position.X,
                        player.Position.Z),
                    2f,
                    HeroPalette.GetColor32(player.HeroId));
            }

            for (var index = 0; index < players.Length; index += 1)
            {
                var player = players[index];
                if (player.EntityId != localEntityId ||
                    player.LifeState == LifeState.Eliminated)
                {
                    continue;
                }
                var center = projection.Project(
                    player.Position.X,
                    player.Position.Z);
                surface.FillCircle(center, 4.4f, LocalOutlineColor);
                surface.FillCircle(
                    center,
                    3.2f,
                    HeroPalette.LocalHighlight);
            }
        }

        private void OnParentGeometryChanged(
            GeometryChangedEvent changed)
        {
            var panelWidth = changed.newRect.width;
            if (panelWidth <= 0f)
            {
                return;
            }
            var width = Mathf.Clamp(
                panelWidth * PanelWidthFraction,
                MinPixelWidth,
                MinimapProjection.Width);
            container.style.width = width;
            container.style.height = width *
                (MinimapProjection.Height /
                    (float)MinimapProjection.Width);
        }
    }
}
