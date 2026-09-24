import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DocumentResponse } from "@insta-quote/shared";
import { createApp, MAX_UPLOAD_BYTES } from "./app";
import { openDatabase, recoverProcessingJobs } from "./db";
import { processNextJob, type DocumentProcessor } from "./worker";

const fixture = new Uint8Array([...new TextEncoder().encode("%PDF-1.4\nfixture")]);
const result = {
  metadata: {},
  items: [{
    description: "Timber",
    quantity: { value: 2, evidence: { page: 1, sourceText: "2" } },
    unitPrice: { value: 10, evidence: { page: 1, sourceText: "$10.00" } },
    lineTotal: { value: 20, evidence: { page: 1, sourceText: "$20.00" } },
  }],
  refusals: [{ code: "MISSING_QUANTITY", message: "The quantity for this item is missing, so it could not be verified.", page: 1, sourceText: "Screws $3.00" }],
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
    expect(database.sqlite.query<{ status: string }, [string]>("SELECT status FROM documents WHERE id = ?").get(queued.id)?.status).toBe("queued");
    expect(await (await app.request(`/api/docs/${queued.id}`)).json()).toEqual(queued);
  });

  test("processes outside the request and persists completed items, refusals, and metadata", async () => {
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
    expect(database.sqlite.query<{ result_json: string }, [string]>("SELECT result_json FROM documents WHERE id = ?").get(id)?.result_json).toContain("MISSING_QUANTITY");
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
    expect(database.sqlite.query<{ status: string; error_message: string }, [string]>("SELECT status, error_message FROM documents WHERE id = ?").get(id)).toEqual({ status: "failed", error_message: "PDF text could not be read." });
  });

  test("turns a corrupt persisted result into a persisted failed response", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    database.sqlite.query("UPDATE documents SET status = 'completed', result_json = '{broken' WHERE id = ?").run(id);
    const failed = await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse;
    expect(failed).toEqual({ id, status: "failed", error: { code: "PDF_PROCESSING_FAILED", message: "The saved processing result could not be read. Please upload the document again." } });
    expect(database.sqlite.query<{ status: string }, [string]>("SELECT status FROM documents WHERE id = ?").get(id)?.status).toBe("failed");
  });

  test("rejects persisted JSON that does not match the result contract", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    database.sqlite.query("UPDATE documents SET status = 'completed', result_json = ? WHERE id = ?").run(JSON.stringify({ items: [], refusals: [{ code: "INVALID" }] }), id);
    const failed = await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse;
    expect(failed.status).toBe("failed");
    expect(database.sqlite.query<{ status: string }, [string]>("SELECT status FROM documents WHERE id = ?").get(id)?.status).toBe("failed");
  });

  test("reads completed results saved before metadata and line evidence existed", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    const legacy = { items: [{ description: "Timber", quantity: { value: 2, evidence: { page: 1, sourceText: "2" } }, unitPrice: { value: 10, evidence: { page: 1, sourceText: "$10.00" } }, lineTotal: { value: 20, evidence: { page: 1, sourceText: "$20.00" } } }], refusals: [] };
    database.sqlite.query("UPDATE documents SET status = 'completed', result_json = ? WHERE id = ?").run(JSON.stringify(legacy), id);
    expect(await (await app.request(`/api/docs/${id}`)).json()).toEqual({ id, status: "completed", ...legacy });
  });

  test("requeues interrupted processing documents on restart", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    database.sqlite.query("UPDATE documents SET status = 'processing' WHERE id = ?").run(id);
    recoverProcessingJobs(database.sqlite);
    expect(database.sqlite.query<{ status: string }, [string]>("SELECT status FROM documents WHERE id = ?").get(id)?.status).toBe("queued");
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
    expect(completed.items.every((item) => item.evidence?.line && item.quantity.evidence.line && item.unitPrice.evidence.line && item.lineTotal.evidence.line)).toBe(true);
    expect(completed.metadata?.companyName?.value).toBe("Kowhai Building Supplies Ltd");
    expect(completed.metadata?.companyName?.evidence).toMatchObject({ page: 1, line: 1, sourceText: "Kowhai Building Supplies Ltd" });
    expect(completed.metadata?.documentType?.value).toBe("Packing List");
    expect(completed.metadata?.documentNumber?.value).toBe("KBS-10270");
    expect(completed.metadata?.deliveredTo?.value).toBe("Site 6, Matai Grove");
    expect(completed.metadata?.orderedBy?.value).toBe("S. Prasad");
    expect(completed.metadata?.disclaimer).toBeUndefined();
    expect(completed.refusals.every((refusal) => refusal.page === undefined || refusal.line !== undefined || refusal.code === "UNREADABLE_CONTENT")).toBe(true);
    expect(completed.refusals.length).toBeGreaterThan(0);
  });
});
