import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  loadConfig,
  openDb,
  Dao,
  bus,
  type AppEventName,
} from "@driftsentinel/core";
import { EvoMapClient } from "@driftsentinel/evomap";
import { Queries } from "./queries.js";
import { Daemon } from "./daemon.js";
import { EvoMapBroadcaster } from "./broadcaster.js";
import { seedNormalHistory } from "./seed.js";
import { registerOpenAIProxy } from "./proxy.js";

const PORT = Number(process.env.PORT ?? 8787);
const CONFIG_PATH = process.env.DRIFT_CONFIG ?? "config.yaml";
const DB_PATH = process.env.DRIFT_DB ?? "data/driftsentinel.db";
const GENES_PATH = process.env.DRIFT_GENES ?? "genes.json";
const AUTO_DAEMON = process.env.DRIFT_DAEMON !== "0";
const PUBLISH_FOR_REAL = process.env.DRIFT_PUBLISH === "1";

async function main() {
  const root = findWorkspaceRoot(process.cwd());
  process.chdir(root);

  const cfg = loadConfig(CONFIG_PATH);
  const db = openDb(DB_PATH);
  const dao = new Dao(db);
  const q = new Queries(db);

  const evomap = new EvoMapClient({
    hubUrl: cfg.hub.baseUrl,
    credPath: cfg.node.idFile,
    mockPublish: !PUBLISH_FOR_REAL, // real publish ONLY when DRIFT_PUBLISH=1; auto_publish controls auto-broadcast, not mock/real
    model: "driftsentinel",
    name: "DriftSentinel Agent",
  });
  const broadcaster = new EvoMapBroadcaster(evomap, dao);
  const daemon = new Daemon(cfg, dao, {
    genesPath: GENES_PATH,
    configPath: CONFIG_PATH,
    broadcaster,
  });
  let seedJob: Promise<void> | undefined;
  let cycleJob: Promise<void> | undefined;

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  const dashboardDist = join(root, "packages/dashboard/dist");
  if (existsSync(dashboardDist)) {
    await app.register(fastifyStatic, {
      root: dashboardDist,
      prefix: "/",
    });
  }

  // ---- REST: dashboard reads ----
  app.get("/api/health", async () => ({ ok: true, ts: Date.now(), node: evomap.nodeId ?? null }));
  app.get("/api/config", async () => ({
    endpoints: cfg.endpoints.map((e) => ({ id: e.id, model: e.model, platform: e.platform })),
    hub: cfg.hub.baseUrl,
    autoPublish: cfg.hub.autoPublish,
    inject: cfg.demo.inject,
  }));

  app.get("/api/endpoints", async () => q.endpoints());
  app.get("/api/latest", async () => q.latestPerEndpoint());
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/history/:id",
    async (req) => q.history(req.params.id, Number(req.query.limit ?? 50)),
  );
  app.get<{ Params: { id: string } }>("/api/endpoint/:id", async (req, reply) => {
    const detail = q.endpointDetail(req.params.id);
    if (!detail.endpoint) return reply.code(404).send({ error: "endpoint not found" });
    return detail;
  });
  app.get("/api/baselines", async () => q.baselines());
  app.get<{ Querystring: { limit?: string } }>("/api/verdicts", async (req) =>
    q.recentVerdicts(Number(req.query.limit ?? 30)),
  );
  app.get<{ Querystring: { limit?: string } }>("/api/cycles", async (req) =>
    q.gepCycles(Number(req.query.limit ?? 30)),
  );
  app.get<{ Querystring: { limit?: string } }>("/api/timeline", async (req) =>
    q.timeline(Number(req.query.limit ?? 80)),
  );
  app.get("/api/routes", async () => q.routes());
  app.get("/api/elo", async () => q.elo());
  app.get("/api/board", async () => q.verdictBoard());
  app.get<{ Querystring: { limit?: string } }>("/api/assets", async (req) =>
    q.evomapAssets(Number(req.query.limit ?? 30)),
  );
  app.get<{ Querystring: { limit?: string } }>("/api/node-verdicts", async (req) =>
    q.nodeVerdicts(Number(req.query.limit ?? 50)),
  );

  // ---- REST: EvoMap public-verdict board (GDI leaderboard) ----
  app.get<{ Querystring: { limit?: string } }>("/api/ranked", async (req) => {
    const res = await evomap.ranked(Number(req.query.limit ?? 20));
    return { ok: res.ok, status: res.status, body: res.body };
  });
  app.get<{ Querystring: { signals?: string } }>("/api/search", async (req) => {
    const signals = (req.query.signals ?? "quality_drop,model_substitution").split(",");
    const res = await evomap.search(signals);
    return { ok: res.ok, status: res.status, body: res.body };
  });

  // ---- Agent Guard: OpenAI-compatible proxy ----
  registerOpenAIProxy(app, cfg, db);

  // ---- REST: control plane (HITL gates) ----
  app.post("/api/run-cycle", async () => {
    if (cycleJob) return { ok: true, running: true };
    cycleJob = daemon
      .runOnce()
      .then(() => {
        bus.emit("gep.phase", { ts: Date.now(), phase: "broadcast", status: "manual cycle completed" });
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        bus.emit("gep.phase", { ts: Date.now(), phase: "validate", status: `manual cycle failed: ${message}` });
        // eslint-disable-next-line no-console
        console.error("manual cycle failed", e);
      })
      .finally(() => {
        cycleJob = undefined;
      });
    return { ok: true, started: true };
  });
  app.post<{
    Body: {
      mode?: "swap_model" | "add_latency" | "truncate";
      target?: string;
      weakModel?: string;
      latencyMs?: number;
    };
  }>("/api/demo/inject", async (req) => {
    const b = req.body ?? {};
    const configured = cfg.demo.inject;
    cfg.demo.inject = {
      enabled: true,
      target: b.target ?? configured.target ?? "relay-x/suspect",
      mode: b.mode ?? configured.mode ?? "swap_model",
      weakModel: b.weakModel ?? configured.weakModel ?? "gpt-weak-7b",
      latencyMs: b.latencyMs ?? configured.latencyMs ?? 1500,
    };
    bus.emit("gep.phase", {
      ts: Date.now(),
      phase: "scan",
      status: `demo: injected ${cfg.demo.inject.mode} on ${cfg.demo.inject.target}`,
    });
    return { ok: true, inject: cfg.demo.inject };
  });
  app.post("/api/demo/recover", async () => {
    cfg.demo.inject = { enabled: false };
    bus.emit("gep.phase", { ts: Date.now(), phase: "scan", status: "demo: injection cleared" });
    return { ok: true, inject: cfg.demo.inject };
  });
  app.post("/api/demo/reset", async () => {
    if (seedJob) await seedJob;
    daemon.stop();
    dao.clearAll();
    cfg.demo.inject = { enabled: false };
    for (const ep of cfg.endpoints) {
      dao.upsertEndpoint({ id: ep.id, baseUrl: ep.baseUrl, model: ep.model, platform: ep.platform });
    }
    writeFileSync(
      join(root, GENES_PATH),
      JSON.stringify({ version: 0, routes: {}, updatedAt: Date.now() }, null, 2),
      "utf8",
    );
    if (isMockConfig(cfg)) {
      seedJob = seedNormalHistory(cfg, dao).finally(() => {
        seedJob = undefined;
      });
      await seedJob;
    }
    if (AUTO_DAEMON) {
      daemon.start(Math.max(10_000, cfg.probe.intervalMin * 60_000));
    }
    bus.emit("route.changed", { task: "code", best: "" });
    return { ok: true, seeded: isMockConfig(cfg) };
  });

  // ---- SSE: live event stream ----
  const EVENTS: AppEventName[] = [
    "probe.done",
    "drift.verdict",
    "gep.phase",
    "route.changed",
    "evomap.published",
    "consensus.reached",
    "evomap.vote",
    "evomap.report",
    "evomap.memory",
  ];
  app.get("/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

    const send = (name: string) => (payload: unknown) => {
      reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const handlers = EVENTS.map((n) => {
      const fn = send(n);
      bus.on(n, fn);
      return [n, fn] as const;
    });
    const ping = setInterval(() => reply.raw.write(`event: ping\ndata: {}\n\n`), 15_000);

    req.raw.on("close", () => {
      clearInterval(ping);
      for (const [n, fn] of handlers) bus.off(n, fn);
    });
  });

  if (existsSync(join(dashboardDist, "index.html"))) {
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/") || req.raw.url === "/events") {
        void reply.code(404).send({ error: "not found" });
        return;
      }
      void reply.sendFile("index.html");
    });
  }

  await app.listen({ port: PORT, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`DriftSentinel server on http://localhost:${PORT}  (publish=${PUBLISH_FOR_REAL ? "real" : "mock"})`);

  if ((q.endpoints() as unknown[]).length === 0 && isMockConfig(cfg)) {
    seedJob = seedNormalHistory(cfg, dao)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("initial demo seed failed", e);
      })
      .finally(() => {
        seedJob = undefined;
      });
  }
  if ((q.endpoints() as unknown[]).length === 0) {
    for (const ep of cfg.endpoints) {
      dao.upsertEndpoint({ id: ep.id, baseUrl: ep.baseUrl, model: ep.model, platform: ep.platform });
    }
  }

  if (AUTO_DAEMON) {
    const intervalMs = Math.max(10_000, cfg.probe.intervalMin * 60_000);
    daemon.start(intervalMs);
    // eslint-disable-next-line no-console
    console.log(`GEP daemon started (every ${Math.round(intervalMs / 1000)}s)`);
  }

  const shutdown = () => {
    daemon.stop();
    void app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function isMockConfig(cfg: { endpoints: Array<{ baseUrl: string }> }): boolean {
  return cfg.endpoints.every((ep) => ep.baseUrl.startsWith("mock://"));
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
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
