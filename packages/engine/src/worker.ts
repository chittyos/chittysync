/**
 * ChittySync Engine - Cloudflare Worker
 *
 * Enterprise data synchronization for Notion <-> PostgreSQL <-> Google Sheets
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { syncRoutes } from "./routes/sync";
import { healthRoutes } from "./routes/health";
import { registryRoutes } from "./routes/registry";
import { auditRoutes } from "./routes/audit";
import { reviewRoutes } from "./routes/review";
import type { ScheduledEvent, ExecutionContext } from "./worker.d";

export interface Env {
  // Database
  DATABASE_URL: string;

  // Notion
  NOTION_API_TOKEN?: string;

  // Google Sheets
  GOOGLE_SERVICE_ACCOUNT?: string;

  // ChittyOS ecosystem
  CHITTY_SCHEMA_URL?: string;
  CHITTY_FINANCE_URL?: string;
  CHITTY_AUTH_URL?: string;
  CHITTYSECRETS_URL?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  CHITTY_JWKS_URL?: string;
  CHITTY_ISSUER_URI?: string;
  CHITTY_AUDIENCE_URI?: string;
  CHITTY_ROUTER_URL?: string;

  // AppSheet
  APPSHEET_APP_ID?: string;
  APPSHEET_REVIEW_TABLE?: string;

  // Google Sheets
  SHEETS_SPREADSHEET_ID?: string;
  SHEETS_SHEET_NAME?: string;

  // Crypto
  ENGINE_PUBKEY_HEX?: string;

  // Environment
  ENVIRONMENT?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Middleware
// 1. Request ID — injected before all other middleware so every log line is traceable
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use('*', async (c: any, next: any) => {
  const requestId: string = (c.req.header('cf-ray') as string | undefined) ?? crypto.randomUUID();
  c.header('X-Request-Id', requestId);
  return next();
});
// 2. Logging — runs after request ID is stamped
app.use("*", logger());
app.use("*", cors({
  origin: ["https://chitty.cc", "https://*.chitty.cc"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-ChittySync-Version"],
  exposeHeaders: ["X-ChittySync-Request-Id"],
  maxAge: 86400,
}));

// Routes
app.route("/health", healthRoutes);
app.route("/api/sync", syncRoutes);
app.route("/api/registry", registryRoutes);
app.route("/api/audit", auditRoutes);
app.route("/api/v1/review", reviewRoutes);

// ChittyOS ecosystem status endpoint (Phase 3 — ChittyHelper registration + projection readiness)
app.get("/api/v1/status", async (c) => {
  const startTime = Date.now();
  const env = c.env;

  // 1. Database
  let dbStatus: { ok: boolean; latencyMs?: number; error?: string } = { ok: false };
  try {
    const dbStart = Date.now();
    const { getDb } = await import("./db/neon-worker");
    const sql = getDb(env.DATABASE_URL);
    await sql`SELECT 1`;
    dbStatus = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (err: any) {
    dbStatus = { ok: false, error: err.message };
  }

  // 2. JWKS / routing policy reachability (no key material exposed)
  let routingStatus: { ok: boolean; latencyMs?: number; jwksCacheStatus: string; error?: string } = { ok: false, jwksCacheStatus: "not_checked" };
  try {
    const jwksUrl = env.CHITTY_JWKS_URL || "https://auth.chitty.cc/.well-known/jwks.json";
    const jwksStart = Date.now();
    const jwksRes = await fetch(jwksUrl, { method: "GET", signal: AbortSignal.timeout(5000) });
    const latency = Date.now() - jwksStart;
    if (jwksRes.ok) {
      const body = await jwksRes.json() as any;
      const keyCount = body.keys?.length ?? 0;
      routingStatus = { ok: true, latencyMs: latency, jwksCacheStatus: `reachable (${keyCount} key(s); material not logged)` };
    } else {
      routingStatus = { ok: false, latencyMs: latency, jwksCacheStatus: "unreachable", error: `HTTP ${jwksRes.status}` };
    }
  } catch (err: any) {
    routingStatus = { ok: false, jwksCacheStatus: "unreachable", error: err.message };
  }

  // 3. ChittySecrets readiness (existence probe only — no names or values logged)
  let secretsStatus: { ok: boolean; latencyMs?: number; error?: string } = { ok: false };
  try {
    const secretsUrl = env.CHITTYSECRETS_URL || "https://secrets.chitty.cc";
    const secStart = Date.now();
    const headers: Record<string, string> = {};
    if (env.CF_ACCESS_CLIENT_ID) {
      headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID;
      headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET || "";
    }
    const secRes = await fetch(`${secretsUrl}/health`, { method: "GET", headers, signal: AbortSignal.timeout(5000) });
    secretsStatus = { ok: secRes.ok, latencyMs: Date.now() - secStart };
    if (!secRes.ok) secretsStatus.error = `HTTP ${secRes.status}`;
  } catch (err: any) {
    secretsStatus = { ok: false, error: err.message };
  }

  // 4. ChittyFinance readiness
  const { checkChittyFinanceReadiness } = await import("./integrations/chittyfinance");
  const financeStatus = await checkChittyFinanceReadiness(env);

  // 5. Sheets projection readiness
  const { checkSheetsReadiness } = await import("./integrations/sheets-projection");
  const sheetsConfig = env.SHEETS_SPREADSHEET_ID
    ? { spreadsheetId: env.SHEETS_SPREADSHEET_ID, sheetName: env.SHEETS_SHEET_NAME || "Transactions" }
    : null;
  const sheetsStatus = checkSheetsReadiness(sheetsConfig, env);

  // 6. AppSheet review queue readiness
  const { checkAppSheetReadiness } = await import("./integrations/appsheet-review");
  const appsheetStatus = checkAppSheetReadiness(env);

  // Critical: ALL four must be ok for healthy production processing.
  //   - database: cannot sync without it
  //   - routingStatus: cannot classify documents without JWKS/ChittyRouter
  //   - secretsStatus: cannot resolve any runtime credentials
  //   - financeStatus: ALLOW_GENERAL records cannot be recorded (declared service contract)
  // Projection services (Sheets, AppSheet) are reported separately; their failure
  // degrades reporting but does not block core ingestion.
  const criticalOk = dbStatus.ok && routingStatus.ok && secretsStatus.ok && financeStatus.ready;
  const projectionOk = sheetsStatus.ready && appsheetStatus.ready;
  const overallStatus = criticalOk && projectionOk ? "healthy"
    : criticalOk ? "degraded"   // projections unavailable but core ok
    : "unhealthy";                // one or more critical deps down

  return c.json({
    status: overallStatus,
    service: "chittysync",
    version: "2.0.0",
    environment: env.ENVIRONMENT || "development",
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startTime,
    checks: {
      database: { status: dbStatus.ok ? "connected" : "disconnected", latencyMs: dbStatus.latencyMs, error: dbStatus.error },
      routingPolicy: {
        status: routingStatus.ok ? "reachable" : "unreachable",
        latencyMs: routingStatus.latencyMs,
        jwksCacheStatus: routingStatus.jwksCacheStatus,
        error: routingStatus.error,
      },
      chittySecrets: {
        status: secretsStatus.ok ? "reachable" : "unreachable",
        latencyMs: secretsStatus.latencyMs,
        // reason_code only — no secret names, token values, or internal URLs
        reason_code: secretsStatus.ok ? undefined : "SECRETS_UNREACHABLE",
      },
      chittyFinance: {
        status: financeStatus.ready ? "ready" : "not_ready",
        latencyMs: financeStatus.latencyMs,
        reason_code: financeStatus.ready ? undefined : "FINANCE_UNREACHABLE",
      },
      sheetsProjection: {
        status: sheetsStatus.ready ? "configured" : "not_configured",
        error: sheetsStatus.error,
      },
      appsheetReview: {
        status: appsheetStatus.ready ? "configured" : "not_configured",
        error: appsheetStatus.error,
      },
    },
  }, overallStatus === "unhealthy" ? 503 : overallStatus === "degraded" ? 207 : 200);
});

// Root
app.get("/", (c) => {
  return c.json({
    service: "ChittySync",
    version: "2.0.0",
    description: "Enterprise data synchronization platform",
    docs: "https://docs.chitty.cc/sync",
    endpoints: {
      health: "/health",
      sync: "/api/sync",
      registry: "/api/registry",
      audit: "/api/audit",
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found", path: c.req.path }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error(`[ChittySync Error] ${err.message}`, err.stack);
  return c.json({
    error: err.message,
    requestId: c.req.header("cf-ray") || crypto.randomUUID(),
  }, 500);
});

// Scheduled handler for cron-triggered syncs
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`[ChittySync] Scheduled sync triggered at ${new Date(event.scheduledTime).toISOString()}`);

    // TODO: Implement scheduled sync logic
    // 1. Fetch all registries configured for auto-sync
    // 2. Execute sync for each registry
    // 3. Log results to audit trail

    ctx.waitUntil(
      Promise.resolve().then(async () => {
        console.log("[ChittySync] Scheduled sync completed");
      })
    );
  },
};
