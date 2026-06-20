import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCode, grade } from "../src/grader.js";
import type { TestItem } from "@driftsentinel/core";

test("extractCode pulls from fenced block", () => {
  const t = "Here:\n```python\ndef f():\n    return 1\n```\nDone.";
  assert.equal(extractCode(t), "def f():\n    return 1");
});

test("extractCode falls back to raw", () => {
  assert.equal(extractCode("def f(): return 1"), "def f(): return 1");
});

test("numeric_tolerance grades last number", async () => {
  const item = {
    grader: { type: "numeric_tolerance", spec: "answer=72|tol=0.1" },
  } as TestItem;
  assert.equal((await grade(item, "The total is 72.")).score, 1);
  assert.equal((await grade(item, "The total is 71.")).score, 0);
});

test("exact grades multiple-choice letter", async () => {
  const item = { grader: { type: "exact", spec: "C" } } as TestItem;
  assert.equal((await grade(item, "The answer is C")).score, 1);
  assert.equal((await grade(item, "The answer is B")).score, 0);
});

test("keyword_hit grades fractional coverage", async () => {
  const item = { grader: { type: "keyword_hit", spec: "alpha|beta" } } as TestItem;
  assert.equal((await grade(item, "alpha only")).score, 0.5);
  assert.equal((await grade(item, "alpha and beta")).score, 1);
});

test("json_schema counts fields", async () => {
  const item = { grader: { type: "json_schema", spec: "fields=2" } } as TestItem;
  assert.equal((await grade(item, '{"a":1,"b":2}')).score, 1);
  assert.equal((await grade(item, '{"a":1}')).score, 0);
});
