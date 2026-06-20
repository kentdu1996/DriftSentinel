import type { NodeIdentity } from "@driftsentinel/core";
import { request, envelope, type HttpResult } from "./http.js";
import { CredentialStore } from "./credentials.js";
import { bundleId, type Bundle } from "./asset-builder.js";

export interface EvoMapClientOpts {
  hubUrl: string;
  credPath?: string;
  // When true, /a2a/publish is NOT actually sent — returns a simulated success.
  // /a2a/validate (dry-run, no persistence) is ALWAYS real. Default: true.
  mockPublish?: boolean;
  model?: string;
  name?: string;
}

export interface PublishResult {
  ok: boolean;
  bundleId: string;
  geneId: string;
  capsuleId: string;
  mocked: boolean;
  error?: string;
}

export class EvoMapClient {
  private creds: CredentialStore;
  private identity?: NodeIdentity;
  private mockPublish: boolean;

  constructor(private opts: EvoMapClientOpts) {
    this.creds = new CredentialStore(opts.credPath);
    this.identity = this.creds.load();
    this.mockPublish = opts.mockPublish ?? true;
  }

  get nodeId(): string | undefined {
    return this.identity?.nodeId;
  }

  getIdentity(): NodeIdentity | undefined {
    return this.identity;
  }

  credentialLocation(): string {
    return this.creds.location();
  }

  private url(path: string): string {
    return `${this.opts.hubUrl.replace(/\/$/, "")}${path}`;
  }

  // POST /a2a/hello — register node, cache node_secret. No auth required.
  async hello(): Promise<NodeIdentity> {
    if (this.identity?.nodeSecret) return this.identity;

    const payload = {
      capabilities: { degradation_detection: true, public_verdict: true },
      model: this.opts.model ?? "driftsentinel",
      name: this.opts.name ?? "DriftSentinel Agent",
      gene_count: 0,
      capsule_count: 0,
      env_fingerprint: {
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    };
    const res = await request<Record<string, unknown>>(
      this.url("/a2a/hello"),
      "POST",
      envelope("hello", payload),
      { timeoutMs: 8000 },
    );

    // Fields live inside payload for protocol responses; fall back to top level.
    const root = (res.body ?? {}) as Record<string, unknown>;
    const p = (root.payload as Record<string, unknown> | undefined) ?? root;
    const yourNodeId = (p.your_node_id ?? root.your_node_id) as string | undefined;
    const nodeSecret = (p.node_secret ?? root.node_secret) as string | undefined;
    const hubNodeId = (p.hub_node_id ?? root.hub_node_id) as string | undefined;
    const claimUrl = (p.claim_url ?? root.claim_url) as string | undefined;

    if (!res.ok || !yourNodeId) {
      throw new Error(`hello failed: ${res.status} ${res.error ?? JSON.stringify(res.body)}`);
    }
    const identity: NodeIdentity = {
      nodeId: yourNodeId,
      nodeSecret: nodeSecret ?? "",
      hubNodeId,
      claimUrl,
    };
    this.identity = identity;
    this.creds.save(identity);
    return identity;
  }

  private bearer(): string {
    if (!this.identity?.nodeSecret) throw new Error("not registered — call hello() first");
    return this.identity.nodeSecret;
  }

  // POST /a2a/validate — dry-run, no persistence. ALWAYS real.
  async validate(bundle: Bundle): Promise<HttpResult> {
    const assets = bundleAssets(bundle);
    return request(
      this.url("/a2a/validate"),
      "POST",
      envelope("publish", { assets }, this.identity?.nodeId),
      { bearer: this.identity?.nodeSecret, timeoutMs: 20000 },
    );
  }

  // POST /a2a/publish — broadcast bundle. Mocked unless mockPublish=false.
  async publish(bundle: Bundle): Promise<PublishResult> {
    const id = bundleId(bundle.gene, bundle.capsule);
    const base = {
      bundleId: id,
      geneId: bundle.gene.asset_id ?? "",
      capsuleId: bundle.capsule.asset_id ?? "",
    };
    if (this.mockPublish) {
      return { ok: true, mocked: true, ...base };
    }
    const assets = bundleAssets(bundle);
    const res = await request(
      this.url("/a2a/publish"),
      "POST",
      envelope("publish", { assets }, this.bearer() && this.identity!.nodeId),
      { bearer: this.bearer(), timeoutMs: 10000 },
    );
    return {
      ok: res.ok,
      mocked: false,
      error: res.ok ? undefined : `${res.status} ${res.error ?? ""}`,
      ...base,
    };
  }

  // POST /a2a/fetch — recall promoted assets matching signal filter.
  async fetch(filter: { signals_match?: string[]; limit?: number }): Promise<HttpResult> {
    return request(
      this.url("/a2a/fetch"),
      "POST",
      envelope("fetch", filter, this.identity?.nodeId),
      { bearer: this.identity?.nodeSecret, timeoutMs: 8000 },
    );
  }

  // GET /a2a/assets/search — public, by signals.
  async search(signals: string[]): Promise<HttpResult> {
    const q = encodeURIComponent(signals.join(","));
    return request(this.url(`/a2a/assets/search?signals=${q}`), "GET", undefined, {
      timeoutMs: 8000,
    });
  }

  // GET /a2a/assets/ranked — public GDI leaderboard.
  async ranked(limit = 20): Promise<HttpResult> {
    return request(this.url(`/a2a/assets/ranked?limit=${limit}`), "GET", undefined, {
      timeoutMs: 8000,
    });
  }

  // POST /a2a/assets/:id/vote — social signal. Auth required.
  async vote(assetId: string, value: 1 | -1): Promise<HttpResult> {
    return request(
      this.url(`/a2a/assets/${encodeURIComponent(assetId)}/vote`),
      "POST",
      { value, sender_id: this.identity?.nodeId },
      { bearer: this.bearer(), timeoutMs: 8000 },
    );
  }

  // POST /a2a/report — validation report (replaces "staking"). Auth required.
  async report(targetAssetId: string, status: string, score: number): Promise<HttpResult> {
    return request(
      this.url("/a2a/report"),
      "POST",
      envelope(
        "report",
        { target_asset_id: targetAssetId, validation_report: { status, score } },
        this.identity?.nodeId,
      ),
      { bearer: this.bearer(), timeoutMs: 8000 },
    );
  }

  // GET /a2a/nodes/:id — node reputation. Public.
  async nodeReputation(nodeId: string): Promise<HttpResult> {
    return request(this.url(`/a2a/nodes/${encodeURIComponent(nodeId)}`), "GET", undefined, {
      timeoutMs: 8000,
    });
  }

  // POST /a2a/memory/record — private experience. Auth required.
  async memoryRecord(rec: {
    signals: string[];
    gene_id?: string;
    status: string;
    score: number;
    summary: string;
  }): Promise<HttpResult> {
    return request(
      this.url("/a2a/memory/record"),
      "POST",
      { sender_id: this.identity?.nodeId, ...rec },
      { bearer: this.bearer(), timeoutMs: 8000 },
    );
  }
}

function bundleAssets(bundle: Bundle): unknown[] {
  const assets: unknown[] = [bundle.gene, bundle.capsule];
  if (bundle.event) assets.push(bundle.event);
  return assets;
}
