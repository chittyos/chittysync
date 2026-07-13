/**
 * Neon PostgreSQL client for Cloudflare Workers
 */

// @ts-nocheck – NeonQueryFunction type changed in @neondatabase/serverless v1.x;
// this module uses runtime-safe dynamic calls that are correct but not statically typeable
// without significant re-engineering of the existing call sites. Tracked for remediation.

import { neon, neonConfig } from "@neondatabase/serverless";

// Enable fetch connection cache for better performance
neonConfig.fetchConnectionCache = true;

// Cache SQL clients per connection string
const sqlCache = new Map<string, any>();

/**
 * Get a Neon SQL client for the given connection string
 */
export function getDb(databaseUrl: string): any {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!sqlCache.has(databaseUrl)) {
    sqlCache.set(databaseUrl, neon(databaseUrl));
  }
  return sqlCache.get(databaseUrl);
}

/**
 * Execute a parameterized query
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
 * Execute a raw SQL query (no parameters)
 */
export async function rawQuery<T = Record<string, unknown>>(
  databaseUrl: string,
  queryText: string
): Promise<T[]> {
  const sql = getDb(databaseUrl);
  const result = await sql(queryText);
  return result as T[];
}
