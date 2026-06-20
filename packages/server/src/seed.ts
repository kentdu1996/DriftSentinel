import type { AppConfig, Dao } from "@driftsentinel/core";
import { DriftEngine } from "@driftsentinel/drift-engine";
import { loadTestset, makeClient, runProbe, sampleAndRender } from "@driftsentinel/probe";

// Seed a clean local history so the demo opens with non-empty baselines and
// sparklines. It deliberately bypasses cfg.demo.inject: reset must return to a
// healthy world without mutating the real probe/drift/router paths.
export async function seedNormalHistory(
  cfg: AppConfig,
  dao: Dao,
  rounds = 8,
): Promise<void> {
  const items = loadTestset("testsets", cfg.probe.testsets);
  const engine = new DriftEngine(dao, cfg);

  for (let i = 0; i < rounds; i++) {
    const results = [];
    for (const ep of cfg.endpoints) {
      dao.upsertEndpoint({
        id: ep.id,
        baseUrl: ep.baseUrl,
        model: ep.model,
        platform: ep.platform,
      });
      const client = makeClient(ep, undefined);
      const result = await runProbe(client, sampleAndRender(items, 5), {
        samples: cfg.probe.samples,
        fingerprintSamples: 3,
      });
      engine.ingest(result);
      results.push(result);
    }
    engine.updateRoundElo("code", results);
  }
}
