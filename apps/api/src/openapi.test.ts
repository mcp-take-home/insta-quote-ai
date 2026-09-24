import { afterEach, expect, test } from "bun:test";
import { createApp } from "./app";
import { openDatabase } from "./db";

const database = openDatabase(":memory:");
const app = createApp(database, "/tmp/insta-quote-openapi-test");

afterEach(() => database.sqlite.close());

test("serves the documented API routes and Scalar reference", async () => {
  const response = await app.request("/api/openapi.json");
  expect(response.status).toBe(200);
  const spec = await response.json() as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
  expect(Object.keys(spec.paths).sort()).toEqual(["/api/docs", "/api/docs/{id}"]);
  expect(spec.components.schemas.CompletedDocument).toBeDefined();
  expect(spec.components.schemas.FailedDocument).toBeDefined();
  expect(spec.components.schemas).not.toHaveProperty("Refusal");

  const reference = await app.request("/api/reference");
  expect(reference.status).toBe(200);
  expect(reference.headers.get("content-type")).toContain("text/html");
});
