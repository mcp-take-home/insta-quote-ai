import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { documents } from "./schema";

export { documents } from "./schema";

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true });
  const db = drizzle({ client: sqlite, schema: { documents } });
  migrate(db, { migrationsFolder: resolve(import.meta.dir, "../drizzle") });
  return { db, sqlite };
}

export type OpenDatabase = ReturnType<typeof openDatabase>;

export function recoverProcessingJobs(db: OpenDatabase["db"]) {
  return db.update(documents).set({ status: "queued", updatedAt: new Date().toISOString() }).where(eq(documents.status, "processing")).run();
}
