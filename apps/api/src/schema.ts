import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull(),
  status: text("status", { enum: ["queued", "processing", "completed", "failed"] }).notNull(),
  resultJson: text("result_json"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  check("documents_status_check", sql`${table.status} in ('queued', 'processing', 'completed', 'failed')`),
  index("documents_queue_idx").on(table.status, table.createdAt),
]);
