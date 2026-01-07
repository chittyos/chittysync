import { rawQuery } from "./neon-worker";

interface SeqRow {
  seq: number;
}

export async function nextSeq(databaseUrl: string, registry: string): Promise<number> {
  const safeRegistry = registry.replace(/'/g, "''");
  const query = `
    UPDATE registry_sequencer
    SET seq = seq + 1
    WHERE registry = '${safeRegistry}'
    RETURNING seq
  `;

  const result = await rawQuery<SeqRow>(databaseUrl, query);
  if (!result.length) {
    throw new Error("SEQUENCER_MISSING");
  }
  return result[0].seq;
}
