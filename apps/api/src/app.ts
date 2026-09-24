import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DocumentResponseSchema } from "@insta-quote/shared";
import type { OpenDatabase } from "./db";
import { documents } from "./db";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function createApp(database: OpenDatabase, uploadDir: string) {
  const app = new Hono();

  app.post("/api/docs", bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => c.json({ error: "The PDF must be no larger than 15 MB." }, 413) }), async (c) => {
    let body: Record<string, string | File>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({ error: "Upload a PDF file using multipart form data." }, 400);
    }
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "Choose a PDF file to upload." }, 400);
    if (!file.size) return c.json({ error: "The uploaded PDF is empty." }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: "The PDF must be no larger than 15 MB." }, 413);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return c.json({ error: "The uploaded file must be a PDF." }, 415);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return c.json({ error: "The file does not contain a valid PDF signature." }, 415);

    const id = randomUUID();
    const filePath = join(uploadDir, `${id}.pdf`);
    await mkdir(uploadDir, { recursive: true });
    await writeFile(filePath, bytes, { flag: "wx" });
    const now = new Date().toISOString();
    try {
      await database.db.insert(documents).values({ id, filename: file.name, filePath, status: "queued", createdAt: now, updatedAt: now });
    } catch (error) {
      await unlink(filePath).catch(() => {});
      throw error;
    }
    return c.json({ id, status: "queued" }, 202);
  });

  app.get("/api/docs/:id", async (c) => {
    const row = await database.db.query.documents.findFirst({ where: eq(documents.id, c.req.param("id")) });
    if (!row) return c.json({ error: "Document not found." }, 404);
    if (row.status === "completed") {
      try {
        if (!row.resultJson) throw new Error("Missing result");
        const parsed = JSON.parse(row.resultJson);
        return c.json(DocumentResponseSchema.parse({ id: row.id, status: "completed", items: parsed.items, refusals: parsed.refusals }));
      } catch {
        const message = "The saved processing result could not be read. Please upload the document again.";
        await database.db.update(documents).set({ status: "failed", errorMessage: message, updatedAt: new Date().toISOString() }).where(eq(documents.id, row.id));
        return c.json({ id: row.id, status: "failed", error: { code: "PDF_PROCESSING_FAILED", message } });
      }
    }
    if (row.status === "failed") return c.json({ id: row.id, status: "failed", error: { code: "PDF_PROCESSING_FAILED", message: row.errorMessage || "The PDF could not be processed." } });
    if (row.status === "processing") return c.json({ id: row.id, status: "processing" });
    return c.json({ id: row.id, status: "queued" });
  });

  return app;
}
