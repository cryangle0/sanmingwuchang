using Unity.Collections;
using Unity.Entities;
using Unity.NetCode;

namespace Jwgb.Netcode
{
    public struct MatchJoinRpc : IRpcCommand
    {
        public int ProtocolVersion;
        public FixedString64Bytes ReconnectTicket;
        public FixedString32Bytes RequestedHeroId;
        public int LastEventMatchSequence;
        public int LastEventCursor;
    }

    public struct MatchJoinAcceptedRpc : IRpcCommand
    {
        public int EntityId;
        public int MatchSequence;
        public int LastTransactionId;
        public int LastEventCursor;
        public FixedString64Bytes ReconnectTicket;
        public FixedString32Bytes AssignedHeroId;
        public bool ResumedSession;
    }

    public struct MatchInputRpc : IRpcCommand
    {
        public int Sequence;
        public int MoveX;
        public int MoveZ;
        public int AimX;
        public int AimZ;
        public bool Attack;
        public bool CastActive;
        public bool Interact;
    }

    public struct MatchStateRpc : IRpcCommand
    {
        public int MatchSequence;
        public int Tick;
        public int PlayerCount;
        public int RemainingCompetitors;
        public int ProjectileCount;
        public int WindWallCount;
        public byte MatchStatus;
        public bool HasStartedAtTick;
        public int StartedAtTick;
        public bool HasFinishedAtTick;
        public int FinishedAtTick;
        public bool HasWinner;
        public int WinnerEntityId;
        public uint StateHash;
    }

    public struct MatchTransactionRpc : IRpcCommand
    {
        public int MatchSequence;
        public int TransactionId;
        public byte Kind;
        public FixedString64Bytes ShopId;
        public FixedString64Bytes ListingId;
        public int ExpectedVersion;
        public FixedString32Bytes Destination;
        public int InstanceId;
        public bool HasReplacementInstanceId;
        public int ReplacementInstanceId;
        public FixedString32Bytes PassiveId;
        public int LootEntityId;
        public bool Confirm;
        public FixedString64Bytes HeroId;
        public int WagerGold;
        public FixedString32Bytes Mode;
        public FixedString64Bytes AirdropId;
    }

    public struct MatchTransactionResultRpc : IRpcCommand
    {
        public int MatchSequence;
        public int TransactionId;
        public byte Kind;
        public bool Accepted;
        public FixedString64Bytes Code;
        public bool HasLootEntityId;
        public int LootEntityId;
        public int CommitTick;
        public uint StateHash;
    }

    public struct MatchRematchRequestRpc : IRpcCommand
    {
        public int RequestSequence;
    }

    public struct MatchConnectionSlot : IComponentData
    {
        public int EntityId;
    }
}
