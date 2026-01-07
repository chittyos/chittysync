import { verify as edVerify } from "./ed25519";

export type SignatureHex = string; // hex-encoded detached sig
export type PublicKeyHex = string; // hex-encoded ed25519 public key

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Verify that a quorum of signatures is valid for a message
 */
export function verifyQuorum(
  message: Uint8Array,
  signatures: SignatureHex[],
  pubkeys: PublicKeyHex[],
  threshold: number
): boolean {
  if (threshold <= 0) return false;
  const pkSet = new Set(pubkeys.map((p) => p.toLowerCase()));
  let valid = 0;
  const seen = new Set<string>();

  for (const sigHex of signatures) {
    for (const pkHex of pkSet) {
      const key = pkHex + ":" + sigHex;
      if (seen.has(key)) continue;
      const ok = edVerify(
        message,
        hexToBytes(sigHex),
        hexToBytes(pkHex)
      );
      if (ok) {
        valid++;
        seen.add(key);
        break; // next signature
      }
    }
    if (valid >= threshold) return true;
  }
  return valid >= threshold;
}
