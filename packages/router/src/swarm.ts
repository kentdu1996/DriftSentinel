import type {
  AppConfig,
  Dimension,
  DriftVerdict,
  NodeVerdict,
  ProbeResult,
} from "@driftsentinel/core";
import { Dao, openDb } from "@driftsentinel/core";
import { makeClient, loadTestset, sampleAndRender, runProbe } from "@driftsentinel/probe";
import { DriftEngine, aggregate } from "@driftsentinel/drift-engine";
import { buildBundle, type HubPort } from "@driftsentinel/evomap";
import { buildBundle as buildGeneCapsule } from "./gep-loop.js";

// A single DriftSentinel node participating in the swarm. Each node has its own
// SQLite DB (its private baselines/verdicts) but shares a Hub. The Hub is the
// HubPort abstraction: LocalHub for offline demos, RemoteHub for the real
// EvoMap Hub via /a2a/publish + /a2a/fetch. Switching from local simulation to
// the decentralized network is a one-line change at the call site — SwarmNode's
// logic is identical because every Hub call is awaited.
export class SwarmNode {
  readonly dao: Dao;
  private engine: DriftEngine;

  constructor(
    readonly nodeId: string,
    readonly cfg: AppConfig,
    private hub: HubPort,
    dbPath: string,
    private reputation = 50,
  ) {
    this.dao = new Dao(openDb(dbPath));
    this.engine = new DriftEngine(this.dao, cfg);
  }

  // INHERITANCE: on startup, fetch peers' degradation capsules and pre-mark
  // the affected endpoints as high-risk — avoid the pit without stepping in it.
  async inheritKnownRisks(): Promise<string[]> {
    const capsules = await this.hub.fetch([
      "quality_drop",
      "model_substitution",
      "fingerprint_drift",
      "latency_spike",
    ]);
    const risky = new Set<string>();
    for (const c of capsules) {
      // capsule summary encodes "degradation on <endpointId>"; extract it
      const m =
        c.capsule.summary.match(/degradation on (\S+)/i) ?? c.capsule.summary.match(/on (\S+)/i);
      if (m) risky.add(m[1]);
    }
    return [...risky];
  }

  async probeEndpoint(endpointId: string, n: number): Promise<ProbeResult> {
    const ep = this.cfg.endpoints.find((e) => e.id === endpointId)!;
    this.dao.upsertEndpoint({ id: ep.id, baseUrl: ep.baseUrl, model: ep.model, platform: ep.platform });
    const items = loadTestset("testsets", this.cfg.probe.testsets);
    const client = makeClient(ep, this.cfg.demo.inject);
    return runProbe(client, sampleAndRender(items, n), {
      samples: this.cfg.probe.samples,
      fingerprintSamples: 2,
    });
  }

  ingest(r: ProbeResult): DriftVerdict {
    return this.engine.ingest(r);
  }

  // Publish a degradation capsule to the shared Hub + record this node's verdict.
  async publishVerdict(verdict: DriftVerdict, dim: Dimension, recommendedBest: string): Promise<void> {
    const { gene, capsule } = buildGeneCapsule(verdict, recommendedBest, dim);
    const bundle = buildBundle(gene, capsule);
    await this.hub.publish(bundle.gene, bundle.capsule, this.nodeId);
    const nv: NodeVerdict = {
      nodeId: this.nodeId,
      endpointId: verdict.endpointId,
      dimension: dim,
      level: verdict.level,
      z: verdict.delta,
      reputation: this.reputation,
      ts: Date.now(),
    };
    await this.hub.recordVerdict(nv);
  }

  // L2 CONSENSUS: combine this node's local verdict with peers' independent
  // verdicts pulled from the Hub, per the §8.8 aggregation table.
  async reachConsensus(verdict: DriftVerdict, dim: Dimension) {
    const peers = await this.hub.peerVerdicts(verdict.endpointId, dim, this.nodeId);
    return aggregate({
      localNodeId: this.nodeId,
      localLevel: verdict.level,
      localZ: verdict.delta,
      endpointId: verdict.endpointId,
      dimension: dim,
      peerVerdicts: peers,
    });
  }
}
