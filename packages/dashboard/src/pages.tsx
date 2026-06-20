import { useState } from "react";
import type { AssetRow, BoardRow, Cycle, Dict, EndpointDetail, GateRecord, NodeVerdict, ProbePoint, RankedResponse, RouteRow, TimelineItem, Verdict } from "./api";
import { eventClass, eventLabel, evidenceText, intelSentence, num, platformLabel, riskLabel, riskOf, short, signalText, time, useApi } from "./api";
import { CardTitle, EndpointCard, List, Sparkline, Timeline } from "./components";

export function IntelPage({ version, events }: { version: number; events: { name: string; payload: unknown; ts: number }[] }) {
  const config = useApi<{ endpoints: { id: string; model: string; platform: string }[]; hub: string; autoPublish: boolean; inject: Dict }>("/api/config", { endpoints: [], hub: "", autoPublish: false, inject: {} }, version);
  const board = useApi<BoardRow[]>("/api/board", [], version);
  const verdicts = useApi<Verdict[]>("/api/verdicts?limit=12", [], version);
  const selected = board.data[0]?.endpointId;
  const [historyRange, setHistoryRange] = useState<"24h" | "7d">("24h");
  const historyLimit = historyRange === "24h" ? 24 : 168;
  const history = useApi<ProbePoint[]>(selected ? `/api/history/${encodeURIComponent(selected)}?limit=${historyLimit}` : "", [], version);
  const confirmed = verdicts.data.filter((v) => v.level === "confirmed").length;
  const avoid = board.data.filter((r) => riskOf(r) === "avoid").length;
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <main className="grid two">
      <section className="metric-grid span">
        <div className="metric">
          <span>高风险服务</span>
          <b>{avoid}</b>
          <small>建议暂时避开的模型 / 中转站</small>
        </div>
        <div className="metric">
          <span>确认情报</span>
          <b>{confirmed}</b>
          <small>已确认的降智 / 质量漂移事件</small>
        </div>
        <div className="metric">
          <span>EvoMap 连接</span>
          <b>{config.data.autoPublish ? "ON" : "OFF"}</b>
          <small>{config.data.hub || "未配置 Hub"} · {config.data.endpoints.length} 个服务</small>
        </div>
      </section>
      <section className="card span">
        <CardTitle title="实时情报流" desc="把探测结果翻译成用户可读的模型/中转站风险情报。" />
        <div className="intel-feed">
          {verdicts.data.map((v, i) => (
            <article key={`${v.ts}-${i}`} className={`intel-item ${v.level}`}>
              <div>
                <strong>{intelSentence(v)}</strong>
                <span>{time(v.ts)} · {signalText(v)} · {evidenceText(v)}</span>
              </div>
              <em>{v.level}</em>
            </article>
          ))}
          {!verdicts.data.length && <p className="empty">暂无情报。点击“立即评测一轮”生成第一批结果。</p>}
        </div>
      </section>
      <section className="card span">
        <CardTitle title="我的模型与中转站" desc="每张卡片都有动态诊断雷达图。图形看整体收缩，右侧明细看具体维度、分数和异常原因。" />
        <div className="cards">{board.data.map((row) => <EndpointCard key={row.endpointId} row={row} onOpen={setDetailId} />)}</div>
      </section>
      {detailId && <EndpointDetailCard endpointId={detailId} version={version} onClose={() => setDetailId(null)} />}
      <section className="card">
        <CardTitle title="实时系统事件" desc="页面通过 SSE 实时接收检测、路由和广播事件。" />
        <EventFeed events={events} />
      </section>
      <section className="card">
        <div className="card-title-row">
          <CardTitle title={`质量趋势 ${selected ?? ""}`} desc={`${historyRange === "24h" ? "最近 24 次" : "最近 7 天窗口"}探测分，用来判断服务是否持续恢复或继续恶化。`} />
          <div className="segmented">
            <button className={historyRange === "24h" ? "active" : ""} onClick={() => setHistoryRange("24h")}>24h</button>
            <button className={historyRange === "7d" ? "active" : ""} onClick={() => setHistoryRange("7d")}>7d</button>
          </div>
        </div>
        <Sparkline points={history.data} />
      </section>
    </main>
  );
}

export function RatingsPage({ version }: { version: number }) {
  const board = useApi<BoardRow[]>("/api/board", [], version);
  const ranked = useApi<RankedResponse>("/api/ranked?limit=20", { ok: false, status: 0, body: null }, version);
  const elo = useApi<Dict[]>("/api/elo", [], version);

  return (
    <main className="grid two">
      <section className="card span">
        <CardTitle title="模型 / 中转站评分榜" desc="面向用户的质量、延迟、稳定性和社区信任概览。长期声誉分来自 Elo 排名思想：表现越稳定，声誉越高。" />
        <table>
          <thead><tr><th>服务</th><th>模型</th><th>健康分</th><th>建议</th><th>长期声誉</th><th>主要问题</th><th>p95</th></tr></thead>
          <tbody>
            {board.data.map((r) => (
              <tr key={r.endpointId}>
                <td>{r.endpointId}</td>
                <td>{r.model}</td>
                <td>{r.health == null ? "-" : num(r.health)}</td>
                <td><span className={`pill ${riskOf(r)}`}>{riskLabel(riskOf(r))}</span></td>
                <td>{r.localElo}</td>
                <td>{r.problemDirections?.length ? r.problemDirections.join(" / ") : "暂无明显问题"}</td>
                <td>{r.latencyP95 == null ? "-" : `${num(r.latencyP95)}ms`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <CardTitle title="本地任务声誉" desc="按代码、数学、长上下文等任务维度累计质量声誉；这里的 Elo 可理解为长期口碑分。" />
        <List rows={elo.data.map((r) => [String(r.endpoint_id), String(r.dimension), num(Number(r.rating))])} />
      </section>
      <section className="card">
        <CardTitle title="EvoMap 公共网络排行" desc="来自 EvoMap ranked 的公共资产/经验排行，用于展示外部网络里的模型经验。" />
        <pre className="json">{JSON.stringify(ranked.data.body, null, 2).slice(0, 5000)}</pre>
      </section>
    </main>
  );
}

export function WatchPage({ version }: { version: number }) {
  const config = useApi<{ endpoints: { id: string; model: string; platform: string }[]; hub: string; autoPublish: boolean; inject: Dict }>("/api/config", { endpoints: [], hub: "", autoPublish: false, inject: {} }, version);
  const board = useApi<BoardRow[]>("/api/board", [], version);
  const nodeVerdicts = useApi<NodeVerdict[]>("/api/node-verdicts?limit=30", [], version);
  const risky = board.data.filter((r) => riskOf(r) !== "healthy");

  return (
    <main className="grid two">
      <section className="card">
        <CardTitle title="我的关注" desc="当前配置中被 DriftSentinel 持续监控的模型和中转站。" />
        <List rows={config.data.endpoints.map((e) => [e.id, e.model, platformLabel(e.platform), board.data.find((r) => r.endpointId === e.id)?.health ?? "-"])} />
      </section>
      <section className="card">
        <CardTitle title="EvoMap 调用状态" desc="真实演示时，模型评测会调用 EvoMap API 并消耗 Token；确认异常后会发布 A2A 资产。" />
        <List rows={[
          ["Hub", config.data.hub || "-", config.data.autoPublish ? "允许发布" : "仅验证/本地", ""],
          ["监控服务数", config.data.endpoints.length, "API Key 来自 EVOMAP_API_KEY", ""],
        ]} />
      </section>
      <section className="card">
        <CardTitle title="需要关注的风险" desc="系统会把健康分低或有 confirmed 事件的服务放在这里。" />
        <List rows={risky.map((r) => [r.endpointId, r.model, riskLabel(riskOf(r)), `drift=${r.driftEvents}`])} />
      </section>
      <section className="card span">
        <CardTitle title="可信节点复核" desc="公共网络中来自其他节点的独立复核会进入共识判断；后续可作为 A2A 协作的可信证据。" />
        <List rows={nodeVerdicts.data.map((v) => [v.node_id, v.endpoint_id, v.dimension, `${v.level} z=${num(v.z)}`])} />
      </section>
    </main>
  );
}

export function ActionsPage({ version }: { version: number }) {
  const routes = useApi<RouteRow[]>("/api/routes", [], version);
  const cycles = useApi<Cycle[]>("/api/cycles?limit=20", [], version);
  const latestRoute = routes.data[0];

  return (
    <main className="grid two">
      <section className="card">
        <CardTitle title="系统建议动作" desc="confirmed 后系统会建议避开降智服务，并把流量切向健康 endpoint。" />
        {routes.data.map((r) => (
          <div key={r.task} className="route">
            <div className="route-head"><strong>{r.task}</strong><span>推荐: {r.best_endpoint}</span></div>
            {Object.entries(r.weights).map(([id, w]) => (
              <div key={id} className="bar-row">
                <span>{id}</span><div className="bar"><i style={{ width: `${Math.round(w * 100)}%` }} /></div><b>{Math.round(w * 100)}%</b>
              </div>
            ))}
          </div>
        ))}
        {!routes.data.length && <p className="empty">暂无路由建议。运行一轮评测后会生成。</p>}
      </section>
      <section className="card">
        <CardTitle title="GEP 自愈过程" desc="扫描 → 提取信号 → 判断意图 → 生成新路由 → 验证 → 固化 → 广播到 EvoMap。" />
        <Timeline cycles={cycles.data} />
      </section>
      <section className="card">
        <CardTitle title="70/30 流量饼图" desc="展示当前 genes.json 固化后的生产流量分配。" />
        {latestRoute ? <TrafficPie route={latestRoute} /> : <p className="empty">暂无路由。</p>}
      </section>
      <section className="card">
        <CardTitle title="genes.json 版本时间线" desc="每次 solidify 都代表一次自愈路由固化。" />
        <List rows={cycles.data.filter((c) => c.phase === "solidify").map((c, i) => [`v${i + 1}`, time(c.ts), c.status, "已固化"])} />
      </section>
    </main>
  );
}

// P2: Agent 进化时间线 — visualizes the GEP Loop 7 phases AND cross-node
// inheritance / consensus as one chronological stream, so the evolution is
// "肉眼可见". Backed by /api/timeline (merges gep_cycles + evomap_assets +
// node_verdicts).
export function EvolutionPage({ version, events }: { version: number; events: { name: string; payload: unknown; ts: number }[] }) {
  const timeline = useApi<TimelineItem[]>("/api/timeline?limit=80", [], version);
  const [filter, setFilter] = useState<"all" | TimelineItem["category"]>("all");
  const items = filter === "all" ? timeline.data : timeline.data.filter((t) => t.category === filter);

  const counts = {
    detect: timeline.data.filter((t) => t.category === "detect").length,
    heal: timeline.data.filter((t) => t.category === "heal").length,
    publish: timeline.data.filter((t) => t.category === "publish").length,
    inherit: timeline.data.filter((t) => t.category === "inherit").length,
  };

  return (
    <main className="grid two">
      <section className="metric-grid span">
        <FilterMetric label="检测" hint="Scan / Signal / 判定" value={counts.detect} active={filter === "detect"} onClick={() => setFilter(filter === "detect" ? "all" : "detect")} />
        <FilterMetric label="自愈" hint="Intent / Mutate / Validate / Solidify" value={counts.heal} active={filter === "heal"} onClick={() => setFilter(filter === "heal" ? "all" : "heal")} />
        <FilterMetric label="广播" hint="发布 / 投票 / 公评" value={counts.publish} active={filter === "publish"} onClick={() => setFilter(filter === "publish" ? "all" : "publish")} />
        <FilterMetric label="继承" hint="跨节点复核 / 记忆" value={counts.inherit} active={filter === "inherit"} onClick={() => setFilter(filter === "inherit" ? "all" : "inherit")} />
      </section>

      <section className="card span">
        <div className="card-title-row">
          <CardTitle title="Agent 进化时间线" desc="把 GEP Loop 七阶段（扫描→信号→意图→变异→验证→固化→广播）和跨节点继承/共识合并成一条可见的进化轨迹。点击上方卡片可按类别过滤。" />
          {filter !== "all" && <button className="link-button" onClick={() => setFilter("all")}>显示全部</button>}
        </div>
        <ol className="evo-timeline">
          {items.map((t, i) => (
            <li key={`${t.ts}-${i}`} className={`evo-item ${t.category}`}>
              <span className="evo-dot" />
              <div className="evo-body">
                <div className="evo-head">
                  <strong>{t.title}</strong>
                  <em className={`evo-tag ${t.category}`}>{categoryLabel(t.category)}</em>
                </div>
                <span className="evo-detail">{t.detail}</span>
                <small>
                  {time(t.ts)}
                  {t.endpoint ? ` · ${t.endpoint}` : ""}
                  {t.nodeId ? ` · ${t.nodeId}` : ""}
                </small>
              </div>
            </li>
          ))}
          {!items.length && <p className="empty">暂无进化事件。运行一轮评测或触发 confirmed drift 后会逐步出现。</p>}
        </ol>
      </section>

      <section className="card span">
        <CardTitle title="实时进化事件" desc="通过 SSE 实时接收的检测、自愈、广播（含投票/公评/记忆）与继承事件。" />
        <EventFeed events={events} />
      </section>
    </main>
  );
}

function FilterMetric({ label, hint, value, active, onClick }: { label: string; hint: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button className={`metric metric-filter ${active ? "active" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{hint}</small>
    </button>
  );
}

function categoryLabel(category: TimelineItem["category"]) {
  if (category === "detect") return "检测";
  if (category === "heal") return "自愈";
  if (category === "publish") return "广播";
  return "继承";
}

export function DeveloperPage({ version, events }: { version: number; events: { name: string; payload: unknown; ts: number }[] }) {
  const assets = useApi<AssetRow[]>("/api/assets?limit=30", [], version);
  const nodeVerdicts = useApi<NodeVerdict[]>("/api/node-verdicts?limit=30", [], version);
  const search = useApi<RankedResponse>("/api/search?signals=quality_drop,model_substitution,fingerprint_drift", { ok: false, status: 0, body: null }, version);
  const verdicts = useApi<Verdict[]>("/api/verdicts?limit=10", [], version);

  return (
    <main className="grid two">
      <section className="card">
        <CardTitle title="Gene / Capsule 资产" desc="开发者视角：本地构造并验证的 A2A 资产，用于发布到 EvoMap 形成可继承经验。" />
        <List rows={assets.data.map((a) => [a.kind, a.remote_status, a.body?.summary ?? a.asset_id])} />
      </section>
      <section className="card">
        <PublishGatePanel assets={assets.data} events={events} />
      </section>
      <section className="card">
        <CardTitle title="L2 独立复核" desc="reputation >= 40 的独立节点可参与共识。" />
        <List rows={nodeVerdicts.data.map((v) => [v.node_id, v.endpoint_id, `${v.level} z=${num(v.z)}`])} />
      </section>
      <section className="card span">
        <A2AFlow assets={assets.data} nodeVerdicts={nodeVerdicts.data} />
      </section>
      <section className="card span">
        <CardTitle title="原始判定与 Hub 查询" desc="保留给调试、协议验证和 A2A 集成排障。" />
        <pre className="json">{JSON.stringify({ verdicts: verdicts.data, hub: search.data.body }, null, 2).slice(0, 7000)}</pre>
      </section>
    </main>
  );
}

function TrafficPie({ route }: { route: RouteRow }) {
  const entries = Object.entries(route.weights);
  let acc = 0;
  const colors = ["#38bdf8", "#2dd4bf", "#fbbf24", "#a78bfa", "#fb7185"];
  const stops = entries.map(([, w], i) => {
    const start = acc;
    acc += Math.max(0, w) * 100;
    return `${colors[i % colors.length]} ${start}% ${acc}%`;
  });
  return (
    <div className="pie-wrap">
      <div className="traffic-pie" style={{ background: `conic-gradient(${stops.join(", ") || "#14263a 0 100%"})` }} />
      <List rows={entries.map(([id, w]) => [id, `${Math.round(w * 100)}%`, id === route.best_endpoint ? "推荐主路由" : "探索/备用", ""])} />
    </div>
  );
}

function A2AFlow({ assets, nodeVerdicts }: { assets: AssetRow[]; nodeVerdicts: NodeVerdict[] }) {
  const published = assets.find((a) => a.remote_status === "published" || a.remote_status === "mock_published");
  const inherited = nodeVerdicts[0];
  return (
    <>
      <CardTitle title="A2A 发布 → 继承飞线" desc="展示节点 A 发布情报、节点 B 或公共网络读取后避坑的协作路径。" />
      <div className="a2a-flow">
        <div className="a2a-node">
          <b>节点 A</b>
          <span>{published ? `发布 ${published.kind}` : "等待发布"}</span>
        </div>
        <div className={`a2a-line ${published ? "active" : ""}`}><i /></div>
        <div className="a2a-node">
          <b>EvoMap Hub</b>
          <span>{published ? statusText(published.remote_status) : "暂无 asset"}</span>
        </div>
        <div className={`a2a-line ${inherited ? "active" : ""}`}><i /></div>
        <div className="a2a-node">
          <b>节点 B</b>
          <span>{inherited ? `避开 ${inherited.endpoint_id}` : "等待继承证据"}</span>
        </div>
      </div>
    </>
  );
}

function EventFeed({ events }: { events: { name: string; payload: unknown; ts: number }[] }) {
  if (!events.length) return <p className="empty">暂无事件。运行一轮评测后会出现检测、自愈、发布和继承事件。</p>;
  return (
    <div className="event-feed">
      {events.map((e, i) => (
        <article key={`${e.ts}-${i}`} className={`event-item ${eventClass(e.name, e.payload)}`}>
          <b>{eventLabel(e.name)}</b>
          <span>{short(e.payload)}</span>
          <small>{time(e.ts)}</small>
        </article>
      ))}
    </div>
  );
}

function EndpointDetailCard({ endpointId, version, onClose }: { endpointId: string; version: number; onClose: () => void }) {
  const detail = useApi<EndpointDetail>(`/api/endpoint/${encodeURIComponent(endpointId)}`, { history: [], verdicts: [], routes: [], assets: [] }, version);
  const latestVerdict = detail.data.verdicts[0];
  return (
    <section className="card span detail-card">
      <div className="detail-head">
        <CardTitle title={`端点详情：${endpointId}`} desc="下钻查看健康曲线、历史判决、命中信号、切流时间线和发布记录。" />
        <button className="link-button" onClick={onClose}>关闭</button>
      </div>
      <div className="detail-grid">
        <div>
          <h3>健康分曲线</h3>
          <Sparkline points={detail.data.history} />
        </div>
        <div>
          <h3>最新判定证据</h3>
          {latestVerdict ? (
            <List rows={[
              ["等级", latestVerdict.level, "delta", num(latestVerdict.delta)],
              ...((latestVerdict.signals ?? []).map((s) => [signalText({ ...latestVerdict, signals: [s] }), s.hit ? "命中" : "未命中", "delta", num(s.delta)])),
            ]} />
          ) : <p className="empty">暂无判定。</p>}
        </div>
        <div>
          <h3>历史判决</h3>
          <List rows={detail.data.verdicts.slice(0, 8).map((v) => [time(v.ts), v.level, evidenceText(v), num(v.delta)])} />
        </div>
        <div>
          <h3>切流与发布</h3>
          <List rows={[
            ...detail.data.routes.map((r) => [r.task, `推荐 ${r.best_endpoint}`, `${Math.round((r.weights[endpointId] ?? 0) * 100)}%`, time(r.updated_at)]),
            ...detail.data.assets.map((a) => [a.kind, a.remote_status, a.asset_id.slice(0, 18), time(a.ts)]),
          ]} />
        </div>
      </div>
    </section>
  );
}

function PublishGatePanel({ assets, events }: { assets: AssetRow[]; events: { name: string; payload: unknown; ts: number }[] }) {
  const gateEvents = events
    .filter((e) => e.name === "gep.phase")
    .map((e) => toGateRecord(e))
    .filter((e): e is GateRecord => Boolean(e));
  const assetRecords: GateRecord[] = assets.slice(0, 12).map((a) => ({
    ts: a.ts,
    endpoint: endpointFromAsset(a),
    status: statusText(a.remote_status),
    assetId: a.asset_id,
  }));
  const records = [...gateEvents, ...assetRecords].sort((a, b) => b.ts - a.ts).slice(0, 12);
  return (
    <>
      <CardTitle title="发布闸记录" desc="只读透明面板：展示自动脱敏、拦截、validate 和 publish 结果，没有人工审批按钮。" />
      <div className="gate-list">
        {records.map((r, i) => (
          <article key={`${r.ts}-${i}`} className={`gate-item ${r.status.includes("拦截") ? "blocked" : "passed"}`}>
            <div>
              <strong>{r.status}</strong>
              <span>{r.endpoint || "未知端点"} · {time(r.ts)}</span>
              {r.sanitize && <small>扫描 {r.sanitize.checkedFields} 个字段，命中 {r.sanitize.hits.length} 项</small>}
              {!!r.sanitize?.hits.length && <code>{r.sanitize.hits.join("；")}</code>}
            </div>
            {r.assetId && <em title={r.assetId}>{r.assetId.slice(0, 18)}</em>}
          </article>
        ))}
        {!records.length && <p className="empty">暂无发布闸记录。触发 confirmed drift 后会自动产生。</p>}
      </div>
    </>
  );
}

function toGateRecord(e: { payload: unknown; ts: number }): GateRecord | null {
  const payload = e.payload as { phase?: string; status?: string; payload?: { endpoint?: string; assetId?: string; sanitize?: GateRecord["sanitize"] } } | null;
  if (!payload || payload.phase !== "broadcast") return null;
  const status = payload.status ?? "";
  if (!status.includes("sanitize") && !status.includes("published")) return null;
  return {
    ts: e.ts,
    endpoint: payload.payload?.endpoint ?? "",
    status: statusText(status),
    assetId: payload.payload?.assetId,
    sanitize: payload.payload?.sanitize,
  };
}

function statusText(status: string) {
  if (status === "blocked_sanitize" || status.includes("BLOCKED")) return "自动拦截";
  if (status === "published" || status.includes("published to Hub")) return "已发布到 Hub";
  if (status === "mock_published" || status.includes("mock")) return "脱敏通过 / mock 发布";
  if (status.includes("passed")) return "脱敏通过";
  return status;
}

function endpointFromAsset(a: AssetRow) {
  const summary = a.body?.summary ?? "";
  const match = summary.match(/on ([^\s]+)|from ([^\s]+)/);
  return match?.[1] ?? match?.[2] ?? "-";
}
