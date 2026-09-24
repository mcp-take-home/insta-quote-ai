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
  description: z.string().min(1),
  evidence: EvidenceSchema.optional(),
  quantity: SourcedNumberSchema,
  unitPrice: SourcedNumberSchema,
  lineTotal: SourcedNumberSchema,
});

export const RefusalSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  page: z.number().int().positive().optional(),
  line: z.number().int().positive().optional(),
  lines: z.array(z.number().int().positive()).optional(),
  sourceText: z.string().optional(),
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
    metadata: z.object({
      companyName: SourcedTextSchema.optional(),
      documentType: SourcedTextSchema.optional(),
      documentNumber: SourcedTextSchema.optional(),
      deliveredTo: SourcedTextSchema.optional(),
      orderedBy: SourcedTextSchema.optional(),
      disclaimer: SourcedTextSchema.optional(),
    }).optional(),
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
export type Refusal = z.infer<typeof RefusalSchema>;
export type DocumentResponse = z.infer<typeof DocumentResponseSchema>;
