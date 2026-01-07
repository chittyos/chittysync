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
  CHITTY_LEDGER_URL?: string;
  CHITTY_AUTH_URL?: string;

  // Crypto
  ENGINE_PUBKEY_HEX?: string;

  // Environment
  ENVIRONMENT?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Middleware
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

// ChittyOS ecosystem status endpoint (for ChittyHelper registration)
app.get("/api/v1/status", async (c) => {
  const startTime = Date.now();

  // Check database connectivity
  let dbHealthy = false;
  try {
    const { getDb } = await import("./db/neon-worker");
    const sql = getDb(c.env.DATABASE_URL);
    await sql`SELECT 1`;
    dbHealthy = true;
  } catch {
    dbHealthy = false;
  }

  return c.json({
    status: dbHealthy ? "healthy" : "degraded",
    service: "chittysync",
    version: "2.0.0",
    uptime: process.uptime?.() ?? 0,
    timestamp: new Date().toISOString(),
    checks: {
      database: dbHealthy ? "connected" : "disconnected",
      api: "operational",
    },
    latency: Date.now() - startTime,
  });
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
