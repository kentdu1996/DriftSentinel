import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { NodeIdentity } from "@driftsentinel/core";

export const DEFAULT_CREDENTIAL_PATH = "~/.evomap/node.json";

// Stores node_id + node_secret outside of git. The official EvoMap location is
// ~/.evomap/node_id + ~/.evomap/node_secret; node.json is kept for this app.
export class CredentialStore {
  private path: string;
  private canonicalDir: string;

  constructor(path = DEFAULT_CREDENTIAL_PATH) {
    this.path = expandHome(path);
    this.canonicalDir = join(homedir(), ".evomap");
  }

  load(): NodeIdentity | undefined {
    const fromJson = this.loadJson(this.path);
    if (fromJson?.nodeSecret) return fromJson;

    const nodeIdPath = join(this.canonicalDir, "node_id");
    const nodeSecretPath = join(this.canonicalDir, "node_secret");
    if (existsSync(nodeIdPath) && existsSync(nodeSecretPath)) {
      const nodeId = readFileSync(nodeIdPath, "utf8").trim();
      const nodeSecret = readFileSync(nodeSecretPath, "utf8").trim();
      if (nodeId && nodeSecret) return { nodeId, nodeSecret };
    }

    return undefined;
  }

  save(id: NodeIdentity): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(id, null, 2) + "\n", { mode: 0o600 });
    try {
      mkdirSync(this.canonicalDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(this.canonicalDir, "node_id"), id.nodeId + "\n", { mode: 0o600 });
      writeFileSync(join(this.canonicalDir, "node_secret"), id.nodeSecret + "\n", { mode: 0o600 });
    } catch {
      // Some sandboxed environments cannot write to ~/.evomap. The primary
      // credential file above remains valid; a normal user terminal will mirror.
    }
  }

  has(): boolean {
    return !!this.load()?.nodeSecret;
  }

  location(): string {
    return this.path;
  }

  private loadJson(path: string): NodeIdentity | undefined {
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as NodeIdentity;
    } catch {
      return undefined;
    }
  }
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}
