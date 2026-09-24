import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { DocumentResponse } from "@insta-quote/shared";
import type { OpenDatabase } from "./db";
import { documents } from "./db";
import { extractDocument } from "./extract";

type ClaimedDocument = { id: string; file_path: string };
export type DocumentProcessor = (buffer: ArrayBuffer) => Promise<Pick<Extract<DocumentResponse, { status: "completed" }>, "items" | "refusals" | "metadata">>;

export async function processNextJob(
  { db, sqlite }: OpenDatabase,
  processor: DocumentProcessor = extractDocument,
): Promise<boolean> {
  // ponytail: one SQLite conditional update claims one row atomically; a shared multi-process queue can replace it if deployment scales beyond this local app.
  const job = sqlite.query<ClaimedDocument, [string]>(`
    UPDATE documents
    SET status = 'processing', updated_at = ?
    WHERE id = (SELECT id FROM documents WHERE status = 'queued' ORDER BY created_at, id LIMIT 1)
      AND status = 'queued'
    RETURNING id, file_path
  `).get(new Date().toISOString());
  if (!job) return false;

  try {
    const buffer = await readFile(job.file_path);
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
