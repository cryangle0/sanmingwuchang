using System;
using System.Collections.Generic;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal sealed class RandomStreams
    {
        public RandomStreams(long rootSeed)
        {
            var root = new DeterministicRng(rootSeed);
            Spawn = root.Fork("spawn");
            Combat = root.Fork("combat");
            Storm = root.Fork("storm");
            StormLayout = root.Fork("storm-layout");
            Shop = root.Fork("shop");
            BlackMountain = root.Fork("black-mountain");
            Airdrop = root.Fork("airdrop");
        }

        public DeterministicRng Spawn;
        public DeterministicRng Combat;
        public DeterministicRng Storm;
        public DeterministicRng StormLayout;
        public DeterministicRng Shop;
        public DeterministicRng BlackMountain;
        public DeterministicRng Airdrop;
    }

    internal sealed class CultivationAward
    {
        public int EntityId;
        public int Amount;
    }

    internal sealed class MatchState
    {
        public MatchStatus Status = MatchStatus.Waiting;
        public int? StartedAtTick;
        public int? FinishedAtTick;
        public string Outcome;
        public int? WinnerEntityId;
        public readonly List<int> WinnerEntityIds = new List<int>();
        public readonly List<int> Placements = new List<int>();
        public readonly List<List<int>> PlacementGroups =
            new List<List<int>>();
        public string VoidAbortReason;
        public bool MmrEligible;
        public readonly List<CultivationAward> CultivationAwards =
            new List<CultivationAward>();
        public bool DiagnosticReplayRequired;
    }

    internal sealed class StormZoneState
    {
        public string SelectedCourtId;
        public int CourtAnnouncementTick;
        public int WarningTick;
        public Int2Mm Center;
        public int RadiusMm = 520_000;
        public bool CourtAnnounced;
        public bool ApocalypseWarning;
        public bool ApocalypseStarted;
    }

    internal sealed class ShopListingState
    {
        public string ListingId;
        public string Kind;
        public string EquipmentId;
        public string ConsumableId;
        public int Price;
    }

    internal sealed class ShopState
    {
        public string ShopId;
        public string Kind;
        public Int2Mm Position;
        public string AnchorId;
        public string MacroId;
        public int OpenAtTick;
        public int CloseAtTick;
        public int Version;
        public string Status = "open";
        public int NextRelocationAttemptTick;
        public readonly List<ShopListingState> Inventory =
            new List<ShopListingState>();
    }

    internal sealed class AirdropState
    {
        public string Id;
        public int Sequence;
        public int ScheduledElapsedTick;
        public string Phase = "pending";
        public Int2Mm? Position;
        public int? AnnouncedAtTick;
        public int? LandedAtTick;
        public int? ExpiresAtTick;
        public int? OpenedAtTick;
        public int? OpenedByEntityId;
        public string EquipmentId;
        public int? LootEntityId;
    }

    internal sealed class AirdropChannelState
    {
        public int Sequence;
        public int PlayerEntityId;
        public string AirdropId;
        public int StartedAtTick;
        public int CompletesAtTick;
        public Int2Mm OriginPosition;
    }

    internal sealed class PlayerHistoryFrame
    {
        public int EntityId;
        public int Tick;
        public Int2Mm Position;
        public int Hp;
    }

    internal sealed class SimulationState
    {
        public int Tick;
        public uint RootSeed;
        public int ArenaRadiusMm;
        public readonly SortedDictionary<int, PlayerState> Players =
            new SortedDictionary<int, PlayerState>();
        public readonly SortedDictionary<int, WindWallState> WindWalls =
            new SortedDictionary<int, WindWallState>();
        public readonly SortedDictionary<int, ProjectileState> Projectiles =
            new SortedDictionary<int, ProjectileState>();
        public readonly SortedDictionary<int, MonsterState> Monsters =
            new SortedDictionary<int, MonsterState>();
        public readonly SortedDictionary<int, LootDropState> LootDrops =
            new SortedDictionary<int, LootDropState>();
        public readonly SortedDictionary<int, SummonState> Summons =
            new SortedDictionary<int, SummonState>();
        public readonly SortedDictionary<int, AfterimageState> Afterimages =
            new SortedDictionary<int, AfterimageState>();
        public readonly List<BountyMarkState> BountyMarks =
            new List<BountyMarkState>();
        public readonly List<MonsterRespawnState> MonsterRespawns =
            new List<MonsterRespawnState>();
        public readonly SortedDictionary<int, CoreBossRuntimeState>
            CoreBossRuntimes =
                new SortedDictionary<int, CoreBossRuntimeState>();
        public readonly SortedDictionary<int, CoreBossHazardState>
            CoreBossHazards =
                new SortedDictionary<int, CoreBossHazardState>();
        public readonly SortedDictionary<int, CoreBossRevealAnchorState>
            CoreBossRevealAnchors =
                new SortedDictionary<int, CoreBossRevealAnchorState>();
        public readonly SortedDictionary<int, int> CoreBossThreat =
            new SortedDictionary<int, int>();
        public readonly SortedDictionary<int, PendingActiveReplacementState>
            PendingActiveReplacements =
                new SortedDictionary<int, PendingActiveReplacementState>();
        public readonly SortedDictionary<int, PendingEquipmentPickupState>
            PendingEquipmentPickups =
                new SortedDictionary<int, PendingEquipmentPickupState>();
        public readonly SortedDictionary<string, PassiveTargetState>
            PassiveTargetStates =
                new SortedDictionary<string, PassiveTargetState>(
                    StringComparer.Ordinal);
        public readonly SortedDictionary<string, ShopState> Shops =
            new SortedDictionary<string, ShopState>(
                StringComparer.Ordinal);
        public readonly SortedDictionary<string, AirdropState> Airdrops =
            new SortedDictionary<string, AirdropState>(
                StringComparer.Ordinal);
        public readonly SortedDictionary<int, AirdropChannelState>
            AirdropChannels =
                new SortedDictionary<int, AirdropChannelState>();
        public readonly SortedDictionary<string, int>
            TerminalShopAssignments = new SortedDictionary<string, int>(
                StringComparer.Ordinal);
        public readonly List<PlayerHistoryFrame> PlayerHistoryFrames =
            new List<PlayerHistoryFrame>();
        public readonly List<StaticSolidRect> StaticSolids =
            new List<StaticSolidRect>();
        public readonly Dictionary<string, int> EntityIdByPlayerId =
            new Dictionary<string, int>(StringComparer.Ordinal);
        public RandomStreams Random;
        public readonly HashSet<int> InitialSpawnIndices = new HashSet<int>();
        public readonly HashSet<string> ConsumedB20PlayerIds =
            new HashSet<string>(StringComparer.Ordinal);
        public readonly List<int> EliminationOrder = new List<int>();
        public readonly Dictionary<int, int> EliminationTicks =
            new Dictionary<int, int>();
        public readonly MatchState Match = new MatchState();
        public readonly StormZoneState StormZone = new StormZoneState();
        public bool PveEnabled;
        public string PvePopulation = "demo";

        /// <summary>Non-null once the authoritative 840m map is enabled.</summary>
        public string MapGeometryHash;
        public MapCollisionField MapField;
        public int NextEntityId = 1;
        public int NextEquipmentInstanceId = 1;
        public int NextShieldSequence = 1;
        public int NextAirdropChannelSequence = 1;
        public bool GoldenCudgelDropped;

        /// <summary>
        /// Reusable per-tick iteration buffer for
        /// <see cref="PveSystem"/>. Not part of the authoritative
        /// state: it never feeds <see cref="StateHashBuilder"/> and is
        /// cleared before each use, so it cannot affect hashes or
        /// iteration order.
        /// </summary>
        public readonly List<MonsterState> MonsterAdvanceScratch =
            new List<MonsterState>();
    }
}
