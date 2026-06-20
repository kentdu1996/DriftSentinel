import { getDb } from "@driftsentinel/core";

const db = getDb(process.argv[2] ?? "data/driftsentinel.db");
const rows = db
  .prepare(
    `SELECT phase, status, datetime(ts/1000,'unixepoch','localtime') AS at
     FROM gep_cycles ORDER BY id`,
  )
  .all();
console.table(rows);
db.close();
