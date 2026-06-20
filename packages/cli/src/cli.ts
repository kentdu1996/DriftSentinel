#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { parse, stringify } from "yaml";
import type { AppConfig, Dimension, EndpointConfig, Platform } from "@driftsentinel/core";
import { Dao, loadConfig, openDb } from "@driftsentinel/core";
import { DriftEngine } from "@driftsentinel/drift-engine";
import { GepLoop } from "@driftsentinel/router";
import { loadTestset, makeClient, runProbe, sampleAndRender } from "@driftsentinel/probe";
import { EvoMapClient } from "@driftsentinel/evomap";

type Args = Record<string, string | boolean>;

interface RawConfig {
  node?: { id_file?: string };
  hub?: { base_url?: string; auto_publish?: boolean };
  endpoints?: Array<{
    id: string;
    base_url: string;
    api_key_env: string;
    model: string;
    platform: Platform;
  }>;
  probe?: { interval_min?: number; jitter_min?: number; samples?: number; testsets?: Dimension[] };
  drift?: { z_suspect?: number; z_confirm?: number; fp_cosine_threshold?: number; latency_p95_jump?: number };
  router?: { stable_ratio?: number; explore_ratio?: number };
  demo?: { inject?: { enabled?: boolean; target?: string; mode?: string; weak_model?: string; latency_ms?: number } };
}

const root = findWorkspaceRoot(process.cwd());
process.chdir(root);

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();
  const [cmd, sub, ...rest] = argv;
  const tail = [sub, ...rest].filter(Boolean);
  const args = parseArgs(cmd === "endpoint" ? rest : tail);

  if (!cmd || cmd === "help" || cmd === "--help") return usage();
  if (cmd === "init") return initConfig(args);
  if (cmd === "endpoint" && sub === "add") return endpointAdd(args);
  if (cmd === "endpoint" && sub === "list") return endpointList(args);
  if (cmd === "endpoint" && sub === "check") return endpointCheck(args);
  if (cmd === "eval") return evalEndpoints(args);
  if (cmd === "compare") return compareEndpoints(positionals(tail), args);
  if (cmd === "run-cycle") return runCycle(args);
  if (cmd === "serve") return serve(args);
  if (cmd === "open") return openDashboard(args);
  if (cmd === "route") return route(args);
  if (cmd === "report") return report(args);
  if (cmd === "evomap" && sub === "register") return evomapRegister(args);
  if (cmd === "evomap" && sub === "status") return evomapStatus(args);
  if (cmd === "evomap" && sub === "models") return evomapModels(args);

  throw new Error(`unknown command: ${[cmd, sub].filter(Boolean).join(" ")}`);
}

function usage() {
  console.log(`DriftSentinel CLI

Usage:
  driftsentinel init [--config config.yaml] [--demo]
  driftsentinel endpoint add --id relay-a --base-url https://relay.example/v1 --model gpt-4o --api-key-env RELAY_A_KEY [--platform relay]
  driftsentinel endpoint list [--config config.yaml]
  driftsentinel endpoint check [--config config.yaml] [--smoke]
  driftsentinel eval [--config config.yaml] [--endpoint relay-a] [--suite code] [--n 8]
  driftsentinel compare endpoint-a endpoint-b [--config config.yaml] [--suite code] [--n 8]
  driftsentinel run-cycle [--config config.yaml]
  driftsentinel serve [--config config.yaml] [--port 8787]
  driftsentinel open [--url http://localhost:8787]
  driftsentinel route [--task code] [--db data/driftsentinel.db]
  driftsentinel report [--db data/driftsentinel.db] [--format markdown|json] [--out report.md]
  driftsentinel evomap register [--config config.evomap.yaml]
  driftsentinel evomap status [--config config.evomap.yaml]
  driftsentinel evomap models [--api-key-env EVOMAP_API_KEY]

Agent Guard:
  Start "driftsentinel serve", then point your Agent to:
    OPENAI_BASE_URL=http://localhost:8787/v1
  Optional routing task:
    X-DriftSentinel-Task: code
`);
}

function initConfig(args: Args) {
  const path = str(args.config, "config.yaml");
  if (existsSync(path) && !args.force) {
    throw new Error(`${path} already exists. Use --force to overwrite.`);
  }
  const demo = Boolean(args.demo);
  const raw: RawConfig = {
    node: { id_file: ".secrets/node.json" },
    hub: { base_url: "https://evomap.ai", auto_publish: false },
    endpoints: demo
      ? [
          { id: "official/strong", base_url: "mock://strong", api_key_env: "NONE", model: "gpt-strong", platform: "mock" },
          { id: "relay-x/suspect", base_url: "mock://relay", api_key_env: "NONE", model: "gpt-strong", platform: "mock" },
          { id: "relay-b/healthy", base_url: "mock://strong", api_key_env: "NONE", model: "gpt-strong", platform: "mock" },
        ]
      : [],
    probe: { interval_min: 15, jitter_min: 5, samples: 3, testsets: ["code"] },
    drift: { z_suspect: -1, z_confirm: -2, fp_cosine_threshold: 0.15, latency_p95_jump: 0.5 },
    router: { stable_ratio: 0.7, explore_ratio: 0.3 },
    demo: {
      inject: demo
        ? { enabled: false, target: "relay-x/suspect", mode: "swap_model", weak_model: "gpt-weak-7b" }
        : { enabled: false },
    },
  };
  writeFileSync(path, stringify(raw), "utf8");
  console.log(`created ${path}`);
  if (!demo) {
    console.log("next: driftsentinel endpoint add --id relay-a --base-url https://.../v1 --model gpt-4o --api-key-env RELAY_A_KEY");
  }
}

function endpointAdd(args: Args) {
  const path = str(args.config, "config.yaml");
  const id = required(args, "id");
  const baseUrl = required(args, "base-url");
  const model = required(args, "model");
  const apiKeyEnv = required(args, "api-key-env");
  const platform = str(args.platform, "relay") as Platform;
  if (!["openai", "anthropic", "relay", "mock"].includes(platform)) {
    throw new Error(`invalid --platform ${platform}`);
  }

  const raw = readRaw(path);
  raw.endpoints = (raw.endpoints ?? []).filter((e) => e.id !== id);
  raw.endpoints.push({ id, base_url: baseUrl, api_key_env: apiKeyEnv, model, platform });
  raw.demo = raw.demo ?? { inject: { enabled: false } };
  raw.demo.inject = { ...(raw.demo.inject ?? {}), enabled: false };
  writeFileSync(path, stringify(raw), "utf8");
  console.log(`added endpoint ${id} (${platform}, ${model}) to ${path}`);
  console.log(`make sure ${apiKeyEnv} is set in your shell before running eval/check.`);
}

function endpointList(args: Args) {
  const cfg = loadConfig(str(args.config, "config.yaml"));
  for (const ep of cfg.endpoints) {
    const key = ep.apiKeyEnv === "NONE" || Boolean(process.env[ep.apiKeyEnv]) ? "ok" : "missing-key";
    console.log(`${ep.id}\t${ep.platform}\t${ep.model}\t${ep.baseUrl}\t${ep.apiKeyEnv}:${key}`);
  }
}

async function endpointCheck(args: Args) {
  const cfg = loadConfig(str(args.config, "config.yaml"));
  let failed = 0;
  for (const ep of cfg.endpoints) {
    const envOk = ep.platform === "mock" || ep.apiKeyEnv === "NONE" || Boolean(process.env[ep.apiKeyEnv]);
    if (!envOk) failed++;
    console.log(`${envOk ? "OK" : "MISSING"} ${ep.id}: api_key_env=${ep.apiKeyEnv}`);
    if (envOk && args.smoke) {
      try {
        const client = makeClient(ep, cfg.demo.inject);
        const out = await client.chat([{ role: "user", content: "Reply with OK." }], { maxTokens: 16, timeoutMs: 10_000 });
        console.log(`  smoke: ${out.text.slice(0, 80)} (${out.latencyMs}ms)`);
      } catch (e) {
        failed++;
        console.log(`  smoke failed: ${err(e)}`);
      }
    }
  }
  if (failed > 0) process.exitCode = 1;
}

async function evalEndpoints(args: Args) {
  const configPath = str(args.config, "config.yaml");
  const cfg = loadConfig(configPath);
  const db = openDb(str(args.db, "data/driftsentinel.db"));
  const dao = new Dao(db);
  const engine = new DriftEngine(dao, cfg);
  const endpoints = selectEndpoints(cfg, args.endpoint ? [String(args.endpoint)] : []);
  const results = [];
  for (const ep of endpoints) {
    dao.upsertEndpoint({ id: ep.id, baseUrl: ep.baseUrl, model: ep.model, platform: ep.platform });
    const result = await probeOne(cfg, ep, args);
    const verdict = engine.ingest(result);
    results.push(result);
    printEval(ep, result.score, result.latencyP95, verdict.level, verdict.delta);
  }
  engine.updateRoundElo(str(args.suite, "code") as Dimension, results);
  db.close();
}

async function compareEndpoints(names: string[], args: Args) {
  const cfg = loadConfig(str(args.config, "config.yaml"));
  const endpoints = selectEndpoints(cfg, names.filter((n) => !n.startsWith("--")));
  const rows = [];
  for (const ep of endpoints) {
    const result = await probeOne(cfg, ep, args);
    rows.push({ ep, score: result.score, latency: result.latencyP95 });
  }
  rows.sort((a, b) => b.score - a.score || a.latency - b.latency);
  console.log("Rank\tEndpoint\tModel\tScore\tp95");
  rows.forEach((r, i) => console.log(`${i + 1}\t${r.ep.id}\t${r.ep.model}\t${r.score.toFixed(1)}\t${r.latency}ms`));
}

async function runCycle(args: Args) {
  if (args.local) {
    const configPath = str(args.config, "config.yaml");
    const cfg = loadConfig(configPath);
    const db = openDb(str(args.db, "data/driftsentinel.db"));
    const loop = new GepLoop(cfg, { dao: new Dao(db), genesPath: str(args.genes, "genes.json") }, { configPath, dimension: str(args.suite, "code") as Dimension, probeN: numArg(args.n, 5) });
    const out = await loop.runCycle();
    db.close();
    console.log(`confirmed=[${out.confirmed.map((v) => v.endpointId).join(",")}] rerouted=${out.rerouted}`);
    return;
  }
  const url = str(args.url, "http://localhost:8787");
  const res = await fetch(`${url.replace(/\/$/, "")}/api/run-cycle`, { method: "POST" });
  console.log(await res.text());
}

function serve(args: Args) {
  const port = str(args.port, "8787");
  const config = str(args.config, "config.yaml");
  const env = { ...process.env, PORT: port, DRIFT_CONFIG: config, DRIFT_DAEMON: args.daemon ? "1" : "0" };
  const child = spawn("pnpm", ["--filter", "@driftsentinel/server", "start"], { cwd: root, env, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function openDashboard(args: Args) {
  const url = str(args.url, "http://localhost:8787");
  spawn("open", [url], { stdio: "inherit" });
  console.log(`opened ${url}`);
}

function route(args: Args) {
  const db = openDb(str(args.db, "data/driftsentinel.db"));
  const rows = db.prepare(`SELECT * FROM routes ORDER BY task`).all() as Record<string, unknown>[];
  db.close();
  const task = str(args.task, "");
  for (const r of rows.filter((x) => !task || x.task === task)) {
    console.log(`${r.task}: best=${r.best_endpoint} weights=${r.weights}`);
  }
  if (rows.length === 0) console.log("no route yet. Run driftsentinel eval or driftsentinel run-cycle first.");
}

function report(args: Args) {
  const db = openDb(str(args.db, "data/driftsentinel.db"));
  const verdicts = db.prepare(`SELECT * FROM drift_verdicts ORDER BY ts DESC LIMIT 50`).all() as Record<string, unknown>[];
  const routes = db.prepare(`SELECT * FROM routes ORDER BY task`).all() as Record<string, unknown>[];
  const assets = db.prepare(`SELECT * FROM evomap_assets ORDER BY ts DESC LIMIT 50`).all() as Record<string, unknown>[];
  const endpoints = db.prepare(`SELECT * FROM endpoints ORDER BY id`).all() as Record<string, unknown>[];
  db.close();
  const payload = {
    generatedAt: new Date().toISOString(),
    endpoints,
    verdicts: verdicts.map((v) => ({ ...v, signals: parseJson(v.signals, []) })),
    routes: routes.map((r) => ({ ...r, weights: parseJson(r.weights, {}) })),
    assets: assets.map((a) => ({ ...a, body: parseJson(a.body, null) })),
  };
  const format = str(args.format, "markdown");
  const out = format === "json" ? JSON.stringify(payload, null, 2) : renderMarkdownReport(payload);
  const outPath = typeof args.out === "string" ? args.out : "";
  if (outPath) {
    writeFileSync(outPath, out, "utf8");
    console.log(`report written: ${outPath}`);
  } else {
    console.log(out);
  }
}

async function evomapRegister(args: Args) {
  const cfg = loadConfig(str(args.config, "config.evomap.yaml"));
  const client = new EvoMapClient({
    hubUrl: cfg.hub.baseUrl,
    credPath: cfg.node.idFile,
    mockPublish: true,
    model: "driftsentinel",
    name: "DriftSentinel Agent",
  });
  const id = await client.hello();
  console.log("EvoMap node registered or recovered.");
  console.log(`node_id: ${id.nodeId}`);
  console.log(`credential_file: ${client.credentialLocation()}`);
  console.log("canonical_files: ~/.evomap/node_id, ~/.evomap/node_secret");
  if (id.claimUrl) {
    console.log(`claim_url: ${id.claimUrl}`);
    console.log("Open claim_url in your browser to bind this node to your EvoMap account.");
  } else {
    console.log("claim_url: not returned. The node may already be known by the Hub.");
  }
}

async function evomapStatus(args: Args) {
  const cfg = loadConfig(str(args.config, "config.evomap.yaml"));
  const client = new EvoMapClient({
    hubUrl: cfg.hub.baseUrl,
    credPath: cfg.node.idFile,
    mockPublish: true,
    model: "driftsentinel",
    name: "DriftSentinel Agent",
  });
  const id = client.getIdentity();
  if (!id?.nodeSecret) {
    console.log("no local EvoMap node credentials found.");
    console.log("next: pnpm driftsentinel -- evomap register --config config.evomap.yaml");
    return;
  }
  console.log(`node_id: ${id.nodeId}`);
  console.log(`credential_file: ${client.credentialLocation()}`);
  console.log(`claim_url: ${id.claimUrl ?? "not cached"}`);
  console.log("secret: present (hidden)");
}

async function evomapModels(args: Args) {
  const envName = str(args["api-key-env"], "EVOMAP_API_KEY");
  const key = process.env[envName];
  if (!key) throw new Error(`missing ${envName}. Run: export ${envName}="sk-evomap-..."`);
  const res = await fetch("https://api.evomap.ai/v1/models", {
    headers: { authorization: `Bearer ${key}` },
  });
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  if (!res.ok) {
    console.log(JSON.stringify(body, null, 2));
    process.exitCode = 1;
    return;
  }
  for (const m of body.data ?? []) {
    if (m.id) console.log(m.id);
  }
}

async function probeOne(cfg: AppConfig, ep: EndpointConfig, args: Args) {
  const suite = str(args.suite, cfg.probe.testsets[0] ?? "code") as Dimension;
  const items = loadTestset("testsets", [suite]);
  if (items.length === 0) throw new Error(`no test items for suite ${suite}`);
  const n = Math.min(items.length, numArg(args.n, 8));
  const client = makeClient(ep, cfg.demo.inject);
  console.log(`[eval] ${ep.id}: ${n} ${suite} items x ${cfg.probe.samples}`);
  return runProbe(client, sampleAndRender(items, n), {
    samples: cfg.probe.samples,
    fingerprintSamples: 3,
  });
}

function printEval(ep: EndpointConfig, score: number, p95: number, level: string, delta: number) {
  const advice = level === "confirmed" ? "avoid for now" : level === "suspect" ? "watch closely" : "usable";
  console.log(`\nEndpoint: ${ep.id}`);
  console.log(`Model:    ${ep.model}`);
  console.log(`Score:    ${score.toFixed(1)}/100`);
  console.log(`Latency:  p95=${p95}ms`);
  console.log(`Status:   ${level} (${advice})`);
  if (delta) console.log(`Delta:    ${delta.toFixed(1)}`);
}

function selectEndpoints(cfg: AppConfig, ids: string[]) {
  if (ids.length === 0) return cfg.endpoints;
  const selected = cfg.endpoints.filter((e) => ids.includes(e.id));
  const missing = ids.filter((id) => !selected.some((e) => e.id === id));
  if (missing.length) throw new Error(`unknown endpoint(s): ${missing.join(", ")}`);
  return selected;
}

function readRaw(path: string): RawConfig {
  if (!existsSync(path)) throw new Error(`${path} does not exist. Run driftsentinel init first.`);
  return parse(readFileSync(path, "utf8")) as RawConfig;
}

function parseArgs(xs: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (!x.startsWith("--")) continue;
    const key = x.slice(2);
    const next = xs[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function positionals(xs: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x.startsWith("--")) {
      const next = xs[i + 1];
      if (next && !next.startsWith("--")) i++;
      continue;
    }
    out.push(x);
  }
  return out;
}

function parseJson(v: unknown, fallback: unknown): unknown {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return fallback;
  }
}

function renderMarkdownReport(payload: {
  generatedAt: string;
  endpoints: Record<string, unknown>[];
  verdicts: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  assets: Record<string, unknown>[];
}): string {
  const lines = [
    "# DriftSentinel Report",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    "## Endpoints",
    "",
    "| Endpoint | Model | Platform |",
    "|---|---|---|",
    ...payload.endpoints.map((e) => `| ${e.id ?? ""} | ${e.model ?? ""} | ${e.platform ?? ""} |`),
    "",
    "## Recent Verdicts",
    "",
    "| Time | Endpoint | Level | Delta | Signals |",
    "|---|---|---|---:|---|",
    ...payload.verdicts.slice(0, 20).map((v) => {
      const signals = Array.isArray(v.signals)
        ? v.signals.filter((s) => Boolean((s as { hit?: boolean }).hit)).map((s) => (s as { type?: string }).type).join("+")
        : "";
      return `| ${fmtTime(v.ts)} | ${v.endpoint_id ?? ""} | ${v.level ?? ""} | ${Number(v.delta ?? 0).toFixed(2)} | ${signals || "-"} |`;
    }),
    "",
    "## Routes",
    "",
    "| Task | Best Endpoint | Weights |",
    "|---|---|---|",
    ...payload.routes.map((r) => `| ${r.task ?? ""} | ${r.best_endpoint ?? ""} | \`${JSON.stringify(r.weights ?? {})}\` |`),
    "",
    "## EvoMap Publish Gate",
    "",
    "| Time | Kind | Status | Asset |",
    "|---|---|---|---|",
    ...payload.assets.slice(0, 20).map((a) => `| ${fmtTime(a.ts)} | ${a.kind ?? ""} | ${a.remote_status ?? ""} | ${a.asset_id ?? ""} |`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function fmtTime(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? new Date(n).toISOString() : "";
}

function required(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v) throw new Error(`missing --${key}`);
  return v;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

function numArg(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

function err(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function findWorkspaceRoot(start: string): string {
  let cur = start;
  while (true) {
    if (existsSync(join(cur, "pnpm-workspace.yaml"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return start;
    cur = parent;
  }
}

main().catch((e) => {
  console.error(err(e));
  process.exit(1);
});
