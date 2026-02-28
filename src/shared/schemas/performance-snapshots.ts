import { z } from "zod/v4";

export const PerformanceSnapshotSchema = z.object({
  page_id: z.string().describe("Page UUID"),
  snapshot_date: z.string().describe("YYYY-MM-DD"),
  sessions: z.number().int().default(0),
  users: z.number().int().default(0),
  pageviews: z.number().int().default(0),
  organic_sessions: z.number().int().default(0),
  bounce_rate: z.number().min(0).max(1).optional(),
  avg_session_duration: z.number().min(0).optional(),
  click_to_call_count: z.number().int().default(0),
  calls_total: z.number().int().default(0),
  calls_qualified: z.number().int().default(0),
  revenue: z.number().default(0),
});

export type PerformanceSnapshot = z.infer<typeof PerformanceSnapshotSchema>;
