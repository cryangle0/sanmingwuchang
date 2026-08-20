using Jwgb.Core;

namespace Jwgb.Netcode
{
    public struct ClientPredictionTelemetry
    {
        public int PredictedInputCount { get; set; }

        public int PredictionReplayCount { get; set; }

        public int FrameCount { get; set; }

        public int CorrectionCount { get; set; }

        public int HardSnapCount { get; set; }

        public int ReconciliationHardCorrectionCount { get; set; }

        public int MaxErrorMm { get; set; }

        public int MaxVisualStepMm { get; set; }

        public Int2Mm PredictedPosition { get; set; }

        public Int2Mm AuthoritativePosition { get; set; }

        public int LatestAcknowledgedSequence { get; set; }

        public int LatestSentSequence { get; set; }

        public int UnacknowledgedInputCount { get; set; }

        public int MaxErrorAtAuthoritativeTick { get; set; }

        public int MaxErrorAcknowledgedSequence { get; set; }

        public int MaxErrorPendingInputCount { get; set; }

        public int MaxErrorAuthoritativeTickDelta { get; set; }

        public int MaxErrorAuthoritativeStepMm { get; set; }

        public Int2Mm MaxErrorPreviousPredictedPosition { get; set; }

        public Int2Mm MaxErrorReconciledPosition { get; set; }

        public Int2Mm MaxErrorAuthoritativePosition { get; set; }

        public byte MaxErrorPreviousLifeState { get; set; }

        public byte MaxErrorLifeState { get; set; }

        public int MaxErrorHp { get; set; }

        public int MaxErrorHardControlTicks { get; set; }

        public int MaxErrorIceCoffinTicks { get; set; }

        public int MaxErrorWhirlwindTicks { get; set; }

        public int MaxErrorReviveProtectionTicks { get; set; }

        public string MaxErrorActiveAbilityId { get; set; }

        public string MaxErrorClassification { get; set; }
    }
}
