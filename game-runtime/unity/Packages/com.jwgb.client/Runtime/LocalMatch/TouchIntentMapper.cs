using Jwgb.Core;
using UnityEngine;

namespace Jwgb.Client
{
    /// <summary>
    /// Maps virtual joystick drags to movement intent. Output uses the
    /// same integer-millimeter axis semantics as the keyboard path:
    /// vectors are clamped to a maximum magnitude of one thousand via
    /// IntegerMath.NormalizeAxisPair, and partial deflection keeps a
    /// proportional magnitude.
    /// </summary>
    public static class TouchIntentMapper
    {
        public const float DefaultDeadZoneFraction = 0.15f;

        /// <summary>
        /// Maps a drag delta in screen-style coordinates where +y is
        /// up (matching world +z).
        /// </summary>
        public static Int2Mm MapJoystick(
            Vector2 dragDelta,
            float radius,
            float deadZoneFraction = DefaultDeadZoneFraction)
        {
            if (radius <= 0f)
            {
                return new Int2Mm(0, 0);
            }

            var clamped = Vector2.ClampMagnitude(dragDelta, radius);
            if (clamped.magnitude <
                radius * Mathf.Clamp01(deadZoneFraction))
            {
                return new Int2Mm(0, 0);
            }

            return IntegerMath.NormalizeAxisPair(
                Mathf.RoundToInt(clamped.x * 1_000f / radius),
                Mathf.RoundToInt(clamped.y * 1_000f / radius));
        }

        /// <summary>
        /// Maps a drag delta in UI panel coordinates where +y is down;
        /// the vertical axis is flipped so an upward drag moves toward
        /// world +z.
        /// </summary>
        public static Int2Mm MapPanelDrag(
            Vector2 panelDelta,
            float radius,
            float deadZoneFraction = DefaultDeadZoneFraction)
        {
            return MapJoystick(
                new Vector2(panelDelta.x, -panelDelta.y),
                radius,
                deadZoneFraction);
        }
    }
}
