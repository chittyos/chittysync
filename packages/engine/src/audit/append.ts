import { sha256Hex } from "../crypto/hash";
import { canonicalString } from "../crypto/canonical";
import { rawQuery } from "../db/neon-worker";

interface PrevHashRow {
  hash_self: string | null;
}

export async function appendAudit(
  databaseUrl: string,
  registry: string,
  action: string,
  seq: number,
  payload: unknown
): Promise<void> {
  const prevQuery = `
    SELECT hash_self FROM audit_log
    WHERE registry = $1
    ORDER BY audit_seq DESC LIMIT 1
  `;
  const prev = await rawQuery<PrevHashRow>(databaseUrl, prevQuery.replace("$1", `'${registry}'`));

  const material = { registry, action, seq, payload };
  const prevHash = prev[0]?.hash_self || "";
  const hashInput = prevHash + canonicalString(material);
  const hashSelf = await sha256Hex(hashInput);

  const insertQuery = `
    INSERT INTO audit_log (registry, action, payload, hash_prev, hash_self)
    VALUES ('${registry}', '${action}', '${JSON.stringify(material).replace(/'/g, "''")}',
            ${prev[0]?.hash_self ? `'${prev[0].hash_self}'` : 'NULL'}, '${hashSelf}')
  `;
  await rawQuery(databaseUrl, insertQuery);
}
