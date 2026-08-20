namespace Jwgb.Netcode
{
    public readonly struct NetworkInputSample
    {
        public NetworkInputSample(
            int moveX,
            int moveZ,
            int aimX,
            int aimZ,
            bool attack,
            bool castActive,
            bool interact = false)
        {
            MoveX = moveX;
            MoveZ = moveZ;
            AimX = aimX;
            AimZ = aimZ;
            Attack = attack;
            CastActive = castActive;
            Interact = interact;
        }

        public int MoveX { get; }
        public int MoveZ { get; }
        public int AimX { get; }
        public int AimZ { get; }
        public bool Attack { get; }
        public bool CastActive { get; }
        public bool Interact { get; }
    }

    public readonly struct AcceptedNetworkInput
    {
        public AcceptedNetworkInput(
            int entityId,
            MatchInputRpc input)
        {
            EntityId = entityId;
            Sequence = input.Sequence;
            MoveX = input.MoveX;
            MoveZ = input.MoveZ;
            AimX = input.AimX;
            AimZ = input.AimZ;
            Attack = input.Attack;
            CastActive = input.CastActive;
            Interact = input.Interact;
        }

        public int EntityId { get; }
        public int Sequence { get; }
        public int MoveX { get; }
        public int MoveZ { get; }
        public int AimX { get; }
        public int AimZ { get; }
        public bool Attack { get; }
        public bool CastActive { get; }
        public bool Interact { get; }
    }

    public readonly struct PredictedNetworkInput
    {
        public PredictedNetworkInput(MatchInputRpc input)
        {
            Sequence = input.Sequence;
            MoveX = input.MoveX;
            MoveZ = input.MoveZ;
            AimX = input.AimX;
            AimZ = input.AimZ;
            Attack = input.Attack;
            CastActive = input.CastActive;
            Interact = input.Interact;
        }

        public int Sequence { get; }
        public int MoveX { get; }
        public int MoveZ { get; }
        public int AimX { get; }
        public int AimZ { get; }
        public bool Attack { get; }
        public bool CastActive { get; }
        public bool Interact { get; }
    }

    public readonly struct NetworkPlayerAssignment
    {
        public NetworkPlayerAssignment(
            int entityId,
            bool connected,
            string heroId = null,
            bool applyHero = false)
        {
            EntityId = entityId;
            Connected = connected;
            HeroId = heroId;
            ApplyHero = applyHero;
        }

        public int EntityId { get; }
        public bool Connected { get; }
        public string HeroId { get; }
        public bool ApplyHero { get; }
    }
}
