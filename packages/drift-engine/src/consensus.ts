import type {
  ConsensusResult,
  Dimension,
  DriftLevel,
  NodeVerdict,
} from "@driftsentinel/core";
import { clamp } from "@driftsentinel/core";

const MIN_REPUTATION = 40; // only trusted nodes can establish consensus

export interface ConsensusInput {
  localNodeId: string;
  localLevel: DriftLevel;
  localZ: number;
  endpointId: string;
  dimension: Dimension;
  // independent verdicts from OTHER nodes (already fetched from Hub)
  peerVerdicts: NodeVerdict[];
}

// Implements the §8.8 consensus aggregation table.
// Dedup peers by node_id (latest wins) to prevent a single node padding counts.
export function aggregate(input: ConsensusInput): ConsensusResult {
  const { localNodeId, localLevel, localZ, endpointId, dimension, peerVerdicts } = input;

  const latestByNode = new Map<string, NodeVerdict>();
  for (const v of peerVerdicts) {
    if (v.nodeId === localNodeId) continue; // not independent
    if (v.endpointId !== endpointId || v.dimension !== dimension) continue;
    const prev = latestByNode.get(v.nodeId);
    if (!prev || v.ts > prev.ts) latestByNode.set(v.nodeId, v);
  }
  const peers = [...latestByNode.values()];
  const trusted = peers.filter((p) => p.reputation >= MIN_REPUTATION);

  const peerConfirmed = trusted.filter((p) => p.level === "confirmed");
  const peerNormal = trusted.filter((p) => p.level === "normal");
  const allPeersNormal = trusted.length > 0 && peerNormal.length === trusted.length;

  let consensusLevel: DriftLevel = localLevel;
  let conflict = false;
  let confidence = 0.5;
  // independent nodes agreeing on degradation (local counts as one source)
  let consensusNodes = 1 + peerConfirmed.length;

  if (localLevel === "suspect") {
    if (peerConfirmed.length >= 1) {
      consensusLevel = "confirmed";
      confidence = weightedConfidence(localZ, peerConfirmed);
    } else {
      consensusLevel = "suspect";
      confidence = 0.5;
      consensusNodes = 1;
    }
  } else if (localLevel === "confirmed") {
    if (peerConfirmed.length >= 1) {
      consensusLevel = "confirmed";
      confidence = Math.max(0.85, weightedConfidence(localZ, peerConfirmed));
    } else if (allPeersNormal) {
      // independent review overturns -> downgrade, conservative
      consensusLevel = "suspect";
      conflict = true;
      confidence = 0.4;
      consensusNodes = 1;
    } else {
      // no peer data yet: keep local confirmed but low cross-node confidence
      consensusLevel = "confirmed";
      confidence = 0.7;
      consensusNodes = 1;
    }
  } else {
    consensusLevel = "normal";
    confidence = 0.5;
    consensusNodes = 0;
  }

  return {
    endpointId,
    dimension,
    consensusLevel,
    consensusNodes,
    confidence: clamp(confidence, 0, 1),
    conflict,
  };
}

function weightedConfidence(localZ: number, peers: NodeVerdict[]): number {
  // map z-scores to a confidence; more negative z -> stronger signal
  const zs = [localZ, ...peers.map((p) => p.z)];
  const avgZ = zs.reduce((a, b) => a + b, 0) / zs.length;
  const fromZ = clamp((-avgZ - 1) / 4, 0, 1); // z=-2 -> 0.25, z=-5 -> 1.0
  const fromCount = clamp(0.7 + 0.1 * peers.length, 0, 0.95);
  return clamp(Math.max(0.8, (fromZ + fromCount) / 2), 0.8, 1);
}
