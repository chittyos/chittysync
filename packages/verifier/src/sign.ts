import nacl from "tweetnacl";
import canonicalize from "canonicalize";

export type SignatureEntry = { key: string; sig: string };

export function canonicalBuffer(o: unknown) {
  return Buffer.from(canonicalize(o) ?? "");
}

function toKeyPair(secretHex: string) {
  const sk = Buffer.from(secretHex, "hex");
  if (sk.length === 32) {
    const kp = nacl.sign.keyPair.fromSeed(sk);
    return { secretKey: Buffer.from(kp.secretKey), publicKey: Buffer.from(kp.publicKey) };
  }
  if (sk.length === 64) {
    const publicKey = sk.subarray(32, 64);
    return { secretKey: sk, publicKey };
  }
  throw new Error("invalid ed25519 secret key length");
}

export function signObjectQuorum(att: Record<string, unknown>, secretKeysHex: string[]): SignatureEntry[] {
  const msg = canonicalBuffer(att);
  const out: SignatureEntry[] = [];
  for (const hex of secretKeysHex) {
    const { secretKey, publicKey } = toKeyPair(hex.trim());
    const sig = nacl.sign.detached(msg, secretKey);
    out.push({ key: Buffer.from(publicKey).toString("hex"), sig: Buffer.from(sig).toString("hex") });
  }
  return out;
}

