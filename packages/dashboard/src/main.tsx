import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Tab } from "./api";
import { demoInject, demoRecover, demoReset, parseEvent, runCycle } from "./api";
import { ActionsPage, DeveloperPage, EvolutionPage, IntelPage, RatingsPage, WatchPage } from "./pages";
import "./styles.css";

function App() {
  const [tab, setTab] = useState<Tab>("intel");
  const [version, setVersion] = useState(0);
  const [events, setEvents] = useState<{ name: string; payload: unknown; ts: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const es = new EventSource("/events");
    const names = [
      "hello",
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
    for (const name of names) {
      es.addEventListener(name, (evt) => {
        setVersion((v) => v + 1);
        setEvents((prev) => [{ name, payload: parseEvent(evt), ts: Date.now() }, ...prev].slice(0, 20));
      });
    }
    return () => es.close();
  }, []);

  return (
    <div className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">DriftSentinel</p>
          <h1>模型与中转站的实时质量情报网络</h1>
          <p className="sub">看见哪些服务正在出问题，公共网络如何评价，以及你的 Agent 应该避开哪里。</p>
        </div>
        <div className="hero-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => withBusy(setBusy, async () => {
              await runCycle();
              setVersion((v) => v + 1);
            }, setNotice, "评测已开始，真实模型结果会通过实时事件陆续刷新。")}
          >
            立即评测一轮
          </button>
          <button
            disabled={busy}
            onClick={() => withBusy(setBusy, async () => {
              await demoInject({ mode: "swap_model" });
              await runCycle();
              setVersion((v) => v + 1);
            }, setNotice, "已模拟中转站降级，并启动真实评测。")}
          >
            模拟中转站降级
          </button>
          <button
            disabled={busy}
            onClick={() => withBusy(setBusy, async () => {
              await demoRecover();
              await runCycle();
              setVersion((v) => v + 1);
            }, setNotice, "已恢复注入状态，并完成一轮评测。")}
          >
            恢复
          </button>
          <button
            disabled={busy}
            onClick={() => withBusy(setBusy, async () => {
              await demoReset();
              setVersion((v) => v + 1);
            }, setNotice, "Demo 数据已重置。")}
          >
            重置 Demo
          </button>
        </div>
      </header>

      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

      <nav className="tabs">
        <TabButton id="intel" tab={tab} setTab={setTab} label="实时情报" />
        <TabButton id="ratings" tab={tab} setTab={setTab} label="评分榜" />
        <TabButton id="watch" tab={tab} setTab={setTab} label="我的关注" />
        <TabButton id="actions" tab={tab} setTab={setTab} label="建议动作" />
        <TabButton id="evolution" tab={tab} setTab={setTab} label="进化时间线" />
        <TabButton id="developer" tab={tab} setTab={setTab} label="开发者" />
      </nav>

      {tab === "intel" && <IntelPage version={version} events={events} />}
      {tab === "ratings" && <RatingsPage version={version} />}
      {tab === "watch" && <WatchPage version={version} />}
      {tab === "actions" && <ActionsPage version={version} />}
      {tab === "evolution" && <EvolutionPage version={version} events={events} />}
      {tab === "developer" && <DeveloperPage version={version} events={events} />}
    </div>
  );
}

async function withBusy(
  setBusy: (v: boolean) => void,
  fn: () => Promise<void>,
  setNotice: (v: { kind: "ok" | "error"; text: string } | null) => void,
  okText: string,
) {
  setBusy(true);
  setNotice(null);
  try {
    await fn();
    setNotice({ kind: "ok", text: okText });
  } catch (e) {
    setNotice({
      kind: "error",
      text: e instanceof Error ? e.message : String(e),
    });
  } finally {
    setBusy(false);
  }
}

function TabButton(props: { id: Tab; tab: Tab; label: string; setTab: (t: Tab) => void }) {
  return (
    <button className={props.tab === props.id ? "active" : ""} onClick={() => props.setTab(props.id)}>
      {props.label}
    </button>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
