import { test } from "node:test";
import assert from "node:assert/strict";
import { mutateRoute, Router, type EndpointHealth } from "../src/router.js";
import type { GenesFile } from "@driftsentinel/core";

test("mutateRoute drains degraded endpoint to zero", () => {
  const health: EndpointHealth[] = [
    { endpointId: "good", elo: 1500, healthy: true },
    { endpointId: "bad", elo: 1300, healthy: false },
  ];
  const r = mutateRoute(health, 0.7, 0.3)!;
  assert.equal(r.best, "good");
  assert.equal(r.weights["bad"], 0);
  assert.equal(r.weights["good"], 1); // only one healthy -> gets all
});

test("mutateRoute 70/30 split across healthy", () => {
  const health: EndpointHealth[] = [
    { endpointId: "a", elo: 1600, healthy: true },
    { endpointId: "b", elo: 1400, healthy: true },
    { endpointId: "c", elo: 1200, healthy: false },
  ];
  const r = mutateRoute(health, 0.7, 0.3)!;
  assert.equal(r.best, "a");
  assert.equal(r.weights["a"], 0.7);
  assert.equal(r.weights["c"], 0);
  assert.ok(Math.abs(r.weights["b"] - 0.3) < 1e-9);
  const sum = Object.values(r.weights).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("mutateRoute returns undefined when no healthy endpoint", () => {
  const health: EndpointHealth[] = [{ endpointId: "x", elo: 1000, healthy: false }];
  assert.equal(mutateRoute(health, 0.7, 0.3), undefined);
});

test("Router.route returns best for single-weight entry", () => {
  const genes: GenesFile = {
    version: 1,
    routes: { code: { best: "a", weights: { a: 1, b: 0 } } },
    updatedAt: 0,
  };
  const router = new Router(genes);
  // with b weight 0, should essentially always pick a
  const picks = new Set<string>();
  for (let i = 0; i < 50; i++) picks.add(router.route("code")!);
  assert.ok(picks.has("a"));
  assert.ok(!picks.has("b"));
});
