using System;
using Jwgb.Content;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client
{
    [DisallowMultipleComponent]
    public sealed class LocalMatchRuntime : MonoBehaviour
    {
        private const string AutoStartArgument =
            "-jwgbAutoStartLocal";

        [SerializeField]
        private int rootSeed = 20260724;

        [SerializeField]
        [Range(2, 30)]
        private int competitorCount = 8;

        [SerializeField]
        private bool mapModeEnabled = true;

        [SerializeField]
        private bool pveEnabled = true;

        private readonly SimulationTickClock clock =
            new SimulationTickClock(4);
        private readonly LocalPlayerInputReader input =
            new LocalPlayerInputReader();
        private LocalMatchSession session;
        private int startedMatchCount;

        public event Action<LocalMatchFrame> FrameAdvanced;

        public event Action<ClientTransactionResult>
            TransactionCompleted;

        public event Action SessionStarted;

        public event Action SessionStopped;

        public int LocalEntityId =>
            session == null ? 0 : session.LocalEntityId;

        public WorldSnapshot Snapshot => session?.Snapshot;

        public bool HasSession => session != null;

        public int DefaultCompetitorCount => competitorCount;

        public bool MapModeEnabled =>
            session?.MapEnabled ?? mapModeEnabled;

        public string SelectedHeroId { get; private set; } =
            GameplayIds.SunWukong;

        public float InterpolationAlpha => (float)clock.Alpha;

        private void Awake()
        {
            Application.runInBackground = true;
            Application.targetFrameRate = 120;
            if (!NetworkRuntimeOptions.Configuration.ClientEnabled &&
                Array.IndexOf(
                    Environment.GetCommandLineArgs(),
                    AutoStartArgument) >= 0)
            {
                StartLocalMatch(
                    GameplayIds.SunWukong,
                    competitorCount);
            }
        }

        private void Update()
        {
            if (session == null ||
                session.Snapshot.Match.Status == MatchStatus.Finished)
            {
                return;
            }

            input.Capture(
                Camera.main,
                session.Snapshot,
                session.LocalEntityId);
            var tickCount = clock.Accumulate(Time.unscaledDeltaTime);
            for (var tick = 0; tick < tickCount; tick += 1)
            {
                FrameAdvanced?.Invoke(
                    session.Step(input.ConsumeCommand()));
            }
        }

        public void StartLocalMatch(
            string heroId,
            int requestedCompetitorCount)
        {
            var clientBootstrap = GetComponent<ClientBootstrap>();
            if (clientBootstrap != null &&
                clientBootstrap.IsNetworkActive)
            {
                throw new InvalidOperationException(
                    "Cannot start a local match in Netcode client mode.");
            }
            if (requestedCompetitorCount < 2 ||
                requestedCompetitorCount > 30)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(requestedCompetitorCount));
            }

            HeroCatalog.Get(heroId);
            SelectedHeroId = heroId;
            competitorCount = requestedCompetitorCount;
            var matchSeed = checked(rootSeed + startedMatchCount);
            startedMatchCount = checked(startedMatchCount + 1);
            input.Reset();
            clock.Reset();
            DetachTransactionService();
            session = new LocalMatchSession(
                matchSeed,
                competitorCount,
                heroId,
                mapModeEnabled,
                pveEnabled);
            session.Transactions.Completed +=
                OnTransactionCompleted;
            SessionStarted?.Invoke();
        }

        public void RestartLocalMatch()
        {
            StartLocalMatch(SelectedHeroId, competitorCount);
        }

        public void ReturnToMenu()
        {
            if (session == null)
            {
                return;
            }

            DetachTransactionService();
            session = null;
            input.Reset();
            clock.Reset();
            SessionStopped?.Invoke();
        }

        public ClientTransactionResult ExecuteTransaction(
            SimulationTransactionRequest request)
        {
            if (session == null)
            {
                throw new InvalidOperationException(
                    "Cannot execute a transaction without a local match.");
            }

            return session.Transactions.Execute(request);
        }

        private void OnTransactionCompleted(
            ClientTransactionResult result)
        {
            TransactionCompleted?.Invoke(result);
        }

        private void DetachTransactionService()
        {
            if (session != null)
            {
                session.Transactions.Completed -=
                    OnTransactionCompleted;
            }
        }
    }
}
