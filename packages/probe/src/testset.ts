import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Dimension, TestItem } from "@driftsentinel/core";

// Render a parameterized template into a concrete prompt.
// param rules: random_int(a,b) | random_even(a,b) | choice(x;y;z)
export function renderParams(params: Record<string, string>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, rule] of Object.entries(params)) {
    const ri = rule.match(/^random_int\((\d+),\s*(\d+)\)$/);
    const re = rule.match(/^random_even\((\d+),\s*(\d+)\)$/);
    const ch = rule.match(/^choice\((.+)\)$/);
    if (ri) {
      const [a, b] = [parseInt(ri[1], 10), parseInt(ri[2], 10)];
      out[key] = a + Math.floor(Math.random() * (b - a + 1));
    } else if (re) {
      let [a, b] = [parseInt(re[1], 10), parseInt(re[2], 10)];
      if (a % 2) a++;
      const span = Math.floor((b - a) / 2);
      out[key] = a + 2 * Math.floor(Math.random() * (span + 1));
    } else if (ch) {
      const opts = ch[1].split(";");
      out[key] = opts[Math.floor(Math.random() * opts.length)];
    } else {
      out[key] = rule;
    }
  }
  return out;
}

function fill(tpl: string, vals: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vals[k] ?? `{${k}}`));
}

// Load all test items for the given dimensions from testsets/<dim>/*.json.
export function loadTestset(root: string, dims: Dimension[]): TestItem[] {
  const items: TestItem[] = [];
  for (const dim of dims) {
    const dir = join(root, dim);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
      const arr: TestItem[] = Array.isArray(raw) ? raw : [raw];
      items.push(...arr);
    }
  }
  return items;
}

// Sample n items (with template re-rendering for randomization).
export function sampleAndRender(items: TestItem[], n: number): TestItem[] {
  const shuffled = [...items].sort(() => Math.random() - 0.5).slice(0, n);
  return shuffled.map((it) => {
    if (!it.params) return it;
    const vals = renderParams(it.params);
    return { ...it, promptRender: fill(it.template, vals) };
  });
}
