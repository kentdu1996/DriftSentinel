import type { BoardRow, Cycle, ProbePoint, RadarAxis } from "./api";
import { num, platformLabel, riskLabel, riskOf, time } from "./api";

export function CardTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="card-title">
      <h2>{title}</h2>
      <p>{desc}</p>
    </div>
  );
}

export function List({ rows }: { rows: Array<Array<string | number>> }) {
  if (!rows.length) return <p className="empty">暂无数据。运行一轮 GEP 或等待 daemon 写入。</p>;
  return (
    <div className="list">
      {rows.map((r, i) => (
        <div key={i}>
          {r.map((c, j) => (
            <span key={j}>{c}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Timeline({ cycles }: { cycles: Cycle[] }) {
  if (!cycles.length) return <p className="empty">暂无 GEP cycle。</p>;
  return (
    <ol className="timeline">
      {cycles.map((c, i) => (
        <li key={`${c.ts}-${i}`}>
          <b>{c.phase}</b>
          <span>{c.status}</span>
          <small>{time(c.ts)}</small>
        </li>
      ))}
    </ol>
  );
}

export function Sparkline({ points }: { points: ProbePoint[] }) {
  const values = points.map((p) => p.score);
  const max = Math.max(100, ...values);
  const coords = values
    .map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${100 - (v / max) * 100}`)
    .join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points={coords} />
    </svg>
  );
}

export function EndpointCard({ row, onOpen }: { row: BoardRow; onOpen?: (id: string) => void }) {
  const risk = riskOf(row);
  const level = risk === "avoid" ? "bad" : risk === "watch" ? "warn" : "good";
  const radar = row.radar ?? [];
  const problems = radar.filter((r) => r.status !== "ok");
  return (
    <div className={`endpoint ${level}`}>
      <div className="endpoint-head">
        <div className="endpoint-id">
          <strong title={row.endpointId}>{row.endpointId}</strong>
          <span title={row.model}>{row.model} / {platformLabel(row.platform)}</span>
        </div>
        <span className={`pill ${risk}`}>{riskLabel(risk)}</span>
      </div>
      <div className="endpoint-score">
        <b>{row.health == null ? "-" : num(row.health)}</b>
        <small>健康分</small>
        <span>长期声誉 {row.localElo}</span>
        <span>p95 {row.latencyP95 == null ? "-" : `${num(row.latencyP95)}ms`}</span>
        <span>异常 {row.driftEvents}</span>
      </div>
      {!!radar.length && <RadarChart axes={radar} />}
      <div className="endpoint-problems">
        {problems.length
          ? problems.map((p) => <span key={p.label} className={`tag ${p.status}`}>{p.label}: {p.reason}</span>)
          : <span className="tag ok">五个方向暂未发现明显问题</span>}
      </div>
      {onOpen && <button className="link-button" onClick={() => onOpen(row.endpointId)}>查看证据链</button>}
    </div>
  );
}

export function RadarChart({ axes }: { axes: RadarAxis[] }) {
  const cx = 50;
  const cy = 50;
  const maxR = 30;
  const points = axes.map((axis, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / axes.length;
    const r = maxR * (axis.value / 100);
    return {
      ...axis,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      lx: cx + Math.cos(angle) * 45,
      ly: cy + Math.sin(angle) * 45,
      gx: cx + Math.cos(angle) * maxR,
      gy: cy + Math.sin(angle) * maxR,
      tx: cx + Math.cos(angle) * 41,
      ty: cy + Math.sin(angle) * 41,
    };
  });
  const polygon = points.map((p) => `${p.x},${p.y}`).join(" ");
  const grid = [0.33, 0.66, 1].map((ratio) =>
    axes.map((_, i) => {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / axes.length;
      return `${cx + Math.cos(angle) * maxR * ratio},${cy + Math.sin(angle) * maxR * ratio}`;
    }).join(" "),
  );

  return (
    <div className="radar-wrap">
      <svg className="radar" viewBox="0 0 100 100" role="img" aria-label="多维质量雷达图">
        {grid.map((g, i) => <polygon key={i} points={g} className="radar-grid" />)}
        {points.map((p) => <line key={p.label} x1={cx} y1={cy} x2={p.gx} y2={p.gy} className="radar-line" />)}
        <polygon points={polygon} className="radar-area" />
        {points.map((p) => <circle key={p.label} cx={p.x} cy={p.y} r="2.2" className={`radar-dot ${p.status}`} />)}
        {points.map((p) => (
          <text key={`${p.label}-label`} x={p.tx} y={p.ty} className="radar-label" textAnchor={anchorFor(p.tx)}>
            {shortAxis(p.label)}
          </text>
        ))}
      </svg>
      <div className="radar-detail">
        {points.map((p) => (
          <div key={p.label} className={`radar-row ${p.status}`}>
            <div className="radar-row-head">
              <strong>{p.label}</strong>
              <b>{p.value}</b>
            </div>
            <div className="mini-bar"><i style={{ width: `${p.value}%` }} /></div>
            <small>{p.reason}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function shortAxis(label: string) {
  if (label === "回答质量") return "质量";
  if (label === "响应速度") return "速度";
  if (label === "行为一致性") return "一致性";
  if (label === "任务能力") return "任务";
  return label;
}

function anchorFor(x: number) {
  if (x < 42) return "end";
  if (x > 58) return "start";
  return "middle";
}
