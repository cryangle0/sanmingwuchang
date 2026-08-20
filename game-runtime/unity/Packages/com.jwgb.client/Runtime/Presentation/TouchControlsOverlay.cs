using UnityEngine;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Mobile touch controls built with UI Toolkit, following the
    /// MatchHudBuilder styling. Left half of the screen is a virtual
    /// joystick zone (drag from the touch origin = move vector);
    /// the right side has hold-to-attack and tap-to-cast buttons.
    /// The overlay only writes intent into TouchControlState — the
    /// simulation command path is unchanged and identical in local
    /// and network mode.
    /// </summary>
    internal sealed class TouchControlsOverlay
    {
        private const float JoystickRadius = 60f;
        private const float BaseSize = 148f;
        private const float KnobSize = 60f;

        private readonly VisualElement root;
        private readonly VisualElement joystickZone;
        private readonly VisualElement joystickBase;
        private readonly VisualElement joystickKnob;
        private readonly TouchControlState state;
        private Vector2 joystickOrigin;
        private int joystickPointerId = -1;

        /// <summary>Touch controls activate automatically on mobile
        /// platforms or any device reporting touch support; the
        /// keyboard and mouse path is untouched elsewhere.</summary>
        public static bool ShouldEnable =>
            Application.isMobilePlatform || Input.touchSupported;

        public TouchControlsOverlay(
            VisualElement parentLayer,
            TouchControlState state)
        {
            this.state = state;
            root = new VisualElement();
            root.name = "jwgb-touch-controls";
            root.pickingMode = PickingMode.Ignore;
            root.style.position = Position.Absolute;
            root.style.left = 0;
            root.style.right = 0;
            root.style.top = 0;
            root.style.bottom = 0;

            joystickZone = new VisualElement();
            joystickZone.name = "jwgb-touch-joystick-zone";
            joystickZone.pickingMode = PickingMode.Position;
            joystickZone.style.position = Position.Absolute;
            joystickZone.style.left = 0;
            joystickZone.style.top = 0;
            joystickZone.style.bottom = 0;
            joystickZone.style.width = Length.Percent(50);
            root.Add(joystickZone);

            joystickBase = CreateCircle(
                BaseSize,
                new Color(0.9f, 0.95f, 0.9f, 0.10f),
                new Color(0.7f, 0.78f, 0.72f, 0.55f));
            joystickBase.pickingMode = PickingMode.Ignore;
            joystickBase.style.display = DisplayStyle.None;
            root.Add(joystickBase);

            joystickKnob = CreateCircle(
                KnobSize,
                new Color(0.9f, 0.95f, 0.9f, 0.35f),
                new Color(0.86f, 0.9f, 0.86f, 0.8f));
            joystickKnob.pickingMode = PickingMode.Ignore;
            joystickKnob.style.display = DisplayStyle.None;
            root.Add(joystickKnob);

            var attackButton = CreateActionButton(
                "ATTACK",
                112f,
                24f,
                118f,
                new Color(0.92f, 0.45f, 0.12f, 0.82f));
            root.Add(attackButton);
            var castButton = CreateActionButton(
                "CAST",
                84f,
                150f,
                156f,
                new Color(0.16f, 0.58f, 0.94f, 0.82f));
            root.Add(castButton);
            var interactButton = CreateActionButton(
                "USE",
                72f,
                252f,
                136f,
                new Color(0.62f, 0.48f, 0.18f, 0.82f));
            root.Add(interactButton);

            RegisterJoystick();
            RegisterHoldButton(
                attackButton,
                held => this.state.AttackHeld = held);
            castButton.RegisterCallback<PointerDownEvent>(pointer =>
            {
                this.state.QueueCast();
                pointer.StopPropagation();
            });
            interactButton.RegisterCallback<PointerDownEvent>(pointer =>
            {
                this.state.QueueInteract();
                pointer.StopPropagation();
            });

            parentLayer.Add(root);
            state.OverlayEnabled = true;
        }

        public void Dispose()
        {
            state.OverlayEnabled = false;
            state.Reset();
            root.RemoveFromHierarchy();
        }

        private void RegisterJoystick()
        {
            joystickZone.RegisterCallback<PointerDownEvent>(pointer =>
            {
                if (joystickPointerId >= 0)
                {
                    return;
                }
                joystickPointerId = pointer.pointerId;
                joystickZone.CapturePointer(joystickPointerId);
                joystickOrigin = new Vector2(
                    pointer.position.x,
                    pointer.position.y);
                MoveJoystick(joystickOrigin);
                joystickBase.style.display = DisplayStyle.Flex;
                joystickKnob.style.display = DisplayStyle.Flex;
                state.SetMovement(new Jwgb.Core.Int2Mm(0, 0));
                pointer.StopPropagation();
            });
            joystickZone.RegisterCallback<PointerMoveEvent>(pointer =>
            {
                if (pointer.pointerId != joystickPointerId)
                {
                    return;
                }
                MoveJoystick(new Vector2(
                    pointer.position.x,
                    pointer.position.y));
            });
            joystickZone.RegisterCallback<PointerUpEvent>(pointer =>
            {
                if (pointer.pointerId == joystickPointerId)
                {
                    ReleaseJoystick();
                }
            });
            joystickZone.RegisterCallback<PointerCaptureOutEvent>(
                pointer =>
                {
                    if (pointer.pointerId == joystickPointerId)
                    {
                        ReleaseJoystick();
                    }
                });
        }

        private void MoveJoystick(Vector2 pointerPosition)
        {
            var delta = pointerPosition - joystickOrigin;
            state.SetMovement(TouchIntentMapper.MapPanelDrag(
                delta,
                JoystickRadius));
            var visualDelta = Vector2.ClampMagnitude(
                delta,
                JoystickRadius);
            PlaceCircle(joystickBase, joystickOrigin, BaseSize);
            PlaceCircle(
                joystickKnob,
                joystickOrigin + visualDelta,
                KnobSize);
        }

        private void ReleaseJoystick()
        {
            if (joystickPointerId >= 0 &&
                joystickZone.HasPointerCapture(joystickPointerId))
            {
                joystickZone.ReleasePointer(joystickPointerId);
            }
            joystickPointerId = -1;
            state.ClearMovement();
            joystickBase.style.display = DisplayStyle.None;
            joystickKnob.style.display = DisplayStyle.None;
        }

        private void RegisterHoldButton(
            VisualElement button,
            System.Action<bool> setHeld)
        {
            button.RegisterCallback<PointerDownEvent>(pointer =>
            {
                setHeld(true);
                button.CapturePointer(pointer.pointerId);
                pointer.StopPropagation();
            });
            button.RegisterCallback<PointerUpEvent>(pointer =>
            {
                setHeld(false);
                if (button.HasPointerCapture(pointer.pointerId))
                {
                    button.ReleasePointer(pointer.pointerId);
                }
            });
            button.RegisterCallback<PointerCaptureOutEvent>(_ =>
                setHeld(false));
        }

        private static void PlaceCircle(
            VisualElement circle,
            Vector2 center,
            float size)
        {
            circle.style.left = center.x - (size * 0.5f);
            circle.style.top = center.y - (size * 0.5f);
        }

        private static VisualElement CreateCircle(
            float size,
            Color fill,
            Color border)
        {
            var circle = new VisualElement();
            circle.style.position = Position.Absolute;
            circle.style.width = size;
            circle.style.height = size;
            var radius = size * 0.5f;
            circle.style.borderTopLeftRadius = radius;
            circle.style.borderTopRightRadius = radius;
            circle.style.borderBottomLeftRadius = radius;
            circle.style.borderBottomRightRadius = radius;
            circle.style.backgroundColor = fill;
            circle.style.borderLeftWidth = 2;
            circle.style.borderRightWidth = 2;
            circle.style.borderTopWidth = 2;
            circle.style.borderBottomWidth = 2;
            circle.style.borderLeftColor = border;
            circle.style.borderRightColor = border;
            circle.style.borderTopColor = border;
            circle.style.borderBottomColor = border;
            return circle;
        }

        private static VisualElement CreateActionButton(
            string text,
            float size,
            float right,
            float bottom,
            Color accent)
        {
            var button = CreateCircle(
                size,
                new Color(
                    accent.r * 0.25f,
                    accent.g * 0.25f,
                    accent.b * 0.25f,
                    0.55f),
                accent);
            button.pickingMode = PickingMode.Position;
            button.style.left = StyleKeyword.Auto;
            button.style.right = right;
            button.style.bottom = bottom;
            button.style.top = StyleKeyword.Auto;
            button.style.alignItems = Align.Center;
            button.style.justifyContent = Justify.Center;
            var label = new Label(text);
            label.pickingMode = PickingMode.Ignore;
            label.style.color = new Color(0.94f, 0.96f, 0.94f);
            label.style.fontSize = 15;
            label.style.unityFontStyleAndWeight = FontStyle.Bold;
            button.Add(label);
            return button;
        }
    }
}
