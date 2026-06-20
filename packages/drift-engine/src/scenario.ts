import { loadConfig, getDb, Dao, type AppConfig } from "@driftsentinel/core";
import { makeClient, loadTestset, sampleAndRender, runProbe } from "@driftsentinel/probe";
import { DriftEngine } from "@driftsentinel/drift-engine";

// Stage-2 acceptance: build a healthy baseline, then inject degradation and
// show the engine confirms it within <=2 cycles. Uses mock endpoints (offline).
//
// Usage: tsx src/scenario.ts <configPath> [warmupCycles]

async function probeAll(cfg: AppConfig, n: number) {
  const items = loadTestset("testsets", cfg.probe.testsets);
  const out = [];
  for (const ep of cfg.endpoints) {
    const client = makeClient(ep, cfg.demo.inject);
    const rendered = sampleAndRender(items, n);
    const r = await runProbe(client, rendered, {
      samples: cfg.probe.samples,
      fingerprintSamples: 3,
    });
    out.push(r);
  }
  return out;
}

async function main() {
  const configPath = process.argv[2] ?? "config.demo.yaml";
  const warmup = Number(process.argv[3] ?? 3);
  const n = Number(process.env.PROBE_N ?? 5);

  const cfgClean = loadConfig(configPath);
  cfgClean.demo.inject.enabled = false;

  const db = getDb();
  const dao = new Dao(db);
  for (const ep of cfgClean.endpoints) {
    dao.upsertEndpoint({ id: ep.id, baseUrl: ep.baseUrl, model: ep.model, platform: ep.platform });
  }
  const engine = new DriftEngine(dao, cfgClean);

  const target = cfgClean.demo.inject.target ?? cfgClean.endpoints[1].id;
  console.log(`\n=== Warmup: ${warmup} clean cycles (building baseline) ===`);
  for (let c = 0; c < warmup; c++) {
    const results = await probeAll(cfgClean, n);
    for (const r of results) {
      const v = engine.ingest(r);
      if (r.endpointId === target) {
        console.log(
          `  cycle ${c}: ${r.endpointId} score=${r.score.toFixed(1)} -> ${v.level} (z=${v.delta.toFixed(2)})`,
        );
      }
    }
    engine.updateRoundElo("code", results);
  }

  const base = dao.getBaseline(target)!;
  console.log(`  baseline[${target}]: mu=${base.mu.toFixed(1)} sigma=${base.sigma.toFixed(2)}`);

  console.log(`\n=== Inject degradation on ${target} ===`);
  const cfgInject = loadConfig(configPath);
  cfgInject.demo.inject.enabled = true;
  const injEngine = new DriftEngine(dao, cfgInject);

  let confirmedAt = -1;
  for (let c = 0; c < 3; c++) {
    const results = await probeAll(cfgInject, n);
    for (const r of results) {
      const v = injEngine.ingest(r);
      if (r.endpointId === target) {
        const hits = v.signals.filter((s) => s.hit).map((s) => s.type).join(",") || "none";
        console.log(
          `  cycle ${c}: ${r.endpointId} score=${r.score.toFixed(1)} p95=${r.latencyP95}ms ` +
            `-> ${v.level} [hits: ${hits}] (z=${v.delta.toFixed(2)})`,
        );
        if (v.level === "confirmed" && confirmedAt < 0) confirmedAt = c;
      }
    }
  }

  console.log("\n=== Result ===");
  if (confirmedAt >= 0 && confirmedAt <= 1) {
    console.log(`PASS: degradation confirmed at cycle ${confirmedAt} (<=2 cycles)`);
  } else if (confirmedAt >= 0) {
    console.log(`PARTIAL: confirmed at cycle ${confirmedAt} (slower than target)`);
  } else {
    console.log("FAIL: degradation not confirmed within 3 cycles");
    process.exit(1);
  }
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
