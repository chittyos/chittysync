import { neon, neonConfig } from "@neondatabase/serverless";

neonConfig.fetchConnectionCache = true;

// Expect DATABASE_URL to be set in environment, e.g. postgres://...
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // Defer throwing until first use to allow tooling to import without DB.
}

export const sql: any = databaseUrl
  ? (neon(databaseUrl) as any)
  : (async () => {
      throw new Error("DATABASE_URL not set");
    });

