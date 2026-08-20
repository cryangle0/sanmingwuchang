using NUnit.Framework;
using UnityEditor;

namespace Jwgb.Tests
{
    public sealed class PlayerSettingsTests
    {
        [Test]
        public void AndroidBuildUsesInternalApplicationStorage()
        {
            Assert.That(
                PlayerSettings.Android.preferredInstallLocation,
                Is.EqualTo(AndroidPreferredInstallLocation.ForceInternal));
        }

        [Test]
        public void AndroidBuildTargetsOnlyArm64()
        {
            Assert.That(
                PlayerSettings.Android.targetArchitectures,
                Is.EqualTo(AndroidArchitecture.ARM64));
        }
    }
}
