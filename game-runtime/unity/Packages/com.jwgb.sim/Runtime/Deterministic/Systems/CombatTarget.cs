using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal readonly struct CombatTarget
    {
        public CombatTarget(PlayerState player)
        {
            Player = player;
            Monster = null;
            Summon = null;
        }

        public CombatTarget(MonsterState monster)
        {
            Player = null;
            Monster = monster;
            Summon = null;
        }

        public CombatTarget(SummonState summon)
        {
            Player = null;
            Monster = null;
            Summon = summon;
        }

        public PlayerState Player { get; }
        public MonsterState Monster { get; }
        public SummonState Summon { get; }
        public bool IsPlayer => Player != null;
        public bool IsMonster => Monster != null;
        public bool IsSummon => Summon != null;
        public int EntityId => IsPlayer
            ? Player.EntityId
            : IsMonster ? Monster.EntityId : Summon.EntityId;
        public Int2Mm Position => IsPlayer
            ? Player.Position
            : IsMonster ? Monster.Position : Summon.Position;
        public int CollisionRadiusMm => IsPlayer
            ? GameplayRadius.Player
            : IsMonster ? Monster.CollisionRadiusMm : GameplayRadius.Summon;

        public bool IsAlive => IsPlayer
            ? Player.LifeState == LifeState.Alive
            : IsMonster
                ? Monster.Hp > 0
                : Summon.Targetable && Summon.Hp > 0;
    }

    internal static class GameplayRadius
    {
        public const int Player = 450;
        public const int Summon = 600;
    }
}
