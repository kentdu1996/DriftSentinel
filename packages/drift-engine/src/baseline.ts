import type { Baseline, ProbeResult } from "@driftsentinel/core";
import { mean, stddev } from "@driftsentinel/core";

const MIN_SIGMA = 5.0; // floor for 0-100 score scale; avoids misleading huge z display
const WINDOW = 10; // rolling window of clean samples

// Update a rolling baseline from a clean (non-degraded) probe history.
// Callers must pass only results NOT flagged confirmed, to avoid the baseline
// drifting toward a degraded "new normal".
export function computeBaseline(
  endpointId: string,
  cleanHistory: ProbeResult[],
): Baseline {
  const recent = cleanHistory.slice(-WINDOW);
  const scores = recent.map((r) => r.score);
  const mu = mean(scores);
  const sigma = Math.max(MIN_SIGMA, stddev(scores));

  const latest = recent[recent.length - 1];
  return {
    endpointId,
    mu,
    sigma,
    n: recent.length,
    refFingerprint: latest?.fingerprint.vector ?? [],
    latencyRef: {
      p50: latest?.latencyP50 ?? 0,
      p95: latest?.latencyP95 ?? 0,
    },
    updatedAt: Date.now(),
  };
}

// Seed baseline from a single first probe (n=1, sigma at floor).
export function seedBaseline(r: ProbeResult): Baseline {
  return {
    endpointId: r.endpointId,
    mu: r.score,
    sigma: MIN_SIGMA,
    n: 1,
    refFingerprint: r.fingerprint.vector,
    latencyRef: { p50: r.latencyP50, p95: r.latencyP95 },
    updatedAt: Date.now(),
  };
}
