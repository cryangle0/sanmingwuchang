using UnityEngine;

namespace Jwgb.Client.Presentation
{
    internal sealed class ModelAnimationDriver
    {
        private readonly Animator animator;
        private readonly ModelAnimationStateMachine stateMachine =
            new ModelAnimationStateMachine();
        private ModelAnimationState appliedState;
        private bool applied;

        public ModelAnimationDriver(Animator animator)
        {
            this.animator = animator;
            ApplyState();
        }

        public void SetMoving(bool moving)
        {
            stateMachine.SetMoving(moving);
            ApplyState();
        }

        public void TriggerAttack()
        {
            stateMachine.TriggerAttack();
            ApplyState(forceRestart: true);
        }

        public void TriggerSpell()
        {
            stateMachine.TriggerSpell();
            ApplyState(forceRestart: true);
        }

        public void Update(float deltaTime)
        {
            stateMachine.Advance(deltaTime);
            ApplyState();
        }

        private void ApplyState(bool forceRestart = false)
        {
            if (animator == null ||
                animator.runtimeAnimatorController == null)
            {
                return;
            }
            var state = stateMachine.State;
            if (!forceRestart && applied && state == appliedState)
            {
                return;
            }

            var stateName = state.ToString();
            // Full-path hashes remain unambiguous if the controller gains
            // additional layers or nested state machines.
            var fullPathHash = Animator.StringToHash(
                $"Base Layer.{stateName}");
            var stateHash = animator.HasState(0, fullPathHash)
                ? fullPathHash
                : Animator.StringToHash(stateName);
            if (animator.HasState(0, stateHash))
            {
                animator.Play(stateHash, 0, 0f);
            }
            appliedState = state;
            applied = true;
        }
    }
}
