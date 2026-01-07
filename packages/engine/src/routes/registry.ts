/**
 * Registry API Routes
 *
 * CRUD operations for sync configurations (registries)
 */

import { Hono } from "hono";
import type { Env } from "../worker";
import { SyncConfig } from "../sync/engine";
import { getDb } from "../db/neon-worker";

export const registryRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/registry
 * List all sync configurations
 */
registryRoutes.get("/", async (c) => {
  const sql = getDb(c.env.DATABASE_URL);
  const { enabled } = c.req.query();

  let rows;
  if (enabled === "true") {
    rows = await sql`
      SELECT * FROM sync_configs WHERE enabled = true ORDER BY name
    `;
  } else if (enabled === "false") {
    rows = await sql`
      SELECT * FROM sync_configs WHERE enabled = false ORDER BY name
    `;
  } else {
    rows = await sql`
      SELECT * FROM sync_configs ORDER BY name
    `;
  }

  return c.json({ registries: rows });
});

/**
 * GET /api/registry/:id
 * Get a specific sync configuration
 */
registryRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const sql = getDb(c.env.DATABASE_URL);

  const rows = await sql`
    SELECT * FROM sync_configs WHERE id = ${id}
  `;

  if (rows.length === 0) {
    return c.json({ error: "Registry not found" }, 404);
  }

  return c.json(rows[0]);
});

/**
 * POST /api/registry
 * Create a new sync configuration
 */
registryRoutes.post("/", async (c) => {
  const config = await c.req.json<Partial<SyncConfig>>();
  const sql = getDb(c.env.DATABASE_URL);

  // Generate ID if not provided
  const id = config.id || crypto.randomUUID();

  // Set defaults
  const fullConfig: SyncConfig = {
    id,
    name: config.name || "Untitled Registry",
    source: config.source!,
    target: config.target!,
    mode: config.mode || "bidirectional",
    conflictResolution: config.conflictResolution || "last_write_wins",
    fieldMapping: config.fieldMapping || [],
    schedule: config.schedule,
    enabled: config.enabled ?? true,
  };

  await sql`
    INSERT INTO sync_configs (
      id, name, source, target, mode,
      conflict_resolution, field_mapping, schedule, enabled
    )
    VALUES (
      ${fullConfig.id},
      ${fullConfig.name},
      ${JSON.stringify(fullConfig.source)},
      ${JSON.stringify(fullConfig.target)},
      ${fullConfig.mode},
      ${fullConfig.conflictResolution},
      ${JSON.stringify(fullConfig.fieldMapping)},
      ${fullConfig.schedule || null},
      ${fullConfig.enabled}
    )
  `;

  return c.json(fullConfig, 201);
});

/**
 * PUT /api/registry/:id
 * Update a sync configuration
 */
registryRoutes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const updates = await c.req.json<Partial<SyncConfig>>();
  const sql = getDb(c.env.DATABASE_URL);

  // Check if exists
  const existing = await sql`
    SELECT * FROM sync_configs WHERE id = ${id}
  `;

  if (existing.length === 0) {
    return c.json({ error: "Registry not found" }, 404);
  }

  // Build update
  const current = existing[0] as any;
  const updated = {
    name: updates.name ?? current.name,
    source: updates.source ? JSON.stringify(updates.source) : current.source,
    target: updates.target ? JSON.stringify(updates.target) : current.target,
    mode: updates.mode ?? current.mode,
    conflict_resolution: updates.conflictResolution ?? current.conflict_resolution,
    field_mapping: updates.fieldMapping ? JSON.stringify(updates.fieldMapping) : current.field_mapping,
    schedule: updates.schedule !== undefined ? updates.schedule : current.schedule,
    enabled: updates.enabled !== undefined ? updates.enabled : current.enabled,
  };

  await sql`
    UPDATE sync_configs
    SET
      name = ${updated.name},
      source = ${updated.source},
      target = ${updated.target},
      mode = ${updated.mode},
      conflict_resolution = ${updated.conflict_resolution},
      field_mapping = ${updated.field_mapping},
      schedule = ${updated.schedule},
      enabled = ${updated.enabled},
      updated_at = NOW()
    WHERE id = ${id}
  `;

  // Fetch and return updated
  const result = await sql`
    SELECT * FROM sync_configs WHERE id = ${id}
  `;

  return c.json(result[0]);
});

/**
 * DELETE /api/registry/:id
 * Delete a sync configuration
 */
registryRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const sql = getDb(c.env.DATABASE_URL);

  const existing = await sql`
    SELECT * FROM sync_configs WHERE id = ${id}
  `;

  if (existing.length === 0) {
    return c.json({ error: "Registry not found" }, 404);
  }

  // Delete snapshots first
  await sql`DELETE FROM sync_snapshots WHERE config_id = ${id}`;

  // Delete config
  await sql`DELETE FROM sync_configs WHERE id = ${id}`;

  return c.json({ deleted: true, id });
});

/**
 * POST /api/registry/:id/enable
 * Enable a sync configuration
 */
registryRoutes.post("/:id/enable", async (c) => {
  const id = c.req.param("id");
  const sql = getDb(c.env.DATABASE_URL);

  await sql`
    UPDATE sync_configs SET enabled = true, updated_at = NOW()
    WHERE id = ${id}
  `;

  return c.json({ enabled: true, id });
});

/**
 * POST /api/registry/:id/disable
 * Disable a sync configuration
 */
registryRoutes.post("/:id/disable", async (c) => {
  const id = c.req.param("id");
  const sql = getDb(c.env.DATABASE_URL);

  await sql`
    UPDATE sync_configs SET enabled = false, updated_at = NOW()
    WHERE id = ${id}
  `;

  return c.json({ enabled: false, id });
});

/**
 * GET /api/registry/:id/stats
 * Get sync statistics for a configuration
 */
registryRoutes.get("/:id/stats", async (c) => {
  const id = c.req.param("id");
  const sql = getDb(c.env.DATABASE_URL);

  // Get recent sync stats
  const stats = await sql`
    SELECT
      COUNT(*) as total_syncs,
      COUNT(*) FILTER (WHERE status = 'success') as successful_syncs,
      COUNT(*) FILTER (WHERE status = 'failed') as failed_syncs,
      AVG(EXTRACT(EPOCH FROM (completed_at::timestamp - started_at::timestamp))) as avg_duration_seconds,
      MAX(started_at) as last_sync,
      SUM((stats->>'created')::int) as total_created,
      SUM((stats->>'updated')::int) as total_updated,
      SUM((stats->>'deleted')::int) as total_deleted,
      SUM((stats->>'conflicts')::int) as total_conflicts
    FROM sync_audit_log
    WHERE config_id = ${id}
    AND started_at > NOW() - INTERVAL '30 days'
  `;

  // Get snapshot count
  const snapshots = await sql`
    SELECT COUNT(*) as row_count FROM sync_snapshots WHERE config_id = ${id}
  `;

  return c.json({
    configId: id,
    period: "30 days",
    ...stats[0],
    currentRowCount: snapshots[0]?.row_count || 0,
  });
});
