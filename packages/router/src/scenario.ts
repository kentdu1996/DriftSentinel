import { loadConfig, getDb, Dao } from "@driftsentinel/core";
import { makeClient, loadTestset, sampleAndRender, runProbe } from "@driftsentinel/probe";
import { DriftEngine } from "@driftsentinel/drift-engine";
import { GepLoop, GenesStore } from "./index.js";

// Stage-3 acceptance: warmup baseline, then inject degradation and let the GEP
// Loop auto-reroute. Verify genes.json updates and traffic drains the degraded
// endpoint. Offline (mock endpoints).
//
// Usage: tsx src/scenario.ts <configPath> [warmupCycles] [genesPath]

async function main() {
  const configPath = process.argv[2] ?? "config.demo.yaml";
  const warmup = Number(process.argv[3] ?? 4);
  const genesPath = process.argv[4] ?? "genes.json";
  const probeN = Number(process.env.PROBE_N ?? 5);

  const db = getDb();
  const dao = new Dao(db);

  // --- Warmup: build clean baselines + Elo, no injection ---
  const cfgClean = loadConfig(configPath);
  cfgClean.demo.inject.enabled = false;
  const engine = new DriftEngine(dao, cfgClean);
  const items = loadTestset("testsets", cfgClean.probe.testsets);

  console.log(`\n=== Warmup ${warmup} clean cycles ===`);
  for (let c = 0; c < warmup; c++) {
    const results = [];
    for (const ep of cfgClean.endpoints) {
      dao.upsertEndpoint({ id: ep.id, baseUrl: ep.baseUrl, model: ep.model, platform: ep.platform });
      const r = await runProbe(makeClient(ep, cfgClean.demo.inject), sampleAndRender(items, probeN), {
        samples: cfgClean.probe.samples,
        fingerprintSamples: 2,
      });
      engine.ingest(r);
      results.push(r);
    }
    engine.updateRoundElo("code", results);
  }
  // seed an initial route so 70/30 has somewhere to start
  const elos = cfgClean.endpoints.map((e) => ({
    id: e.id,
    elo: dao.getElo(e.id, "code") ?? 1400,
  }));
  elos.sort((a, b) => b.elo - a.elo);
  new GenesStore(genesPath).setRoute("code", {
    best: elos[0].id,
    weights: Object.fromEntries(
      cfgClean.endpoints.map((e, i) => [e.id, i === 0 ? 0.7 : 0.3 / (elos.length - 1)]),
    ),
  });
  console.log(`  initial best route: ${elos[0].id}`);

  // --- Inject + run GEP Loop ---
  const cfgInject = loadConfig(configPath);
  cfgInject.demo.inject.enabled = true;
  const target = cfgInject.demo.inject.target!;
  const loop = new GepLoop(cfgInject, { dao, genesPath }, { configPath, dimension: "code", probeN });

  console.log(`\n=== Inject degradation on ${target}, run GEP Loop ===`);
  let rerouted = false;
  for (let c = 0; c < 3 && !rerouted; c++) {
    const out = await loop.runCycle();
    console.log(
      `  loop cycle ${c}: confirmed=[${out.confirmed.map((v) => v.endpointId).join(",")}] rerouted=${out.rerouted}`,
    );
    rerouted = out.rerouted;
  }

  // --- Verify genes.json ---
  const genes = new GenesStore(genesPath).load();
  const route = genes.routes.code;
  console.log("\n=== genes.json after loop ===");
  console.log(`  version=${genes.version} best=${route.best}`);
  console.log(`  weights=${JSON.stringify(route.weights)}`);

  const drainedWeight = route.weights[target] ?? 1;
  console.log("\n=== Result ===");
  if (rerouted && route.best !== target && drainedWeight === 0) {
    console.log(`PASS: rerouted away from ${target}; its traffic weight=0; best=${route.best}`);
  } else {
    console.log(
      `FAIL: rerouted=${rerouted} best=${route.best} ${target}.weight=${drainedWeight}`,
    );
    process.exit(1);
  }
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
