import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../src/consensus.js";
import type { NodeVerdict } from "@driftsentinel/core";

function nv(over: Partial<NodeVerdict>): NodeVerdict {
  return {
    nodeId: "nodeB",
    endpointId: "ep",
    dimension: "code",
    level: "confirmed",
    z: -2.5,
    reputation: 60,
    ts: Date.now(),
    ...over,
  };
}

test("suspect + peer confirmed -> confirmed high confidence", () => {
  const r = aggregate({
    localNodeId: "nodeA",
    localLevel: "suspect",
    localZ: -1.5,
    endpointId: "ep",
    dimension: "code",
    peerVerdicts: [nv({})],
  });
  assert.equal(r.consensusLevel, "confirmed");
  assert.ok(r.confidence >= 0.8);
  assert.equal(r.consensusNodes, 2);
});

test("suspect + only suspect peers -> stays suspect", () => {
  const r = aggregate({
    localNodeId: "nodeA",
    localLevel: "suspect",
    localZ: -1.5,
    endpointId: "ep",
    dimension: "code",
    peerVerdicts: [nv({ level: "suspect" })],
  });
  assert.equal(r.consensusLevel, "suspect");
  assert.equal(r.consensusNodes, 1);
});

test("confirmed + peer confirmed -> strong consensus", () => {
  const r = aggregate({
    localNodeId: "nodeA",
    localLevel: "confirmed",
    localZ: -3,
    endpointId: "ep",
    dimension: "code",
    peerVerdicts: [nv({}), nv({ nodeId: "nodeC", z: -2.2 })],
  });
  assert.equal(r.consensusLevel, "confirmed");
  assert.equal(r.consensusNodes, 3);
  assert.ok(r.confidence >= 0.85);
});

test("confirmed + peers all normal -> downgrade with conflict", () => {
  const r = aggregate({
    localNodeId: "nodeA",
    localLevel: "confirmed",
    localZ: -2.1,
    endpointId: "ep",
    dimension: "code",
    peerVerdicts: [nv({ level: "normal", z: 0.1 })],
  });
  assert.equal(r.consensusLevel, "suspect");
  assert.equal(r.conflict, true);
});

test("low-reputation peer cannot establish consensus", () => {
  const r = aggregate({
    localNodeId: "nodeA",
    localLevel: "suspect",
    localZ: -1.5,
    endpointId: "ep",
    dimension: "code",
    peerVerdicts: [nv({ reputation: 20 })],
  });
  assert.equal(r.consensusLevel, "suspect");
});

test("same-node duplicate verdicts counted once", () => {
  const r = aggregate({
    localNodeId: "nodeA",
    localLevel: "confirmed",
    localZ: -3,
    endpointId: "ep",
    dimension: "code",
    peerVerdicts: [
      nv({ nodeId: "nodeB", ts: 1 }),
      nv({ nodeId: "nodeB", ts: 2 }),
      nv({ nodeId: "nodeB", ts: 3 }),
    ],
  });
  assert.equal(r.consensusNodes, 2); // local + 1 distinct peer
});
