import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DocumentResponse } from "@insta-quote/shared";
import { createApp } from "./app";
import { openDatabase, recoverProcessingJobs } from "./db";
import { processNextJob, type DocumentProcessor } from "./worker";

const fixture = new Uint8Array([...new TextEncoder().encode("%PDF-1.4\nfixture")]);
const result = {
  items: [{
    description: "Timber",
    quantity: { value: 2, evidence: { page: 1, sourceText: "2" } },
    unitPrice: { value: 10, evidence: { page: 1, sourceText: "$10.00" } },
    lineTotal: { value: 20, evidence: { page: 1, sourceText: "$20.00" } },
  }],
  refusals: [{ code: "MISSING_QUANTITY", message: "The quantity for this item is missing, so it could not be verified.", page: 1, sourceText: "Screws $3.00" }],
};

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

  test("processes outside the request and persists completed items and refusals", async () => {
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

  test("requeues interrupted processing documents on restart", async () => {
    const response = await upload();
    const { id } = await response.json() as { id: string };
    database.sqlite.query("UPDATE documents SET status = 'processing' WHERE id = ?").run(id);
    recoverProcessingJobs(database.sqlite);
    expect(database.sqlite.query<{ status: string }, [string]>("SELECT status FROM documents WHERE id = ?").get(id)?.status).toBe("queued");
  });

  test("uploads and processes a supplied sample PDF through the real extractor", async () => {
    const sample = await readFile(resolve(import.meta.dir, "../../../../data/KBS-10270.pdf"));
    const file = new File([new Uint8Array(sample).buffer as ArrayBuffer], "KBS-10270.pdf", { type: "application/pdf" });
    const response = await upload(file);
    expect(response.status).toBe(202);
    const { id } = await response.json() as { id: string };
    expect(await processNextJob(database)).toBe(true);
    const completed = await (await app.request(`/api/docs/${id}`)).json() as DocumentResponse;
    expect(completed.status).toBe("completed");
    if (completed.status !== "completed") throw new Error("Expected a completed document");
    expect(completed.items.length).toBeGreaterThan(0);
    expect(completed.items.every((item) => item.quantity.evidence.page > 0 && item.unitPrice.evidence.sourceText && item.lineTotal.evidence.sourceText)).toBe(true);
    expect(completed.refusals.length).toBeGreaterThan(0);
  });
});
