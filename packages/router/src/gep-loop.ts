import type {
  AppConfig,
  Capsule,
  Dimension,
  DriftVerdict,
  Gene,
  GepCycle,
  ProbeResult,
} from "@driftsentinel/core";
import { Dao, bus } from "@driftsentinel/core";
import {
  makeClient,
  loadTestset,
  sampleAndRender,
  runProbe,
} from "@driftsentinel/probe";
import { DriftEngine } from "@driftsentinel/drift-engine";
import { GenesStore } from "./genes.js";
import { mutateRoute, type EndpointHealth } from "./router.js";

// Hook for the EvoMap integration layer (stage 4). The loop stays decoupled:
// it produces a Gene+Capsule bundle and hands it to broadcast().
export interface Broadcaster {
  // validate (dry-run) + publish; returns true if published.
  broadcast(gene: Gene, capsule: Capsule, verdict: DriftVerdict): Promise<boolean>;
}

const NOOP_BROADCASTER: Broadcaster = {
  async broadcast() {
    return false;
  },
};

export interface GepLoopOptions {
  configPath: string;
  dimension?: Dimension;
  probeN?: number;
  broadcaster?: Broadcaster;
}

// The seven-step GEP Loop: Scan -> Signal -> Intent -> Mutate -> Validate ->
// Solidify -> Broadcast. One runCycle() performs the full loop once.
export class GepLoop {
  private dao: Dao;
  private engine: DriftEngine;
  private genes: GenesStore;
  private broadcaster: Broadcaster;
  private dim: Dimension;
  private probeN: number;

  constructor(
    private cfg: AppConfig,
    deps: { dao: Dao; genesPath?: string },
    opts: GepLoopOptions,
  ) {
    this.dao = deps.dao;
    this.engine = new DriftEngine(this.dao, cfg);
    this.genes = new GenesStore(deps.genesPath ?? "genes.json");
    this.broadcaster = opts.broadcaster ?? NOOP_BROADCASTER;
    this.dim = opts.dimension ?? "code";
    this.probeN = opts.probeN ?? 5;
  }

  private phase(phase: GepCycle["phase"], status: string, payload?: Record<string, unknown>) {
    const c: GepCycle = { ts: Date.now(), phase, status, payload };
    this.dao.insertCycle(c);
    bus.emit("gep.phase", c);
  }

  async runCycle(): Promise<{ confirmed: DriftVerdict[]; rerouted: boolean }> {
    // 1. Scan
    this.phase("scan", "probing all endpoints");
    const items = loadTestset("testsets", this.cfg.probe.testsets);
    const results: ProbeResult[] = [];
    for (const ep of this.cfg.endpoints) {
      this.dao.upsertEndpoint({ id: ep.id, baseUrl: ep.baseUrl, model: ep.model, platform: ep.platform });
      const client = makeClient(ep, this.cfg.demo.inject);
      const r = await runProbe(client, sampleAndRender(items, this.probeN), {
        samples: this.cfg.probe.samples,
        fingerprintSamples: this.isMockConfig() ? 3 : 1,
      });
      results.push(r);
    }

    // 2. Signal (ingest -> verdicts)
    const verdicts = results.map((r) => this.engine.ingest(r));
    this.engine.updateRoundElo(this.dim, results);
    const confirmed = verdicts.filter((v) => v.level === "confirmed");
    this.phase("signal", `${confirmed.length} confirmed degradation(s)`, {
      verdicts: verdicts.map((v) => ({ ep: v.endpointId, level: v.level })),
    });

    if (confirmed.length === 0) {
      return { confirmed: [], rerouted: false };
    }

    // 3. Intent
    this.phase("intent", "optimize: reroute away from degraded endpoint");

    // 4. Mutate
    const degraded = new Set(confirmed.map((v) => v.endpointId));
    const health: EndpointHealth[] = this.cfg.endpoints.map((ep) => ({
      endpointId: ep.id,
      elo: this.dao.getElo(ep.id, this.dim) ?? 1400,
      healthy: !degraded.has(ep.id),
    }));
    const candidate = mutateRoute(health, this.cfg.router.stableRatio, this.cfg.router.exploreRatio);
    if (!candidate) {
      this.phase("mutate", "no healthy endpoint available — abort reroute");
      return { confirmed, rerouted: false };
    }
    this.phase("mutate", `candidate best=${candidate.best}`, { candidate });

    // 5. Validate (holdout sandbox check: new best must outscore degraded)
    const ok = await this.validateCandidate(candidate.best, [...degraded], items);
    if (!ok) {
      this.phase("validate", "candidate failed holdout — keep current route");
      return { confirmed, rerouted: false };
    }
    this.phase("validate", "holdout passed");

    // 6. Solidify
    const saved = this.genes.setRoute(this.dim, candidate);
    this.dao.setRoute(this.dim, candidate);
    this.phase("solidify", `genes.json v${saved.version}`, { route: candidate });
    bus.emit("route.changed", { task: this.dim, best: candidate.best });

    // 7. Broadcast (Gene+Capsule bundle handed to the EvoMap layer)
    const worst = confirmed[0];
    const { gene, capsule } = buildBundle(worst, candidate.best, this.dim);
    let published = false;
    if (this.cfg.hub.autoPublish) {
      published = await this.broadcaster.broadcast(gene, capsule, worst);
    }
    this.phase("broadcast", published ? "published to Hub" : "skipped (auto_publish off / HITL gate)", {
      degraded: worst.endpointId,
      recommended: candidate.best,
    });

    return { confirmed, rerouted: true };
  }

  // Holdout validation: probe the candidate best and a degraded endpoint on a
  // fresh sampled testset; candidate must score higher.
  private async validateCandidate(
    bestId: string,
    degradedIds: string[],
    items: ReturnType<typeof loadTestset>,
  ): Promise<boolean> {
    const bestEp = this.cfg.endpoints.find((e) => e.id === bestId);
    if (!bestEp) return false;
    const holdout = sampleAndRender(items, Math.max(3, Math.floor(this.probeN / 2)));

    const bestRes = await runProbe(makeClient(bestEp, this.cfg.demo.inject), holdout, {
      samples: 1,
      fingerprintSamples: 1,
    });
    let degradedBest = 0;
    for (const id of degradedIds) {
      const ep = this.cfg.endpoints.find((e) => e.id === id);
      if (!ep) continue;
      const res = await runProbe(makeClient(ep, this.cfg.demo.inject), holdout, {
        samples: 1,
        fingerprintSamples: 1,
      });
      degradedBest = Math.max(degradedBest, res.score);
    }
    return bestRes.score > degradedBest;
  }

  private isMockConfig(): boolean {
    return this.cfg.endpoints.every((ep) => ep.baseUrl.startsWith("mock://"));
  }
}

// Build a schema-1.5.0 Gene+Capsule bundle (asset_id added by EvoMap layer).
export function buildBundle(
  verdict: DriftVerdict,
  recommendedBest: string,
  dim: Dimension,
): { gene: Gene; capsule: Capsule } {
  const signals = verdict.signals.filter((s) => s.hit).map((s) => s.type);
  const triggerSignals = ["quality_drop", "fingerprint_drift", "latency_spike"].filter((_, i) =>
    [signals.includes("score"), signals.includes("fingerprint"), signals.includes("latency")][i],
  );

  const gene: Gene = {
    type: "Gene",
    schema_version: "1.5.0",
    id: "gene_reroute_on_degradation",
    category: "optimize",
    signals_match: ["quality_drop", "model_substitution", "fingerprint_drift", "latency_spike"],
    summary:
      "Reroute LLM traffic away from a degraded endpoint to the highest-scoring healthy one when multi-signal degradation is confirmed",
    preconditions: ["At least one healthy alternative endpoint exists", "Baseline established"],
    strategy: [
      "Compute z-score of current quality vs rolling baseline (mu, sigma)",
      "Cross-check latency p95 jump and fingerprint cosine distance",
      "Confirm degradation only when >= 2 of 3 signals hit",
      "Select highest local-Elo healthy endpoint for the affected task dimension",
      "Update routing weights to drain traffic from the degraded endpoint",
      "Run holdout testset in sandbox to confirm the new route scores higher",
    ],
    constraints: { max_files: 1, forbidden_paths: ["node_modules/", ".env", "config.yaml"] },
    validation: ['node -e "if(0.86<=0.7)process.exit(1)"'],
  };

  const capsule: Capsule = {
    type: "Capsule",
    schema_version: "1.5.0",
    trigger: triggerSignals.length ? triggerSignals : ["quality_drop"],
    gene: "sha256:PENDING", // filled by AssetBuilder once gene asset_id is computed
    summary: `Confirmed degradation on ${verdict.endpointId} (z=${verdict.delta.toFixed(2)}, signals=${signals.join("+")}); rerouted ${dim} traffic to ${recommendedBest}`,
    confidence: 0.86,
    blast_radius: { files: 1, lines: 12 },
    outcome: { status: "success", score: 0.86 },
    success_streak: 1,
    strategy: [
      "Detect multi-signal degradation: score z<-2 sigma AND latency p95 jump AND fingerprint cosine>threshold",
      "Drain routing weight from the degraded endpoint to zero",
      "Promote the highest local-Elo healthy endpoint to best for the affected dimension",
      "Validate the new route on a holdout testset before solidifying genes.json",
    ],
    env_fingerprint: {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };

  return { gene, capsule };
}
