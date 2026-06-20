import { createHash } from "node:crypto";

// Deterministic canonical JSON: recursively sort object keys, no extra
// whitespace. Arrays keep order. Used for content-addressable asset_id.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]));
  return "{" + parts.join(",") + "}";
}

// sha256 over canonical JSON, EXCLUDING the asset_id field itself.
export function computeAssetId(asset: Record<string, unknown>): string {
  const { asset_id: _omit, ...rest } = asset;
  const canonical = canonicalize(rest);
  return "sha256:" + createHash("sha256").update(canonical, "utf8").digest("hex");
}
