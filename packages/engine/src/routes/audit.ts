/**
 * Audit API Routes
 *
 * View and export audit logs for compliance
 */

import { Hono } from "hono";
import type { Env } from "../worker";
import { getDb } from "../db/neon-worker";

export const auditRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/audit
 * List audit log entries
 */
auditRoutes.get("/", async (c) => {
  const sql = getDb(c.env.DATABASE_URL);
  const {
    configId,
    status,
    startDate,
    endDate,
    limit = "100",
    offset = "0",
  } = c.req.query();

  // Build dynamic query conditions
  const conditions: string[] = [];
  const params: any[] = [];

  if (configId) {
    conditions.push(`config_id = $${params.length + 1}`);
    params.push(configId);
  }

  if (status) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(status);
  }

  if (startDate) {
    conditions.push(`started_at >= $${params.length + 1}`);
    params.push(startDate);
  }

  if (endDate) {
    conditions.push(`started_at <= $${params.length + 1}`);
    params.push(endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Use tagged template for the base query
  const rows = await sql`
    SELECT
      sync_id,
      config_id,
      status,
      started_at,
      completed_at,
      stats,
      changes_count,
      conflicts_count,
      errors_count
    FROM sync_audit_log
    ${sql.unsafe(whereClause)}
    ORDER BY started_at DESC
    LIMIT ${parseInt(limit)}
    OFFSET ${parseInt(offset)}
  `;

  // Get total count
  const countResult = await sql`
    SELECT COUNT(*) as total
    FROM sync_audit_log
    ${sql.unsafe(whereClause)}
  `;

  return c.json({
    entries: rows,
    total: parseInt(countResult[0]?.total || "0"),
    limit: parseInt(limit),
    offset: parseInt(offset),
  });
});

/**
 * GET /api/audit/:syncId
 * Get detailed audit entry
 */
auditRoutes.get("/:syncId", async (c) => {
  const syncId = c.req.param("syncId");
  const sql = getDb(c.env.DATABASE_URL);

  const rows = await sql`
    SELECT * FROM sync_audit_log WHERE sync_id = ${syncId}
  `;

  if (rows.length === 0) {
    return c.json({ error: "Audit entry not found" }, 404);
  }

  return c.json(rows[0]);
});

/**
 * GET /api/audit/:syncId/changes
 * Get detailed changes for a sync operation
 */
auditRoutes.get("/:syncId/changes", async (c) => {
  const syncId = c.req.param("syncId");
  const sql = getDb(c.env.DATABASE_URL);

  const rows = await sql`
    SELECT * FROM sync_change_log
    WHERE sync_id = ${syncId}
    ORDER BY created_at
  `;

  return c.json({ changes: rows });
});

/**
 * GET /api/audit/export
 * Export audit logs (CSV or JSON)
 */
auditRoutes.get("/export", async (c) => {
  const sql = getDb(c.env.DATABASE_URL);
  const {
    format = "json",
    configId,
    startDate,
    endDate,
  } = c.req.query();

  // Build conditions
  const conditions: string[] = [];
  if (configId) conditions.push(`config_id = '${configId}'`);
  if (startDate) conditions.push(`started_at >= '${startDate}'`);
  if (endDate) conditions.push(`started_at <= '${endDate}'`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await sql`
    SELECT
      sync_id,
      config_id,
      status,
      started_at,
      completed_at,
      stats,
      changes_count,
      conflicts_count,
      errors_count
    FROM sync_audit_log
    ${sql.unsafe(whereClause)}
    ORDER BY started_at DESC
  `;

  if (format === "csv") {
    const headers = [
      "sync_id",
      "config_id",
      "status",
      "started_at",
      "completed_at",
      "changes_count",
      "conflicts_count",
      "errors_count",
    ];

    const csvRows = [headers.join(",")];
    for (const row of rows as any[]) {
      csvRows.push(
        [
          row.sync_id,
          row.config_id,
          row.status,
          row.started_at,
          row.completed_at,
          row.changes_count,
          row.conflicts_count,
          row.errors_count,
        ].join(",")
      );
    }

    return new Response(csvRows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="audit-export-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  }

  return c.json({
    exportedAt: new Date().toISOString(),
    count: rows.length,
    entries: rows,
  });
});

/**
 * GET /api/audit/summary
 * Get audit summary statistics
 */
auditRoutes.get("/summary", async (c) => {
  const sql = getDb(c.env.DATABASE_URL);
  const { days = "30" } = c.req.query();

  const summary = await sql`
    SELECT
      COUNT(*) as total_syncs,
      COUNT(*) FILTER (WHERE status = 'success') as successful,
      COUNT(*) FILTER (WHERE status = 'partial') as partial,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(DISTINCT config_id) as active_configs,
      SUM(changes_count) as total_changes,
      SUM(conflicts_count) as total_conflicts,
      SUM(errors_count) as total_errors,
      AVG(EXTRACT(EPOCH FROM (completed_at::timestamp - started_at::timestamp))) as avg_duration_seconds
    FROM sync_audit_log
    WHERE started_at > NOW() - INTERVAL '${sql.unsafe(days)} days'
  `;

  // Get daily breakdown
  const daily = await sql`
    SELECT
      DATE(started_at) as date,
      COUNT(*) as syncs,
      COUNT(*) FILTER (WHERE status = 'success') as successful,
      SUM(changes_count) as changes
    FROM sync_audit_log
    WHERE started_at > NOW() - INTERVAL '${sql.unsafe(days)} days'
    GROUP BY DATE(started_at)
    ORDER BY date DESC
  `;

  return c.json({
    period: `${days} days`,
    summary: summary[0],
    daily,
  });
});
