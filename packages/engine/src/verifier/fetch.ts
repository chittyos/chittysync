import { verifyQuorum } from "../crypto/quorum";
import { canonicalBuffer } from "../crypto/canonical";

interface Attestation {
  decision: "allow" | "deny";
  valid_until: string;
  [key: string]: unknown;
}

interface SignedAttestations {
  att: Record<string, Attestation>;
  signatures: Array<{ sig: string } | string>;
}

/**
 * Fetch attestation for a registry
 * In CF Workers, attestations can come from:
 * 1. A remote URL (ATTESTATIONS_URL env var)
 * 2. KV store (future implementation)
 * 3. Default allow (if not configured)
 */
export async function fetchAttestation(
  registry: string,
  options: {
    attestationsUrl?: string;
    pubkeys?: string[];
    quorum?: number;
  } = {}
): Promise<Attestation> {
  const { attestationsUrl, pubkeys = [], quorum = 0 } = options;

  // If attestations URL is configured, fetch from there
  if (attestationsUrl && pubkeys.length && quorum > 0) {
    try {
      const res = await fetch(attestationsUrl);
      if (res.ok) {
        const m = (await res.json()) as SignedAttestations;
        const msg = canonicalBuffer(m.att);
        const sigs: string[] = (m.signatures || [])
          .map((x) => (typeof x === "string" ? x : x?.sig))
          .filter((s): s is string => Boolean(s));

        if (!verifyQuorum(msg, sigs, pubkeys, quorum)) {
          throw new Error("ATTESTATION_SIGNATURE_QUORUM_FAILED");
        }

        const att = m.att?.[registry];
        if (att) return att;
      }
    } catch {
      // Fall through to default on failure
    }
  }

  // Default: allow all if no attestation configured
  return {
    decision: "allow",
    valid_until: "2999-01-01T00:00:00Z",
  };
}
