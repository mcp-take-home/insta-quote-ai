CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`file_path` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "documents_status_check" CHECK("documents"."status" in ('queued', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `documents_queue_idx` ON `documents` (`status`,`created_at`);