/**
 * AppSheet Review Projection
 *
 * Writes REVIEW-classified routing decisions to the AppSheet review queue.
 * Rules:
 *   - Opaque review handle only; no direct R2 URL, no document preview
 *   - Includes: sha256 prefix, MIME type, size, source class, status, timestamps
 *   - Supports resolve/reject actions via structured update endpoint
 *   - No credentials, private keys, or case-specific constants
 */

import type { Env } from "../worker";
import { resolveSecret } from "../auth/secrets";
import type { RoutingDecision } from "../routing/legal-routing";

export interface ReviewQueueRecord {
  opaqueHandle: string;
  sha256Prefix: string;
  mimeType: string;
  sizeBytes: number;
  sourceClass: string;
  status: "PENDING_REVIEW";
  createdAt: string;
  expiresAt: string;
  reasonCodes: string[];
  routingDecisionId: string;
}

export interface ReviewActionPayload {
  opaqueHandle: string;
  action: "resolve" | "reject";
  reviewerNotes?: string;
  reviewedBy: string;
}

export interface AppSheetWriteResult {
  success: boolean;
  recordId?: string;
  error?: string;
}

export async function writeToAppSheetReviewQueue(
  decision: RoutingDecision,
  context: { mimeType: string; sizeBytes: number; sourceClass: string },
  env: Env
): Promise<AppSheetWriteResult> {
  const appsheetAppId = env.APPSHEET_APP_ID;
  const appsheetTableName = env.APPSHEET_REVIEW_TABLE || "ReviewQueue";

  if (!appsheetAppId) {
    console.warn("[AppSheet] APPSHEET_APP_ID not configured; review record not written", {
      opaqueHandle: decision.opaque_review_handle,
      routingDecisionId: decision.decision_id,
    });
    return { success: false, error: "APPSHEET_APP_ID not configured" };
  }

  let appsheetKey: string;
  try {
    appsheetKey = await resolveSecret("APPSHEET_API_KEY", env);
  } catch (err: any) {
    return { success: false, error: `Credential resolution failed: ${err.message}` };
  }

  const record: ReviewQueueRecord = {
    opaqueHandle: decision.opaque_review_handle || `opaque_review_${decision.decision_id}`,
    sha256Prefix: decision.sha256.slice(0, 16),
    mimeType: context.mimeType,
    sizeBytes: context.sizeBytes,
    sourceClass: context.sourceClass,
    status: "PENDING_REVIEW",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(decision.expires_at * 1000).toISOString(),
    reasonCodes: decision.reason_codes,
    routingDecisionId: decision.decision_id,
  };

  // Safety: abort if any R2 URL or https URL slipped into the record
  const serialized = JSON.stringify(record);
  if (serialized.includes("r2.cloudflarestorage.com") || /https?:\/\/(?!oauth2\.googleapis\.com|api\.appsheet\.com)/.test(serialized)) {
    console.error("[AppSheet] Unexpected URL in review record; aborting write for safety", { decisionId: decision.decision_id });
    return { success: false, error: "URL-like content detected in review record; write aborted" };
  }

  try {
    const url = `https://api.appsheet.com/api/v2/apps/${appsheetAppId}/tables/${encodeURIComponent(appsheetTableName)}/Action`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "ApplicationAccessKey": appsheetKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Action: "Add",
        Properties: { Locale: "en-US" },
        Rows: [record],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`AppSheet API returned HTTP ${res.status}: ${res.statusText}`);
    }

    const body = await res.json() as any;
    return {
      success: true,
      recordId: body.Rows?.[0]?.["Row ID"] || body.Rows?.[0]?.opaqueHandle,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function updateReviewRecord(
  payload: ReviewActionPayload,
  env: Env
): Promise<AppSheetWriteResult> {
  if (!payload.opaqueHandle.startsWith("opaque_review_")) {
    return { success: false, error: "Invalid handle: must be an opaque review reference" };
  }

  const appsheetAppId = env.APPSHEET_APP_ID;
  if (!appsheetAppId) {
    return { success: false, error: "APPSHEET_APP_ID not configured" };
  }

  let appsheetKey: string;
  try {
    appsheetKey = await resolveSecret("APPSHEET_API_KEY", env);
  } catch (err: any) {
    return { success: false, error: `Credential resolution failed: ${err.message}` };
  }

  const appsheetTableName = env.APPSHEET_REVIEW_TABLE || "ReviewQueue";
  try {
    const url = `https://api.appsheet.com/api/v2/apps/${appsheetAppId}/tables/${encodeURIComponent(appsheetTableName)}/Action`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "ApplicationAccessKey": appsheetKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Action: "Edit",
        Properties: { Locale: "en-US" },
        Rows: [{
          opaqueHandle: payload.opaqueHandle,
          status: payload.action === "resolve" ? "RESOLVED" : "REJECTED",
          reviewedBy: payload.reviewedBy,
          reviewerNotes: payload.reviewerNotes || "",
          resolvedAt: new Date().toISOString(),
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`AppSheet API returned HTTP ${res.status}: ${res.statusText}`);
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function checkAppSheetReadiness(env: Env): { ready: boolean; error?: string } {
  if (!env.APPSHEET_APP_ID) {
    return { ready: false, error: "APPSHEET_APP_ID not configured" };
  }
  return { ready: true };
}
