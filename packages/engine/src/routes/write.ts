import { FastifyInstance } from "fastify";
import { sql } from "../db/neon";
import { assertFreshNonce } from "../auth/nonce";
import { fetchAttestation } from "../verifier/fetch";
import { nextSeq } from "../db/sequencer";
import { appendAudit } from "../audit/append";

export default async function writeRoute(app: FastifyInstance) {
  app.post("/write", async (req) => {
    const b: any = (req as any).body;

    const intent = await sql`
      SELECT status, registries
      FROM commit_intent
      WHERE intent_id=${b.intent_id}
      FOR UPDATE
    `;
    if (!intent.length ||
        intent[0].status !== "pending" ||
        !(intent[0].registries as string[]).includes(b.registry))
      throw new Error("INVALID_COMMIT_INTENT");

    assertFreshNonce(b.actor_id, b.nonce);

    const att = await fetchAttestation(b.registry);
    if (!att || att.decision !== "allow")
      throw new Error("ATTESTATION_DENY");

    const seq = await nextSeq(b.registry);

    try {
      // INSERT-only registry write here
      await appendAudit(b.registry, "write", seq, b.payload);
      await sql`UPDATE commit_intent SET status='complete'
                WHERE intent_id=${b.intent_id}`;
    } catch (err) {
      await sql`UPDATE commit_intent SET status='incomplete'
                WHERE intent_id=${b.intent_id}`;
      throw err;
    }

    return { ok: true, seq } as const;
  });
}

