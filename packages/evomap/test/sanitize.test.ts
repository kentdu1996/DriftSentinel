import assert from "node:assert/strict";
import test from "node:test";
import type { Capsule, Gene } from "@driftsentinel/core";
import { sanitizeBundle } from "../src/sanitize.js";

const gene: Gene = {
  type: "Gene",
  schema_version: "1.5.0",
  id: "gene_test",
  category: "optimize",
  signals_match: ["quality_drop"],
  summary: "Reroute a degraded endpoint",
  strategy: ["Drain traffic from degraded endpoint"],
  constraints: { max_files: 1, forbidden_paths: [".env"] },
  validation: ["pnpm test"],
};

const capsule: Capsule = {
  type: "Capsule",
  schema_version: "1.5.0",
  trigger: ["quality_drop"],
  gene: "sha256:test",
  summary: "Confirmed degradation and rerouted",
  confidence: 0.86,
  blast_radius: { files: 1, lines: 12 },
  outcome: { status: "success", score: 0.86 },
  success_streak: 1,
  env_fingerprint: { node_version: "v20", platform: "darwin", arch: "arm64" },
};

test("sanitizeBundle passes normal Gene/Capsule bundles", () => {
  const result = sanitizeBundle(gene, capsule);
  assert.equal(result.safe, true);
  assert.equal(result.hits.length, 0);
  assert.ok(result.checkedFields > 0);
});

test("sanitizeBundle blocks sensitive keys and values without returning raw secrets", () => {
  const unsafe = {
    ...capsule,
    content: "temporary sk-evomap-secret12345678 from user@example.com",
    prompt: "do not publish this",
  } as Capsule & { prompt: string };
  const result = sanitizeBundle(gene, unsafe);
  assert.equal(result.safe, false);
  assert.ok(result.hits.some((hit) => hit.includes("key:prompt")));
  assert.ok(result.hits.some((hit) => hit.includes("pattern:api_key")));
  assert.ok(result.hits.some((hit) => hit.includes("pattern:email")));
  assert.ok(!result.hits.join(" ").includes("secret12345678"));
  assert.ok(!result.hits.join(" ").includes("user@example.com"));
});
