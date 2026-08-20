using System;
using Jwgb.Client;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client.Presentation
{
    public sealed partial class MatchHud
    {
        private MatchInteractionPanel interactionPanel;

        private void InitializeTransactionPanel()
        {
            interactionPanel = new MatchInteractionPanel(
                elements.InMatchLayer,
                ExecuteTransaction);
            if (runtime != null)
            {
                runtime.TransactionCompleted +=
                    OnLocalTransactionCompleted;
            }
            if (clientBootstrap != null)
            {
                clientBootstrap.Transactions.Completed +=
                    OnNetworkTransactionCompleted;
            }
        }

        private void DisposeTransactionPanel()
        {
            if (runtime != null)
            {
                runtime.TransactionCompleted -=
                    OnLocalTransactionCompleted;
            }
            if (clientBootstrap != null)
            {
                clientBootstrap.Transactions.Completed -=
                    OnNetworkTransactionCompleted;
            }
            interactionPanel?.Dispose();
            interactionPanel = null;
        }

        private void ExecuteTransaction(
            SimulationTransactionRequest request)
        {
            if (IsNetworkMode)
            {
                clientBootstrap.Transactions.Execute(request);
                return;
            }
            runtime.ExecuteTransaction(request);
        }

        private void OnLocalTransactionCompleted(
            ClientTransactionResult result)
        {
            interactionPanel?.ShowResult(result);
        }

        private void OnNetworkTransactionCompleted(
            ClientTransactionResult result)
        {
            interactionPanel?.ShowResult(result);
        }
    }
}
