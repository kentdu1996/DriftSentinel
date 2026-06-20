import { openDb } from "./db.js";

const path = process.argv[2] ?? "data/driftsentinel.db";
const db = openDb(path);
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all() as { name: string }[];
db.close();

console.log(`DB initialized at ${path}`);
console.log(`Tables: ${tables.map((t) => t.name).join(", ")}`);
