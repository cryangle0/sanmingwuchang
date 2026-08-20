using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal readonly struct DamageRequest
    {
        public DamageRequest(
            int? sourceEntityId,
            int targetEntityId,
            int amount,
            DamageCause cause,
            DamageForm form,
            int? outgoingDamageBasisPointsOverride = null,
            bool isCritical = false,
            int shieldBypassBasisPoints = 0,
            bool periodic = false,
            bool ignoreExecute = false,
            bool ignoreSourceBonuses = false)
        {
            SourceEntityId = sourceEntityId;
            TargetEntityId = targetEntityId;
            Amount = amount;
            Cause = cause;
            Form = form;
            OutgoingDamageBasisPointsOverride =
                outgoingDamageBasisPointsOverride;
            IsCritical = isCritical;
            ShieldBypassBasisPoints = shieldBypassBasisPoints;
            Periodic = periodic;
            IgnoreExecute = ignoreExecute;
            IgnoreSourceBonuses = ignoreSourceBonuses;
        }

        public int? SourceEntityId { get; }
        public int TargetEntityId { get; }
        public int Amount { get; }
        public DamageCause Cause { get; }
        public DamageForm Form { get; }
        public int? OutgoingDamageBasisPointsOverride { get; }
        public bool IsCritical { get; }
        public int ShieldBypassBasisPoints { get; }
        public bool Periodic { get; }
        public bool IgnoreExecute { get; }
        public bool IgnoreSourceBonuses { get; }
    }

    internal readonly struct BasicAttackSnapshot
    {
        public BasicAttackSnapshot(
            int sourceEntityId,
            FiveElement sourceElement,
            int baseDamage,
            int outgoingDamageBasisPoints,
            int comboDepth = 0,
            bool forcedCritical = false,
            string forcedPassiveId = null)
        {
            SourceEntityId = sourceEntityId;
            SourceElement = sourceElement;
            BaseDamage = baseDamage;
            OutgoingDamageBasisPoints = outgoingDamageBasisPoints;
            ComboDepth = comboDepth;
            ForcedCritical = forcedCritical;
            ForcedPassiveId = forcedPassiveId;
        }

        public int SourceEntityId { get; }
        public FiveElement SourceElement { get; }
        public int BaseDamage { get; }
        public int OutgoingDamageBasisPoints { get; }
        public int ComboDepth { get; }
        public bool ForcedCritical { get; }
        public string ForcedPassiveId { get; }
    }

    internal readonly struct CriticalResolution
    {
        public CriticalResolution(
            bool isCritical,
            int damagePercent,
            int shieldBypassPercent)
        {
            IsCritical = isCritical;
            DamagePercent = damagePercent;
            ShieldBypassPercent = shieldBypassPercent;
        }

        public bool IsCritical { get; }
        public int DamagePercent { get; }
        public int ShieldBypassPercent { get; }
    }

    internal sealed class ShieldAbsorptionResult
    {
        public int Absorbed;
        public int RemainingDamage;
        public readonly List<ShieldState> BrokenShields =
            new List<ShieldState>();
    }
}
