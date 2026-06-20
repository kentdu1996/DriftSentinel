import type { DB } from "./db.js";
import type {
  Baseline,
  Dimension,
  DriftVerdict,
  EvoAsset,
  GepCycle,
  NodeVerdict,
  ProbeResult,
  RouteEntry,
} from "../types.js";

export class Dao {
  constructor(private db: DB) {}

  clearAll(): void {
    const tables = [
      "probe_results",
      "baselines",
      "drift_verdicts",
      "elo_ratings",
      "gep_cycles",
      "evomap_assets",
      "routes",
      "node_verdicts",
      "endpoints",
    ];
    for (const table of tables) {
      this.db.prepare(`DELETE FROM ${table}`).run();
    }
  }

  upsertEndpoint(e: {
    id: string;
    baseUrl: string;
    model: string;
    platform: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO endpoints (id, base_url, model, platform, created_at)
         VALUES (@id, @baseUrl, @model, @platform, @ts)
         ON CONFLICT(id) DO UPDATE SET base_url=@baseUrl, model=@model, platform=@platform`,
      )
      .run({ ...e, ts: Date.now() });
  }

  insertProbeResult(r: ProbeResult): void {
    this.db
      .prepare(
        `INSERT INTO probe_results
         (endpoint_id, ts, score, by_dimension, fingerprint, latency_p50, latency_p95, first_token_p50, samples, raw_meta)
         VALUES (@endpointId, @ts, @score, @byDimension, @fingerprint, @latencyP50, @latencyP95, @firstTokenP50, @samples, @rawMeta)`,
      )
      .run({
        endpointId: r.endpointId,
        ts: r.ts,
        score: r.score,
        byDimension: JSON.stringify(r.byDimension),
        fingerprint: JSON.stringify(r.fingerprint),
        latencyP50: r.latencyP50,
        latencyP95: r.latencyP95,
        firstTokenP50: r.firstTokenP50,
        samples: r.samples,
        rawMeta: r.rawMeta ? JSON.stringify(r.rawMeta) : null,
      });
  }

  recentProbeResults(endpointId: string, limit = 20): ProbeResult[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM probe_results WHERE endpoint_id=? ORDER BY ts DESC LIMIT ?`,
      )
      .all(endpointId, limit) as Record<string, unknown>[];
    return rows.map(rowToProbeResult);
  }

  getBaseline(endpointId: string): Baseline | undefined {
    const row = this.db
      .prepare(`SELECT * FROM baselines WHERE endpoint_id=?`)
      .get(endpointId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      endpointId: row.endpoint_id as string,
      mu: row.mu as number,
      sigma: row.sigma as number,
      n: row.n as number,
      refFingerprint: JSON.parse((row.ref_fingerprint as string) ?? "[]"),
      latencyRef: JSON.parse((row.latency_ref as string) ?? "{}"),
      updatedAt: row.updated_at as number,
    };
  }

  upsertBaseline(b: Baseline): void {
    this.db
      .prepare(
        `INSERT INTO baselines (endpoint_id, mu, sigma, n, ref_fingerprint, latency_ref, updated_at)
         VALUES (@endpointId, @mu, @sigma, @n, @refFingerprint, @latencyRef, @updatedAt)
         ON CONFLICT(endpoint_id) DO UPDATE SET
           mu=@mu, sigma=@sigma, n=@n, ref_fingerprint=@refFingerprint,
           latency_ref=@latencyRef, updated_at=@updatedAt`,
      )
      .run({
        endpointId: b.endpointId,
        mu: b.mu,
        sigma: b.sigma,
        n: b.n,
        refFingerprint: JSON.stringify(b.refFingerprint),
        latencyRef: JSON.stringify(b.latencyRef),
        updatedAt: b.updatedAt,
      });
  }

  insertVerdict(v: DriftVerdict): void {
    this.db
      .prepare(
        `INSERT INTO drift_verdicts (endpoint_id, ts, level, signals, delta)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(v.endpointId, v.ts, v.level, JSON.stringify(v.signals), v.delta);
  }

  recentVerdicts(endpointId: string, limit = 5): DriftVerdict[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM drift_verdicts WHERE endpoint_id=? ORDER BY ts DESC LIMIT ?`,
      )
      .all(endpointId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      endpointId: r.endpoint_id as string,
      ts: r.ts as number,
      level: r.level as DriftVerdict["level"],
      signals: JSON.parse((r.signals as string) ?? "[]"),
      delta: r.delta as number,
    }));
  }

  getElo(endpointId: string, dimension: Dimension): number | undefined {
    const row = this.db
      .prepare(
        `SELECT rating FROM elo_ratings WHERE endpoint_id=? AND dimension=?`,
      )
      .get(endpointId, dimension) as { rating: number } | undefined;
    return row?.rating;
  }

  setElo(endpointId: string, dimension: Dimension, rating: number): void {
    this.db
      .prepare(
        `INSERT INTO elo_ratings (endpoint_id, dimension, rating, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint_id, dimension) DO UPDATE SET rating=excluded.rating, updated_at=excluded.updated_at`,
      )
      .run(endpointId, dimension, rating, Date.now());
  }

  insertCycle(c: GepCycle): void {
    this.db
      .prepare(
        `INSERT INTO gep_cycles (ts, phase, status, payload) VALUES (?, ?, ?, ?)`,
      )
      .run(c.ts, c.phase, c.status, c.payload ? JSON.stringify(c.payload) : null);
  }

  saveAsset(
    asset: EvoAsset,
    remoteStatus: string,
    bundleId?: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO evomap_assets (asset_id, kind, bundle_id, body, remote_status, ts)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET remote_status=excluded.remote_status`,
      )
      .run(
        asset.asset_id ?? `local_${Date.now()}`,
        asset.type,
        bundleId ?? null,
        JSON.stringify(asset),
        remoteStatus,
        Date.now(),
      );
  }

  setRoute(task: string, entry: RouteEntry): void {
    this.db
      .prepare(
        `INSERT INTO routes (task, best_endpoint, weights, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(task) DO UPDATE SET best_endpoint=excluded.best_endpoint, weights=excluded.weights, updated_at=excluded.updated_at`,
      )
      .run(task, entry.best, JSON.stringify(entry.weights), Date.now());
  }

  insertNodeVerdict(v: NodeVerdict): void {
    this.db
      .prepare(
        `INSERT INTO node_verdicts (node_id, endpoint_id, dimension, level, z, reputation, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(v.nodeId, v.endpointId, v.dimension, v.level, v.z, v.reputation, v.ts);
  }

  nodeVerdicts(endpointId: string, dimension: Dimension): NodeVerdict[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM node_verdicts WHERE endpoint_id=? AND dimension=? ORDER BY ts DESC`,
      )
      .all(endpointId, dimension) as Record<string, unknown>[];
    return rows.map((r) => ({
      nodeId: r.node_id as string,
      endpointId: r.endpoint_id as string,
      dimension: r.dimension as Dimension,
      level: r.level as NodeVerdict["level"],
      z: r.z as number,
      reputation: r.reputation as number,
      ts: r.ts as number,
    }));
  }
}

function rowToProbeResult(r: Record<string, unknown>): ProbeResult {
  return {
    endpointId: r.endpoint_id as string,
    ts: r.ts as number,
    score: r.score as number,
    byDimension: JSON.parse((r.by_dimension as string) ?? "{}"),
    fingerprint: JSON.parse((r.fingerprint as string) ?? '{"vector":[],"meta":{}}'),
    latencyP50: r.latency_p50 as number,
    latencyP95: r.latency_p95 as number,
    firstTokenP50: r.first_token_p50 as number,
    samples: r.samples as number,
    rawMeta: r.raw_meta ? JSON.parse(r.raw_meta as string) : undefined,
  };
}
