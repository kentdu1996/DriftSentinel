import type { Capsule, Gene } from "@driftsentinel/core";

const FORBIDDEN_KEYS = [
  "prompt",
  "messages",
  "raw",
  "input",
  "completion",
  "response_text",
  "api_key",
  "apikey",
  "authorization",
  "token",
  "secret",
  "key",
  "email",
  "user",
  "account",
];

const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "api_key", re: /sk-[A-Za-z0-9_-]{8,}/ },
  { name: "authorization", re: /Bearer\s+[A-Za-z0-9._-]+/i },
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
];

export interface SanitizeResult {
  safe: boolean;
  checkedFields: number;
  hits: string[];
}

export function sanitizeBundle(gene: Gene, capsule: Capsule): SanitizeResult {
  const hits: string[] = [];
  let checkedFields = 0;

  const scan = (obj: unknown, path: string): void => {
    if (obj == null) return;
    if (typeof obj === "string") {
      checkedFields++;
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.re.test(obj)) hits.push(`pattern:${pattern.name} @ ${path}`);
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => scan(v, `${path}[${i}]`));
      return;
    }
    if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const nextPath = path ? `${path}.${k}` : k;
        if (FORBIDDEN_KEYS.includes(k.toLowerCase())) hits.push(`key:${k} @ ${path || "<root>"}`);
        scan(v, nextPath);
      }
    }
  };

  scan(gene, "gene");
  scan(capsule, "capsule");
  return { safe: hits.length === 0, checkedFields, hits };
}
