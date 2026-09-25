import { resolve } from "node:path";
import { recoverProcessingJobs, openDatabase } from "./db";
import { createApp } from "./app";
import { startWorker } from "./worker";

const rootDir = resolve(import.meta.dir, "../../..");
const database = openDatabase(resolve(rootDir, "documents.sqlite"));
recoverProcessingJobs(database.db);
startWorker(database);

const app = createApp(database, resolve(rootDir, "data/uploads"));
export { app };

if (import.meta.main) {
  const port = Number(process.env.PORT || 3000);
  Bun.serve({ fetch: app.fetch, port });
  console.log(`API listening on http://localhost:${port}`);
}
