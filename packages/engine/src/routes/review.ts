/**
 * Review Queue Routes
 *
 * AppSheet integration endpoints for REVIEW-classified routing decisions.
 * Authorization: service-to-service only (internal ChittyOS calls).
 */

import { Hono } from "hono";
import type { Env } from "../worker";
import { writeToAppSheetReviewQueue, updateReviewRecord } from "../integrations/appsheet-review";
import type { RoutingDecision } from "../routing/legal-routing";

export const reviewRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /api/v1/review/queue
 * Enqueue a REVIEW-classified routing decision to the AppSheet review table.
 * Body: { decision: RoutingDecision, context: { mimeType, sizeBytes, sourceClass } }
 */
reviewRoutes.post("/queue", async (c) => {
  const body = await c.req.json<{
    decision: RoutingDecision;
    context: { mimeType: string; sizeBytes: number; sourceClass: string };
  }>();

  if (!body.decision || body.decision.decision !== "REVIEW") {
    return c.json({ error: "Only REVIEW-classified decisions may be enqueued" }, 400);
  }

  if (!body.decision.opaque_review_handle?.startsWith("opaque_review_")) {
    return c.json({ error: "Invalid or missing opaque_review_handle" }, 400);
  }

  const result = await writeToAppSheetReviewQueue(body.decision, body.context, c.env);

  if (!result.success) {
    return c.json({ error: result.error }, 503);
  }

  return c.json({ success: true, recordId: result.recordId }, 202);
});

/**
 * POST /api/v1/review/action
 * Resolve or reject a review record by opaque handle.
 * Body: { opaqueHandle, action: "resolve" | "reject", reviewedBy, reviewerNotes? }
 */
reviewRoutes.post("/action", async (c) => {
  const body = await c.req.json<{
    opaqueHandle: string;
    action: "resolve" | "reject";
    reviewedBy: string;
    reviewerNotes?: string;
  }>();

  if (!body.opaqueHandle || !body.action || !body.reviewedBy) {
    return c.json({ error: "opaqueHandle, action, and reviewedBy are required" }, 400);
  }

  if (!["resolve", "reject"].includes(body.action)) {
    return c.json({ error: "action must be 'resolve' or 'reject'" }, 400);
  }

  const result = await updateReviewRecord(body, c.env);

  if (!result.success) {
    return c.json({ error: result.error }, 503);
  }

  return c.json({ success: true }, 200);
});
