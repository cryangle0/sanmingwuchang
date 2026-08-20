using System.IO;
using Jwgb.Core;
using NUnit.Framework;
using UnityEngine;

namespace Jwgb.Tests
{
    public sealed class CoreFixtureParityTests
    {
        private CoreFixtureDocument fixture;

        [OneTimeSetUp]
        public void LoadFixture()
        {
            var fixturePath = Path.GetFullPath(
                Path.Combine(
                    Application.dataPath,
                    "..",
                    "..",
                    "migration",
                    "fixtures",
                    "core-v1.json"));
            Assert.That(File.Exists(fixturePath), Is.True, fixturePath);
            fixture = JsonUtility.FromJson<CoreFixtureDocument>(
                File.ReadAllText(fixturePath));
        }

        [Test]
        public void ScalarContractMatchesTypeScript()
        {
            Assert.That(fixture.schema, Is.EqualTo("jwgb.core.fixture.v1"));
            Assert.That(fixture.ruleset, Is.EqualTo(SimulationConstants.RulesetVersion));
            Assert.That(
                fixture.scalar.ticksPerSecond,
                Is.EqualTo(SimulationConstants.TicksPerSecond));

            foreach (var vector in fixture.scalar.squareRoots)
            {
                Assert.That(
                    IntegerMath.IntegerSquareRoot(vector.input),
                    Is.EqualTo(vector.output),
                    $"sqrt({vector.input})");
            }
        }

        [Test]
        public void RngContractMatchesTypeScript()
        {
            foreach (var sequence in fixture.rng.sequences)
            {
                var rng = new DeterministicRng(sequence.seed);
                Assert.That((long)rng.InitialSeed, Is.EqualTo(sequence.initialSeed));
                foreach (var expected in sequence.nextUint32)
                {
                    Assert.That((long)rng.NextUInt32(), Is.EqualTo(expected));
                }
            }

            foreach (var sequence in fixture.rng.bounded)
            {
                var rng = new DeterministicRng(sequence.seed);
                foreach (var expected in sequence.values)
                {
                    Assert.That(
                        (long)rng.NextInt((ulong)sequence.maximumExclusive),
                        Is.EqualTo(expected),
                        $"seed={sequence.seed}, max={sequence.maximumExclusive}");
                }
            }

            foreach (var sequence in fixture.rng.forks)
            {
                var rng = new DeterministicRng(sequence.seed).Fork(sequence.stream);
                Assert.That((long)rng.InitialSeed, Is.EqualTo(sequence.initialSeed));
                foreach (var expected in sequence.nextUint32)
                {
                    Assert.That((long)rng.NextUInt32(), Is.EqualTo(expected));
                }
            }
        }

        [Test]
        public void HashContractMatchesTypeScript()
        {
            foreach (var vector in fixture.hashes)
            {
                Assert.That(
                    (long)Hash32.HashString(vector.text),
                    Is.EqualTo(vector.hashString32));
                Assert.That(
                    (long)Hash32.HashText(vector.text),
                    Is.EqualTo(vector.hashText32));

                var stableInput = StableFixtureJson.BuildHashInput(vector.text);
                Assert.That(
                    Hash32.ToHex8(Hash32.HashText(stableInput)),
                    Is.EqualTo(vector.stableHash32));
            }
        }

        [Test]
        public void IntegerMathContractMatchesTypeScript()
        {
            var origin = new Int2Mm(0, 0);
            foreach (var vector in fixture.math)
            {
                var input = new Int2Mm(vector.input.x, vector.input.z);
                AssertVector(
                    IntegerMath.NormalizeAxisPair(input.X, input.Z),
                    vector.normalized);
                Assert.That(
                    IntegerMath.DistanceSquared(input, origin),
                    Is.EqualTo(vector.distanceSquaredFromOrigin));
                AssertVector(
                    IntegerMath.ClampToCircle(input, 10_000),
                    vector.clampedToCircle);
                AssertVector(
                    IntegerMath.MoveToward(input, origin, 2_500),
                    vector.movedTowardOrigin);
            }
        }

        private static void AssertVector(Int2Mm actual, VectorFixture expected)
        {
            Assert.That(actual.X, Is.EqualTo(expected.x));
            Assert.That(actual.Z, Is.EqualTo(expected.z));
        }
    }
}
