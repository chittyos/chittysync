/**
 * Google Sheets Projection Client
 *
 * Reporting projection only - NOT a canonical ledger.
 * Rules:
 *   - No legal raw text, no credentials, no source URLs, no R2 URLs
 *   - Columns: date, entity, account, description, amount, currency, sourceClass, sha256 prefix
 */

import type { Env } from "../worker";
import { resolveSecret } from "../auth/secrets";
import type { FinanceRecord } from "./chittyfinance";

export interface SheetsProjectionConfig {
  spreadsheetId: string;
  sheetName: string;
}

const HEADER_ROW = ["Date","Entity","Account","Description","Amount","Currency","SourceClass","DocRef","DecisionId","ImportedAt"];

export async function appendToSheetsProjection(
  record: FinanceRecord,
  config: SheetsProjectionConfig,
  env: Env
): Promise<{ success: boolean; updatedRange?: string; error?: string }> {
  let serviceAccountJson: string;
  try {
    serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT
      ? env.GOOGLE_SERVICE_ACCOUNT
      : await resolveSecret("GOOGLE_SERVICE_ACCOUNT", env);
  } catch (err: any) {
    return { success: false, error: `Credential resolution failed: ${err.message}` };
  }

  let serviceAccount: any;
  try { serviceAccount = JSON.parse(serviceAccountJson); } catch {
    return { success: false, error: "Invalid GOOGLE_SERVICE_ACCOUNT JSON" };
  }

  let accessToken: string;
  try { accessToken = await getGoogleAccessToken(serviceAccount); } catch (err: any) {
    return { success: false, error: `Google auth failed: ${err.message}` };
  }

  const row = [
    record.transactionDate,
    record.entityId,
    record.accountId,
    record.description.slice(0, 200),
    (record.amountCents / 100).toFixed(2),
    record.currency,
    record.sourceClass,
    record.documentSha256.slice(0, 8),
    record.routingDecisionId.slice(0, 36),
    new Date().toISOString(),
  ];

  const range = `${config.sheetName}!A:J`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Sheets API returned HTTP ${res.status}: ${res.statusText}`);
    const body = await res.json() as any;
    return { success: true, updatedRange: body.updates?.updatedRange };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function ensureSheetHeader(config: SheetsProjectionConfig, env: Env): Promise<void> {
  let serviceAccountJson: string;
  try {
    serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT
      ? env.GOOGLE_SERVICE_ACCOUNT
      : await resolveSecret("GOOGLE_SERVICE_ACCOUNT", env);
  } catch { return; }
  let serviceAccount: any;
  try { serviceAccount = JSON.parse(serviceAccountJson); } catch { return; }
  let accessToken: string;
  try { accessToken = await getGoogleAccessToken(serviceAccount); } catch { return; }

  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(config.sheetName + "!A1:J1")}`;
  const readRes = await fetch(readUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!readRes?.ok) return;
  const readBody = await readRes.json() as any;
  if (readBody.values?.length) return;

  const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(config.sheetName + "!A1")}?valueInputOption=RAW`;
  await fetch(writeUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [HEADER_ROW] }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
}

export function checkSheetsReadiness(config: SheetsProjectionConfig | null, env: Env): { ready: boolean; error?: string } {
  if (!config?.spreadsheetId) return { ready: false, error: "Sheets not configured (no SHEETS_SPREADSHEET_ID)" };
  if (!env.GOOGLE_SERVICE_ACCOUNT && !env.CF_ACCESS_CLIENT_ID) return { ready: false, error: "GOOGLE_SERVICE_ACCOUNT not configured" };
  return { ready: true };
}

async function getGoogleAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  };
  const encode = (obj: any) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const sigInput = `${encode(header)}.${encode(claim)}`;
  const pemBody = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(sigInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const jwt = `${sigInput}.${sigB64}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed: HTTP ${tokenRes.status}`);
  const tokenBody = await tokenRes.json() as any;
  return tokenBody.access_token;
}
