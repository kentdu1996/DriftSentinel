import {
  loadConfig,
  getDb,
  Dao,
  bus,
} from "@driftsentinel/core";
import { makeClient } from "./client.js";
import { loadTestset, sampleAndRender } from "./testset.js";
import { runProbe } from "./runner.js";

// One-shot probe: run the testset against all configured endpoints, store results.
async function main() {
  const configPath = process.argv[2] ?? "config.yaml";
  const cfg = loadConfig(configPath);
  const db = getDb();
  const dao = new Dao(db);

  const allItems = loadTestset("testsets", cfg.probe.testsets);
  if (allItems.length === 0) {
    console.error(
      "No test items found in testsets/. Run scripts/prepare-testsets first, or add seed items.",
    );
    process.exit(1);
  }

  const n = Math.min(allItems.length, Number(process.env.PROBE_N ?? 10));

  for (const ep of cfg.endpoints) {
    dao.upsertEndpoint({
      id: ep.id,
      baseUrl: ep.baseUrl,
      model: ep.model,
      platform: ep.platform,
    });
    const client = makeClient(ep, cfg.demo.inject);
    const items = sampleAndRender(allItems, n);
    console.log(`[probe] ${ep.id}: running ${items.length} items x ${cfg.probe.samples}...`);
    const result = await runProbe(client, items, {
      samples: cfg.probe.samples,
      fingerprintSamples: 3,
    });
    dao.insertProbeResult(result);
    bus.emit("probe.done", {
      endpointId: ep.id,
      score: result.score,
      ts: result.ts,
    });
    console.log(
      `[probe] ${ep.id}: score=${result.score.toFixed(1)} ` +
        `p50=${result.latencyP50}ms p95=${result.latencyP95}ms ` +
        `fp_logprobs=${result.fingerprint.meta.has_logprobs}`,
    );
  }
  console.log("[probe] done. Results stored in data/driftsentinel.db");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
