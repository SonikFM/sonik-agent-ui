import { z } from "zod";

// File-based readable store descriptor (Knowledge v1, AC-10). Retrieval is
// readable file inclusion into prompt context — no vector fields in v1.

export const knowledgeFileRefSchema = z.object({
  fileId: z.string().min(1),
  title: z.string().min(1),
  path: z.string().min(1),
}).strict();
export type KnowledgeFileRef = z.infer<typeof knowledgeFileRefSchema>;

export const knowledgeRefSchema = z.object({
  storeId: z.string().min(1),
  title: z.string().min(1),
  fileRefs: z.array(knowledgeFileRefSchema).default([]),
  readable: z.literal(true).default(true),
}).strict();
export type KnowledgeRef = z.infer<typeof knowledgeRefSchema>;
