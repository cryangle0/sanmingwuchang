using Jwgb.Core;

namespace Jwgb.Client
{
    /// <summary>
    /// Shared touch intent written by the presentation touch overlay
    /// (virtual joystick and action buttons) and read by
    /// LocalPlayerInputReader. Pure data with no Unity input access so
    /// both the local and the network capture paths consume identical
    /// intent, and edit-mode tests can drive it directly.
    /// </summary>
    public sealed class TouchControlState
    {
        public static TouchControlState Shared { get; } =
            new TouchControlState();

        private bool castQueued;
        private bool interactQueued;

        /// <summary>
        /// True while a touch overlay owns the touch path. When set,
        /// LocalPlayerInputReader ignores raw touches and reads this
        /// state instead.
        /// </summary>
        public bool OverlayEnabled { get; set; }

        public bool MovementActive { get; private set; }

        public Int2Mm Movement { get; private set; }

        public bool AttackHeld { get; set; }

        public void SetMovement(Int2Mm movement)
        {
            Movement = movement;
            MovementActive = true;
        }

        public void ClearMovement()
        {
            Movement = new Int2Mm(0, 0);
            MovementActive = false;
        }

        public void QueueCast()
        {
            castQueued = true;
        }

        public bool ConsumeCastQueued()
        {
            var wasQueued = castQueued;
            castQueued = false;
            return wasQueued;
        }

        public void QueueInteract()
        {
            interactQueued = true;
        }

        public bool ConsumeInteractQueued()
        {
            var wasQueued = interactQueued;
            interactQueued = false;
            return wasQueued;
        }

        public void Reset()
        {
            ClearMovement();
            AttackHeld = false;
            castQueued = false;
            interactQueued = false;
        }
    }
}
