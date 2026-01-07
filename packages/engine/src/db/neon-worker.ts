/**
 * Neon PostgreSQL client for Cloudflare Workers
 */

import { neon, neonConfig, NeonQueryFunction } from "@neondatabase/serverless";

// Enable fetch connection cache for better performance
neonConfig.fetchConnectionCache = true;

// Extended SQL client with unsafe helper
export interface ExtendedSql extends NeonQueryFunction<false, false> {
  unsafe: (sql: string) => { __raw: string };
}

// Cache SQL clients per connection string
const sqlCache = new Map<string, ExtendedSql>();

/**
 * Get a Neon SQL client for the given connection string
 */
export function getDb(databaseUrl: string): ExtendedSql {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  let sql = sqlCache.get(databaseUrl);
  if (!sql) {
    const baseSql = neon(databaseUrl) as ExtendedSql;
    // Add unsafe helper for dynamic SQL fragments
    baseSql.unsafe = (rawSql: string) => ({ __raw: rawSql });
    sql = baseSql;
    sqlCache.set(databaseUrl, sql);
  }

  return sql;
}

/**
 * Execute a raw SQL query with parameterized values
 */
export async function query<T = Record<string, unknown>>(
  databaseUrl: string,
  queryText: string,
  params: unknown[] = []
): Promise<T[]> {
  const sql = getDb(databaseUrl);
  const result = await sql(queryText, params);
  return result as T[];
}

/**
 * Execute a raw SQL query - use for dynamic queries
 */
export async function rawQuery<T = Record<string, unknown>>(
  databaseUrl: string,
  queryText: string
): Promise<T[]> {
  const sql = getDb(databaseUrl);
  const result = await sql(queryText);
  return result as T[];
}
