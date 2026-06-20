import type {
  AppConfig,
  Baseline,
  DriftLevel,
  DriftSignal,
  DriftVerdict,
  ProbeResult,
} from "@driftsentinel/core";
import { clamp, cosineDistance } from "@driftsentinel/core";

export interface DetectInput {
  current: ProbeResult;
  baseline: Baseline;
  // recent verdicts (most-recent-first) for continuity confirmation
  recentLevels: DriftLevel[];
  cfg: AppConfig["drift"];
}

// Multi-signal cross-check (§六.2): score / latency / fingerprint.
// Rule: >=2 of 3 hit -> confirmed; any single hit -> suspect; else normal.
// Score signal requires continuity (2 consecutive z<zConfirm) to count as hit.
export function detect(input: DetectInput): DriftVerdict {
  const { current, baseline, recentLevels, cfg } = input;
  const signals: DriftSignal[] = [];

  // Signal A: score z-score. A >2σ drop counts as a signal hit.
  const z = (current.score - baseline.mu) / baseline.sigma;
  const scoreStrong = z < cfg.zConfirm; // >2σ drop
  const scoreMild = z < cfg.zSuspect; // >1σ drop
  signals.push({ type: "score", hit: scoreStrong, delta: z });

  // Signal B: latency p95 jump ratio vs reference.
  const refP95 = baseline.latencyRef.p95 || 1;
  const jump = (current.latencyP95 - refP95) / refP95;
  const latencyHit = jump > cfg.latencyP95Jump;
  signals.push({ type: "latency", hit: latencyHit, delta: jump });

  // Signal C: fingerprint cosine distance vs reference.
  const dist =
    baseline.refFingerprint.length && current.fingerprint.vector.length
      ? cosineDistance(current.fingerprint.vector, baseline.refFingerprint)
      : 0;
  const fpHit = dist > cfg.fpCosineThreshold;
  signals.push({ type: "fingerprint", hit: fpHit, delta: dist });

  const hits = signals.filter((s) => s.hit).length;
  const prevNonNormal = recentLevels[0] === "suspect" || recentLevels[0] === "confirmed";

  let level: DriftLevel;
  if (hits >= 2) {
    // multi-signal cross-check
    level = "confirmed";
  } else if (scoreStrong && prevNonNormal) {
    // continuity: consecutive >2σ score drops confirm even single-signal
    level = "confirmed";
  } else if (hits >= 1 || scoreMild) {
    level = "suspect";
  } else {
    level = "normal";
  }

  return {
    endpointId: current.endpointId,
    ts: current.ts,
    level,
    signals,
    delta: clamp(z, -12, 12),
  };
}
