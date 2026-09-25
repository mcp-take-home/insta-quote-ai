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
  const now = new Date().toISOString();
  const interrupted = db.update(documents).set({ status: "queued", updatedAt: now }).where(eq(documents.status, "processing")).run();
  const obsolete = db.select({ id: documents.id, resultJson: documents.resultJson }).from(documents)
    .where(eq(documents.status, "completed")).all()
    .filter((row) => row.resultJson && [
      "This row appears on a summary page",
      "This summary page repeats delivery information",
      '"OCR_REQUIRES_VERIFICATION"',
    ].some((marker) => row.resultJson!.includes(marker)));
  for (const row of obsolete) {
    db.update(documents).set({ status: "queued", resultJson: null, errorMessage: null, updatedAt: now }).where(eq(documents.id, row.id)).run();
  }
  return interrupted;
}
