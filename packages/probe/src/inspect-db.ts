import { getDb } from "@driftsentinel/core";

const db = getDb(process.argv[2] ?? "data/driftsentinel.db");
const rows = db
  .prepare(
    `SELECT endpoint_id, round(score,1) AS score, latency_p50, latency_p95,
            json_extract(fingerprint,'$.meta.diversity') AS diversity,
            json_extract(fingerprint,'$.meta.self_consistency') AS consistency,
            datetime(ts/1000,'unixepoch','localtime') AS at
     FROM probe_results ORDER BY ts`,
  )
  .all();
console.table(rows);
db.close();
