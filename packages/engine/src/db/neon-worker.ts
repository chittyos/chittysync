/**
 * Neon PostgreSQL client for Cloudflare Workers
 */

import { neon, neonConfig } from "@neondatabase/serverless";

// Enable fetch connection cache for better performance
neonConfig.fetchConnectionCache = true;

// Cache SQL clients per connection string
const sqlCache = new Map<string, ReturnType<typeof neon>>();

/**
 * Get a Neon SQL client for the given connection string
 */
export function getDb(databaseUrl: string) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  let sql = sqlCache.get(databaseUrl);
  if (!sql) {
    sql = neon(databaseUrl);
    sqlCache.set(databaseUrl, sql);
  }

  return sql;
}

/**
 * Execute a raw SQL query
 */
export async function query<T = any>(
  databaseUrl: string,
  queryText: string,
  params: any[] = []
): Promise<T[]> {
  const sql = getDb(databaseUrl);
  return sql(queryText, params) as Promise<T[]>;
}
