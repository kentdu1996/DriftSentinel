import { test } from "node:test";
import assert from "node:assert/strict";
import { median, mean, stddev, percentile, cosineDistance } from "../src/util/stats.js";

test("median odd/even", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("mean and stddev", () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.ok(Math.abs(stddev([2, 4, 6]) - 2) < 1e-9);
});

test("percentile", () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
});

test("cosineDistance identical is 0", () => {
  assert.ok(cosineDistance([1, 2, 3], [1, 2, 3]) < 1e-9);
});

test("cosineDistance orthogonal is 1", () => {
  assert.ok(Math.abs(cosineDistance([1, 0], [0, 1]) - 1) < 1e-9);
});
