import { sql } from "./neon";

export async function nextSeq(registry: string): Promise<number> {
  const r = await sql`
    UPDATE registry_sequencer
    SET seq = seq + 1
    WHERE registry=${registry}
    RETURNING seq
  `;
  if (!r.length) throw new Error("SEQUENCER_MISSING");
  return r[0].seq as number;
}

