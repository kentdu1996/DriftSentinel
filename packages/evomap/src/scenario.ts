import { EvoMapClient, buildBundle } from "./index.js";
import type { Capsule, Gene } from "@driftsentinel/core";

// Stage-4 acceptance: register (hello), build a real schema-1.5.0 bundle,
// run REAL dry-run /a2a/validate against the Hub, then mock-publish.
//
// Usage: tsx src/scenario.ts [hubUrl]
//   DRIFT_REAL_HELLO=1  -> actually register on the Hub (writes .secrets/)
//   DRIFT_REAL_PUBLISH=1 -> actually publish (default: mocked)

const HUB = process.argv[2] ?? "https://evomap.ai";

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
  validation: ["node -e \"if(0.86<=0.7)process.exit(1)\""],
};

const capsule: Capsule = {
  type: "Capsule",
  schema_version: "1.5.0",
  trigger: ["quality_drop", "fingerprint_drift"],
  gene: "sha256:PENDING",
  summary:
    "Confirmed quantization swap on relay-x/gpt (score -2.4 sigma, fp cosine 0.21); rerouted code traffic to official endpoint, holdout score improved",
  confidence: 0.86,
  blast_radius: { files: 1, lines: 12 },
  outcome: { status: "success", score: 0.86 },
  success_streak: 1,
  strategy: [
    "Detect multi-signal degradation: score z<-2 sigma AND latency p95 jump AND fingerprint cosine>0.15",
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

async function main() {
  const client = new EvoMapClient({
    hubUrl: HUB,
    credPath: ".secrets/node.json",
    mockPublish: process.env.DRIFT_REAL_PUBLISH !== "1",
    model: "driftsentinel",
  });

  // 1. Register (only if explicitly enabled, to avoid surprise network writes)
  if (process.env.DRIFT_REAL_HELLO === "1") {
    console.log(`[hello] registering with ${HUB} ...`);
    const id = await client.hello();
    console.log(`[hello] node_id=${id.nodeId}`);
    if (id.claimUrl) console.log(`[hello] claim_url=${id.claimUrl} (give this to your human)`);
  } else {
    console.log("[hello] skipped (set DRIFT_REAL_HELLO=1 to register). Validate will run unauthenticated.");
  }

  // 2. Build a real bundle with correct asset_ids + EvolutionEvent
  const bundle = buildBundle(gene, capsule, {
    type: "EvolutionEvent",
    intent: "optimize",
    outcome: { status: "success", score: 0.86 },
    mutations_tried: 2,
    total_cycles: 1,
  });
  console.log(`[asset] gene=${bundle.gene.asset_id}`);
  console.log(`[asset] capsule=${bundle.capsule.asset_id} (gene ref=${bundle.capsule.gene})`);
  console.log(`[asset] event=${bundle.event?.asset_id}`);

  // 3. REAL dry-run validate (safe, no persistence)
  console.log(`\n[validate] POST ${HUB}/a2a/validate (dry-run) ...`);
  const v = await client.validate(bundle);
  console.log(`[validate] status=${v.status} ok=${v.ok}`);
  console.log(`[validate] body=${JSON.stringify(v.body)?.slice(0, 400)}`);

  // 4. Publish (mocked by default)
  const p = await client.publish(bundle);
  console.log(`\n[publish] mocked=${p.mocked} ok=${p.ok} bundleId=${p.bundleId.slice(0, 60)}...`);

  console.log("\n=== Result ===");
  console.log(
    `asset_ids computed: ${!!bundle.gene.asset_id && !!bundle.capsule.asset_id}; ` +
      `validate reached Hub: ${v.status !== 0}; publish handled: ${p.ok}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
