import type {
  AppConfig,
  Dimension,
  DriftVerdict,
  ProbeResult,
} from "@driftsentinel/core";
import { Dao, bus } from "@driftsentinel/core";
import { computeBaseline, seedBaseline } from "./baseline.js";
import { detect } from "./detector.js";
import { updateElo, type EloStore } from "./elo.js";

// Orchestrates: ingest a probe result -> update baseline -> detect drift ->
// persist verdict -> emit event. Returns the verdict.
export class DriftEngine {
  private eloStore: EloStore;
  constructor(
    private dao: Dao,
    private cfg: AppConfig,
  ) {
    this.eloStore = {
      get: (e, d) => this.dao.getElo(e, d),
      set: (e, d, r) => this.dao.setElo(e, d, r),
    };
  }

  ingest(current: ProbeResult): DriftVerdict {
    // Persist the probe result first so baseline/history reads are consistent.
    this.dao.insertProbeResult(current);
    bus.emit("probe.done", {
      endpointId: current.endpointId,
      score: current.score,
      ts: current.ts,
    });

    let baseline = this.dao.getBaseline(current.endpointId);

    if (!baseline) {
      baseline = seedBaseline(current);
      this.dao.upsertBaseline(baseline);
      const verdict: DriftVerdict = {
        endpointId: current.endpointId,
        ts: current.ts,
        level: "normal",
        signals: [],
        delta: 0,
      };
      this.dao.insertVerdict(verdict);
      bus.emit("drift.verdict", verdict);
      return verdict;
    }

    const recentLevels = this.dao
      .recentVerdicts(current.endpointId, 3)
      .map((v) => v.level);

    const verdict = detect({
      current,
      baseline,
      recentLevels,
      cfg: this.cfg.drift,
    });

    this.dao.insertVerdict(verdict);
    bus.emit("drift.verdict", verdict);

    // Update baseline ONLY from clean (non-confirmed) results.
    if (verdict.level !== "confirmed") {
      const clean = this.dao
        .recentProbeResults(current.endpointId, 20)
        .reverse()
        .filter((r) => r.score >= baseline!.mu - 2 * baseline!.sigma);
      const updated = computeBaseline(current.endpointId, clean);
      this.dao.upsertBaseline(updated);
    }

    return verdict;
  }

  // Cross-endpoint Elo on a dimension after a probe round.
  updateRoundElo(dimension: Dimension, results: ProbeResult[]): void {
    const scores = results
      .filter((r) => r.byDimension[dimension] !== undefined)
      .map((r) => ({
        endpointId: r.endpointId,
        score: r.byDimension[dimension]!,
      }));
    if (scores.length >= 2) {
      updateElo(this.eloStore, dimension, scores);
    }
  }
}
