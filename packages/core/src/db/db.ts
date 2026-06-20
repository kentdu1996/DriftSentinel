import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA } from "./schema.js";

export type DB = Database.Database;

let instance: DB | undefined;

export function openDb(path = "data/driftsentinel.db"): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { timeout: 5000 });
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function getDb(path?: string): DB {
  if (!instance) instance = openDb(path);
  return instance;
}

export function closeDb(): void {
  instance?.close();
  instance = undefined;
}
