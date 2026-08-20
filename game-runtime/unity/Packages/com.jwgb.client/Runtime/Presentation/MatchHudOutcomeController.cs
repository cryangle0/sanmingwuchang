using Jwgb.Sim.Deterministic;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    internal sealed class MatchHudOutcomeController
    {
        private const string WaitingMessage =
            "REMATCH REQUESTED | WAITING FOR PLAYERS";

        public bool IsRematchRequested { get; private set; }

        public void ShowFinished(
            MatchHudElements elements,
            WorldSnapshot snapshot,
            bool isNetwork,
            int localEntityId)
        {
            elements.Outcome.text =
                snapshot.Match.WinnerEntityId == localEntityId
                    ? "VICTORY"
                    : snapshot.Match.WinnerEntityId.HasValue
                        ? "DEFEAT"
                        : "DRAW";
            elements.LocalOutcomeActions.style.display =
                DisplayStyle.Flex;
            elements.PlayAgainButton.style.display =
                DisplayStyle.Flex;
            elements.PlayAgainButton.text = isNetwork
                ? "REMATCH"
                : "PLAY AGAIN";
            elements.PlayAgainButton.SetEnabled(
                !isNetwork || !IsRematchRequested);
            elements.NetworkOutcomeNote.text =
                IsRematchRequested
                    ? WaitingMessage
                    : "ALL CONNECTED PLAYERS MUST CONFIRM";
            elements.NetworkOutcomeNote.style.display = isNetwork
                ? DisplayStyle.Flex
                : DisplayStyle.None;
        }

        public void MarkRematchRequested(MatchHudElements elements)
        {
            IsRematchRequested = true;
            elements.PlayAgainButton.SetEnabled(false);
            elements.NetworkOutcomeNote.text = WaitingMessage;
        }

        public void ResetForActiveMatch(MatchHudElements elements)
        {
            ResetRequest();
            elements.PlayAgainButton.SetEnabled(true);
        }

        public void ResetRequest()
        {
            IsRematchRequested = false;
        }
    }
}
