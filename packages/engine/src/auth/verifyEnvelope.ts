import { verify } from "../crypto/ed25519";
import { canonicalBuffer } from "../crypto/canonical";

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

export function verifyEnvelope(
  env: { signature: string; [key: string]: unknown },
  pubkey: Uint8Array
): void {
  const { signature, ...unsigned } = env;
  if (
    !verify(
      canonicalBuffer(unsigned),
      hexToBytes(signature),
      pubkey
    )
  ) {
    throw new Error("INVALID_SIGNATURE");
  }
}
