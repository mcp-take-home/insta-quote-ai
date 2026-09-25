export const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "Insta Quote API", version: "1.0.0", description: "Upload a PDF and poll for its extracted quote data." },
  paths: {
    "/api/docs": {
      post: {
        summary: "Upload a PDF document",
        description: "Accepts a PDF up to 15 MB and queues it for processing.",
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary", description: "PDF document (maximum 15 MB)." } } } } },
        },
        responses: {
          "202": { description: "Document queued.", content: { "application/json": { schema: { $ref: "#/components/schemas/QueuedDocument" } } } },
          "400": { description: "Missing, empty, or malformed upload.", content: { "application/json": { schema: { $ref: "#/components/schemas/RequestError" } } } },
          "413": { description: "PDF exceeds 15 MB.", content: { "application/json": { schema: { $ref: "#/components/schemas/RequestError" } } } },
          "415": { description: "Upload is not a valid PDF.", content: { "application/json": { schema: { $ref: "#/components/schemas/RequestError" } } } },
        },
      },
    },
    "/api/docs/{id}": {
      get: {
        summary: "Get document processing status and result",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Current status or completed extraction result.",
            content: { "application/json": { schema: { oneOf: [
              { $ref: "#/components/schemas/QueuedDocument" },
              { $ref: "#/components/schemas/ProcessingDocument" },
              { $ref: "#/components/schemas/CompletedDocument" },
              { $ref: "#/components/schemas/FailedDocument" },
            ], discriminator: { propertyName: "status" } } } },
          },
          "404": { description: "Document not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/RequestError" } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      RequestError: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
      QueuedDocument: { type: "object", required: ["id", "status"], properties: { id: { type: "string" }, status: { const: "queued" } } },
      ProcessingDocument: { type: "object", required: ["id", "status"], properties: { id: { type: "string" }, status: { const: "processing" } } },
      FailedDocument: {
        type: "object", required: ["id", "status", "error"],
        properties: { id: { type: "string" }, status: { const: "failed" }, error: { type: "object", required: ["code", "message"], properties: { code: { const: "PDF_PROCESSING_FAILED" }, message: { type: "string" } } } },
      },
      Evidence: {
        type: "object", required: ["page", "sourceText"],
        properties: { page: { type: "integer", minimum: 1 }, line: { type: "integer", minimum: 1 }, sourceText: { type: "string", minLength: 1 }, contextText: { type: "string" } },
      },
      SourcedText: { type: "object", required: ["value", "evidence"], properties: { value: { type: "string", minLength: 1 }, evidence: { $ref: "#/components/schemas/Evidence" } } },
      SourcedNumber: { type: "object", required: ["value", "evidence"], properties: { value: { type: "number" }, evidence: { $ref: "#/components/schemas/Evidence" } } },
      ExtractionError: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } },
      ExtractedItem: {
        type: "object", required: ["evidence"],
        anyOf: [{ required: ["error"] }, { required: ["description", "quantity", "unitPrice", "lineTotal"] }],
        properties: { description: { type: "string" }, evidence: { $ref: "#/components/schemas/Evidence" }, quantity: { $ref: "#/components/schemas/SourcedNumber" }, unitPrice: { $ref: "#/components/schemas/SourcedNumber" }, lineTotal: { $ref: "#/components/schemas/SourcedNumber" }, error: { $ref: "#/components/schemas/ExtractionError" } },
      },
      Note: {
        type: "object", required: ["value"],
        properties: { value: { type: "string", minLength: 1 }, evidence: { $ref: "#/components/schemas/Evidence" }, page: { type: "integer", minimum: 1 }, line: { type: "integer", minimum: 1 }, lines: { type: "array", items: { type: "integer", minimum: 1 } }, sourceText: { type: "string" }, contextText: { type: "string" }, error: { $ref: "#/components/schemas/ExtractionError" } },
      },
      CompletedDocument: {
        type: "object", required: ["id", "status", "items", "details", "notes"],
        properties: { id: { type: "string" }, status: { const: "completed" }, pageCount: { type: "integer", minimum: 1, description: "PDF page count for new results; older saved results may omit it." }, items: { type: "array", items: { $ref: "#/components/schemas/ExtractedItem" } }, details: { type: "object", additionalProperties: { type: "array", items: { $ref: "#/components/schemas/SourcedText" } } }, notes: { type: "array", items: { $ref: "#/components/schemas/Note" } } },
      },
    },
  },
} as const;
