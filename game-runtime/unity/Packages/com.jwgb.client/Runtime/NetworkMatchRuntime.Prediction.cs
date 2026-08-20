using Jwgb.Netcode;
using UnityEngine;

namespace Jwgb.Client
{
    public sealed partial class NetworkMatchRuntime
    {
        private void LateUpdate()
        {
            if (!localPrediction.IsInitialized)
            {
                return;
            }
            MatchNetworkRuntimeState.CopyUnacknowledgedClientInputs(
                localPrediction.LastAcknowledgedSequence,
                pendingInputs);
            for (var index = 0; index < pendingInputs.Count; index += 1)
            {
                localPrediction.ApplyInput(pendingInputs[index]);
            }
            localPrediction.RecordFrame(Time.unscaledDeltaTime);
            RecordPrediction();
        }

        private void RecordPrediction()
        {
            MatchNetworkRuntimeState.RecordClientPrediction(
                new ClientPredictionTelemetry
                {
                    PredictedInputCount =
                        localPrediction.PredictedInputCount,
                    PredictionReplayCount =
                        localPrediction.PredictionReplayCount,
                    FrameCount = localPrediction.FrameCount,
                    CorrectionCount =
                        localPrediction.CorrectionCount,
                    HardSnapCount = localPrediction.HardSnapCount,
                    ReconciliationHardCorrectionCount =
                        localPrediction
                            .ReconciliationHardCorrectionCount,
                    MaxErrorMm = localPrediction.MaxErrorMm,
                    MaxVisualStepMm =
                        localPrediction.MaxVisualStepMm,
                    PredictedPosition = localPrediction.Position,
                    AuthoritativePosition =
                        localPrediction.AuthoritativePosition,
                    LatestAcknowledgedSequence =
                        localPrediction.LastAcknowledgedSequence,
                    LatestSentSequence =
                        MatchNetworkRuntimeState
                            .LatestClientSentInputSequence,
                    UnacknowledgedInputCount = pendingInputs.Count,
                    MaxErrorAtAuthoritativeTick =
                        localPrediction.MaxErrorAtAuthoritativeTick,
                    MaxErrorAcknowledgedSequence =
                        localPrediction.MaxErrorAcknowledgedSequence,
                    MaxErrorPendingInputCount =
                        localPrediction.MaxErrorPendingInputCount,
                    MaxErrorAuthoritativeTickDelta =
                        localPrediction.MaxErrorAuthoritativeTickDelta,
                    MaxErrorAuthoritativeStepMm =
                        localPrediction.MaxErrorAuthoritativeStepMm,
                    MaxErrorPreviousPredictedPosition =
                        localPrediction
                            .MaxErrorPreviousPredictedPosition,
                    MaxErrorReconciledPosition =
                        localPrediction.MaxErrorReconciledPosition,
                    MaxErrorAuthoritativePosition =
                        localPrediction.MaxErrorAuthoritativePosition,
                    MaxErrorPreviousLifeState = (byte)
                        localPrediction.MaxErrorPreviousLifeState,
                    MaxErrorLifeState = (byte)
                        localPrediction.MaxErrorLifeState,
                    MaxErrorHp = localPrediction.MaxErrorHp,
                    MaxErrorHardControlTicks =
                        localPrediction.MaxErrorHardControlTicks,
                    MaxErrorIceCoffinTicks =
                        localPrediction.MaxErrorIceCoffinTicks,
                    MaxErrorWhirlwindTicks =
                        localPrediction.MaxErrorWhirlwindTicks,
                    MaxErrorReviveProtectionTicks =
                        localPrediction
                            .MaxErrorReviveProtectionTicks,
                    MaxErrorActiveAbilityId =
                        localPrediction.MaxErrorActiveAbilityId,
                    MaxErrorClassification =
                        localPrediction.MaxErrorClassification
                });
        }
    }
}
