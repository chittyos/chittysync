/**
 * ChittyFinance Integration Client
 *
 * Forwards ALLOW_GENERAL records to the canonical ChittyFinance ledger.
 * Rules:
 *   - Sends only ALLOW_GENERAL-classified records (never ROUTE_LEGAL or REVIEW)
 *   - Canonical entity/account identifiers; never document bodies
 *   - Records idempotency keys and stores reconciliation receipts
 *   - Fails closed: on ledger error, returns an error receipt (never silently drops)
 */

import type { Env } from "../worker";
import { resolveSecret } from "../auth/secrets";

export interface FinanceRecord {
  /** Canonical entity identifier (e.g. ARIBIA_LLC, ITCANBE_LLC) */
  entityId: string;
  /** Canonical account identifier from ChittyFinance account registry */
  accountId: string;
  /** Transaction description — no document bodies or file content */
  description: string;
  /** ISO 8601 transaction date */
  transactionDate: string;
  /** Amount in minor units (cents) */
  amountCents: number;
  /** Currency code (ISO 4217) */
  currency: string;
  /** Idempotency key — caller-supplied, stable across retries */
  idempotencyKey: string;
  /** Source class (e.g. bank_statement, invoice, expense) — no filenames or paths */
  sourceClass: string;
  /** SHA-256 of the originating document (hex) — audit linkage only */
  documentSha256: string;
  /** Routing decision ID that authorized this record for general ingestion */
  routingDecisionId: string;
}

export interface FinanceReceipt {
  ledgerEntryId: string;
  idempotencyKey: string;
  status: "accepted" | "duplicate" | "error";
  timestamp: string;
  error?: string;
}

export async function submitToChittyFinance(
  record: FinanceRecord,
  env: Env
): Promise<FinanceReceipt> {
  const ledgerUrl = env.CHITTY_LEDGER_URL || "https://ledger.chitty.cc";

  let credentials: string;
  try {
    credentials = await resolveSecret("CHITTY_SYNC_SERVICE_CREDENTIALS", env);
  } catch (err: any) {
    return {
      ledgerEntryId: "",
      idempotencyKey: record.idempotencyKey,
      status: "error",
      timestamp: new Date().toISOString(),
      error: `Credential resolution failed: ${err.message}`,
    };
  }

  const entry = {
    entityType: "transaction",
    entityId: record.entityId,
    action: "general_import",
    actor: "chittysync",
    actorType: "service",
    metadata: {
      accountId: record.accountId,
      description: record.description,
      transactionDate: record.transactionDate,
      amountCents: record.amountCents,
      currency: record.currency,
      sourceClass: record.sourceClass,
      documentSha256: record.documentSha256,
      routingDecisionId: record.routingDecisionId,
      idempotencyKey: record.idempotencyKey,
    },
  };

  try {
    const res = await fetch(`${ledgerUrl}/entries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials}`,
        "X-Idempotency-Key": record.idempotencyKey,
      },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 409) {
      const body = await res.json() as any;
      return {
        ledgerEntryId: body.id || body.ledgerEntryId || "",
        idempotencyKey: record.idempotencyKey,
        status: "duplicate",
        timestamp: new Date().toISOString(),
      };
    }

    if (!res.ok) {
      throw new Error(`ChittyFinance returned HTTP ${res.status}: ${res.statusText}`);
    }

    const body = await res.json() as any;
    return {
      ledgerEntryId: body.id || body.ledgerEntryId || "",
      idempotencyKey: record.idempotencyKey,
      status: "accepted",
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      ledgerEntryId: "",
      idempotencyKey: record.idempotencyKey,
      status: "error",
      timestamp: new Date().toISOString(),
      error: err.message,
    };
  }
}

export async function checkChittyFinanceReadiness(env: Env): Promise<{
  ready: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const ledgerUrl = env.CHITTY_LEDGER_URL || "https://ledger.chitty.cc";
  const start = Date.now();
  try {
    const res = await fetch(`${ledgerUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return { ready: res.ok, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ready: false, latencyMs: Date.now() - start, error: err.message };
  }
}
