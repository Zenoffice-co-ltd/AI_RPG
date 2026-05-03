import { percentile } from "../ttsComparison/stats";

export type CiInterval = {
  low: number;
  high: number;
};

/**
 * Bootstrap percentile CI by resampling with replacement.
 * Returns null if not enough data points.
 */
export function bootstrapPercentileCi(
  values: number[],
  pct: number,
  options: {
    iterations?: number;
    ciPercent?: number;
    rng?: () => number;
  } = {}
): CiInterval | null {
  if (values.length < 5) return null;
  const iterations = options.iterations ?? 1000;
  const ciPercent = options.ciPercent ?? 95;
  const rng = options.rng ?? Math.random;

  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const resampled: number[] = new Array(values.length);
    for (let j = 0; j < values.length; j += 1) {
      const idx = Math.floor(rng() * values.length);
      resampled[j] = values[Math.min(idx, values.length - 1)]!;
    }
    const p = percentile(resampled, pct);
    if (p !== null) samples.push(p);
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a - b);
  const lowQ = (100 - ciPercent) / 2;
  const highQ = 100 - lowQ;
  const low = percentile(samples, lowQ);
  const high = percentile(samples, highQ);
  if (low === null || high === null) return null;
  return { low, high };
}
