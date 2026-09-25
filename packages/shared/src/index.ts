import { z } from "zod";

export const EvidenceSchema = z.object({
  page: z.number().int().positive(),
  line: z.number().int().positive().optional(),
  sourceText: z.string().min(1),
  contextText: z.string().optional(),
});

export const SourcedTextSchema = z.object({
  value: z.string().min(1),
  evidence: EvidenceSchema,
});

export const SourcedNumberSchema = z.object({
  value: z.number().finite(),
  evidence: EvidenceSchema,
});

export const ExtractedItemSchema = z.object({
  description: z.string().min(1).optional(),
  evidence: EvidenceSchema,
  quantity: SourcedNumberSchema.optional(),
  unitPrice: SourcedNumberSchema.optional(),
  lineTotal: SourcedNumberSchema.optional(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).optional(),
}).refine((item) => item.error !== undefined || (item.description !== undefined && item.quantity !== undefined && item.unitPrice !== undefined && item.lineTotal !== undefined), {
  message: "An incomplete item must include an error explaining what could not be verified.",
});

export const NoteSchema = z.object({
  value: z.string().min(1),
  evidence: EvidenceSchema.optional(),
  page: z.number().int().positive().optional(),
  line: z.number().int().positive().optional(),
  lines: z.array(z.number().int().positive()).optional(),
  sourceText: z.string().optional(),
  contextText: z.string().optional(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).optional(),
});

const DocumentIdSchema = z.string().min(1);

export const DocumentResponseSchema = z.discriminatedUnion("status", [
  z.object({ id: DocumentIdSchema, status: z.literal("queued") }),
  z.object({ id: DocumentIdSchema, status: z.literal("processing") }),
  z.object({
    id: DocumentIdSchema,
    status: z.literal("completed"),
    pageCount: z.number().int().positive().optional(),
    items: z.array(ExtractedItemSchema),
    details: z.record(z.string(), z.array(SourcedTextSchema)),
    notes: z.array(NoteSchema),
  }),
  z.object({
    id: DocumentIdSchema,
    status: z.literal("failed"),
    error: z.object({
      code: z.literal("PDF_PROCESSING_FAILED"),
      message: z.string().min(1),
    }),
  }),
]);

export type Evidence = z.infer<typeof EvidenceSchema>;
export type SourcedText = z.infer<typeof SourcedTextSchema>;
export type SourcedNumber = z.infer<typeof SourcedNumberSchema>;
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type DocumentResponse = z.infer<typeof DocumentResponseSchema>;
