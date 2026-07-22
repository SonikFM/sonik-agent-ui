import { z } from "zod";

// Bounds per plan D4 (.omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md):
// 32KB response cap, 200-entry console ring, 100-entry network ring.
export const OBSERVE_RESPONSE_MAX_BYTES = 32768;
export const CONSOLE_RING_CAPACITY = 200;
export const NETWORK_RING_CAPACITY = 100;

export const observeConsoleLevelSchema = z.enum(["log", "info", "warn", "error", "debug"]);

export const observeConsoleReadInputSchema = z.strictObject({
  level: observeConsoleLevelSchema.optional(),
  sinceId: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(CONSOLE_RING_CAPACITY).default(CONSOLE_RING_CAPACITY),
});

export const observeConsoleEntrySchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  level: observeConsoleLevelSchema,
  message: z.string(),
  timestamp: z.string().min(1),
});

export const observeConsoleReadResultSchema = z.strictObject({
  ok: z.boolean(),
  status: z.enum(["executed", "blocked", "unavailable"]),
  receiptId: z.string().min(1),
  capturedAt: z.string().min(1),
  entries: z.array(observeConsoleEntrySchema),
  droppedCount: z.number().int().nonnegative(),
  stale: z.boolean(),
});

export const observeNetworkReadInputSchema = z.strictObject({
  status: z.number().int().optional(),
  urlPattern: z.string().min(1).optional(),
  sinceId: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(NETWORK_RING_CAPACITY).default(NETWORK_RING_CAPACITY),
});

export const observeNetworkEntrySchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  method: z.string().min(1),
  url: z.string().min(1),
  status: z.number().int(),
  durationMs: z.number().nonnegative(),
  sizeBytes: z.number().nonnegative(),
});

export const observeNetworkReadResultSchema = z.strictObject({
  ok: z.boolean(),
  status: z.enum(["executed", "blocked", "unavailable"]),
  receiptId: z.string().min(1),
  capturedAt: z.string().min(1),
  entries: z.array(observeNetworkEntrySchema),
  droppedCount: z.number().int().nonnegative(),
  stale: z.boolean(),
});

export type ObserveConsoleLevel = z.infer<typeof observeConsoleLevelSchema>;
export type ObserveConsoleReadInput = z.infer<typeof observeConsoleReadInputSchema>;
export type ObserveConsoleEntry = z.infer<typeof observeConsoleEntrySchema>;
export type ObserveConsoleReadResult = z.infer<typeof observeConsoleReadResultSchema>;
export type ObserveNetworkReadInput = z.infer<typeof observeNetworkReadInputSchema>;
export type ObserveNetworkEntry = z.infer<typeof observeNetworkEntrySchema>;
export type ObserveNetworkReadResult = z.infer<typeof observeNetworkReadResultSchema>;
