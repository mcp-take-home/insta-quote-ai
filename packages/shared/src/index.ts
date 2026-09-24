import { z } from "zod";

export const EvidenceSchema = z.object({
  page: z.number().int().positive(),
  sourceText: z.string().min(1),
  contextText: z.string().optional(),
});

export const SourcedNumberSchema = z.object({
  value: z.number().finite(),
  evidence: EvidenceSchema,
});

export const ExtractedItemSchema = z.object({
  description: z.string().min(1),
  quantity: SourcedNumberSchema,
  unitPrice: SourcedNumberSchema,
  lineTotal: SourcedNumberSchema.optional(),
});

export const RefusalSchema = z.object({
  message: z.string().min(1),
  page: z.number().int().positive().optional(),
  contextText: z.string().optional(),
});

const DocumentIdSchema = z.string().min(1);

export const DocumentResponseSchema = z.discriminatedUnion("status", [
  z.object({ id: DocumentIdSchema, status: z.literal("queued") }),
  z.object({ id: DocumentIdSchema, status: z.literal("processing") }),
  z.object({
    id: DocumentIdSchema,
    status: z.literal("completed"),
    items: z.array(ExtractedItemSchema),
    refusals: z.array(RefusalSchema),
  }),
  z.object({
    id: DocumentIdSchema,
    status: z.literal("failed"),
    error: z.string().min(1),
  }),
]);

export type Evidence = z.infer<typeof EvidenceSchema>;
export type SourcedNumber = z.infer<typeof SourcedNumberSchema>;
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;
export type Refusal = z.infer<typeof RefusalSchema>;
export type DocumentResponse = z.infer<typeof DocumentResponseSchema>;
