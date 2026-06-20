import { test } from "node:test";
import assert from "node:assert/strict";
import { detect } from "../src/detector.js";
import type { AppConfig, Baseline, ProbeResult } from "@driftsentinel/core";

const cfg: AppConfig["drift"] = {
  zSuspect: -1,
  zConfirm: -2,
  fpCosineThreshold: 0.15,
  latencyP95Jump: 0.5,
};

const baseline: Baseline = {
  endpointId: "ep",
  mu: 100,
  sigma: 5,
  n: 10,
  refFingerprint: [1, 0, 0],
  latencyRef: { p50: 600, p95: 800 },
  updatedAt: 0,
};

function pr(over: Partial<ProbeResult>): ProbeResult {
  return {
    endpointId: "ep",
    ts: Date.now(),
    score: 100,
    byDimension: { code: 1 },
    fingerprint: { vector: [1, 0, 0], meta: {} },
    latencyP50: 600,
    latencyP95: 800,
    firstTokenP50: 240,
    samples: 3,
    ...over,
  };
}

test("healthy probe -> normal", () => {
  const v = detect({ current: pr({}), baseline, recentLevels: [], cfg });
  assert.equal(v.level, "normal");
});

test("two signals (score+latency) -> confirmed", () => {
  const v = detect({
    current: pr({ score: 85, latencyP95: 2300 }), // z=-3, jump huge
    baseline,
    recentLevels: [],
    cfg,
  });
  assert.equal(v.level, "confirmed");
});

test("score+fingerprint -> confirmed", () => {
  const v = detect({
    current: pr({ score: 80, fingerprint: { vector: [0, 1, 0], meta: {} } }),
    baseline,
    recentLevels: [],
    cfg,
  });
  assert.equal(v.level, "confirmed");
});

test("single mild signal -> suspect", () => {
  const v = detect({
    current: pr({ score: 92 }), // z=-1.6, single, not extreme
    baseline,
    recentLevels: [],
    cfg,
  });
  assert.equal(v.level, "suspect");
});

test("latency-only jump -> suspect", () => {
  const v = detect({
    current: pr({ latencyP95: 2000 }),
    baseline,
    recentLevels: [],
    cfg,
  });
  assert.equal(v.level, "suspect");
});
