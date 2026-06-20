import type { ChatResult, Fingerprint } from "@driftsentinel/core";

// Behavior fingerprint (path B, always available) + optional logprob signal (path A).
// Input: multiple samples of the SAME canary prompt at high temperature.

function typeTokenRatio(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) return 0;
  return new Set(words).size / words.length;
}

function markdownDensity(text: string): number {
  const marks = (text.match(/[#*`>\-|]/g) ?? []).length;
  return text.length ? marks / text.length : 0;
}

function punctuationRate(text: string): number {
  const p = (text.match(/[.,;:!?]/g) ?? []).length;
  return text.length ? p / text.length : 0;
}

// Mean pairwise normalized edit distance across samples (output diversity).
function diversity(texts: string[]): number {
  if (texts.length < 2) return 0;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      sum += normalizedLevenshtein(texts[i], texts[j]);
      cnt++;
    }
  }
  return cnt ? sum / cnt : 0;
}

function normalizedLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return m === n ? 0 : 1;
  const prev = new Array(n + 1);
  const cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n] / Math.max(m, n);
}

function selfConsistency(texts: string[]): number {
  if (texts.length < 2) return 1;
  const norm = texts.map((t) => t.replace(/\s+/g, " ").trim().toLowerCase());
  const counts = new Map<string, number>();
  for (const t of norm) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return top / texts.length;
}

// Logprob-based confidence (path A): mean max-prob across tokens, if available.
function logprobSignal(result: ChatResult): number | undefined {
  if (!result.logprobs?.length) return undefined;
  const probs = result.logprobs.map((t) => Math.exp(t.logprob));
  return probs.reduce((a, b) => a + b, 0) / probs.length;
}

export function buildFingerprint(samples: ChatResult[]): Fingerprint {
  const texts = samples.map((s) => s.text);
  const lengths = texts.map((t) => t.length);
  const avgLen = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);

  const meta: Record<string, number> = {
    diversity: diversity(texts),
    self_consistency: selfConsistency(texts),
    ttr: typeTokenRatio(texts.join(" ")),
    md_density: markdownDensity(texts.join(" ")),
    punct_rate: punctuationRate(texts.join(" ")),
    avg_len_norm: Math.tanh(avgLen / 1000),
    first_token_norm: Math.tanh(
      samples.reduce((a, s) => a + s.firstTokenMs, 0) / (samples.length || 1) / 1000,
    ),
  };

  const lp = logprobSignal(samples[0]);
  if (lp !== undefined) {
    meta.logprob_conf = lp;
    meta.has_logprobs = 1;
  } else {
    meta.has_logprobs = 0;
  }

  const vector = [
    meta.diversity,
    meta.self_consistency,
    meta.ttr,
    meta.md_density,
    meta.punct_rate,
    meta.avg_len_norm,
    meta.first_token_norm,
    meta.has_logprobs ? meta.logprob_conf : 0,
  ];

  return { vector, meta };
}
