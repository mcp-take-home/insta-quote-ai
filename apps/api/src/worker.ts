import { readFile } from "node:fs/promises";
import { and, asc, eq } from "drizzle-orm";
import type { DocumentResponse } from "@insta-quote/shared";
import type { OpenDatabase } from "./db";
import { documents } from "./schema";
import { extractDocument } from "./extract";

export type DocumentProcessor = (buffer: ArrayBuffer) => Promise<Pick<Extract<DocumentResponse, { status: "completed" }>, "items" | "details" | "notes">>;

export async function processNextJob(
  { db }: OpenDatabase,
  processor: DocumentProcessor = extractDocument,
): Promise<boolean> {
  // ponytail: one SQLite conditional update claims one row atomically; a shared multi-process queue can replace it if deployment scales beyond this local app.
  const job = db.transaction((tx) => {
    const queued = tx.select({ id: documents.id }).from(documents)
      .where(eq(documents.status, "queued"))
      .orderBy(asc(documents.createdAt), asc(documents.id))
      .limit(1).get();
    if (!queued) return undefined;
    return tx.update(documents)
      .set({ status: "processing", updatedAt: new Date().toISOString() })
      .where(and(eq(documents.id, queued.id), eq(documents.status, "queued")))
      .returning({ id: documents.id, filePath: documents.filePath }).get();
  });
  if (!job) return false;

  try {
    const buffer = await readFile(job.filePath);
    const result = await processor(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    await db.update(documents).set({ status: "completed", resultJson: JSON.stringify(result), errorMessage: null, updatedAt: new Date().toISOString() }).where(eq(documents.id, job.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The PDF could not be processed.";
    await db.update(documents).set({ status: "failed", errorMessage: message.slice(0, 500), updatedAt: new Date().toISOString() }).where(eq(documents.id, job.id));
  }
  return true;
}

export function startWorker(database: OpenDatabase, processor: DocumentProcessor = extractDocument, pollMs = 250) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void processNextJob(database, processor).catch((error) => console.error("Document worker iteration failed", error)).finally(() => { running = false; });
  }, pollMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
