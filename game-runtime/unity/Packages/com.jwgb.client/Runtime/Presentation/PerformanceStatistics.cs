using System;

namespace Jwgb.Client.Presentation
{
    [Serializable]
    public sealed class PerformanceDistribution
    {
        public int count;
        public double average;
        public double p50;
        public double p95;
        public double p99;
        public double max;
    }

    public static class PerformanceStatistics
    {
        public static PerformanceDistribution Calculate(
            double[] samples,
            int count)
        {
            if (samples == null)
            {
                throw new ArgumentNullException(nameof(samples));
            }

            if (count < 0 || count > samples.Length)
            {
                throw new ArgumentOutOfRangeException(nameof(count));
            }

            if (count == 0)
            {
                return new PerformanceDistribution();
            }

            var sorted = new double[count];
            Array.Copy(samples, sorted, count);
            Array.Sort(sorted);

            var sum = 0d;
            for (var index = 0; index < count; index += 1)
            {
                sum += sorted[index];
            }

            return new PerformanceDistribution
            {
                count = count,
                average = sum / count,
                p50 = Percentile(sorted, 0.50d),
                p95 = Percentile(sorted, 0.95d),
                p99 = Percentile(sorted, 0.99d),
                max = sorted[count - 1]
            };
        }

        private static double Percentile(double[] sorted, double percentile)
        {
            var index = Math.Max(
                0,
                (int)Math.Ceiling(percentile * sorted.Length) - 1);
            return sorted[index];
        }
    }
}
