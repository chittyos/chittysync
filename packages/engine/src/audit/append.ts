import { sha256 } from "../crypto/hash";
import { canonicalBuffer } from "../crypto/canonical";
import { sql } from "../db/neon";

export async function appendAudit(
  registry: string,
  action: string,
  seq: number,
  payload: any
) {
  const prev = await sql`
    SELECT hash_self FROM audit_log
    WHERE registry=${registry}
    ORDER BY audit_seq DESC LIMIT 1
  `;
  const material = { registry, action, seq, payload };
  const hashSelf = sha256(
    Buffer.concat([
      prev[0]?.hash_self ?? Buffer.alloc(0),
      canonicalBuffer(material)
    ])
  );

  await sql`
    INSERT INTO audit_log
      (registry, action, payload, hash_prev, hash_self)
    VALUES
      (${registry}, ${action}, ${material},
       ${prev[0]?.hash_self ?? null}, ${hashSelf})
  `;
}

