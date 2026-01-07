/**
 * Sync API Routes
 *
 * REST endpoints for sync operations
 */

import { Hono } from "hono";
import type { Env } from "../worker";
import { SyncEngine, SyncConfig } from "../sync/engine";
import { getDb } from "../db/neon-worker";

export const syncRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /api/sync/execute
 * Execute a sync operation
 */
syncRoutes.post("/execute", async (c) => {
  const body = await c.req.json<{
    configId?: string;
    config?: SyncConfig;
    dryRun?: boolean;
  }>();

  if (!body.configId && !body.config) {
    return c.json({ error: "Either configId or config is required" }, 400);
  }

  let config: SyncConfig;

  if (body.configId) {
    // Load config from database
    const sql = getDb(c.env.DATABASE_URL);
    const rows = await sql`
      SELECT * FROM sync_configs WHERE id = ${body.configId}
    `;
    if (rows.length === 0) {
      return c.json({ error: "Config not found" }, 404);
    }
    config = rows[0] as SyncConfig;
  } else {
    config = body.config!;
  }

  const engine = new SyncEngine({
    databaseUrl: c.env.DATABASE_URL,
    notionToken: c.env.NOTION_API_TOKEN,
    schemaUrl: c.env.CHITTY_SCHEMA_URL,
  });

  const result = await engine.sync(config, { dryRun: body.dryRun });

  return c.json(result);
});

/**
 * POST /api/sync/dry-run
 * Preview sync changes without applying
 */
syncRoutes.post("/dry-run", async (c) => {
  const body = await c.req.json<{
    configId?: string;
    config?: SyncConfig;
  }>();

  if (!body.configId && !body.config) {
    return c.json({ error: "Either configId or config is required" }, 400);
  }

  let config: SyncConfig;

  if (body.configId) {
    const sql = getDb(c.env.DATABASE_URL);
    const rows = await sql`
      SELECT * FROM sync_configs WHERE id = ${body.configId}
    `;
    if (rows.length === 0) {
      return c.json({ error: "Config not found" }, 404);
    }
    config = rows[0] as SyncConfig;
  } else {
    config = body.config!;
  }

  const engine = new SyncEngine({
    databaseUrl: c.env.DATABASE_URL,
    notionToken: c.env.NOTION_API_TOKEN,
    schemaUrl: c.env.CHITTY_SCHEMA_URL,
  });

  const result = await engine.sync(config, { dryRun: true });

  return c.json({
    preview: true,
    ...result,
  });
});

/**
 * GET /api/sync/status/:syncId
 * Get status of a sync operation
 */
syncRoutes.get("/status/:syncId", async (c) => {
  const syncId = c.req.param("syncId");
  const sql = getDb(c.env.DATABASE_URL);

  const rows = await sql`
    SELECT * FROM sync_audit_log WHERE sync_id = ${syncId}
  `;

  if (rows.length === 0) {
    return c.json({ error: "Sync not found" }, 404);
  }

  return c.json(rows[0]);
});

/**
 * GET /api/sync/history
 * Get sync history
 */
syncRoutes.get("/history", async (c) => {
  const { configId, limit = "50", offset = "0" } = c.req.query();
  const sql = getDb(c.env.DATABASE_URL);

  let rows;
  if (configId) {
    rows = await sql`
      SELECT * FROM sync_audit_log
      WHERE config_id = ${configId}
      ORDER BY started_at DESC
      LIMIT ${parseInt(limit)}
      OFFSET ${parseInt(offset)}
    `;
  } else {
    rows = await sql`
      SELECT * FROM sync_audit_log
      ORDER BY started_at DESC
      LIMIT ${parseInt(limit)}
      OFFSET ${parseInt(offset)}
    `;
  }

  return c.json({ history: rows });
});

/**
 * POST /api/sync/validate
 * Validate a sync config
 */
syncRoutes.post("/validate", async (c) => {
  const config = await c.req.json<SyncConfig>();

  const errors: string[] = [];

  // Validate required fields
  if (!config.id) errors.push("id is required");
  if (!config.name) errors.push("name is required");
  if (!config.source) errors.push("source is required");
  if (!config.target) errors.push("target is required");
  if (!config.fieldMapping || config.fieldMapping.length === 0) {
    errors.push("At least one field mapping is required");
  }

  // Validate source
  if (config.source) {
    if (!["notion", "postgres", "sheets"].includes(config.source.type)) {
      errors.push(`Invalid source type: ${config.source.type}`);
    }
    if (!config.source.id) {
      errors.push("source.id is required");
    }
  }

  // Validate target
  if (config.target) {
    if (!["notion", "postgres", "sheets"].includes(config.target.type)) {
      errors.push(`Invalid target type: ${config.target.type}`);
    }
    if (!config.target.id) {
      errors.push("target.id is required");
    }
  }

  // Validate mode
  if (config.mode && !["bidirectional", "source_to_target", "target_to_source"].includes(config.mode)) {
    errors.push(`Invalid mode: ${config.mode}`);
  }

  // Validate conflict resolution
  if (config.conflictResolution && !["last_write_wins", "source_wins", "target_wins", "manual"].includes(config.conflictResolution)) {
    errors.push(`Invalid conflictResolution: ${config.conflictResolution}`);
  }

  if (errors.length > 0) {
    return c.json({ valid: false, errors }, 400);
  }

  return c.json({ valid: true });
});
