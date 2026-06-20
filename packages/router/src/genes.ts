import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { GenesFile, RouteEntry } from "@driftsentinel/core";

const EMPTY: GenesFile = { version: 0, routes: {}, updatedAt: 0 };

export class GenesStore {
  constructor(private path = "genes.json") {}

  load(): GenesFile {
    if (!existsSync(this.path)) return { ...EMPTY };
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as GenesFile;
    } catch {
      return { ...EMPTY };
    }
  }

  // Persist a new routing table, bumping the version. Returns the saved file.
  save(routes: Record<string, RouteEntry>): GenesFile {
    const prev = this.load();
    const next: GenesFile = {
      version: prev.version + 1,
      routes,
      updatedAt: Date.now(),
    };
    writeFileSync(this.path, JSON.stringify(next, null, 2) + "\n", "utf8");
    return next;
  }

  setRoute(task: string, entry: RouteEntry): GenesFile {
    const cur = this.load();
    cur.routes[task] = entry;
    return this.save(cur.routes);
  }
}
