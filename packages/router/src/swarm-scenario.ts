import { loadConfig } from "@driftsentinel/core";
import { LocalHub, RemoteHub, EvoMapClient, type HubPort } from "@driftsentinel/evomap";
import { SwarmNode } from "./swarm.js";
import { rmSync } from "node:fs";

// Stage-5 acceptance: two nodes A and B over a shared Hub.
//   1. INHERITANCE: A confirms degradation + publishes; B starts up, fetches
//      A's capsule, and pre-avoids the bad endpoint WITHOUT probing it first.
//   2. L2 CONSENSUS: A is only suspect; B independently re-probes and confirms;
//      consensus upgrades to confirmed (>=2 independent nodes).
//
// Hub selection (HubPort): LocalHub by default (offline, mock endpoints).
// Set SWARM_REMOTE=1 to run over the REAL EvoMap Hub via RemoteHub
// (/a2a/publish + /a2a/fetch). DRIFT_PUBLISH=1 additionally enables real
// /a2a/publish writes; otherwise RemoteHub validates (dry-run) only.
// Usage: tsx src/swarm-scenario.ts [config]

async function main() {
  const configPath = process.argv[2] ?? "config.demo.yaml";
  const n = Number(process.env.PROBE_N ?? 5);
  const useRemote = process.env.SWARM_REMOTE === "1";

  // fresh state
  rmSync("data/hub.json", { force: true });
  rmSync("data/remote-hub-mirror.json", { force: true });
  rmSync("data/nodeA.db", { force: true });
  rmSync("data/nodeA.db-wal", { force: true });
  rmSync("data/nodeA.db-shm", { force: true });
  rmSync("data/nodeB.db", { force: true });
  rmSync("data/nodeB.db-wal", { force: true });
  rmSync("data/nodeB.db-shm", { force: true });

  const cfgClean = loadConfig(configPath);
  cfgClean.demo.inject.enabled = false;
  const cfgInject = loadConfig(configPath);
  cfgInject.demo.inject.enabled = true;
  const target = cfgInject.demo.inject.target!;

  let hub: HubPort;
  if (useRemote) {
    const realPublish = process.env.DRIFT_PUBLISH === "1";
    const client = new EvoMapClient({
      hubUrl: cfgInject.hub.baseUrl,
      credPath: cfgInject.node.idFile,
      mockPublish: !realPublish,
      model: "driftsentinel",
      name: "DriftSentinel Swarm",
    });
    hub = new RemoteHub(client, new LocalHub("data/remote-hub-mirror.json"), realPublish);
    console.log(
      `Hub: RemoteHub -> ${cfgInject.hub.baseUrl} (publish=${realPublish ? "real" : "validate-only"})`,
    );
  } else {
    const local = new LocalHub("data/hub.json");
    local.reset();
    hub = local;
    console.log("Hub: LocalHub (offline mirror)");
  }

  // === Part 1: Node A detects + publishes ===
  console.log("=== Part 1: Node A detects degradation and publishes ===");
  const nodeA = new SwarmNode("node_A", cfgInject, hub, "data/nodeA.db", 60);

  // warmup clean baseline for A
  const cfgAClean = { ...cfgInject, demo: { inject: { enabled: false } } } as typeof cfgInject;
  const nodeAClean = new SwarmNode("node_A", cfgAClean, hub, "data/nodeA.db", 60);
  for (let c = 0; c < 4; c++) {
    const r = await nodeAClean.probeEndpoint(target, n);
    nodeAClean.ingest(r);
  }
  // now with injection on
  let aVerdict;
  for (let c = 0; c < 2; c++) {
    const r = await nodeA.probeEndpoint(target, n);
    aVerdict = nodeA.ingest(r);
    console.log(`  A cycle ${c}: ${target} score=${r.score.toFixed(1)} -> ${aVerdict.level}`);
    if (aVerdict.level === "confirmed") break;
  }
  const best = cfgInject.endpoints.find((e) => e.id !== target)!.id;
  await nodeA.publishVerdict(aVerdict!, "code", best);
  console.log(`  A published degradation capsule for ${target} (recommend ${best})`);

  // === Part 2: Node B inherits BEFORE probing the bad endpoint ===
  console.log("\n=== Part 2: Node B starts up and inherits A's knowledge ===");
  const nodeB = new SwarmNode("node_B", cfgInject, hub, "data/nodeB.db", 55);
  const inherited = await nodeB.inheritKnownRisks();
  console.log(`  B inherited high-risk endpoints (no probing yet): [${inherited.join(", ")}]`);
  const avoidedBlind = inherited.includes(target);

  // === Part 3: L2 consensus — B independently re-probes to confirm ===
  console.log("\n=== Part 3: L2 consensus — B independently re-probes ===");
  // B warms a clean baseline too, then probes under injection (different random variants)
  const cfgBClean = { ...cfgInject, demo: { inject: { enabled: false } } } as typeof cfgInject;
  const nodeBClean = new SwarmNode("node_B", cfgBClean, hub, "data/nodeB.db", 55);
  for (let c = 0; c < 4; c++) {
    const r = await nodeBClean.probeEndpoint(target, n);
    nodeBClean.ingest(r);
  }
  let bVerdict;
  for (let c = 0; c < 2; c++) {
    const r = await nodeB.probeEndpoint(target, n);
    bVerdict = nodeB.ingest(r);
    if (bVerdict.level === "confirmed") break;
  }
  console.log(`  B independent verdict: ${bVerdict!.level} (z=${bVerdict!.delta.toFixed(2)})`);
  await nodeB.publishVerdict(bVerdict!, "code", best);

  const consensus = await nodeB.reachConsensus(bVerdict!, "code");
  console.log(
    `  consensus: ${consensus.consensusLevel} nodes=${consensus.consensusNodes} ` +
      `confidence=${consensus.confidence.toFixed(2)} conflict=${consensus.conflict}`,
  );

  console.log("\n=== Result ===");
  const pass =
    avoidedBlind &&
    consensus.consensusLevel === "confirmed" &&
    consensus.consensusNodes >= 2;
  if (pass) {
    console.log(
      `PASS: B inherited risk for ${target} without blind probing; ` +
        `L2 consensus=confirmed across ${consensus.consensusNodes} independent nodes`,
    );
  } else {
    console.log(
      `FAIL: inherited=${avoidedBlind} consensus=${consensus.consensusLevel} nodes=${consensus.consensusNodes}`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
