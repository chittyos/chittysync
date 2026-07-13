/**
 * ChittyFinance Integration
 *
 * Records ALLOW_GENERAL corporate document imports to ChittyFinance
 * (finance.chitty.cc). ChittyFinance is the canonical corporate finance
 * plane for ChittyOS. CHITTY_FINANCE_URL must resolve to finance.chitty.cc
 * in production and staging.
 *
 * API contract:
 *   POST /import   Record a document import event (idempotent)
 *   GET  /health   Liveness probe
 *
 * Rules:
 *   - ALLOW_GENERAL records only (never ROUTE_LEGAL or REVIEW)
 *   - Canonical entity/account IDs; no document bodies, filenames, or paths
 *   - X-Idempotency-Key on every POST; 409 = safe duplicate, not an error
 *   - Error receipt returned on any failure; never silently dropped
 *   - Credentials resolved through ChittySecrets at runtime
 */

import type { Env } from "../worker";
import { resolveSecret } from "../auth/secrets";

export interface FinanceImportRecord {
  entityId: string;
  accountId: string;
  description: string;
  transactionDate: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  sourceClass: string;
  documentSha256: string;
  routingDecisionId: string;
}

export interface FinanceImportReceipt {
  importId: string;
  idempotencyKey: string;
  status: "accepted" | "duplicate" | "error";
  timestamp: string;
  error?: string;
}

export async function submitToChittyFinance(
  record: FinanceImportRecord,
  env: Env
): Promise<FinanceImportReceipt> {
  const financeUrl = env.CHITTY_FINANCE_URL ?? "https://finance.chitty.cc";

  let credentials: string;
  try {
    credentials = await resolveSecret("CHITTY_SYNC_SERVICE_CREDENTIALS", env);
  } catch (err: any) {
    return {
      importId: "",
      idempotencyKey: record.idempotencyKey,
      status: "error",
      timestamp: new Date().toISOString(),
      error: err.message as string,
    };
  }

  const payload = {
    entityId:          record.entityId,
    accountId:         record.accountId,
    description:       record.description,
    transactionDate:   record.transactionDate,
    amountCents:       record.amountCents,
    currency:          record.currency,
    sourceClass:       record.sourceClass,
    documentSha256:    record.documentSha256,
    routingDecisionId: record.routingDecisionId,
    idempotencyKey:    record.idempotencyKey,
  };

  try {
    const endpoint = financeUrl + "/import";
    const authHeader = "Bearer " + credentials;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "Authorization":     authHeader,
        "X-Idempotency-Key": record.idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 409) {
      const body = await res.json() as any;
      return {
        importId:       body.importId ?? body.id ?? "",
        idempotencyKey: record.idempotencyKey,
        status:         "duplicate",
        timestamp:      new Date().toISOString(),
      };
    }

    if (!res.ok) {
      throw new Error("ChittyFinance returned HTTP " + res.status.toString());
    }

    const body = await res.json() as any;
    return {
      importId:       body.importId ?? body.id ?? "",
      idempotencyKey: record.idempotencyKey,
      status:         "accepted",
      timestamp:      new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      importId:       "",
      idempotencyKey: record.idempotencyKey,
      status:         "error",
      timestamp:      new Date().toISOString(),
      error:          err.message as string,
    };
  }
}

export async function checkChittyFinanceReadiness(env: Env): Promise<{
  ready: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const financeUrl = env.CHITTY_FINANCE_URL ?? "https://finance.chitty.cc";
  const start = Date.now();
  try {
    const res = await fetch(financeUrl + "/health", {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    return { ready: res.ok, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ready: false, latencyMs: Date.now() - start, error: err.message as string };
  }
}
