import { verify as edVerify } from "./ed25519";

export type SignatureHex = string; // hex-encoded detached sig
export type PublicKeyHex = string; // hex-encoded ed25519 public key

export function verifyQuorum(
  message: Buffer,
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
        Buffer.from(sigHex, "hex"),
        Buffer.from(pkHex, "hex")
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

