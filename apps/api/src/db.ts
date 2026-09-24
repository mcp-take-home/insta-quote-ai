import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull(),
  status: text("status", { enum: ["queued", "processing", "completed", "failed"] }).notNull(),
  resultJson: text("result_json"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true });
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
      result_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS documents_queue_idx ON documents(status, created_at);
  `);
  return { db: drizzle({ client: sqlite, schema: { documents } }), sqlite };
}

export type OpenDatabase = ReturnType<typeof openDatabase>;

export function recoverProcessingJobs(sqlite: Database) {
  sqlite.query("UPDATE documents SET status = 'queued', updated_at = ? WHERE status = 'processing'").run(new Date().toISOString());
}
