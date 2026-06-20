// Shared domain types for DriftSentinel. All packages depend on these.

export type Platform = "openai" | "anthropic" | "relay" | "mock";

export type Dimension = "code" | "math" | "instruct" | "fact" | "longctx";

export type DriftLevel = "normal" | "suspect" | "confirmed";

export type GraderType =
  | "unit_test"
  | "numeric_tolerance"
  | "json_schema"
  | "regex"
  | "exact"
  | "keyword_hit";

export interface EndpointConfig {
  id: string;
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  platform: Platform;
}

export interface InjectConfig {
  enabled: boolean;
  target?: string;
  mode?: "swap_model" | "add_latency" | "truncate";
  weakModel?: string;
  latencyMs?: number;
}

export interface AppConfig {
  node: { idFile: string };
  hub: { baseUrl: string; autoPublish: boolean };
  endpoints: EndpointConfig[];
  probe: {
    intervalMin: number;
    jitterMin: number;
    samples: number;
    testsets: Dimension[];
  };
  drift: {
    zSuspect: number;
    zConfirm: number;
    fpCosineThreshold: number;
    latencyP95Jump: number;
  };
  router: { stableRatio: number; exploreRatio: number };
  demo: { inject: InjectConfig };
}

// ---- Probe ----

export interface TokenLogprob {
  token: string;
  logprob: number;
  topLogprobs?: { token: string; logprob: number }[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  model: string;
  temperature?: number;
  maxTokens?: number;
  logprobs?: boolean;
  topLogprobs?: number;
  timeoutMs?: number;
}

export interface ChatResult {
  text: string;
  latencyMs: number;
  firstTokenMs: number;
  usage?: { prompt: number; completion: number };
  logprobs?: TokenLogprob[];
}

export interface Fingerprint {
  vector: number[];
  meta: Record<string, number>;
}

export interface ProbeResult {
  endpointId: string;
  ts: number;
  score: number; // 0..100 weighted total
  byDimension: Partial<Record<Dimension, number>>;
  fingerprint: Fingerprint;
  latencyP50: number;
  latencyP95: number;
  firstTokenP50: number;
  samples: number;
  rawMeta?: Record<string, unknown>;
}

// ---- Test set ----

export interface TestItem {
  id: string;
  source: string;
  dimension: Dimension;
  difficulty: "easy" | "medium" | "hard";
  template: string;
  params?: Record<string, string>;
  promptRender: string;
  grader: { type: GraderType; spec: string; timeoutS?: number };
  weight: number;
}

// ---- Drift ----

export interface DriftSignal {
  type: "score" | "latency" | "fingerprint";
  hit: boolean;
  delta: number;
}

export interface DriftVerdict {
  endpointId: string;
  ts: number;
  level: DriftLevel;
  signals: DriftSignal[];
  delta: number;
}

export interface Baseline {
  endpointId: string;
  mu: number;
  sigma: number;
  n: number;
  refFingerprint: number[];
  latencyRef: { p50: number; p95: number };
  updatedAt: number;
}

// ---- Consensus (cross-node, §8.8) ----

export interface NodeVerdict {
  nodeId: string;
  endpointId: string;
  dimension: Dimension;
  level: DriftLevel;
  z: number;
  reputation: number;
  ts: number;
}

export interface ConsensusResult {
  endpointId: string;
  dimension: Dimension;
  consensusLevel: DriftLevel;
  consensusNodes: number;
  confidence: number;
  conflict: boolean;
}

// ---- Routing ----

export interface RouteEntry {
  best: string;
  weights: Record<string, number>;
}

export interface GenesFile {
  version: number;
  routes: Record<string, RouteEntry>;
  updatedAt: number;
}

// ---- GEP Loop ----

export type GepPhase =
  | "scan"
  | "signal"
  | "intent"
  | "mutate"
  | "validate"
  | "solidify"
  | "broadcast";

export interface GepCycle {
  ts: number;
  phase: GepPhase;
  status: string;
  payload?: Record<string, unknown>;
}

// ---- EvoMap assets (GEP-A2A schema 1.5.0) ----

export type GeneCategory =
  | "repair"
  | "optimize"
  | "innovate"
  | "regulatory"
  | "explore";

export interface Gene {
  type: "Gene";
  schema_version: "1.5.0";
  id: string;
  category: GeneCategory;
  signals_match: string[];
  summary: string;
  preconditions?: string[];
  strategy: string[];
  constraints: { max_files: number; forbidden_paths: string[] };
  validation: string[];
  epigenetic_marks?: string[];
  asset_id?: string;
}

export interface Capsule {
  type: "Capsule";
  schema_version: "1.5.0";
  trigger: string[];
  gene: string;
  summary: string;
  confidence: number;
  blast_radius: { files: number; lines: number };
  outcome: { status: string; score: number };
  success_streak: number;
  env_fingerprint: { node_version: string; platform: string; arch: string };
  // Substantive content (Hub requires >=1 of these to be non-trivial).
  content?: string;
  strategy?: string[];
  code_snippet?: string;
  diff?: string;
  asset_id?: string;
}

export interface EvolutionEvent {
  type: "EvolutionEvent";
  intent: string;
  capsule_id: string;
  genes_used: string[];
  outcome: { status: string; score: number };
  mutations_tried: number;
  total_cycles: number;
  asset_id?: string;
}

export type EvoAsset = Gene | Capsule | EvolutionEvent;

export interface NodeIdentity {
  nodeId: string;
  nodeSecret: string;
  hubNodeId?: string;
  claimUrl?: string;
}
