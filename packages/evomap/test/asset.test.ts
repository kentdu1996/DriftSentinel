import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, computeAssetId } from "../src/canonical.js";
import { buildBundle } from "../src/asset-builder.js";
import type { Capsule, Gene } from "@driftsentinel/core";

test("canonicalize sorts keys recursively", () => {
  const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
  const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":3,"d":2},"b":1}');
});

test("canonicalize preserves array order", () => {
  assert.equal(canonicalize([3, 1, 2]), "[3,1,2]");
});

test("computeAssetId is deterministic and excludes asset_id", () => {
  const x = { type: "Gene", id: "g1", asset_id: "sha256:should-be-ignored" };
  const y = { id: "g1", type: "Gene" };
  assert.equal(computeAssetId(x), computeAssetId(y));
  assert.ok(computeAssetId(x).startsWith("sha256:"));
});

const gene: Gene = {
  type: "Gene",
  schema_version: "1.5.0",
  id: "gene_test",
  category: "optimize",
  signals_match: ["quality_drop"],
  summary: "test gene summary that is long enough",
  strategy: ["step one", "step two"],
  constraints: { max_files: 1, forbidden_paths: ["node_modules/"] },
  validation: ["node x.js"],
};

const capsule: Capsule = {
  type: "Capsule",
  schema_version: "1.5.0",
  trigger: ["quality_drop"],
  gene: "sha256:PENDING",
  summary: "test capsule summary that is definitely long enough for schema",
  confidence: 0.86,
  blast_radius: { files: 1, lines: 12 },
  outcome: { status: "success", score: 0.86 },
  success_streak: 1,
  env_fingerprint: { node_version: "v20", platform: "darwin", arch: "arm64" },
};

test("buildBundle links capsule.gene to gene asset_id", () => {
  const b = buildBundle(gene, capsule);
  assert.ok(b.gene.asset_id?.startsWith("sha256:"));
  assert.equal(b.capsule.gene, b.gene.asset_id);
  assert.ok(b.capsule.asset_id?.startsWith("sha256:"));
});

test("buildBundle with event links capsule_id + genes_used", () => {
  const b = buildBundle(gene, capsule, {
    type: "EvolutionEvent",
    intent: "optimize",
    outcome: { status: "success", score: 0.86 },
    mutations_tried: 2,
    total_cycles: 1,
  });
  assert.ok(b.event);
  assert.equal(b.event!.capsule_id, b.capsule.asset_id);
  assert.deepEqual(b.event!.genes_used, [b.gene.asset_id]);
});

test("buildBundle is stable across runs", () => {
  const a1 = buildBundle(gene, capsule);
  const a2 = buildBundle(gene, capsule);
  assert.equal(a1.gene.asset_id, a2.gene.asset_id);
  assert.equal(a1.capsule.asset_id, a2.capsule.asset_id);
});
