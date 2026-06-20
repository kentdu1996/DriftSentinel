import type { AppConfig, Dao } from "@driftsentinel/core";
import { GepLoop, type Broadcaster } from "@driftsentinel/router";

// Background daemon: runs GEP Loop cycles on an interval. Each cycle scans all
// endpoints, detects drift, and (if confirmed) auto-reroutes + solidifies.
export class Daemon {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private cfg: AppConfig,
    private dao: Dao,
    private opts: { genesPath?: string; configPath?: string; broadcaster?: Broadcaster } = {},
  ) {}

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const loop = new GepLoop(
        this.cfg,
        { dao: this.dao, genesPath: this.opts.genesPath ?? "genes.json" },
        {
          configPath: this.opts.configPath ?? "config.yaml",
          dimension: "code",
          probeN: this.isMockConfig() ? 5 : 2,
          broadcaster: this.opts.broadcaster,
        },
      );
      await loop.runCycle();
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 60_000): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private isMockConfig(): boolean {
    return this.cfg.endpoints.every((ep) => ep.baseUrl.startsWith("mock://"));
  }
}
