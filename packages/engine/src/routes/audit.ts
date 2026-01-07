/**
 * Audit API Routes
 *
 * View and export audit logs for compliance
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../worker";
import { rawQuery } from "../db/neon-worker";

export const auditRoutes = new Hono<{ Bindings: Env }>();

interface AuditEntry {
  sync_id: string;
  config_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  stats: Record<string, unknown> | null;
  changes_count: number;
  conflicts_count: number;
  errors_count: number;
}

interface AuditSummary {
  total_syncs: string;
  successful: string;
  partial: string;
  failed: string;
  active_configs: string;
  total_changes: string | null;
  total_conflicts: string | null;
  total_errors: string | null;
  avg_duration_seconds: string | null;
}

/**
 * GET /api/audit
 * List audit log entries
 */
auditRoutes.get("/", async (c: Context<{ Bindings: Env }>) => {
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

  if (configId) {
    conditions.push(`config_id = '${configId.replace(/'/g, "''")}'`);
  }

  if (status) {
    conditions.push(`status = '${status.replace(/'/g, "''")}'`);
  }

  if (startDate) {
    conditions.push(`started_at >= '${startDate.replace(/'/g, "''")}'`);
  }

  if (endDate) {
    conditions.push(`started_at <= '${endDate.replace(/'/g, "''")}'`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
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
    ${whereClause}
    ORDER BY started_at DESC
    LIMIT ${parseInt(limit)}
    OFFSET ${parseInt(offset)}
  `;

  const rows = await rawQuery<AuditEntry>(c.env.DATABASE_URL, query);

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM sync_audit_log
    ${whereClause}
  `;

  const countResult = await rawQuery<{ total: string }>(c.env.DATABASE_URL, countQuery);

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
auditRoutes.get("/:syncId", async (c: Context<{ Bindings: Env }>) => {
  const syncId = c.req.param("syncId");

  const query = `SELECT * FROM sync_audit_log WHERE sync_id = '${syncId.replace(/'/g, "''")}'`;
  const rows = await rawQuery<AuditEntry>(c.env.DATABASE_URL, query);

  if (rows.length === 0) {
    return c.json({ error: "Audit entry not found" }, 404);
  }

  return c.json(rows[0]);
});

/**
 * GET /api/audit/:syncId/changes
 * Get detailed changes for a sync operation
 */
auditRoutes.get("/:syncId/changes", async (c: Context<{ Bindings: Env }>) => {
  const syncId = c.req.param("syncId");

  const query = `
    SELECT * FROM sync_change_log
    WHERE sync_id = '${syncId.replace(/'/g, "''")}'
    ORDER BY created_at
  `;
  const rows = await rawQuery(c.env.DATABASE_URL, query);

  return c.json({ changes: rows });
});

/**
 * GET /api/audit/export
 * Export audit logs (CSV or JSON)
 */
auditRoutes.get("/export", async (c: Context<{ Bindings: Env }>) => {
  const {
    format = "json",
    configId,
    startDate,
    endDate,
  } = c.req.query();

  // Build conditions
  const conditions: string[] = [];
  if (configId) conditions.push(`config_id = '${configId.replace(/'/g, "''")}'`);
  if (startDate) conditions.push(`started_at >= '${startDate.replace(/'/g, "''")}'`);
  if (endDate) conditions.push(`started_at <= '${endDate.replace(/'/g, "''")}'`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
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
    ${whereClause}
    ORDER BY started_at DESC
  `;

  const rows = await rawQuery<AuditEntry>(c.env.DATABASE_URL, query);

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
    for (const row of rows) {
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
auditRoutes.get("/summary", async (c: Context<{ Bindings: Env }>) => {
  const { days = "30" } = c.req.query();
  const daysNum = parseInt(days);

  const summaryQuery = `
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
    WHERE started_at > NOW() - INTERVAL '${daysNum} days'
  `;

  const summary = await rawQuery<AuditSummary>(c.env.DATABASE_URL, summaryQuery);

  // Get daily breakdown
  const dailyQuery = `
    SELECT
      DATE(started_at) as date,
      COUNT(*) as syncs,
      COUNT(*) FILTER (WHERE status = 'success') as successful,
      SUM(changes_count) as changes
    FROM sync_audit_log
    WHERE started_at > NOW() - INTERVAL '${daysNum} days'
    GROUP BY DATE(started_at)
    ORDER BY date DESC
  `;

  const daily = await rawQuery(c.env.DATABASE_URL, dailyQuery);

  return c.json({
    period: `${days} days`,
    summary: summary[0],
    daily,
  });
});
