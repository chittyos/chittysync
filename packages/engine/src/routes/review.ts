/**
 * Review Queue Routes
 *
 * AppSheet integration endpoints for REVIEW-classified routing decisions.
 * Authentication is mandatory on every endpoint — never advisory.
 *
 * POST /api/v1/review/queue   — requires scope: chittysync:review:write
 * POST /api/v1/review/action  — requires scope: chittysync:review:resolve
 *
 * Authentication: see middleware/service-auth.ts
 */

import { Hono } from 'hono';
import type { Env } from '../worker';
import { requireServiceAuth, SCOPE_REVIEW_WRITE, SCOPE_REVIEW_RESOLVE } from '../middleware/service-auth';
import { writeToAppSheetReviewQueue, updateReviewRecord } from '../integrations/appsheet-review';
import type { RoutingDecision } from '../routing/legal-routing';

export const reviewRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /api/v1/review/queue
 * Enqueue a REVIEW-classified routing decision to the AppSheet review table.
 * Scope required: chittysync:review:write
 */
reviewRoutes.post('/queue', async (c) => {
  const authResult = await requireServiceAuth(SCOPE_REVIEW_WRITE)(c as any, async () => {});
  if (authResult instanceof Response) return authResult;

  const body = await c.req.json<{
    decision: RoutingDecision;
    context: { mimeType: string; sizeBytes: number; sourceClass: string };
  }>();

  if (!body.decision || body.decision.decision !== 'REVIEW') {
    return c.json({ error: 'Only REVIEW-classified decisions may be enqueued' }, 400);
  }
  if (!body.decision.opaque_review_handle?.startsWith('opaque_review_')) {
    return c.json({ error: 'Invalid or missing opaque_review_handle' }, 400);
  }

  const result = await writeToAppSheetReviewQueue(body.decision, body.context, c.env);
  if (!result.success) return c.json({ error: result.error }, 503);
  return c.json({ success: true, recordId: result.recordId }, 202);
});

/**
 * POST /api/v1/review/action
 * Resolve or reject a review record by opaque handle.
 * Scope required: chittysync:review:resolve
 */
reviewRoutes.post('/action', async (c) => {
  const authResult = await requireServiceAuth(SCOPE_REVIEW_RESOLVE)(c as any, async () => {});
  if (authResult instanceof Response) return authResult;

  const body = await c.req.json<{
    opaqueHandle: string;
    action: 'resolve' | 'reject';
    reviewedBy: string;
    reviewerNotes?: string;
  }>();

  if (!body.opaqueHandle || !body.action || !body.reviewedBy) {
    return c.json({ error: 'opaqueHandle, action, and reviewedBy are required' }, 400);
  }
  if (!['resolve', 'reject'].includes(body.action)) {
    return c.json({ error: "action must be 'resolve' or 'reject'" }, 400);
  }

  const result = await updateReviewRecord(body, c.env);
  if (!result.success) return c.json({ error: result.error }, 503);
  return c.json({ success: true }, 200);
});
