import { z } from "zod";
import { defineContract, createClient, defineEvent, createEventClient } from "../contracts/core";

export const IndexCodebaseParamsSchema = z.object({
  appId: z.number(),
});

export const IndexCodebaseResponseSchema = z.object({
  indexed: z.number(),
  skipped: z.number(),
  total: z.number(),
});

export const GetIndexStatusParamsSchema = z.object({
  appId: z.number(),
});

export const GetIndexStatusResponseSchema = z.object({
  chunkCount: z.number(),
});

export const IndexProgressPayloadSchema = z.object({
  appId: z.number(),
  indexed: z.number(),
  total: z.number(),
  state: z.enum(["indexing", "complete", "error"]),
  error: z.string().optional(),
});

export type IndexProgressPayload = z.infer<typeof IndexProgressPayloadSchema>;

export const ClearIndexParamsSchema = z.object({
  appId: z.number(),
});

export const ClearIndexResponseSchema = z.object({
  success: z.boolean(),
});

export const codeIndexContracts = {
  indexCodebase: defineContract({
    channel: "code-index:index",
    input: IndexCodebaseParamsSchema,
    output: IndexCodebaseResponseSchema,
  }),
  getIndexStatus: defineContract({
    channel: "code-index:status",
    input: GetIndexStatusParamsSchema,
    output: GetIndexStatusResponseSchema,
  }),
  clearIndex: defineContract({
    channel: "code-index:clear",
    input: ClearIndexParamsSchema,
    output: ClearIndexResponseSchema,
  }),
};

export const codeIndexEvents = {
  indexProgress: defineEvent({
    channel: "code-index:progress",
    payload: IndexProgressPayloadSchema,
  }),
};

export const codeIndexClient = createClient(codeIndexContracts);
export const codeIndexEventClient = createEventClient(codeIndexEvents);
