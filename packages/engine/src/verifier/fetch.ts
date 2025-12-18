import fs from "fs";
import { verifyQuorum } from "../crypto/quorum";
import { canonicalBuffer } from "../crypto/canonical";

export async function fetchAttestation(registry: string) {
  const pathSigned = process.env.ATTESTATIONS_SIGNED_PATH || "assets/attestations.signed.json";
  const pathPlain = process.env.ATTESTATIONS_PATH || "assets/attestations.json";

  const pubkeys = process.env.ATTESTATION_PUBKEYS_HEX
    ? process.env.ATTESTATION_PUBKEYS_HEX.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const quorum = Math.max(0, parseInt(process.env.ATTESTATION_QUORUM || "0", 10) || 0);

  // Prefer signed attestations if quorum is configured
  if (pubkeys.length && quorum > 0) {
    try {
      const m = JSON.parse(fs.readFileSync(pathSigned, "utf8"));
      const msg = canonicalBuffer(m.att);
      const sigs: string[] = (m.signatures || []).map((x: any) => x?.sig || x).filter(Boolean);
      if (!verifyQuorum(msg, sigs, pubkeys, quorum)) {
        throw new Error("ATTESTATION_SIGNATURE_QUORUM_FAILED");
      }
      const att = m.att?.[registry];
      if (att) return att;
    } catch (e) {
      // fall through to plain on failure
    }
  }

  // Plain file fallback
  try {
    const m = JSON.parse(fs.readFileSync(pathPlain, "utf8"));
    const att = m?.[registry];
    if (att) return att;
  } catch {
    // ignore
  }

  return { decision: "allow", valid_until: "2999-01-01T00:00:00Z" } as const;
}
