import type { Capsule, DriftVerdict, Gene } from "@driftsentinel/core";
import { bus, type Dao } from "@driftsentinel/core";
import type { Broadcaster } from "@driftsentinel/router";
import { EvoMapClient, buildBundle, sanitizeBundle } from "@driftsentinel/evomap";

// Bridges the GEP Loop's Broadcaster port to the EvoMap Hub: finalize asset_ids,
// run a REAL dry-run /a2a/validate, then /a2a/publish (mocked unless DRIFT_PUBLISH=1).
// validate failures keep the bundle local — we never publish an invalid asset.
//
// After a successful publish the node also participates in the GDI public-verdict
// loop (P1): it records the experience into its PRIVATE memory (/a2a/memory/record)
// and, for REAL publishes, casts its own social signals on the shared asset
// (/a2a/assets/:id/vote + /a2a/report). All post-publish calls are best-effort:
// a failure there never invalidates the publish itself.
export class EvoMapBroadcaster implements Broadcaster {
  constructor(
    private client: EvoMapClient,
    private dao?: Dao,
  ) {}

  async broadcast(gene: Gene, capsule: Capsule, verdict: DriftVerdict): Promise<boolean> {
    const bundle = buildBundle(gene, capsule, {
      type: "EvolutionEvent",
      intent: `Share confirmed LLM endpoint degradation experience for ${verdict.endpointId}`,
      outcome: { status: "success", score: capsule.outcome.score },
      mutations_tried: 1,
      total_cycles: 1,
    });

    const san = sanitizeBundle(bundle.gene, bundle.capsule);
    bus.emit("gep.phase", {
      ts: Date.now(),
      phase: "broadcast",
      status: san.safe
        ? `sanitize passed (${san.checkedFields} fields, 0 hits)`
        : `sanitize BLOCKED (${san.hits.length} hits) - kept local`,
      payload: { endpoint: verdict.endpointId, sanitize: san },
    });
    if (!san.safe) {
      this.dao?.saveAsset(bundle.gene, "blocked_sanitize", "");
      return false;
    }

    // Ensure we are registered (hello caches node_secret; no-op if cached).
    try {
      await this.client.hello();
    } catch (e) {
      bus.emit("gep.phase", {
        ts: Date.now(),
        phase: "broadcast",
        status: `hello failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      return false;
    }

    const v = await this.client.validate(bundle);
    const body = (v.body ?? {}) as { valid?: boolean; payload?: { valid?: boolean } };
    const valid = v.ok && (body.payload?.valid ?? body.valid) === true;
    if (!valid) {
      bus.emit("gep.phase", {
        ts: Date.now(),
        phase: "broadcast",
        status: `validate rejected (status=${v.status})`,
        payload: { endpoint: verdict.endpointId },
      });
      return false;
    }

    const pub = await this.client.publish(bundle);
    if (pub.ok) {
      this.dao?.saveAsset(bundle.gene, pub.mocked ? "mock_published" : "published", pub.bundleId);
      this.dao?.saveAsset(bundle.capsule, pub.mocked ? "mock_published" : "published", pub.bundleId);
      bus.emit("evomap.published", { assetId: pub.capsuleId, kind: "Capsule" });
      bus.emit("gep.phase", {
        ts: Date.now(),
        phase: "broadcast",
        status: pub.mocked ? "published (mock)" : "published to Hub",
        payload: { bundleId: pub.bundleId, assetId: pub.capsuleId, endpoint: verdict.endpointId, sanitize: san },
      });

      // ---- P1: GDI public-verdict participation (best-effort) ----
      await this.participateGdi(bundle, verdict, pub.capsuleId, pub.mocked);
    }
    return pub.ok;
  }

  // Record private memory + cast public social signals on the freshly shared
  // asset. Each call is isolated in try/catch so a Hub hiccup can't fail the
  // broadcast or block the next signal.
  private async participateGdi(
    bundle: ReturnType<typeof buildBundle>,
    verdict: DriftVerdict,
    capsuleId: string,
    mocked: boolean,
  ): Promise<void> {
    const signals = bundle.capsule.trigger;
    const score = bundle.capsule.outcome.score;
    const summary = bundle.capsule.summary;

    // (1) Private experience memory — always attempt once registered.
    try {
      const res = await this.client.memoryRecord({
        signals,
        gene_id: bundle.gene.asset_id,
        status: "confirmed",
        score,
        summary,
      });
      this.dao?.saveAsset(bundle.capsule, "memory_recorded", capsuleId);
      bus.emit("evomap.memory", {
        endpointId: verdict.endpointId,
        status: "confirmed",
        score,
        ok: res.ok,
      });
      bus.emit("gep.phase", {
        ts: Date.now(),
        phase: "broadcast",
        status: res.ok ? "memory recorded" : `memory record failed (status=${res.status})`,
        payload: { endpoint: verdict.endpointId, assetId: capsuleId },
      });
    } catch (e) {
      bus.emit("gep.phase", {
        ts: Date.now(),
        phase: "broadcast",
        status: `memory record error: ${e instanceof Error ? e.message : String(e)}`,
        payload: { endpoint: verdict.endpointId },
      });
    }

    // (2) Public social signals require a real on-Hub asset id. Skip for mock
    // publishes (no asset persisted on the Hub to vote/report on).
    if (mocked) return;

    try {
      const res = await this.client.vote(capsuleId, 1);
      bus.emit("evomap.vote", { assetId: capsuleId, value: 1, ok: res.ok });
      bus.emit("gep.phase", {
        ts: Date.now(),
        phase: "broadcast",
        status: res.ok ? "vote +1 cast" : `vote failed (status=${res.status})`,
        payload: { endpoint: verdict.endpointId, assetId: capsuleId },
      });
    } catch (e) {
      bus.emit("gep.phase", {
        ts: Date.now(),
        phase: "broadcast",
        status: `vote error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    try {
      const res = await this.client.report(capsuleId, "confirmed", score);
      bus.emit("evomap.report", { assetId: capsuleId, status: "confirmed", score, ok: res.ok });
      bus.emit("gep.phase", {
        ts: Date.now(),
        phase: "broadcast",
        status: res.ok ? "validation report submitted" : `report failed (status=${res.status})`,
        payload: { endpoint: verdict.endpointId, assetId: capsuleId },
      });
    } catch (e) {
      bus.emit("gep.phase", {
        ts: Date.now(),
        phase: "broadcast",
        status: `report error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}
