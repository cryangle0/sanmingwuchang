using Jwgb.Client;
using Jwgb.Core;
using NUnit.Framework;
using UnityEngine;

namespace Jwgb.Tests
{
    public sealed class TouchIntentMapperTests
    {
        private const float Radius = 60f;

        [Test]
        public void DragInsideDeadZoneProducesNoMovement()
        {
            var movement = TouchIntentMapper.MapJoystick(
                new Vector2(4f, 3f),
                Radius);
            Assert.That(movement.X, Is.EqualTo(0));
            Assert.That(movement.Z, Is.EqualTo(0));
        }

        [Test]
        public void FullDeflectionMapsToUnitAxisVector()
        {
            var right = TouchIntentMapper.MapJoystick(
                new Vector2(Radius, 0f),
                Radius);
            Assert.That(right.X, Is.EqualTo(1_000));
            Assert.That(right.Z, Is.EqualTo(0));

            var up = TouchIntentMapper.MapJoystick(
                new Vector2(0f, Radius),
                Radius);
            Assert.That(up.X, Is.EqualTo(0));
            Assert.That(up.Z, Is.EqualTo(1_000));
        }

        [Test]
        public void OverDragIsClampedToMaximumMagnitude()
        {
            var movement = TouchIntentMapper.MapJoystick(
                new Vector2(Radius * 8f, Radius * 8f),
                Radius);
            var magnitudeSquared =
                ((long)movement.X * movement.X) +
                ((long)movement.Z * movement.Z);
            Assert.That(
                magnitudeSquared,
                Is.LessThanOrEqualTo(1_000L * 1_000L));
            Assert.That(
                magnitudeSquared,
                Is.GreaterThan(900L * 900L));
            Assert.That(movement.X, Is.EqualTo(movement.Z));
        }

        [Test]
        public void PartialDeflectionKeepsProportionalMagnitude()
        {
            var movement = TouchIntentMapper.MapJoystick(
                new Vector2(Radius * 0.5f, 0f),
                Radius);
            Assert.That(movement.X, Is.EqualTo(500));
            Assert.That(movement.Z, Is.EqualTo(0));
        }

        [Test]
        public void PanelDragFlipsVerticalAxis()
        {
            // Dragging up on screen (negative panel y) must move
            // toward world +z.
            var movement = TouchIntentMapper.MapPanelDrag(
                new Vector2(0f, -Radius),
                Radius);
            Assert.That(movement.X, Is.EqualTo(0));
            Assert.That(movement.Z, Is.EqualTo(1_000));
        }

        [Test]
        public void NonPositiveRadiusIsSafe()
        {
            var movement = TouchIntentMapper.MapJoystick(
                new Vector2(10f, 10f),
                0f);
            Assert.That(movement.X, Is.EqualTo(0));
            Assert.That(movement.Z, Is.EqualTo(0));
        }

        [Test]
        public void TouchStateCastQueueIsConsumedOnce()
        {
            var state = new TouchControlState();
            Assert.That(state.ConsumeCastQueued(), Is.False);
            state.QueueCast();
            Assert.That(state.ConsumeCastQueued(), Is.True);
            Assert.That(state.ConsumeCastQueued(), Is.False);
        }

        [Test]
        public void TouchStateInteractQueueIsConsumedOnce()
        {
            var state = new TouchControlState();
            Assert.That(state.ConsumeInteractQueued(), Is.False);
            state.QueueInteract();
            Assert.That(state.ConsumeInteractQueued(), Is.True);
            Assert.That(state.ConsumeInteractQueued(), Is.False);
        }

        [Test]
        public void TouchStateMovementLifecycle()
        {
            var state = new TouchControlState();
            Assert.That(state.MovementActive, Is.False);
            state.SetMovement(new Int2Mm(700, -300));
            Assert.That(state.MovementActive, Is.True);
            Assert.That(state.Movement.X, Is.EqualTo(700));
            Assert.That(state.Movement.Z, Is.EqualTo(-300));
            state.ClearMovement();
            Assert.That(state.MovementActive, Is.False);
            Assert.That(state.Movement.X, Is.EqualTo(0));
            Assert.That(state.Movement.Z, Is.EqualTo(0));
        }

        [Test]
        public void TouchStateResetClearsEverything()
        {
            var state = new TouchControlState();
            state.SetMovement(new Int2Mm(1_000, 0));
            state.AttackHeld = true;
            state.QueueCast();
            state.Reset();
            Assert.That(state.MovementActive, Is.False);
            Assert.That(state.AttackHeld, Is.False);
            Assert.That(state.ConsumeCastQueued(), Is.False);
        }
    }
}
