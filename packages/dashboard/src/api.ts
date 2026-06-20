import { useEffect, useState } from "react";

export type Tab = "intel" | "ratings" | "watch" | "actions" | "evolution" | "developer";
export type Dict = Record<string, unknown>;

export interface BoardRow {
  endpointId: string;
  model: string;
  platform: string;
  health: number | null;
  localElo: number;
  driftEvents: number;
  latencyP95: number | null;
  byDimension?: Record<string, number>;
  latestSignals?: { type: string; hit: boolean; delta: number }[];
  radar?: RadarAxis[];
  problemDirections?: string[];
}

export interface RadarAxis {
  label: string;
  value: number;
  status: "ok" | "watch" | "bad";
  reason: string;
}

export interface ProbePoint {
  endpoint_id: string;
  ts: number;
  score: number;
  latency_p95: number;
}

export interface Verdict {
  endpoint_id?: string;
  endpointId?: string;
  ts: number;
  level: string;
  delta: number;
  signals?: { type: string; hit: boolean; delta: number }[];
}

export interface Cycle {
  ts: number;
  phase: string;
  status: string;
  payload?: Dict | null;
}

export interface RouteRow {
  task: string;
  best_endpoint: string;
  weights: Record<string, number>;
  updated_at: number;
}

export interface AssetRow {
  asset_id: string;
  kind: string;
  remote_status: string;
  ts: number;
  body?: { summary?: string; trigger?: string[]; signals_match?: string[] } | null;
}

export interface GateRecord {
  ts: number;
  endpoint: string;
  status: string;
  assetId?: string;
  sanitize?: { safe: boolean; checkedFields: number; hits: string[] };
}

export interface EndpointDetail {
  endpoint?: { id: string; base_url: string; model: string; platform: string };
  history: ProbePoint[];
  verdicts: Verdict[];
  routes: RouteRow[];
  assets: AssetRow[];
}

export interface NodeVerdict {
  node_id: string;
  endpoint_id: string;
  dimension: string;
  level: string;
  z: number;
  reputation: number;
  ts: number;
}

// P2: unified evolution timeline item — merges GEP Loop 7-phase events, EvoMap
// asset publishes / memory records and cross-node verdicts into one stream.
export interface TimelineItem {
  ts: number;
  category: "detect" | "heal" | "publish" | "inherit";
  phase: string;
  title: string;
  detail: string;
  endpoint?: string;
  assetId?: string;
  nodeId?: string;
}

export interface RankedResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export function useApi<T>(path: string, fallback: T, version: number) {
  const [data, setData] = useState<T>(fallback);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    fetch(path)
      .then((r) => r.json() as Promise<T>)
      .then((json) => {
        if (!alive) return;
        setData(json);
        setError(null);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [path, version]);

  return { data, error };
}

export async function runCycle() {
  await requestJson("/api/run-cycle", { method: "POST" });
}

export function demoInject(body: { mode?: string; target?: string } = {}) {
  return requestJson("/api/demo/inject", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function demoRecover() {
  return requestJson("/api/demo/recover", { method: "POST" });
}

export function demoReset() {
  return requestJson("/api/demo/reset", { method: "POST" });
}

async function requestJson(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(path, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message)
        : body && typeof body === "object" && "error" in body
          ? String((body as { error?: unknown }).error)
          : text || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body;
}

export function parseEvent(evt: Event) {
  const msg = evt as MessageEvent;
  try {
    return JSON.parse(msg.data) as unknown;
  } catch {
    return msg.data;
  }
}

export function endpointOf(v: Verdict) {
  return v.endpoint_id ?? v.endpointId ?? "-";
}

export function signalText(v: Verdict) {
  return (v.signals ?? []).filter((s) => s.hit).map((s) => signalLabel(s.type)).join("+") || "-";
}

export function riskOf(row: BoardRow) {
  if (row.driftEvents > 0 || (row.health != null && row.health < 60)) return "avoid";
  if (row.health != null && row.health < 80) return "watch";
  return "healthy";
}

export function riskLabel(risk: string) {
  if (risk === "avoid") return "建议避开";
  if (risk === "watch") return "继续观察";
  return "可用";
}

export function evidenceText(v: Verdict) {
  const hits = (v.signals ?? []).filter((s) => s.hit);
  if (!hits.length) return "未发现显著异常";
  return hits
    .map((s) => {
      if (s.type === "score") return `质量分下降 ${Math.abs(s.delta).toFixed(1)}`;
      if (s.type === "latency") return `延迟上升 ${(s.delta * 100).toFixed(0)}%`;
      if (s.type === "fingerprint") return `行为指纹变化 ${s.delta.toFixed(2)}`;
      return `${s.type} 异常`;
    })
    .join("，");
}

export function signalLabel(type: string) {
  if (type === "score") return "质量下降";
  if (type === "latency") return "速度变慢";
  if (type === "fingerprint") return "行为变化";
  return type;
}

export function intelSentence(v: Verdict) {
  const endpoint = endpointOf(v);
  if (v.level === "confirmed") return `${endpoint} 被确认出现降智，${evidenceText(v)}。建议暂时避开。`;
  if (v.level === "suspect") return `${endpoint} 出现可疑迹象，${evidenceText(v)}。建议继续观察。`;
  return `${endpoint} 当前检测正常。`;
}

export function platformLabel(platform: string) {
  if (platform === "openai") return "官方接口";
  if (platform === "relay") return "中转站";
  if (platform === "mock") return "模拟服务";
  if (platform === "anthropic") return "Anthropic 接口";
  return platform;
}

export function eventLabel(name: string) {
  const labels: Record<string, string> = {
    hello: "页面已连接",
    "probe.done": "检测完成",
    "drift.verdict": "异常判定",
    "gep.phase": "自愈阶段",
    "route.changed": "路由更新",
    "evomap.published": "已发布到公共网络",
    "consensus.reached": "共识达成",
    "evomap.vote": "群体投票",
    "evomap.report": "公评上报",
    "evomap.memory": "经验记忆",
  };
  return labels[name] ?? name;
}

export function eventClass(name: string, payload: unknown) {
  if (name === "probe.done" || name === "drift.verdict") return "detect";
  if (name === "route.changed") return "heal";
  if (name === "evomap.published") return "publish";
  if (name === "evomap.vote" || name === "evomap.report") return "publish";
  if (name === "evomap.memory") return "inherit";
  if (name === "consensus.reached") return "inherit";
  if (name === "gep.phase") {
    const phase = payload && typeof payload === "object" && "phase" in payload ? String((payload as { phase?: unknown }).phase) : "";
    if (phase === "broadcast") return "publish";
    if (phase === "solidify" || phase === "mutate" || phase === "validate") return "heal";
    return "detect";
  }
  return "detect";
}

export function num(x: number) {
  return Number.isFinite(x) ? x.toFixed(1) : "-";
}

export function time(ts: number) {
  return new Date(ts).toLocaleTimeString();
}

export function short(x: unknown) {
  return JSON.stringify(x).slice(0, 120);
}
