using System;

namespace Jwgb.Client.Presentation
{
    public enum ModelAnimationState : byte
    {
        Idle = 1,
        Move = 2,
        Attack = 3,
        Spell = 4
    }

    public sealed class ModelAnimationStateMachine
    {
        private bool moving;
        private float oneShotSeconds;

        public ModelAnimationState State { get; private set; } =
            ModelAnimationState.Idle;

        public void SetMoving(bool value)
        {
            moving = value;
            if (oneShotSeconds <= 0f)
            {
                State = moving
                    ? ModelAnimationState.Move
                    : ModelAnimationState.Idle;
            }
        }

        public void TriggerAttack()
        {
            Trigger(ModelAnimationState.Attack, 1f);
        }

        public void TriggerSpell()
        {
            Trigger(ModelAnimationState.Spell, 1f);
        }

        public void Advance(float deltaTime)
        {
            if (deltaTime < 0f)
            {
                throw new ArgumentOutOfRangeException(nameof(deltaTime));
            }
            if (oneShotSeconds <= 0f)
            {
                return;
            }

            oneShotSeconds = Math.Max(0f, oneShotSeconds - deltaTime);
            if (oneShotSeconds <= 0f)
            {
                State = moving
                    ? ModelAnimationState.Move
                    : ModelAnimationState.Idle;
            }
        }

        private void Trigger(ModelAnimationState state, float seconds)
        {
            State = state;
            oneShotSeconds = seconds;
        }
    }
}
