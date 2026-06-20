import type { DB } from "@driftsentinel/core";

// Read helpers for the dashboard REST layer.
export class Queries {
  constructor(private db: DB) {}

  endpoints() {
    return this.db.prepare(`SELECT * FROM endpoints ORDER BY id`).all();
  }

  latestPerEndpoint() {
    return this.db
      .prepare(
        `SELECT p.* FROM probe_results p
         JOIN (SELECT endpoint_id, MAX(ts) mt FROM probe_results GROUP BY endpoint_id) m
           ON p.endpoint_id = m.endpoint_id AND p.ts = m.mt`,
      )
      .all()
      .map(parseProbeRow);
  }

  history(endpointId: string, limit = 50) {
    return this.db
      .prepare(
        `SELECT * FROM probe_results WHERE endpoint_id=? ORDER BY ts DESC LIMIT ?`,
      )
      .all(endpointId, limit)
      .map(parseProbeRow)
      .reverse();
  }

  baselines() {
    return this.db.prepare(`SELECT * FROM baselines`).all();
  }

  recentVerdicts(limit = 30) {
    return this.db
      .prepare(`SELECT * FROM drift_verdicts ORDER BY ts DESC LIMIT ?`)
      .all(limit)
      .map((r) => {
        const row = r as Record<string, unknown>;
        return { ...row, signals: JSON.parse((row.signals as string) ?? "[]") };
      });
  }

  gepCycles(limit = 30) {
    return this.db
      .prepare(`SELECT * FROM gep_cycles ORDER BY id DESC LIMIT ?`)
      .all(limit)
      .map((r) => {
        const row = r as Record<string, unknown>;
        return { ...row, payload: row.payload ? JSON.parse(row.payload as string) : null };
      })
      .reverse();
  }

  routes() {
    return this.db
      .prepare(`SELECT * FROM routes`)
      .all()
      .map((r) => {
        const row = r as Record<string, unknown>;
        return { ...row, weights: JSON.parse((row.weights as string) ?? "{}") };
      });
  }

  elo() {
    return this.db.prepare(`SELECT * FROM elo_ratings ORDER BY rating DESC`).all();
  }

  evomapAssets(limit = 30) {
    return this.db
      .prepare(`SELECT * FROM evomap_assets ORDER BY ts DESC LIMIT ?`)
      .all(limit)
      .map((r) => {
        const row = r as Record<string, unknown>;
        return { ...row, body: row.body ? JSON.parse(row.body as string) : null };
      });
  }

  nodeVerdicts(limit = 50) {
    return this.db
      .prepare(`SELECT * FROM node_verdicts ORDER BY ts DESC LIMIT ?`)
      .all(limit);
  }

  // P2: unified evolution timeline. Merges GEP-Loop phase events, EvoMap asset
  // publishes, and cross-node verdicts into one chronological stream so the
  // dashboard can visualize the 7-phase GEP Loop AND cross-node inheritance /
  // consensus as a single "Agent 进化时间线".
  timeline(limit = 80) {
    const items: TimelineItem[] = [];

    // GEP Loop phases (Scan→Signal→Intent→Mutate→Validate→Solidify→Broadcast)
    const cycles = this.db
      .prepare(`SELECT * FROM gep_cycles ORDER BY id DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    for (const c of cycles) {
      const phase = c.phase as string;
      const payload = c.payload ? safeJson(c.payload as string) : null;
      items.push({
        ts: c.ts as number,
        category: phaseCategory(phase, c.status as string),
        phase,
        title: phaseTitle(phase),
        detail: c.status as string,
        endpoint: extractEndpoint(payload),
      });
    }

    // EvoMap assets (publish / mock / memory / inherit)
    const assets = this.evomapAssets(limit);
    for (const a of assets) {
      const row = a as { kind?: string; remote_status?: string; ts?: number; asset_id?: string; body?: { summary?: string } | null };
      items.push({
        ts: row.ts ?? 0,
        category: assetCategory(row.remote_status ?? ""),
        phase: "broadcast",
        title: `EvoMap ${row.kind ?? "Asset"}`,
        detail: `${assetStatusLabel(row.remote_status ?? "")} · ${row.body?.summary ?? row.asset_id ?? ""}`,
        endpoint: endpointFromSummary(row.body?.summary ?? ""),
        assetId: row.asset_id,
      });
    }

    // Cross-node verdicts (L2 inheritance + consensus evidence)
    const verdicts = this.db
      .prepare(`SELECT * FROM node_verdicts ORDER BY ts DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    for (const v of verdicts) {
      items.push({
        ts: v.ts as number,
        category: "inherit",
        phase: "consensus",
        title: `跨节点复核 · ${v.node_id as string}`,
        detail: `${v.endpoint_id as string} / ${v.dimension as string} → ${v.level as string} (z=${Number(v.z).toFixed(2)}, 声誉 ${Math.round(Number(v.reputation))})`,
        endpoint: v.endpoint_id as string,
        nodeId: v.node_id as string,
      });
    }

    items.sort((a, b) => b.ts - a.ts);
    return items.slice(0, limit);
  }

  endpointDetail(endpointId: string) {
    const endpoint = this.db.prepare(`SELECT * FROM endpoints WHERE id=?`).get(endpointId) as
      | Record<string, unknown>
      | undefined;
    const history = this.history(endpointId, 80);
    const verdicts = this.db
      .prepare(`SELECT * FROM drift_verdicts WHERE endpoint_id=? ORDER BY ts DESC LIMIT 30`)
      .all(endpointId)
      .map((r) => {
        const row = r as Record<string, unknown>;
        return { ...row, signals: JSON.parse((row.signals as string) ?? "[]") };
      });
    const routes = this.routes().filter((r) => {
      const row = r as { best_endpoint?: string; weights?: Record<string, number> };
      return row.best_endpoint === endpointId || Object.prototype.hasOwnProperty.call(row.weights ?? {}, endpointId);
    });
    const assets = this.evomapAssets(80).filter((a) => {
      const row = a as { body?: { summary?: string; trigger?: string[]; signals_match?: string[] } | null };
      const haystack = [
        row.body?.summary,
        ...(row.body?.trigger ?? []),
        ...(row.body?.signals_match ?? []),
      ].join(" ");
      return haystack.includes(endpointId);
    });
    return { endpoint, history, verdicts, routes, assets };
  }

  // Verdict board: aggregate per endpoint — local health + drift event count.
  verdictBoard() {
    const eps = this.endpoints() as { id: string; model: string; platform: string }[];
    const latest = this.latestPerEndpoint();
    const latestById = new Map(latest.map((l) => [l.endpoint_id, l]));
    return eps.map((ep) => {
      const driftCount = (
        this.db
          .prepare(
            `SELECT COUNT(*) c FROM drift_verdicts WHERE endpoint_id=? AND level='confirmed'`,
          )
          .get(ep.id) as { c: number }
      ).c;
      const elo =
        (this.db
          .prepare(`SELECT AVG(rating) r FROM elo_ratings WHERE endpoint_id=?`)
          .get(ep.id) as { r: number | null }).r ?? 1400;
      const l = latestById.get(ep.id);
      const recentVerdict = this.latestVerdict(ep.id);
      const radar = buildRadar(l, recentVerdict, driftCount);
      return {
        endpointId: ep.id,
        model: ep.model,
        platform: ep.platform,
        health: l?.score ?? null,
        localElo: Math.round(elo),
        driftEvents: driftCount,
        latencyP95: l?.latency_p95 ?? null,
        byDimension: l?.by_dimension ?? {},
        latestSignals: recentVerdict?.signals ?? [],
        radar,
        problemDirections: radar.filter((r) => r.status !== "ok").map((r) => r.label),
      };
    });
  }

  private latestVerdict(endpointId: string) {
    const row = this.db
      .prepare(`SELECT * FROM drift_verdicts WHERE endpoint_id=? ORDER BY ts DESC LIMIT 1`)
      .get(endpointId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return { ...row, signals: JSON.parse((row.signals as string) ?? "[]") };
  }
}

interface TimelineItem {
  ts: number;
  category: "detect" | "heal" | "publish" | "inherit";
  phase: string;
  title: string;
  detail: string;
  endpoint?: string;
  assetId?: string;
  nodeId?: string;
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractEndpoint(payload: Record<string, unknown> | null): string | undefined {
  if (!payload) return undefined;
  const direct = (payload.endpoint ?? payload.degraded ?? payload.recommended) as string | undefined;
  return direct;
}

function endpointFromSummary(summary: string): string | undefined {
  const m = summary.match(/on (\S+)|from (\S+)/);
  return m?.[1] ?? m?.[2];
}

const PHASE_TITLES: Record<string, string> = {
  scan: "1 · Scan 扫描探测",
  signal: "2 · Signal 信号提取",
  intent: "3 · Intent 意图判定",
  mutate: "4 · Mutate 策略变异",
  validate: "5 · Validate 沙箱验证",
  solidify: "6 · Solidify 固化路由",
  broadcast: "7 · Broadcast 广播共享",
};

function phaseTitle(phase: string): string {
  return PHASE_TITLES[phase] ?? phase;
}

function phaseCategory(phase: string, status: string): TimelineItem["category"] {
  if (phase === "broadcast") {
    if (/inherit|fetch|继承/.test(status)) return "inherit";
    return "publish";
  }
  if (phase === "solidify" || phase === "mutate" || phase === "validate" || phase === "intent") return "heal";
  return "detect";
}

function assetCategory(status: string): TimelineItem["category"] {
  if (status.includes("memory")) return "inherit";
  if (status.includes("blocked")) return "detect";
  return "publish";
}

function assetStatusLabel(status: string): string {
  if (status === "published") return "已发布到 Hub";
  if (status === "mock_published") return "脱敏通过 / mock 发布";
  if (status === "memory_recorded") return "已写入私有记忆";
  if (status === "blocked_sanitize") return "自动拦截";
  return status;
}

function parseProbeRow(r: unknown) {
  const row = r as Record<string, unknown>;
  return {
    endpoint_id: row.endpoint_id as string,
    ts: row.ts as number,
    score: row.score as number,
    by_dimension: JSON.parse((row.by_dimension as string) ?? "{}"),
    fingerprint: JSON.parse((row.fingerprint as string) ?? '{"vector":[],"meta":{}}'),
    latency_p50: row.latency_p50 as number,
    latency_p95: row.latency_p95 as number,
    first_token_p50: row.first_token_p50 as number,
    samples: row.samples as number,
  };
}

function buildRadar(
  latest: ReturnType<typeof parseProbeRow> | undefined,
  verdict: { level?: string; signals?: Array<{ type: string; hit: boolean; delta: number }> } | undefined,
  driftCount: number,
) {
  const hits = (verdict?.signals ?? []).filter((s) => s.hit);
  const has = (type: string) => hits.some((s) => s.type === type);
  const dims = latest?.by_dimension ?? {};
  const dimValues = Object.values(dims).filter((v): v is number => typeof v === "number");
  const taskScore = dimValues.length
    ? dimValues.reduce((sum, v) => sum + v, 0) / dimValues.length
    : latest?.score;
  const latency = latest?.latency_p95;
  const speed = latency == null ? undefined : clamp(100 - Math.max(0, (latency - 1500) / 55));
  const stability = clamp(100 - driftCount * 22 - (verdict?.level === "suspect" ? 12 : 0));
  const consistency = clamp(100 - (has("fingerprint") ? 45 : 0) - (verdict?.level === "confirmed" ? 15 : 0));

  return [
    radarAxis("回答质量", latest?.score, has("score"), "综合评测得分下降"),
    radarAxis("响应速度", speed, has("latency"), latency == null ? "还没有延迟数据" : `p95 ${Math.round(latency)}ms`),
    radarAxis("稳定性", stability, driftCount > 0, driftCount > 0 ? `已确认异常 ${driftCount} 次` : "近期未确认异常"),
    radarAxis("行为一致性", consistency, has("fingerprint"), has("fingerprint") ? "回答行为指纹漂移" : "行为指纹稳定"),
    radarAxis("任务能力", taskScore, (taskScore ?? 100) < 75, "按 code/math/longctx 等任务维度汇总"),
  ];
}

function radarAxis(label: string, value: number | undefined, hit: boolean, reason: string) {
  const v = clamp(value ?? 0);
  return {
    label,
    value: Math.round(v),
    status: hit || v < 65 ? "bad" : v < 82 ? "watch" : "ok",
    reason,
  };
}

function clamp(v: number) {
  return Math.max(0, Math.min(100, v));
}
