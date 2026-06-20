import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Capsule, Gene, NodeVerdict } from "@driftsentinel/core";

// A file-backed local mirror of the Hub for OFFLINE cross-node demos.
// When publish is mocked (no real Hub writes), two local nodes still need a
// shared place to exchange capsules and verdicts. LocalHub is that shared store.
// The real Hub (/a2a/publish + /a2a/fetch) is a drop-in replacement: same
// publish/fetch/search shape.

interface HubState {
  assets: { gene: Gene; capsule: Capsule; nodeId: string; ts: number }[];
  verdicts: NodeVerdict[];
}

const EMPTY: HubState = { assets: [], verdicts: [] };

export class LocalHub {
  constructor(private path = "data/local-hub.json") {}

  private read(): HubState {
    if (!existsSync(this.path)) return { ...EMPTY };
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as HubState;
    } catch {
      return { ...EMPTY };
    }
  }

  private write(state: HubState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(state, null, 2), "utf8");
  }

  publish(gene: Gene, capsule: Capsule, nodeId: string): void {
    const s = this.read();
    s.assets.push({ gene, capsule, nodeId, ts: Date.now() });
    this.write(s);
  }

  // Mirror of /a2a/fetch + /a2a/assets/search: match by signal overlap.
  fetch(signalsMatch: string[]): { gene: Gene; capsule: Capsule; nodeId: string }[] {
    const s = this.read();
    return s.assets.filter((a) =>
      a.capsule.trigger.some((t) => signalsMatch.includes(t)) ||
      a.gene.signals_match.some((t) => signalsMatch.includes(t)),
    );
  }

  recordVerdict(v: NodeVerdict): void {
    const s = this.read();
    s.verdicts.push(v);
    this.write(s);
  }

  // Peer verdicts for a given endpoint+dimension (excludes the asking node).
  peerVerdicts(endpointId: string, dimension: string, exceptNodeId: string): NodeVerdict[] {
    const s = this.read();
    return s.verdicts.filter(
      (v) => v.endpointId === endpointId && v.dimension === dimension && v.nodeId !== exceptNodeId,
    );
  }

  reset(): void {
    this.write({ ...EMPTY });
  }
}
