import type { Capsule, Gene, NodeVerdict } from "@driftsentinel/core";

// A value that may be returned synchronously (LocalHub) or asynchronously
// (RemoteHub over the real EvoMap Hub). Callers always `await` the result, so
// both implementations are interchangeable behind HubPort.
export type Awaitable<T> = T | Promise<T>;

export interface HubAsset {
  gene: Gene;
  capsule: Capsule;
  nodeId: string;
}

// The swarm's view of a shared experience Hub. LocalHub implements this for
// offline demos; RemoteHub implements it against the real EvoMap Hub via
// /a2a/publish + /a2a/fetch. SwarmNode depends only on this port, so switching
// from local simulation to the real decentralized network is a one-line change.
export interface HubPort {
  // Share a confirmed-degradation Gene+Capsule with the network.
  publish(gene: Gene, capsule: Capsule, nodeId: string): Awaitable<void>;
  // Recall peers' degradation capsules matching any of the given signals.
  fetch(signalsMatch: string[]): Awaitable<HubAsset[]>;
  // Record this node's independent verdict (for L2 cross-node consensus).
  recordVerdict(v: NodeVerdict): Awaitable<void>;
  // Other nodes' independent verdicts for the same endpoint+dimension.
  peerVerdicts(
    endpointId: string,
    dimension: string,
    exceptNodeId: string,
  ): Awaitable<NodeVerdict[]>;
}
