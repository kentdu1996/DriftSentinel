import type {
  ChatResult,
  Dimension,
  ProbeResult,
  TestItem,
} from "@driftsentinel/core";
import { median, percentile } from "@driftsentinel/core";
import type { UnifiedClient } from "./client.js";
import { grade } from "./grader.js";
import { buildFingerprint } from "./fingerprint.js";

const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  code: 0.3,
  math: 0.25,
  instruct: 0.2,
  fact: 0.15,
  longctx: 0.1,
};

const CANARY_PROMPT =
  "In exactly two sentences, explain what a hash map is and give one real-world analogy.";

export interface RunOptions {
  samples: number; // N repeats for median
  fingerprintSamples: number; // high-temp samples for behavior fingerprint
}

export async function runProbe(
  client: UnifiedClient,
  items: TestItem[],
  opts: RunOptions,
): Promise<ProbeResult> {
  const perItemScores: { dim: Dimension; weight: number; score: number }[] = [];
  const latencies: number[] = [];
  const firstTokens: number[] = [];

  for (const item of items) {
    const runs: number[] = [];
    for (let i = 0; i < opts.samples; i++) {
      let res: ChatResult;
      try {
        res = await client.chat(
          [
            { role: "system", content: "You are a precise assistant. Answer directly." },
            { role: "user", content: item.promptRender },
          ],
          { temperature: 0 },
        );
      } catch (e) {
        runs.push(0);
        continue;
      }
      latencies.push(res.latencyMs);
      firstTokens.push(res.firstTokenMs);
      const g = await grade(item, res.text);
      runs.push(g.score);
    }
    perItemScores.push({
      dim: item.dimension,
      weight: item.weight,
      score: median(runs),
    });
  }

  // Aggregate by dimension.
  const byDimension: Partial<Record<Dimension, number>> = {};
  const dimGroups = new Map<Dimension, { sum: number; w: number }>();
  for (const s of perItemScores) {
    const g = dimGroups.get(s.dim) ?? { sum: 0, w: 0 };
    g.sum += s.score * s.weight;
    g.w += s.weight;
    dimGroups.set(s.dim, g);
  }
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const [dim, g] of dimGroups) {
    const dimScore = g.w ? g.sum / g.w : 0;
    byDimension[dim] = dimScore;
    const w = DIMENSION_WEIGHTS[dim];
    weightedTotal += dimScore * w;
    totalWeight += w;
  }
  const score = totalWeight ? (weightedTotal / totalWeight) * 100 : 0;

  // Behavior fingerprint: high-temp samples of the canary prompt.
  const fpSamples: ChatResult[] = [];
  for (let i = 0; i < opts.fingerprintSamples; i++) {
    try {
      const res = await client.chat([{ role: "user", content: CANARY_PROMPT }], {
        temperature: 0.9,
        logprobs: true,
        maxTokens: 200,
      });
      fpSamples.push(res);
    } catch {
      /* skip failed sample */
    }
  }
  const fingerprint =
    fpSamples.length > 0
      ? buildFingerprint(fpSamples)
      : { vector: [], meta: { has_logprobs: 0 } };

  return {
    endpointId: client.endpoint.id,
    ts: Date.now(),
    score,
    byDimension,
    fingerprint,
    latencyP50: median(latencies),
    latencyP95: percentile(latencies, 95),
    firstTokenP50: median(firstTokens),
    samples: opts.samples,
  };
}
