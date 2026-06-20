import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalHub } from "@driftsentinel/evomap";
import type { Capsule, Gene, NodeVerdict } from "@driftsentinel/core";
import { rmSync } from "node:fs";

const HUB = "data/test-hub.json";

function freshHub(): LocalHub {
  rmSync(HUB, { force: true });
  const h = new LocalHub(HUB);
  h.reset();
  return h;
}

const gene: Gene = {
  type: "Gene",
  schema_version: "1.5.0",
  id: "g",
  category: "optimize",
  signals_match: ["quality_drop"],
  summary: "x".repeat(20),
  strategy: ["s"],
  constraints: { max_files: 1, forbidden_paths: [] },
  validation: ['node -e "0"'],
};

function capsuleFor(ep: string): Capsule {
  return {
    type: "Capsule",
    schema_version: "1.5.0",
    trigger: ["quality_drop"],
    gene: "sha256:x",
    summary: `Confirmed degradation on ${ep} (z=-3)`,
    confidence: 0.86,
    blast_radius: { files: 1, lines: 1 },
    outcome: { status: "success", score: 0.86 },
    success_streak: 1,
    strategy: ["reroute"],
    env_fingerprint: { node_version: "v20", platform: "darwin", arch: "arm64" },
  };
}

test("LocalHub fetch matches by signal overlap", () => {
  const hub = freshHub();
  hub.publish(gene, capsuleFor("relay-x"), "node_A");
  const got = hub.fetch(["quality_drop"]);
  assert.equal(got.length, 1);
  assert.equal(got[0].nodeId, "node_A");
  assert.equal(hub.fetch(["unrelated_signal"]).length, 0);
});

test("LocalHub peerVerdicts excludes the asking node", () => {
  const hub = freshHub();
  const mk = (nodeId: string): NodeVerdict => ({
    nodeId,
    endpointId: "relay-x",
    dimension: "code",
    level: "confirmed",
    z: -3,
    reputation: 60,
    ts: Date.now(),
  });
  hub.recordVerdict(mk("node_A"));
  hub.recordVerdict(mk("node_B"));
  const peers = hub.peerVerdicts("relay-x", "code", "node_B");
  assert.equal(peers.length, 1);
  assert.equal(peers[0].nodeId, "node_A");
});
