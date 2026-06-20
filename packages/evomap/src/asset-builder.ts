import type { Capsule, EvolutionEvent, Gene } from "@driftsentinel/core";
import { computeAssetId } from "./canonical.js";

export interface Bundle {
  gene: Gene;
  capsule: Capsule;
  event?: EvolutionEvent;
}

// Finalize a Gene+Capsule(+EvolutionEvent) bundle:
// 1. compute gene.asset_id
// 2. set capsule.gene = gene.asset_id, then compute capsule.asset_id
// 3. if event present, set event.capsule_id + genes_used, compute its asset_id
export function buildBundle(
  gene: Gene,
  capsule: Capsule,
  event?: Omit<EvolutionEvent, "asset_id" | "capsule_id" | "genes_used">,
): Bundle {
  const geneId = computeAssetId(gene as unknown as Record<string, unknown>);
  const finalGene: Gene = { ...gene, asset_id: geneId };

  const linkedCapsule: Capsule = { ...capsule, gene: geneId };
  const capsuleId = computeAssetId(linkedCapsule as unknown as Record<string, unknown>);
  const finalCapsule: Capsule = { ...linkedCapsule, asset_id: capsuleId };

  let finalEvent: EvolutionEvent | undefined;
  if (event) {
    const partial: EvolutionEvent = {
      ...event,
      type: "EvolutionEvent",
      capsule_id: capsuleId,
      genes_used: [geneId],
    };
    const eventId = computeAssetId(partial as unknown as Record<string, unknown>);
    finalEvent = { ...partial, asset_id: eventId };
  }

  return { gene: finalGene, capsule: finalCapsule, event: finalEvent };
}

// Deterministic bundleId from the gene+capsule asset_id pair (mirrors Hub).
export function bundleId(gene: Gene, capsule: Capsule): string {
  return `${gene.asset_id ?? ""}__${capsule.asset_id ?? ""}`;
}
