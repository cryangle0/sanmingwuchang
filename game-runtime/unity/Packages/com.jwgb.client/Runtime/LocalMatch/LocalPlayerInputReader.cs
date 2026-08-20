using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client
{
    internal sealed class LocalPlayerInputReader
    {
        private Int2Mm movement;
        private Int2Mm aim = new Int2Mm(0, 1_000);
        private bool attack;
        private bool castQueued;
        private bool interactQueued;

        public void Capture(
            Camera camera,
            WorldSnapshot snapshot,
            int localEntityId)
        {
            CaptureKeyboard();
            CapturePointer(camera, snapshot, localEntityId);
            if (TouchControlState.Shared.OverlayEnabled)
            {
                CaptureTouchOverlay(TouchControlState.Shared);
            }
            else
            {
                CaptureTouch(camera, snapshot, localEntityId);
            }
        }

        public LocalMatchCommand ConsumeCommand()
        {
            var command = new LocalMatchCommand(
                movement.X,
                movement.Z,
                aim.X,
                aim.Z,
                attack,
                castQueued,
                interactQueued);
            castQueued = false;
            interactQueued = false;
            return command;
        }

        public void Reset()
        {
            movement = new Int2Mm(0, 0);
            aim = new Int2Mm(0, 1_000);
            attack = false;
            castQueued = false;
            interactQueued = false;
        }

        public void CaptureKeyboardOnly()
        {
            CaptureKeyboard();
            if (TouchControlState.Shared.OverlayEnabled)
            {
                CaptureTouchOverlay(TouchControlState.Shared);
            }
        }

        /// <summary>
        /// Merges intent produced by the touch overlay (virtual
        /// joystick and buttons). The joystick wins over keyboard
        /// movement while active, and movement direction doubles as
        /// aim so touch players face their travel direction.
        /// </summary>
        private void CaptureTouchOverlay(TouchControlState touch)
        {
            if (touch.MovementActive &&
                (touch.Movement.X != 0 || touch.Movement.Z != 0))
            {
                movement = touch.Movement;
                aim = IntegerMath.NormalizeAxisPair(
                    movement.X,
                    movement.Z);
            }
            attack |= touch.AttackHeld;
            if (touch.ConsumeCastQueued())
            {
                castQueued = true;
            }
            if (touch.ConsumeInteractQueued())
            {
                interactQueued = true;
            }
        }

        private void CaptureKeyboard()
        {
            var horizontal =
                (Input.GetKey(KeyCode.D) ? 1 : 0) -
                (Input.GetKey(KeyCode.A) ? 1 : 0);
            var vertical =
                (Input.GetKey(KeyCode.W) ? 1 : 0) -
                (Input.GetKey(KeyCode.S) ? 1 : 0);
            movement = IntegerMath.NormalizeAxisPair(
                horizontal * 1_000,
                vertical * 1_000);
            attack =
                Input.GetKey(KeyCode.Space) ||
                Input.GetMouseButton(0);
            if (Input.GetKeyDown(KeyCode.Q) ||
                Input.GetMouseButtonDown(1))
            {
                castQueued = true;
            }
            if (Input.GetKeyDown(KeyCode.E) ||
                Input.GetKeyDown(KeyCode.F))
            {
                interactQueued = true;
            }
        }

        private void CapturePointer(
            Camera camera,
            WorldSnapshot snapshot,
            int localEntityId)
        {
            if (camera == null || !Input.mousePresent)
            {
                return;
            }

            if (TryWorldDirection(
                camera,
                Input.mousePosition,
                snapshot,
                localEntityId,
                out var pointerAim))
            {
                aim = pointerAim;
            }
        }

        private void CaptureTouch(
            Camera camera,
            WorldSnapshot snapshot,
            int localEntityId)
        {
            for (var index = 0; index < Input.touchCount; index += 1)
            {
                var touch = Input.GetTouch(index);
                if (touch.position.x < Screen.width * 0.5f)
                {
                    var origin = new Vector2(
                        Screen.width * 0.22f,
                        Screen.height * 0.22f);
                    var delta = Vector2.ClampMagnitude(
                        touch.position - origin,
                        Screen.height * 0.14f);
                    movement = IntegerMath.NormalizeAxisPair(
                        Mathf.RoundToInt(delta.x * 1_000f),
                        Mathf.RoundToInt(delta.y * 1_000f));
                    continue;
                }

                attack = touch.phase != TouchPhase.Ended &&
                    touch.phase != TouchPhase.Canceled;
                if (touch.phase == TouchPhase.Began &&
                    touch.position.y > Screen.height * 0.65f)
                {
                    castQueued = true;
                }
                if (TryWorldDirection(
                    camera,
                    touch.position,
                    snapshot,
                    localEntityId,
                    out var touchAim))
                {
                    aim = touchAim;
                }
            }
        }

        private static bool TryWorldDirection(
            Camera camera,
            Vector2 screenPosition,
            WorldSnapshot snapshot,
            int localEntityId,
            out Int2Mm direction)
        {
            direction = default;
            var local = FindPlayer(snapshot, localEntityId);
            if (local == null)
            {
                return false;
            }

            var ray = camera.ScreenPointToRay(screenPosition);
            var plane = new Plane(Vector3.up, Vector3.zero);
            if (!plane.Raycast(ray, out var distance))
            {
                return false;
            }

            var point = ray.GetPoint(distance);
            var deltaX =
                Mathf.RoundToInt(point.x * 1_000f) -
                local.Position.X;
            var deltaZ =
                Mathf.RoundToInt(point.z * 1_000f) -
                local.Position.Z;
            if (deltaX == 0 && deltaZ == 0)
            {
                return false;
            }

            direction = IntegerMath.NormalizeAxisPair(deltaX, deltaZ);
            return true;
        }

        private static PlayerSnapshot FindPlayer(
            WorldSnapshot snapshot,
            int entityId)
        {
            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                if (snapshot.Players[index].EntityId == entityId)
                {
                    return snapshot.Players[index];
                }
            }

            return null;
        }
    }
}
