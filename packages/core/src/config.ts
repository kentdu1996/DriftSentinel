import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { AppConfig } from "./types.js";

interface RawConfig {
  node?: { id_file?: string };
  hub?: { base_url?: string; auto_publish?: boolean };
  endpoints?: Array<{
    id: string;
    base_url: string;
    api_key_env: string;
    model: string;
    platform: AppConfig["endpoints"][number]["platform"];
  }>;
  probe?: {
    interval_min?: number;
    jitter_min?: number;
    samples?: number;
    testsets?: AppConfig["probe"]["testsets"];
  };
  drift?: {
    z_suspect?: number;
    z_confirm?: number;
    fp_cosine_threshold?: number;
    latency_p95_jump?: number;
  };
  router?: { stable_ratio?: number; explore_ratio?: number };
  demo?: {
    inject?: {
      enabled?: boolean;
      target?: string;
      mode?: AppConfig["demo"]["inject"]["mode"];
      weak_model?: string;
      latency_ms?: number;
    };
  };
}

const DEFAULTS = {
  intervalMin: 15,
  jitterMin: 5,
  samples: 3,
  zSuspect: -1,
  zConfirm: -2,
  fpCosineThreshold: 0.15,
  latencyP95Jump: 0.5,
  stableRatio: 0.7,
  exploreRatio: 0.3,
};

export function loadConfig(path = "config.yaml"): AppConfig {
  const raw = parse(readFileSync(resolve(path), "utf8")) as RawConfig;

  if (!raw.endpoints?.length) {
    throw new Error(`config: at least one endpoint required (${path})`);
  }

  return {
    node: { idFile: raw.node?.id_file ?? ".secrets/node.json" },
    hub: {
      baseUrl: raw.hub?.base_url ?? "https://evomap.ai",
      autoPublish: raw.hub?.auto_publish ?? false,
    },
    endpoints: raw.endpoints.map((e) => ({
      id: e.id,
      baseUrl: e.base_url,
      apiKeyEnv: e.api_key_env,
      model: e.model,
      platform: e.platform,
    })),
    probe: {
      intervalMin: raw.probe?.interval_min ?? DEFAULTS.intervalMin,
      jitterMin: raw.probe?.jitter_min ?? DEFAULTS.jitterMin,
      samples: raw.probe?.samples ?? DEFAULTS.samples,
      testsets: raw.probe?.testsets ?? ["code"],
    },
    drift: {
      zSuspect: raw.drift?.z_suspect ?? DEFAULTS.zSuspect,
      zConfirm: raw.drift?.z_confirm ?? DEFAULTS.zConfirm,
      fpCosineThreshold:
        raw.drift?.fp_cosine_threshold ?? DEFAULTS.fpCosineThreshold,
      latencyP95Jump: raw.drift?.latency_p95_jump ?? DEFAULTS.latencyP95Jump,
    },
    router: {
      stableRatio: raw.router?.stable_ratio ?? DEFAULTS.stableRatio,
      exploreRatio: raw.router?.explore_ratio ?? DEFAULTS.exploreRatio,
    },
    demo: {
      inject: {
        enabled: raw.demo?.inject?.enabled ?? false,
        target: raw.demo?.inject?.target,
        mode: raw.demo?.inject?.mode,
        weakModel: raw.demo?.inject?.weak_model,
        latencyMs: raw.demo?.inject?.latency_ms,
      },
    },
  };
}

export function resolveApiKey(env: string): string {
  const key = process.env[env];
  if (!key) throw new Error(`missing API key env var: ${env}`);
  return key;
}
