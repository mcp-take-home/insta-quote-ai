import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { DocumentResponse } from "@insta-quote/shared";
import { createApp, MAX_UPLOAD_BYTES } from "./app";
import { openDatabase, recoverProcessingJobs } from "./db";
import { documents } from "./schema";
import { processNextJob, type DocumentProcessor } from "./worker";

const fixture = new Uint8Array([...new TextEncoder().encode("%PDF-1.4\nfixture")]);
const result = {
  details: { "Document No": [{ value: "KBS-1", evidence: { page: 1, line: 1, sourceText: "Document No: KBS-1" } }] },
  notes: [
    { value: "Packing List", evidence: { page: 1, line: 2, sourceText: "Packing List" } },
    { value: "The quantity for this item is missing, so it could not be verified.", page: 1, sourceText: "Screws $3.00", error: { code: "MISSING_QUANTITY", message: "The quantity for this item is missing, so it could not be verified." } },
  ],
  items: [{
    description: "Timber",
    evidence: { page: 1, line: 3, sourceText: "Timber 2 $10.00 $20.00" },
    quantity: { value: 2, evidence: { page: 1, sourceText: "2" } },
    unitPrice: { value: 10, evidence: { page: 1, sourceText: "$10.00" } },
    lineTotal: { value: 20, evidence: { page: 1, sourceText: "$20.00" } },
  }],
};
const samplePath = resolve(import.meta.dir, "../../../../data/KBS-10270.pdf");
const sampleAvailable = await Bun.file(samplePath).exists();

describe("document API", () => {
  let root: string;
  let database: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "insta-quote-api-"));
    database = openDatabase(":memory:");
    app = createApp(database, join(root, "uploads"));
  });

  afterEach(async () => {
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });

  async function upload(file = new File([fixture], "quote.pdf", { type: "application/pdf" })) {
    const form = new FormData();
    form.set("file", file);
    return app.request("/api/docs", { method: "POST", body: form });
  }

  test("stores a valid PDF as a queued document and returns immediately", async () => {
    const response = await upload();
    expect(response.status).toBe(202);
    const queued = await response.json() as { id: string; status: string };
    expect(queued.status).toBe("queued");
    expect([...await readFile(join(root, "uploads", `${queued.id}.pdf`))]).toEqual([...fixture]);
    expect(database.db.select({ status: documents.status }).from(documents).where(eq(documents.id, queued.id)).get()?.status).toBe("queued");
    expect(await (await app.request(`/api/docs/${queued.id}`)).json()).toEqual(queued);
  });

  test("processes outside the request and persists completed items, details, and notes with errors", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    let release!: (value: typeof result) => void;
    const processor: DocumentProcessor = () => new Promise((resolve) => { release = resolve; });
    const running = processNextJob(database, processor);
    await Bun.sleep(20);
    expect((await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse).status).toBe("processing");
    release(result);
    expect(await running).toBe(true);
    const completed = await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse;
    expect(completed).toEqual({ id, status: "completed", ...result });
    expect(database.db.select({ resultJson: documents.resultJson }).from(documents).where(eq(documents.id, id)).get()?.resultJson).toContain("MISSING_QUANTITY");
  });

  test("rejects missing, non-PDF, and invalid-signature uploads", async () => {
    const missing = await app.request("/api/docs", { method: "POST", body: new FormData() });
    expect(missing.status).toBe(400);
    const wrongType = await upload(new File([fixture], "quote.txt", { type: "text/plain" }));
    expect(wrongType.status).toBe(415);
    const badSignature = await upload(new File(["not a PDF"], "fake.pdf", { type: "application/pdf" }));
    expect(badSignature.status).toBe(415);
  });

  test("returns 400 for an empty file and caps oversized multipart ingress", async () => {
    const empty = await upload(new File([], "empty.pdf", { type: "application/pdf" }));
    expect(empty.status).toBe(400);
    const oversized = await upload(new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "large.pdf", { type: "application/pdf" }));
    expect(oversized.status).toBe(413);
  });

  test("returns and persists failed when a worker cannot process a PDF", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    expect(await processNextJob(database, async () => { throw new Error("PDF text could not be read."); })).toBe(true);
    const failed = await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse;
    expect(failed).toEqual({ id, status: "failed", error: { code: "PDF_PROCESSING_FAILED", message: "PDF text could not be read." } });
    expect(database.db.select({ status: documents.status, errorMessage: documents.errorMessage }).from(documents).where(eq(documents.id, id)).get()).toEqual({ status: "failed", errorMessage: "PDF text could not be read." });
  });

  test("turns a corrupt persisted result into a persisted failed response", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    database.db.update(documents).set({ status: "completed", resultJson: "{broken" }).where(eq(documents.id, id)).run();
    const failed = await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse;
    expect(failed).toEqual({ id, status: "failed", error: { code: "PDF_PROCESSING_FAILED", message: "The saved processing result could not be read. Please upload the document again." } });
    expect(database.db.select({ status: documents.status }).from(documents).where(eq(documents.id, id)).get()?.status).toBe("failed");
  });

  test("rejects persisted JSON that does not match the result contract", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    database.db.update(documents).set({ status: "completed", resultJson: JSON.stringify({ items: [{ evidence: { page: 1, line: 2, sourceText: "Unclear item" } }], details: {}, notes: [] }) }).where(eq(documents.id, id)).run();
    const failed = await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse;
    expect(failed.status).toBe("failed");
    expect(database.db.select({ status: documents.status }).from(documents).where(eq(documents.id, id)).get()?.status).toBe("failed");
  });

  test("requeues interrupted processing documents on restart", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    database.db.update(documents).set({ status: "processing" }).where(eq(documents.id, id)).run();
    recoverProcessingJobs(database.db);
    expect(database.db.select({ status: documents.status }).from(documents).where(eq(documents.id, id)).get()?.status).toBe("queued");
  });

  test("reprocesses completed results with old page-type refusals or OCR output", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    const oldResult = {
      pageCount: 8,
      ...result,
      notes: [
        { value: "Framing timber lot 5-1", page: 5, error: { code: "UNVERIFIABLE_VALUE", message: "This row appears on a summary page, so it was not counted as a delivery item." } },
        { value: "This summary page repeats delivery information, so its rows were skipped to avoid counting the same items twice.", page: 5 },
        { value: "Framing timber lot 4-1", page: 4, error: { code: "OCR_REQUIRES_VERIFICATION", message: "OCR found this item row." } },
      ],
      items: [],
    };
    database.db.update(documents).set({ status: "completed", resultJson: JSON.stringify(oldResult) }).where(eq(documents.id, id)).run();

    recoverProcessingJobs(database.db);
    expect(database.db.select({ status: documents.status, resultJson: documents.resultJson }).from(documents).where(eq(documents.id, id)).get()).toEqual({ status: "queued", resultJson: null });

    const currentResult = {
      pageCount: 8,
      details: {},
      notes: [],
      items: [{ description: "Framing timber lot 5-1", evidence: { page: 5, line: 7, sourceText: "1 Framing timber lot 5-1 10 length $16.00 $160.00" }, error: { code: "MISSING_LINE_TOTAL", message: "Needs review." } }],
    };
    expect(await processNextJob(database, async () => currentResult)).toBe(true);
    const completed = await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse;
    expect(completed.status).toBe("completed");
    if (completed.status === "completed") {
      expect(completed.items).toHaveLength(1);
      expect(completed.items[0]).toMatchObject({ description: "Framing timber lot 5-1", evidence: { page: 5 }, error: { code: "MISSING_LINE_TOTAL" } });
      expect(completed.notes).toEqual([]);
    }
  });

  test.skipIf(!sampleAvailable)("uploads and processes a supplied sample PDF through the real extractor", async () => {
    const sample = await readFile(samplePath);
    const file = new File([new Uint8Array(sample).buffer as ArrayBuffer], "KBS-10270.pdf", { type: "application/pdf" });
    const response = await upload(file);
    expect(response.status).toBe(202);
    const { id } = await response.json() as { id: string };
    expect(await processNextJob(database)).toBe(true);
    const completed = await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse;
    expect(completed.status).toBe("completed");
    if (completed.status !== "completed") throw new Error("Expected a completed document");
    expect(completed.items.length).toBeGreaterThan(0);
    expect(completed.items.every((item) => item.evidence.line && (!item.quantity || item.quantity.evidence.line) && (!item.unitPrice || item.unitPrice.evidence.line) && (!item.lineTotal || item.lineTotal.evidence.line))).toBe(true);
    expect(completed.details.Text).toContainEqual(expect.objectContaining({ value: "Kowhai Building Supplies Ltd", evidence: { page: 1, line: 1, sourceText: "Kowhai Building Supplies Ltd" } }));
    expect(completed.details["Document No"]?.[0]?.value).toBe("KBS-10270");
    expect(completed.details["Delivered to"]?.[0]?.value).toBe("Site 6, Matai Grove");
    expect(completed.details["Ordered by"]?.[0]?.value).toBe("S. Prasad");
    expect(completed.notes.some((note) => note.error?.code === "ARITHMETIC_CONTRADICTION")).toBe(false);
  });

  test.skipIf(!sampleAvailable)("uploads all supplied PDFs and returns page-scoped items through the API", async () => {
    const expected = { "KBS-10234": 5, "KBS-10241": 0, "KBS-10255": 4, "KBS-10262": 3, "KBS-10270": 4, "KBS-DR118": 21 };
    for (const [name, count] of Object.entries(expected)) {
      const bytes = await readFile(resolve(import.meta.dir, `../../../../data/${name}.pdf`));
      const response = await upload(new File([new Uint8Array(bytes).buffer as ArrayBuffer], `${name}.pdf`, { type: "application/pdf" }));
      expect(response.status).toBe(202);
      const { id } = await response.json() as { id: string };
      expect(await processNextJob(database)).toBe(true);
      const completed = await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse;
      expect(completed.status).toBe("completed");
      if (completed.status !== "completed") continue;
      expect(completed.items).toHaveLength(count);
      if (name === "KBS-DR118") {
        expect(completed.pageCount).toBe(8);
        expect(Array.from({ length: 8 }, (_, page) => completed.items.filter((item) => item.evidence.page === page + 1).length)).toEqual([3, 3, 3, 0, 3, 3, 3, 3]);
        expect(completed.notes.some((note) => "page" in note && note.page === 4 && note.error?.code === "UNREADABLE_CONTENT")).toBe(true);
      }
      if (name === "KBS-10241") expect(completed.notes.some((note) => "page" in note && note.page === 1 && note.error?.code === "UNREADABLE_CONTENT")).toBe(true);
      if (name === "KBS-10255") expect(completed.items.every((item) => item.error)).toBe(true);
    }
  }, 90_000);
});
