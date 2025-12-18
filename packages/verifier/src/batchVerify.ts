import { neon, neonConfig } from "@neondatabase/serverless";
import canonicalize from "canonicalize";
import fs from "fs";

const OUTPUT_PATH = process.env.OUTPUT_PATH || "assets/attestations.json";
const DATABASE_URL = process.env.DATABASE_URL;
const FAR_FUTURE = "2999-01-01T00:00:00Z";

function sha256(b: Buffer | string) {
  return require("crypto").createHash("sha256").update(b).digest();
}

function canonicalBuffer(o: unknown) {
  return Buffer.from(canonicalize(o) ?? "");
}

function buf(x: any): Buffer | null {
  if (x == null) return null;
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x);
  if (typeof x === "string") {
    if (x.startsWith("\\x")) return Buffer.from(x.slice(2), "hex");
    return Buffer.from(x, "utf8");
  }
  return null;
}

export type Attestation = {
  decision: "allow" | "deny";
  valid_until: string;
  head?: string;
  entries?: number;
  reason?: string;
};

export async function batchVerify(): Promise<Record<string, Attestation>> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
  neonConfig.fetchConnectionCache = true;
  const sql: any = neon(DATABASE_URL);

  const rows = await sql`
    SELECT registry, audit_seq, action, payload, hash_prev, hash_self
    FROM audit_log
    ORDER BY registry ASC, audit_seq ASC
  `;

  const out: Record<string, Attestation> = {};
  let current: string | null = null;
  let prevHash: Buffer = Buffer.alloc(0);
  let ok = true;
  let count = 0;
  let head: Buffer = Buffer.alloc(0);

  const flush = () => {
    if (current == null) return;
    out[current] = ok
      ? {
          decision: "allow",
          valid_until: FAR_FUTURE,
          head: head.length ? head.toString("hex") : undefined,
          entries: count,
        }
      : {
          decision: "deny",
          valid_until: new Date(0).toISOString(),
          reason: "audit chain mismatch",
          head: head.length ? head.toString("hex") : undefined,
          entries: count,
        };
  };

  for (const r of rows) {
    const reg = r.registry as string;
    if (current !== reg) {
      // emit previous
      flush();
      // reset
      current = reg;
      prevHash = Buffer.alloc(0);
      ok = true;
      count = 0;
      head = Buffer.alloc(0);
    }

    if (!ok) {
      count++;
      continue;
    }

    const hp = buf(r.hash_prev);
    const hs = buf(r.hash_self);
    const payload = r.payload; // expected to be { registry, action, seq, payload }
    const material = payload;

    // Validate linkage
    const expectedPrev = prevHash.length ? prevHash : Buffer.alloc(0);
    if ((hp ?? Buffer.alloc(0)).compare(expectedPrev) !== 0) {
      ok = false;
      count++;
      head = hs || Buffer.alloc(0);
      continue;
    }

    // Recompute self hash
    const expectedSelf = sha256(
      Buffer.concat([expectedPrev, canonicalBuffer(material)])
    );
    if (!hs || hs.compare(expectedSelf) !== 0) {
      ok = false;
      count++;
      head = hs || Buffer.alloc(0);
      continue;
    }

    // advance
    prevHash = hs;
    head = hs;
    count++;
  }

  // flush last group
  flush();

  // Ensure output directory exists
  const dir = require("path").dirname(OUTPUT_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2));
  return out;
}

