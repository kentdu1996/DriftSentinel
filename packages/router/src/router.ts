import type {
  Dimension,
  GenesFile,
  RouteEntry,
} from "@driftsentinel/core";

export interface EndpointHealth {
  endpointId: string;
  elo: number;
  healthy: boolean; // false if confirmed-degraded
}

// 70/30 routing: weights are baked into genes.json by mutateRoute.
export class Router {
  constructor(private genes: GenesFile) {}

  // Pick an endpoint for a task using weighted random selection.
  route(task: Dimension): string | undefined {
    const entry = this.genes.routes[task];
    if (!entry) return undefined;
    const weights = entry.weights;
    const ids = Object.keys(weights);
    if (ids.length === 0) return entry.best;
    const r = Math.random();
    let acc = 0;
    for (const id of ids) {
      acc += weights[id];
      if (r <= acc) return id;
    }
    return entry.best;
  }
}

// Mutate: build a candidate route entry for a task.
// Best healthy endpoint gets stableRatio; remaining healthy share exploreRatio.
// A degraded endpoint is fully drained (weight 0).
export function mutateRoute(
  health: EndpointHealth[],
  stableRatio: number,
  exploreRatio: number,
): RouteEntry | undefined {
  const healthy = health.filter((h) => h.healthy);
  if (healthy.length === 0) return undefined;

  healthy.sort((a, b) => b.elo - a.elo);
  const best = healthy[0];
  const others = healthy.slice(1);

  const weights: Record<string, number> = {};
  for (const h of health) weights[h.endpointId] = 0; // drained by default

  if (others.length === 0) {
    weights[best.endpointId] = 1;
  } else {
    weights[best.endpointId] = stableRatio;
    // distribute exploreRatio across other healthy endpoints by Elo share
    const eloSum = others.reduce((a, h) => a + h.elo, 0) || others.length;
    for (const h of others) {
      const share = (h.elo || 1) / eloSum;
      weights[h.endpointId] = exploreRatio * share;
    }
  }

  return { best: best.endpointId, weights };
}
