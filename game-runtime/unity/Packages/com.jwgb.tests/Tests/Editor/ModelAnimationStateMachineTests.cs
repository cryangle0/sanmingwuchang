using Jwgb.Client.Presentation;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class ModelAnimationStateMachineTests
    {
        [Test]
        public void LocomotionSwitchesBetweenIdleAndMove()
        {
            var state = new ModelAnimationStateMachine();
            Assert.That(state.State, Is.EqualTo(ModelAnimationState.Idle));

            state.SetMoving(true);
            Assert.That(state.State, Is.EqualTo(ModelAnimationState.Move));

            state.SetMoving(false);
            Assert.That(state.State, Is.EqualTo(ModelAnimationState.Idle));
        }

        [Test]
        public void AttackReturnsToCurrentLocomotionState()
        {
            var state = new ModelAnimationStateMachine();
            state.SetMoving(true);
            state.TriggerAttack();
            Assert.That(state.State, Is.EqualTo(ModelAnimationState.Attack));

            state.Advance(0.5f);
            Assert.That(state.State, Is.EqualTo(ModelAnimationState.Attack));

            state.Advance(0.5f);
            Assert.That(state.State, Is.EqualTo(ModelAnimationState.Move));
        }

        [Test]
        public void SpellOverridesAttackAndReturnsToIdle()
        {
            var state = new ModelAnimationStateMachine();
            state.TriggerAttack();
            state.TriggerSpell();
            Assert.That(state.State, Is.EqualTo(ModelAnimationState.Spell));

            state.Advance(1f);
            Assert.That(state.State, Is.EqualTo(ModelAnimationState.Idle));
        }
    }
}
