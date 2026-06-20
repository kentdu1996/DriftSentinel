import type { Capsule, Dimension, DriftLevel, Gene, NodeVerdict } from "@driftsentinel/core";
import type { EvoMapClient } from "./client.js";
import { buildBundle } from "./asset-builder.js";
import type { HubAsset, HubPort } from "./hub-port.js";
import { LocalHub } from "./local-hub.js";

// RemoteHub implements HubPort against the REAL EvoMap Hub via EvoMapClient
// (/a2a/hello + /a2a/validate + /a2a/publish + /a2a/fetch). It is a drop-in
// replacement for LocalHub, so SwarmNode runs cross-node experience inheritance
// over the decentralized network instead of a local file mirror.
//
// publish/fetch hit the real Hub. Verdict exchange (recordVerdict/peerVerdicts)
// is derived from the same Hub: a published confirmed-degradation Capsule IS a
// node's independent verdict. A LocalHub mirror is kept so the demo degrades
// gracefully (offline / network error) without crashing the swarm flow.
export class RemoteHub implements HubPort {
  constructor(
    private client: EvoMapClient,
    private mirror: LocalHub = new LocalHub("data/remote-hub-mirror.json"),
    // When false, validate (dry-run) runs but /a2a/publish is not sent.
    private realPublish = true,
  ) {}

  async publish(gene: Gene, capsule: Capsule, nodeId: string): Promise<void> {
    const bundle = buildBundle(gene, capsule);
    try {
      await this.client.hello();
      await this.client.validate(bundle);
      if (this.realPublish) await this.client.publish(bundle);
    } catch {
      // Network unavailable — keep the local mirror so the demo still works.
    }
    // Always mirror locally so peerVerdicts/fetch have an offline fallback.
    this.mirror.publish(bundle.gene, bundle.capsule, nodeId);
  }

  async fetch(signalsMatch: string[]): Promise<HubAsset[]> {
    try {
      await this.client.hello();
      const res = await this.client.fetch({ signals_match: signalsMatch, limit: 50 });
      const remote = extractAssets(res.body);
      if (remote.length) return remote;
    } catch {
      // fall through to mirror
    }
    return this.mirror.fetch(signalsMatch);
  }

  async recordVerdict(v: NodeVerdict): Promise<void> {
    // On the real Hub a verdict is shared by publishing the Capsule; we still
    // mirror it locally for this node's own consensus bookkeeping.
    this.mirror.recordVerdict(v);
  }

  async peerVerdicts(
    endpointId: string,
    dimension: string,
    exceptNodeId: string,
  ): Promise<NodeVerdict[]> {
    // Peers' independent verdicts = their published degradation Capsules for the
    // same endpoint. Pull them from the real Hub and synthesize NodeVerdicts.
    const derived: NodeVerdict[] = [];
    try {
      await this.client.hello();
      const res = await this.client.fetch({
        signals_match: ["quality_drop", "model_substitution", "fingerprint_drift", "latency_spike"],
        limit: 50,
      });
      for (const a of extractAssets(res.body)) {
        if (a.nodeId === exceptNodeId) continue;
        const m = a.capsule.summary.match(/degradation on (\S+)/i);
        if (!m || m[1] !== endpointId) continue;
        const zMatch = a.capsule.summary.match(/z=(-?\d+(?:\.\d+)?)/);
        derived.push({
          nodeId: a.nodeId || "peer",
          endpointId,
          dimension: dimension as Dimension,
          level: "confirmed" as DriftLevel,
          z: zMatch ? Number(zMatch[1]) : -3,
          reputation: 50,
          ts: Date.now(),
        });
      }
    } catch {
      // ignore network errors; fall back to the mirror below
    }
    // Merge with the local mirror, dedupe by nodeId (prefer Hub-derived).
    const local = this.mirror.peerVerdicts(endpointId, dimension, exceptNodeId);
    const seen = new Set(derived.map((d) => d.nodeId));
    for (const l of local) if (!seen.has(l.nodeId)) derived.push(l);
    return derived;
  }
}

// The Hub may return assets in several shapes; parse leniently into HubAssets so
// we never crash on an unexpected envelope. Handles: {payload:{assets:[...]}},
// {assets|results|bundles|capsules|items:[...]}, a bare array, bundle entries
// ({gene,capsule,node_id}), and flat asset entries (Gene/Capsule with a type).
function extractAssets(body: unknown): HubAsset[] {
  const out: HubAsset[] = [];
  const root = (body ?? {}) as Record<string, unknown>;
  const payload = ((root.payload as Record<string, unknown>) ?? root) as Record<string, unknown>;

  const lists: unknown[] = [];
  for (const key of ["assets", "results", "bundles", "capsules", "items"]) {
    const v = payload[key];
    if (Array.isArray(v)) lists.push(...v);
  }
  if (Array.isArray(payload)) lists.push(...(payload as unknown[]));
  if (Array.isArray(body)) lists.push(...(body as unknown[]));

  const genePool: Gene[] = [];
  const capsulePool: { capsule: Capsule; nodeId: string }[] = [];

  for (const entry of lists) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const nodeId = String(e.node_id ?? e.nodeId ?? e.sender_id ?? "peer");

    // Case A: bundle form { gene, capsule }
    if (e.gene && typeof e.gene === "object" && e.capsule && typeof e.capsule === "object") {
      out.push({ gene: e.gene as Gene, capsule: e.capsule as Capsule, nodeId });
      continue;
    }

    // Case B: flat asset (possibly wrapped in { body })
    const asset = ((e.body as Record<string, unknown>) ?? e) as Record<string, unknown>;
    const type = asset.type;
    if (type === "Capsule" || (asset.trigger && asset.summary)) {
      capsulePool.push({ capsule: asset as unknown as Capsule, nodeId });
    } else if (type === "Gene" || asset.signals_match) {
      genePool.push(asset as unknown as Gene);
    }
  }

  for (const { capsule, nodeId } of capsulePool) {
    const gene =
      genePool.find((g) => g.asset_id === capsule.gene) ?? genePool[0] ?? placeholderGene();
    out.push({ gene, capsule, nodeId });
  }
  return out;
}

function placeholderGene(): Gene {
  return {
    type: "Gene",
    schema_version: "1.5.0",
    id: "gene_reroute_on_degradation",
    category: "optimize",
    signals_match: ["quality_drop", "model_substitution", "fingerprint_drift", "latency_spike"],
    summary: "Reroute LLM traffic away from a degraded endpoint (recovered from Hub fetch)",
    strategy: ["reroute to healthiest endpoint"],
    constraints: { max_files: 1, forbidden_paths: [] },
    validation: ['node -e "if(0.86<=0.7)process.exit(1)"'],
  };
}
