/**
 * Health check endpoints
 */

import { Hono } from "hono";
import type { Env } from "../worker";
import { getDb } from "../db/neon-worker";

export const healthRoutes = new Hono<{ Bindings: Env }>();

// Basic health check
healthRoutes.get("/", async (c) => {
  const startTime = Date.now();

  const checks: Record<string, { status: string; latency?: number; error?: string }> = {
    service: { status: "healthy" },
  };

  // Check database connection
  try {
    const dbStart = Date.now();
    const sql = getDb(c.env.DATABASE_URL);
    await sql`SELECT 1 as ping`;
    checks.database = { status: "healthy", latency: Date.now() - dbStart };
  } catch (err: any) {
    checks.database = { status: "unhealthy", error: err.message };
  }

  // Check Notion connection (if configured)
  if (c.env.NOTION_API_TOKEN) {
    try {
      const notionStart = Date.now();
      const res = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${c.env.NOTION_API_TOKEN}`,
          "Notion-Version": "2022-06-28",
        },
      });
      checks.notion = {
        status: res.ok ? "healthy" : "unhealthy",
        latency: Date.now() - notionStart,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err: any) {
      checks.notion = { status: "unhealthy", error: err.message };
    }
  } else {
    checks.notion = { status: "not_configured" };
  }

  // Check schema service
  if (c.env.CHITTY_SCHEMA_URL) {
    try {
      const schemaStart = Date.now();
      const res = await fetch(`${c.env.CHITTY_SCHEMA_URL}/health`);
      checks.schema = {
        status: res.ok ? "healthy" : "degraded",
        latency: Date.now() - schemaStart,
      };
    } catch (err: any) {
      checks.schema = { status: "degraded", error: err.message };
    }
  }

  const overallStatus = Object.values(checks).every(
    (c) => c.status === "healthy" || c.status === "not_configured" || c.status === "degraded"
  )
    ? "healthy"
    : "unhealthy";

  return c.json({
    status: overallStatus,
    service: "ChittySync",
    version: "2.0.0",
    environment: c.env.ENVIRONMENT || "development",
    timestamp: new Date().toISOString(),
    latency: Date.now() - startTime,
    checks,
  }, overallStatus === "healthy" ? 200 : 503);
});

// Readiness check (for k8s/load balancers)
healthRoutes.get("/ready", async (c) => {
  try {
    const sql = getDb(c.env.DATABASE_URL);
    await sql`SELECT 1`;
    return c.json({ ready: true });
  } catch {
    return c.json({ ready: false }, 503);
  }
});

// Liveness check
healthRoutes.get("/live", (c) => {
  return c.json({ live: true });
});
