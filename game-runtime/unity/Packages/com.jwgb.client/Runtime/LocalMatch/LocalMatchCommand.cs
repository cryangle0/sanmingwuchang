namespace Jwgb.Client
{
    public readonly struct LocalMatchCommand
    {
        public LocalMatchCommand(
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
}
