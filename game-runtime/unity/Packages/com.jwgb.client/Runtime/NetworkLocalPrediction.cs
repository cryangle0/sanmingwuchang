using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client
{
    public sealed class NetworkLocalPrediction
    {
        private const int MovementDenominator =
            1_000 * SimulationConstants.TicksPerSecond;
        private const int CorrectionThresholdMm = 50;
        private const int HardSnapThresholdMm = 4_000;
        private const int CorrectionRecoverySpeedMmPerSecond = 12_000;
        private const int MaximumCorrectionStepPerFrameMm = 750;

        private int positionX;
        private int positionZ;
        private int correctionOffsetX;
        private int correctionOffsetZ;
        private int remainderX;
        private int remainderZ;
        private int moveSpeedMmPerSecond;
        private int hardControlTicks;
        private int iceCoffinTicks;
        private int whirlwindTicks;
        private int reviveProtectionTicks;
        private int highestCountedSequence;
        private int lastAuthoritativeTick;
        private Int2Mm previousAuthoritativePosition;
        private LifeState previousAuthoritativeLifeState;
        private Int2Mm? respawnTarget;
        private Int2Mm lastRecordedRenderPosition;
        private bool hasRecordedRenderPosition;
        private string activeAbilityId;
        private LifeState lifeState;
        private Int2Mm facing = new Int2Mm(0, 1_000);

        public bool IsInitialized { get; private set; }

        public int LastAcknowledgedSequence { get; private set; }

        public int LastPredictedSequence { get; private set; }

        public int PredictedInputCount { get; private set; }

        public int PredictionReplayCount { get; private set; }

        public int FrameCount { get; private set; }

        public int CorrectionCount { get; private set; }

        public int HardSnapCount { get; private set; }

        public int ReconciliationHardCorrectionCount {
            get;
            private set;
        }

        public int MaxErrorMm { get; private set; }

        public int MaxVisualStepMm { get; private set; }

        public int MaxErrorAtAuthoritativeTick { get; private set; }

        public int MaxErrorAcknowledgedSequence { get; private set; }

        public int MaxErrorPendingInputCount { get; private set; }

        public int MaxErrorAuthoritativeTickDelta { get; private set; }

        public int MaxErrorAuthoritativeStepMm { get; private set; }

        public Int2Mm MaxErrorPreviousPredictedPosition {
            get;
            private set;
        }

        public Int2Mm MaxErrorReconciledPosition { get; private set; }

        public Int2Mm MaxErrorAuthoritativePosition { get; private set; }

        public LifeState MaxErrorPreviousLifeState { get; private set; }

        public LifeState MaxErrorLifeState { get; private set; }

        public int MaxErrorHp { get; private set; }

        public int MaxErrorHardControlTicks { get; private set; }

        public int MaxErrorIceCoffinTicks { get; private set; }

        public int MaxErrorWhirlwindTicks { get; private set; }

        public int MaxErrorReviveProtectionTicks { get; private set; }

        public string MaxErrorActiveAbilityId { get; private set; }

        public string MaxErrorClassification { get; private set; }

        public Int2Mm Position => new Int2Mm(
            checked(positionX + correctionOffsetX),
            checked(positionZ + correctionOffsetZ));

        public Int2Mm SimulatedPosition =>
            new Int2Mm(positionX, positionZ);

        public Int2Mm AuthoritativePosition { get; private set; }

        public Int2Mm Facing => facing;

        public void ApplyAuthoritative(
            int authoritativeTick,
            PlayerSnapshot player,
            int authoritativeHardControlTicks,
            Int2Mm? authoritativeRespawnTarget,
            int authoritativeReviveProtectionTicks,
            int authoritativeRemainderX,
            int authoritativeRemainderZ,
            int acknowledgedSequence,
            IReadOnlyList<PredictedNetworkInput> pendingInputs)
        {
            var previousRenderPosition = Position;
            var previousSimulatedPosition = SimulatedPosition;
            var wasInitialized = IsInitialized;
            var authoritativeTickDelta = wasInitialized
                ? authoritativeTick - lastAuthoritativeTick
                : 0;
            var authoritativeStepMm = wasInitialized
                ? DistanceMm(
                    previousAuthoritativePosition,
                    player.Position)
                : 0;
            var previousLifeState = previousAuthoritativeLifeState;

            AuthoritativePosition = player.Position;
            positionX = player.Position.X;
            positionZ = player.Position.Z;
            facing = player.Facing;
            remainderX = authoritativeRemainderX;
            remainderZ = authoritativeRemainderZ;
            moveSpeedMmPerSecond = player.MoveSpeedMmPerSecond;
            hardControlTicks = authoritativeHardControlTicks;
            respawnTarget = authoritativeRespawnTarget;
            reviveProtectionTicks =
                authoritativeReviveProtectionTicks;
            iceCoffinTicks = player.IceCoffinTicks;
            whirlwindTicks = player.WhirlwindTicks;
            activeAbilityId = player.ActiveAbilityId;
            lifeState = player.LifeState;
            LastAcknowledgedSequence = acknowledgedSequence;
            LastPredictedSequence = acknowledgedSequence;
            lastAuthoritativeTick = authoritativeTick;
            previousAuthoritativePosition = player.Position;
            previousAuthoritativeLifeState = player.LifeState;
            IsInitialized = true;

            if (pendingInputs != null)
            {
                for (var index = 0;
                    index < pendingInputs.Count;
                    index += 1)
                {
                    ApplyInput(pendingInputs[index]);
                }
            }

            if (!wasInitialized)
            {
                correctionOffsetX = 0;
                correctionOffsetZ = 0;
                lastRecordedRenderPosition = Position;
                hasRecordedRenderPosition = true;
                return;
            }
            correctionOffsetX = checked(
                previousRenderPosition.X - positionX);
            correctionOffsetZ = checked(
                previousRenderPosition.Z - positionZ);
            var errorMm = checked((int)IntegerMath.IntegerSquareRoot(
                IntegerMath.DistanceSquared(
                    previousSimulatedPosition,
                    SimulatedPosition)));
            if (errorMm > MaxErrorMm)
            {
                MaxErrorMm = errorMm;
                MaxErrorAtAuthoritativeTick = authoritativeTick;
                MaxErrorAcknowledgedSequence = acknowledgedSequence;
                MaxErrorPendingInputCount =
                    pendingInputs?.Count ?? 0;
                MaxErrorAuthoritativeTickDelta =
                    authoritativeTickDelta;
                MaxErrorAuthoritativeStepMm =
                    authoritativeStepMm;
                MaxErrorPreviousPredictedPosition =
                    previousSimulatedPosition;
                MaxErrorReconciledPosition = SimulatedPosition;
                MaxErrorAuthoritativePosition = player.Position;
                MaxErrorPreviousLifeState = previousLifeState;
                MaxErrorLifeState = player.LifeState;
                MaxErrorHp = player.Hp;
                MaxErrorHardControlTicks =
                    authoritativeHardControlTicks;
                MaxErrorIceCoffinTicks = player.IceCoffinTicks;
                MaxErrorWhirlwindTicks = player.WhirlwindTicks;
                MaxErrorReviveProtectionTicks =
                    authoritativeReviveProtectionTicks;
                MaxErrorActiveAbilityId =
                    player.ActiveAbilityId ?? string.Empty;
                MaxErrorClassification = ClassifyCorrection(
                    previousLifeState,
                    player.LifeState,
                    authoritativeStepMm);
            }
            if (errorMm >= CorrectionThresholdMm)
            {
                CorrectionCount += 1;
            }
            if (errorMm >= HardSnapThresholdMm)
            {
                ReconciliationHardCorrectionCount += 1;
            }
        }

        public void ApplyInput(PredictedNetworkInput input)
        {
            if (!IsInitialized ||
                input.Sequence <= LastPredictedSequence)
            {
                return;
            }
            LastPredictedSequence = input.Sequence;
            PredictionReplayCount += 1;
            if (input.Sequence > highestCountedSequence)
            {
                highestCountedSequence = input.Sequence;
                PredictedInputCount += 1;
            }

            AdvanceTimers(input);
            AdvanceSoulFlight();
            if (!CanMove())
            {
                return;
            }
            if (input.AimX != 0 || input.AimZ != 0)
            {
                facing = new Int2Mm(input.AimX, input.AimZ);
            }

            var speed = moveSpeedMmPerSecond;
            if (whirlwindTicks > 0 &&
                ActiveCatalog.Get(activeAbilityId).Effect ==
                    ActiveEffect.MobileChannelAreaDamage)
            {
                speed = checked(
                    speed *
                    ActiveCatalog.Get(activeAbilityId)
                        .SelfMoveMultiplierBasisPoints /
                    10_000);
            }

            AxisStep(
                input.MoveX,
                speed,
                remainderX,
                out var deltaX,
                out remainderX);
            AxisStep(
                input.MoveZ,
                speed,
                remainderZ,
                out var deltaZ,
                out remainderZ);
            if (input.MoveX != 0 || input.MoveZ != 0)
            {
                facing = new Int2Mm(input.MoveX, input.MoveZ);
            }
            var next = IntegerMath.ClampToCircle(
                new Int2Mm(
                    checked(positionX + deltaX),
                    checked(positionZ + deltaZ)),
                GameplayRules.ArenaRadiusMm);
            positionX = next.X;
            positionZ = next.Z;
        }

        public void RecordFrame(float deltaSeconds)
        {
            if (!IsInitialized)
            {
                return;
            }
            if (float.IsNaN(deltaSeconds) ||
                float.IsInfinity(deltaSeconds) ||
                deltaSeconds < 0f)
            {
                throw new System.ArgumentOutOfRangeException(
                    nameof(deltaSeconds));
            }

            RecoverCorrectionOffset(deltaSeconds);
            var renderPosition = Position;
            if (hasRecordedRenderPosition)
            {
                var stepMm = DistanceMm(
                    lastRecordedRenderPosition,
                    renderPosition);
                MaxVisualStepMm = System.Math.Max(
                    MaxVisualStepMm,
                    stepMm);
                if (stepMm >= HardSnapThresholdMm)
                {
                    HardSnapCount += 1;
                }
            }
            lastRecordedRenderPosition = renderPosition;
            hasRecordedRenderPosition = true;
            FrameCount += 1;
        }

        public void Reset()
        {
            positionX = 0;
            positionZ = 0;
            correctionOffsetX = 0;
            correctionOffsetZ = 0;
            remainderX = 0;
            remainderZ = 0;
            moveSpeedMmPerSecond = 0;
            hardControlTicks = 0;
            iceCoffinTicks = 0;
            whirlwindTicks = 0;
            reviveProtectionTicks = 0;
            highestCountedSequence = 0;
            lastAuthoritativeTick = 0;
            previousAuthoritativePosition = default;
            previousAuthoritativeLifeState = default;
            respawnTarget = null;
            lastRecordedRenderPosition = default;
            hasRecordedRenderPosition = false;
            activeAbilityId = null;
            lifeState = default;
            facing = new Int2Mm(0, 1_000);
            IsInitialized = false;
            LastAcknowledgedSequence = 0;
            LastPredictedSequence = 0;
            PredictedInputCount = 0;
            PredictionReplayCount = 0;
            FrameCount = 0;
            CorrectionCount = 0;
            HardSnapCount = 0;
            ReconciliationHardCorrectionCount = 0;
            MaxErrorMm = 0;
            MaxVisualStepMm = 0;
            MaxErrorAtAuthoritativeTick = 0;
            MaxErrorAcknowledgedSequence = 0;
            MaxErrorPendingInputCount = 0;
            MaxErrorAuthoritativeTickDelta = 0;
            MaxErrorAuthoritativeStepMm = 0;
            MaxErrorPreviousPredictedPosition = default;
            MaxErrorReconciledPosition = default;
            MaxErrorAuthoritativePosition = default;
            MaxErrorPreviousLifeState = default;
            MaxErrorLifeState = default;
            MaxErrorHp = 0;
            MaxErrorHardControlTicks = 0;
            MaxErrorIceCoffinTicks = 0;
            MaxErrorWhirlwindTicks = 0;
            MaxErrorReviveProtectionTicks = 0;
            MaxErrorActiveAbilityId = null;
            MaxErrorClassification = null;
            AuthoritativePosition = default;
        }

        private static int DistanceMm(Int2Mm left, Int2Mm right)
        {
            return checked((int)IntegerMath.IntegerSquareRoot(
                IntegerMath.DistanceSquared(left, right)));
        }

        private static string ClassifyCorrection(
            LifeState previousLifeState,
            LifeState currentLifeState,
            int authoritativeStepMm)
        {
            if (previousLifeState == LifeState.SoulFlight ||
                currentLifeState == LifeState.SoulFlight)
            {
                return "soul-flight";
            }
            if (previousLifeState != currentLifeState)
            {
                return "life-state-transition";
            }
            if (authoritativeStepMm >= HardSnapThresholdMm)
            {
                return "authoritative-displacement";
            }
            return "movement-reconciliation";
        }

        private bool CanMove()
        {
            return
                (lifeState == LifeState.Alive ||
                 lifeState == LifeState.ReviveProtection) &&
                hardControlTicks == 0 &&
                iceCoffinTicks == 0;
        }

        private void RecoverCorrectionOffset(float deltaSeconds)
        {
            if (correctionOffsetX == 0 &&
                correctionOffsetZ == 0)
            {
                return;
            }

            var timeStep = checked((int)System.Math.Ceiling(
                CorrectionRecoverySpeedMmPerSecond *
                (double)deltaSeconds));
            var maximumStep = System.Math.Min(
                MaximumCorrectionStepPerFrameMm,
                System.Math.Max(0, timeStep));
            if (maximumStep == 0)
            {
                return;
            }

            var next = IntegerMath.MoveToward(
                new Int2Mm(
                    correctionOffsetX,
                    correctionOffsetZ),
                new Int2Mm(0, 0),
                maximumStep);
            correctionOffsetX = next.X;
            correctionOffsetZ = next.Z;
        }

        private void AdvanceSoulFlight()
        {
            if (lifeState != LifeState.SoulFlight ||
                !respawnTarget.HasValue)
            {
                return;
            }

            var target = respawnTarget.Value;
            var next = IntegerMath.MoveToward(
                SimulatedPosition,
                target,
                GameplayRules.SoulSpeedMmPerSecond /
                    SimulationConstants.TicksPerSecond);
            positionX = next.X;
            positionZ = next.Z;
            if (!next.Equals(target))
            {
                return;
            }

            lifeState = LifeState.ReviveProtection;
            reviveProtectionTicks =
                GameplayRules.ReviveProtectionTicks;
            hardControlTicks = 0;
            iceCoffinTicks = 0;
            whirlwindTicks = 0;
            remainderX = 0;
            remainderZ = 0;
            respawnTarget = null;
        }

        private void AdvanceTimers(PredictedNetworkInput input)
        {
            if (hardControlTicks > 0)
            {
                whirlwindTicks = 0;
            }
            else if (whirlwindTicks > 0)
            {
                whirlwindTicks -= 1;
            }

            hardControlTicks = System.Math.Max(
                0,
                hardControlTicks - 1);
            iceCoffinTicks = System.Math.Max(
                0,
                iceCoffinTicks - 1);
            if (lifeState != LifeState.ReviveProtection)
            {
                return;
            }

            if (input.Attack ||
                input.CastActive ||
                input.Interact)
            {
                reviveProtectionTicks = 0;
                lifeState = LifeState.Alive;
                return;
            }

            reviveProtectionTicks = System.Math.Max(
                0,
                reviveProtectionTicks - 1);
            if (reviveProtectionTicks == 0)
            {
                lifeState = LifeState.Alive;
            }
        }

        private static void AxisStep(
            int input,
            int speed,
            int remainder,
            out int movement,
            out int nextRemainder)
        {
            var numerator = checked((input * speed) + remainder);
            movement = numerator / MovementDenominator;
            nextRemainder =
                numerator - (movement * MovementDenominator);
        }
    }
}
