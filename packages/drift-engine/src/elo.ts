import type { Dimension } from "@driftsentinel/core";

const K = 32;
const DEFAULT_RATING = 1400;

function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

export interface EloStore {
  get(endpointId: string, dimension: Dimension): number | undefined;
  set(endpointId: string, dimension: Dimension, rating: number): void;
}

// Pairwise update on a single dimension: whoever scored higher "wins".
// Self-research only — never exposed as an EvoMap primitive.
export function updateElo(
  store: EloStore,
  dimension: Dimension,
  scores: { endpointId: string; score: number }[],
): Map<string, number> {
  const ratings = new Map<string, number>();
  for (const s of scores) {
    ratings.set(s.endpointId, store.get(s.endpointId, dimension) ?? DEFAULT_RATING);
  }

  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      const a = scores[i];
      const b = scores[j];
      const ra = ratings.get(a.endpointId)!;
      const rb = ratings.get(b.endpointId)!;
      // outcome: 1 if a wins, 0 if b wins, 0.5 tie
      let sa: number;
      if (a.score > b.score) sa = 1;
      else if (a.score < b.score) sa = 0;
      else sa = 0.5;
      const ea = expected(ra, rb);
      ratings.set(a.endpointId, ra + K * (sa - ea));
      ratings.set(b.endpointId, rb + K * (1 - sa - (1 - ea)));
    }
  }

  for (const [endpointId, rating] of ratings) {
    store.set(endpointId, dimension, rating);
  }
  return ratings;
}
