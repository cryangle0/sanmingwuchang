using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Stable per-hero colors. The three implemented heroes mirror the
    /// web client palette (apps/web/src/render/arena-renderer.ts
    /// HERO_COLORS); every other catalog hero gets a deterministic hue
    /// from an evenly spaced 38-slot wheel visited in coprime stride
    /// order, so all 38 heroes stay visually distinct and numeric
    /// neighbors (H002 vs H003) land far apart on the wheel. Ids
    /// outside the H### pattern fall back to an FNV-1a hash hue. Same
    /// heroId always yields the same color across sessions, platforms,
    /// and match modes.
    /// </summary>
    public static class HeroPalette
    {
        /// <summary>Highlight used for the local player ring and
        /// minimap marker (mirrors the web minimap local dot).</summary>
        public static readonly Color32 LocalHighlight =
            new Color32(255, 210, 87, 255);

        private const int HueSlots = 38;
        private const int HueStride = 7;
        private const float Saturation = 0.55f;
        private const float Value = 0.78f;

        public static Color32 GetColor32(string heroId)
        {
            switch (heroId)
            {
                case "H001":
                    return new Color32(0xb9, 0x4d, 0x43, 0xff);
                case "H009":
                    return new Color32(0xd2, 0xa8, 0x44, 0xff);
                case "H018":
                    return new Color32(0x3d, 0x73, 0x5c, 0xff);
            }

            float hue;
            if (TryParseHeroNumber(heroId, out var number))
            {
                hue = Mathf.Repeat(
                    number * HueStride % HueSlots *
                        (360f / HueSlots),
                    360f);
            }
            else
            {
                hue = Fnv1aHash(heroId) % 360u;
            }

            Color32 color = Color.HSVToRGB(
                hue / 360f,
                Saturation,
                Value);
            color.a = 0xff;
            return color;
        }

        public static Color GetColor(string heroId)
        {
            return GetColor32(heroId);
        }

        private static bool TryParseHeroNumber(
            string heroId,
            out int number)
        {
            number = 0;
            if (string.IsNullOrEmpty(heroId) ||
                heroId.Length < 2 ||
                heroId[0] != 'H')
            {
                return false;
            }
            for (var index = 1; index < heroId.Length; index += 1)
            {
                var digit = heroId[index];
                if (digit < '0' || digit > '9')
                {
                    return false;
                }
                number = (number * 10) + (digit - '0');
            }
            return true;
        }

        private static uint Fnv1aHash(string value)
        {
            var hash = 2166136261u;
            if (value == null)
            {
                return hash;
            }
            for (var index = 0; index < value.Length; index += 1)
            {
                hash ^= value[index];
                hash *= 16777619u;
            }
            return hash;
        }
    }
}
