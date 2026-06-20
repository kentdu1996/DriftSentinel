export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS endpoints (
  id TEXT PRIMARY KEY,
  base_url TEXT,
  model TEXT,
  platform TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS probe_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT,
  ts INTEGER,
  score REAL,
  by_dimension TEXT,
  fingerprint TEXT,
  latency_p50 REAL,
  latency_p95 REAL,
  first_token_p50 REAL,
  samples INTEGER,
  raw_meta TEXT,
  FOREIGN KEY (endpoint_id) REFERENCES endpoints (id)
);
CREATE INDEX IF NOT EXISTS idx_probe_ep_ts ON probe_results (endpoint_id, ts);

CREATE TABLE IF NOT EXISTS baselines (
  endpoint_id TEXT PRIMARY KEY,
  mu REAL,
  sigma REAL,
  n INTEGER,
  ref_fingerprint TEXT,
  latency_ref TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS drift_verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT,
  ts INTEGER,
  level TEXT,
  signals TEXT,
  delta REAL
);
CREATE INDEX IF NOT EXISTS idx_verdict_ep_ts ON drift_verdicts (endpoint_id, ts);

CREATE TABLE IF NOT EXISTS elo_ratings (
  endpoint_id TEXT,
  dimension TEXT,
  rating REAL,
  updated_at INTEGER,
  PRIMARY KEY (endpoint_id, dimension)
);

CREATE TABLE IF NOT EXISTS gep_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,
  phase TEXT,
  status TEXT,
  payload TEXT
);

CREATE TABLE IF NOT EXISTS evomap_assets (
  asset_id TEXT PRIMARY KEY,
  kind TEXT,
  bundle_id TEXT,
  body TEXT,
  remote_status TEXT,
  ts INTEGER
);

CREATE TABLE IF NOT EXISTS routes (
  task TEXT PRIMARY KEY,
  best_endpoint TEXT,
  weights TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS node_verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT,
  endpoint_id TEXT,
  dimension TEXT,
  level TEXT,
  z REAL,
  reputation REAL,
  ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_nodeverdict ON node_verdicts (endpoint_id, dimension);
`;
