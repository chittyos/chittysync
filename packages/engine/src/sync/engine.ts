/**
 * ChittySync Engine
 *
 * Core sync orchestration: Fetch -> Diff -> Validate -> Resolve -> Apply -> Audit
 */

import { NotionAdapter, NotionRow } from "../adapters/notion";
import { getDb } from "../db/neon-worker";

export interface SyncConfig {
  id: string;
  name: string;
  source: DataSource;
  target: DataSource;
  mode: "bidirectional" | "source_to_target" | "target_to_source";
  conflictResolution: "last_write_wins" | "source_wins" | "target_wins" | "manual";
  fieldMapping: FieldMapping[];
  schedule?: string;
  enabled: boolean;
}

export interface DataSource {
  type: "notion" | "postgres" | "sheets";
  id: string; // database_id for Notion, table name for Postgres, sheet URL for Sheets
  schema?: string; // Optional schema reference for validation
}

export interface FieldMapping {
  source: string;
  target: string;
  type?: string;
  transform?: string;
  readonly?: boolean;
}

export interface SyncResult {
  syncId: string;
  configId: string;
  status: "success" | "partial" | "failed";
  startedAt: string;
  completedAt: string;
  stats: SyncStats;
  changes: ChangeRecord[];
  conflicts: ConflictRecord[];
  errors: ErrorRecord[];
}

export interface SyncStats {
  sourceRows: number;
  targetRows: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  conflicts: number;
  errors: number;
}

export interface ChangeRecord {
  type: "create" | "update" | "delete";
  direction: "source_to_target" | "target_to_source";
  rowId: string;
  fields: string[];
  before?: Record<string, any>;
  after?: Record<string, any>;
}

export interface ConflictRecord {
  rowId: string;
  field: string;
  sourceValue: any;
  targetValue: any;
  resolution: string;
  resolvedValue: any;
}

export interface ErrorRecord {
  rowId?: string;
  field?: string;
  error: string;
  details?: any;
}

export interface RowSnapshot {
  id: string;
  hash: string;
  data: Record<string, any>;
  updatedAt: string;
}

/**
 * Sync Engine - orchestrates the entire sync process
 */
export class SyncEngine {
  private databaseUrl: string;
  private notionAdapter?: NotionAdapter;
  private schemaUrl?: string;

  constructor(options: {
    databaseUrl: string;
    notionToken?: string;
    schemaUrl?: string;
  }) {
    this.databaseUrl = options.databaseUrl;
    if (options.notionToken) {
      this.notionAdapter = new NotionAdapter({ apiToken: options.notionToken });
    }
    this.schemaUrl = options.schemaUrl;
  }

  /**
   * Execute a sync operation
   */
  async sync(config: SyncConfig, options: { dryRun?: boolean } = {}): Promise<SyncResult> {
    const syncId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    const result: SyncResult = {
      syncId,
      configId: config.id,
      status: "success",
      startedAt,
      completedAt: "",
      stats: {
        sourceRows: 0,
        targetRows: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        skipped: 0,
        conflicts: 0,
        errors: 0,
      },
      changes: [],
      conflicts: [],
      errors: [],
    };

    try {
      // 1. Fetch current state from both systems
      console.log(`[Sync ${syncId}] Fetching source data...`);
      const sourceData = await this.fetchData(config.source);
      result.stats.sourceRows = sourceData.length;

      console.log(`[Sync ${syncId}] Fetching target data...`);
      const targetData = await this.fetchData(config.target);
      result.stats.targetRows = targetData.length;

      // 2. Get last known state (for diff calculation)
      const lastSnapshot = await this.getLastSnapshot(config.id);

      // 3. Calculate diffs
      console.log(`[Sync ${syncId}] Calculating diffs...`);
      const { sourceChanges, targetChanges } = this.calculateDiffs(
        sourceData,
        targetData,
        lastSnapshot,
        config.fieldMapping
      );

      // 4. Validate changes against schema (if configured)
      if (this.schemaUrl && config.source.schema) {
        console.log(`[Sync ${syncId}] Validating against schema...`);
        const validationErrors = await this.validateChanges(
          [...sourceChanges, ...targetChanges],
          config.source.schema
        );
        if (validationErrors.length > 0) {
          result.errors.push(...validationErrors);
          result.stats.errors = validationErrors.length;
        }
      }

      // 5. Detect and resolve conflicts
      console.log(`[Sync ${syncId}] Resolving conflicts...`);
      const { resolvedChanges, conflicts } = this.resolveConflicts(
        sourceChanges,
        targetChanges,
        config.conflictResolution
      );
      result.conflicts = conflicts;
      result.stats.conflicts = conflicts.length;

      // 6. Apply changes (unless dry run)
      if (!options.dryRun) {
        console.log(`[Sync ${syncId}] Applying ${resolvedChanges.length} changes...`);
        for (const change of resolvedChanges) {
          try {
            await this.applyChange(change, config);
            result.changes.push(change);

            switch (change.type) {
              case "create":
                result.stats.created++;
                break;
              case "update":
                result.stats.updated++;
                break;
              case "delete":
                result.stats.deleted++;
                break;
            }
          } catch (err: any) {
            result.errors.push({
              rowId: change.rowId,
              error: err.message,
            });
            result.stats.errors++;
          }
        }

        // 7. Save new snapshot
        await this.saveSnapshot(config.id, sourceData, targetData);
      } else {
        // In dry run, just record what would change
        result.changes = resolvedChanges;
        result.stats.created = resolvedChanges.filter((c) => c.type === "create").length;
        result.stats.updated = resolvedChanges.filter((c) => c.type === "update").length;
        result.stats.deleted = resolvedChanges.filter((c) => c.type === "delete").length;
      }

      // 8. Write audit log
      await this.writeAuditLog(syncId, config, result);

      result.status = result.errors.length > 0 ? "partial" : "success";
    } catch (err: any) {
      console.error(`[Sync ${syncId}] Fatal error:`, err);
      result.status = "failed";
      result.errors.push({ error: err.message });
    }

    result.completedAt = new Date().toISOString();
    return result;
  }

  /**
   * Fetch data from a data source
   */
  private async fetchData(source: DataSource): Promise<RowSnapshot[]> {
    switch (source.type) {
      case "notion":
        return this.fetchNotionData(source.id);
      case "postgres":
        return this.fetchPostgresData(source.id);
      case "sheets":
        return this.fetchSheetsData(source.id);
      default:
        throw new Error(`Unsupported data source type: ${source.type}`);
    }
  }

  /**
   * Fetch data from Notion database
   */
  private async fetchNotionData(databaseId: string): Promise<RowSnapshot[]> {
    if (!this.notionAdapter) {
      throw new Error("Notion adapter not configured");
    }

    const rows = await this.notionAdapter.queryDatabase(databaseId);
    return rows.map((row) => ({
      id: row.id,
      hash: this.hashRow(row.properties),
      data: row.properties,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Fetch data from PostgreSQL table
   */
  private async fetchPostgresData(tableName: string): Promise<RowSnapshot[]> {
    const { rawQuery } = await import("../db/neon-worker");

    // Sanitize table name to prevent SQL injection
    const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, "");
    const query = `SELECT * FROM ${safeTableName} ORDER BY updated_at DESC NULLS LAST`;

    const rows = await rawQuery<Record<string, unknown>>(this.databaseUrl, query);

    return rows.map((row) => ({
      id: String(row.id || row[Object.keys(row)[0]]),
      hash: this.hashRow(row),
      data: row,
      updatedAt: String(row.updated_at || new Date().toISOString()),
    }));
  }

  /**
   * Fetch data from Google Sheets (placeholder)
   */
  private async fetchSheetsData(sheetUrl: string): Promise<RowSnapshot[]> {
    // TODO: Implement Google Sheets integration
    throw new Error("Google Sheets integration not yet implemented");
  }

  /**
   * Calculate diffs between source and target
   */
  private calculateDiffs(
    sourceData: RowSnapshot[],
    targetData: RowSnapshot[],
    lastSnapshot: Map<string, RowSnapshot> | null,
    fieldMapping: FieldMapping[]
  ): { sourceChanges: ChangeRecord[]; targetChanges: ChangeRecord[] } {
    const sourceChanges: ChangeRecord[] = [];
    const targetChanges: ChangeRecord[] = [];

    const sourceMap = new Map(sourceData.map((r) => [r.id, r]));
    const targetMap = new Map(targetData.map((r) => [r.id, r]));

    // Find changes in source that need to go to target
    for (const source of sourceData) {
      const target = targetMap.get(source.id);
      const lastKnown = lastSnapshot?.get(source.id);

      if (!target) {
        // New in source -> create in target
        sourceChanges.push({
          type: "create",
          direction: "source_to_target",
          rowId: source.id,
          fields: Object.keys(source.data),
          after: this.mapFields(source.data, fieldMapping, "source_to_target"),
        });
      } else if (source.hash !== target.hash) {
        // Changed -> update target
        const changedFields = this.getChangedFields(source.data, target.data, fieldMapping);
        if (changedFields.length > 0) {
          sourceChanges.push({
            type: "update",
            direction: "source_to_target",
            rowId: source.id,
            fields: changedFields,
            before: target.data,
            after: this.mapFields(source.data, fieldMapping, "source_to_target"),
          });
        }
      }
    }

    // Find changes in target that need to go to source
    for (const target of targetData) {
      const source = sourceMap.get(target.id);
      const lastKnown = lastSnapshot?.get(target.id);

      if (!source) {
        // New in target -> create in source
        targetChanges.push({
          type: "create",
          direction: "target_to_source",
          rowId: target.id,
          fields: Object.keys(target.data),
          after: this.mapFields(target.data, fieldMapping, "target_to_source"),
        });
      } else if (target.hash !== source.hash && lastKnown) {
        // Check if target changed since last sync
        if (target.hash !== lastKnown.hash) {
          const changedFields = this.getChangedFields(target.data, source.data, fieldMapping);
          if (changedFields.length > 0) {
            targetChanges.push({
              type: "update",
              direction: "target_to_source",
              rowId: target.id,
              fields: changedFields,
              before: source.data,
              after: this.mapFields(target.data, fieldMapping, "target_to_source"),
            });
          }
        }
      }
    }

    // Find deletions
    if (lastSnapshot) {
      for (const [id, lastRow] of lastSnapshot) {
        if (!sourceMap.has(id) && targetMap.has(id)) {
          // Deleted from source -> delete from target
          sourceChanges.push({
            type: "delete",
            direction: "source_to_target",
            rowId: id,
            fields: [],
            before: lastRow.data,
          });
        }
        if (!targetMap.has(id) && sourceMap.has(id)) {
          // Deleted from target -> delete from source
          targetChanges.push({
            type: "delete",
            direction: "target_to_source",
            rowId: id,
            fields: [],
            before: lastRow.data,
          });
        }
      }
    }

    return { sourceChanges, targetChanges };
  }

  /**
   * Resolve conflicts between source and target changes
   */
  private resolveConflicts(
    sourceChanges: ChangeRecord[],
    targetChanges: ChangeRecord[],
    strategy: string
  ): { resolvedChanges: ChangeRecord[]; conflicts: ConflictRecord[] } {
    const conflicts: ConflictRecord[] = [];
    const resolvedChanges: ChangeRecord[] = [];

    // Index changes by row ID
    const sourceByRow = new Map(sourceChanges.map((c) => [c.rowId, c]));
    const targetByRow = new Map(targetChanges.map((c) => [c.rowId, c]));

    // Process source changes
    for (const change of sourceChanges) {
      const targetChange = targetByRow.get(change.rowId);

      if (targetChange && change.type === "update" && targetChange.type === "update") {
        // Conflict: both sides updated
        for (const field of change.fields) {
          if (targetChange.fields.includes(field)) {
            const sourceValue = change.after?.[field];
            const targetValue = targetChange.after?.[field];

            if (sourceValue !== targetValue) {
              let resolvedValue: any;

              switch (strategy) {
                case "source_wins":
                  resolvedValue = sourceValue;
                  break;
                case "target_wins":
                  resolvedValue = targetValue;
                  break;
                case "last_write_wins":
                default:
                  // Compare timestamps if available
                  resolvedValue = sourceValue; // Default to source
                  break;
              }

              conflicts.push({
                rowId: change.rowId,
                field,
                sourceValue,
                targetValue,
                resolution: strategy,
                resolvedValue,
              });

              // Update the change record with resolved value
              if (change.after) {
                change.after[field] = resolvedValue;
              }
            }
          }
        }
      }

      resolvedChanges.push(change);
    }

    // Add non-conflicting target changes
    for (const change of targetChanges) {
      if (!sourceByRow.has(change.rowId)) {
        resolvedChanges.push(change);
      }
    }

    return { resolvedChanges, conflicts };
  }

  /**
   * Apply a single change
   */
  private async applyChange(change: ChangeRecord, config: SyncConfig): Promise<void> {
    const target =
      change.direction === "source_to_target" ? config.target : config.source;

    switch (target.type) {
      case "notion":
        await this.applyNotionChange(change, target.id);
        break;
      case "postgres":
        await this.applyPostgresChange(change, target.id);
        break;
      case "sheets":
        await this.applySheetsChange(change, target.id);
        break;
    }
  }

  /**
   * Apply change to Notion
   */
  private async applyNotionChange(change: ChangeRecord, databaseId: string): Promise<void> {
    if (!this.notionAdapter) {
      throw new Error("Notion adapter not configured");
    }

    switch (change.type) {
      case "create":
        await this.notionAdapter.createPage(databaseId, change.after || {});
        break;
      case "update":
        await this.notionAdapter.updatePage(change.rowId, change.after || {});
        break;
      case "delete":
        await this.notionAdapter.archivePage(change.rowId);
        break;
    }
  }

  /**
   * Apply change to PostgreSQL
   */
  private async applyPostgresChange(change: ChangeRecord, tableName: string): Promise<void> {
    const { rawQuery } = await import("../db/neon-worker");

    // Sanitize table name
    const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, "");

    switch (change.type) {
      case "create": {
        const data = change.after || {};
        const columns = Object.keys(data).map((k) => k.replace(/[^a-zA-Z0-9_]/g, "")).join(", ");
        const values = Object.values(data)
          .map((v) => (typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : v))
          .join(", ");
        await rawQuery(this.databaseUrl, `INSERT INTO ${safeTableName} (${columns}) VALUES (${values})`);
        break;
      }
      case "update": {
        const data = change.after || {};
        const setClause = Object.entries(data)
          .map(([k, v]) => {
            const safeKey = k.replace(/[^a-zA-Z0-9_]/g, "");
            const safeVal = typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : v;
            return `${safeKey} = ${safeVal}`;
          })
          .join(", ");
        const safeRowId = String(change.rowId).replace(/'/g, "''");
        await rawQuery(this.databaseUrl, `UPDATE ${safeTableName} SET ${setClause} WHERE id = '${safeRowId}'`);
        break;
      }
      case "delete": {
        const safeRowId = String(change.rowId).replace(/'/g, "''");
        await rawQuery(this.databaseUrl, `DELETE FROM ${safeTableName} WHERE id = '${safeRowId}'`);
        break;
      }
    }
  }

  /**
   * Apply change to Google Sheets (placeholder)
   */
  private async applySheetsChange(change: ChangeRecord, sheetUrl: string): Promise<void> {
    throw new Error("Google Sheets integration not yet implemented");
  }

  /**
   * Validate changes against schema
   */
  private async validateChanges(
    changes: ChangeRecord[],
    schemaId: string
  ): Promise<ErrorRecord[]> {
    if (!this.schemaUrl) return [];

    const errors: ErrorRecord[] = [];

    try {
      const res = await fetch(`${this.schemaUrl}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaId,
          records: changes.map((c) => c.after).filter(Boolean),
        }),
      });

      if (!res.ok) {
        errors.push({ error: `Schema validation failed: ${res.status}` });
        return errors;
      }

      const result = await res.json();
      if (result.errors) {
        for (const err of result.errors) {
          errors.push({
            rowId: err.rowId,
            field: err.field,
            error: err.message,
          });
        }
      }
    } catch (err: any) {
      errors.push({ error: `Schema validation error: ${err.message}` });
    }

    return errors;
  }

  /**
   * Get last snapshot for diff calculation
   */
  private async getLastSnapshot(configId: string): Promise<Map<string, RowSnapshot> | null> {
    const { query } = await import("../db/neon-worker");

    interface SnapshotRow {
      row_id: string;
      hash: string;
      data: Record<string, unknown>;
      updated_at: string;
    }

    try {
      const rows = await query<SnapshotRow>(
        this.databaseUrl,
        `SELECT row_id, hash, data, updated_at FROM sync_snapshots WHERE config_id = $1`,
        [configId]
      );

      if (rows.length === 0) return null;

      return new Map(
        rows.map((r) => [
          r.row_id,
          {
            id: r.row_id,
            hash: r.hash,
            data: r.data,
            updatedAt: r.updated_at,
          },
        ])
      );
    } catch {
      return null;
    }
  }

  /**
   * Save current snapshot for future diffs
   */
  private async saveSnapshot(
    configId: string,
    sourceData: RowSnapshot[],
    targetData: RowSnapshot[]
  ): Promise<void> {
    const sql = getDb(this.databaseUrl);

    // Combine source and target data
    const allRows = [...sourceData, ...targetData];
    const uniqueRows = new Map(allRows.map((r) => [r.id, r]));

    // Delete old snapshots
    await sql`DELETE FROM sync_snapshots WHERE config_id = ${configId}`;

    // Insert new snapshots
    for (const row of uniqueRows.values()) {
      await sql`
        INSERT INTO sync_snapshots (config_id, row_id, hash, data, updated_at)
        VALUES (${configId}, ${row.id}, ${row.hash}, ${row.data}, ${row.updatedAt})
      `;
    }
  }

  /**
   * Write audit log entry
   */
  private async writeAuditLog(
    syncId: string,
    config: SyncConfig,
    result: SyncResult
  ): Promise<void> {
    const sql = getDb(this.databaseUrl);

    await sql`
      INSERT INTO sync_audit_log (
        sync_id, config_id, status, started_at, completed_at,
        stats, changes_count, conflicts_count, errors_count
      )
      VALUES (
        ${syncId}, ${config.id}, ${result.status},
        ${result.startedAt}, ${result.completedAt},
        ${JSON.stringify(result.stats)},
        ${result.changes.length},
        ${result.conflicts.length},
        ${result.errors.length}
      )
    `;
  }

  /**
   * Hash a row for change detection
   */
  private hashRow(data: Record<string, any>): string {
    const sorted = JSON.stringify(data, Object.keys(data).sort());
    // Simple hash using Web Crypto API
    return btoa(sorted).slice(0, 32);
  }

  /**
   * Map fields between source and target
   */
  private mapFields(
    data: Record<string, any>,
    mapping: FieldMapping[],
    direction: "source_to_target" | "target_to_source"
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const map of mapping) {
      if (map.readonly && direction === "target_to_source") continue;

      const sourceField = direction === "source_to_target" ? map.source : map.target;
      const targetField = direction === "source_to_target" ? map.target : map.source;

      if (sourceField in data) {
        result[targetField] = data[sourceField];
      }
    }

    return result;
  }

  /**
   * Get fields that changed between two records
   */
  private getChangedFields(
    record1: Record<string, any>,
    record2: Record<string, any>,
    mapping: FieldMapping[]
  ): string[] {
    const changed: string[] = [];

    for (const map of mapping) {
      const val1 = record1[map.source];
      const val2 = record2[map.target];

      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        changed.push(map.source);
      }
    }

    return changed;
  }
}
