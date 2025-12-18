import { verify } from "../crypto/ed25519";
import { canonicalBuffer } from "../crypto/canonical";

export function verifyEnvelope(env: any, pubkey: Buffer) {
  const { signature, ...unsigned } = env;
  if (
    !verify(
      canonicalBuffer(unsigned),
      Buffer.from(signature, "hex"),
      pubkey
    )
  )
    throw new Error("INVALID_SIGNATURE");
}

