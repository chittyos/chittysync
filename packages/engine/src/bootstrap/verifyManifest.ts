import { verify } from "../crypto/ed25519";
import { verifyQuorum } from "../crypto/quorum";
import fs from "fs";

export function verifyManifest(pkSingle?: Buffer) {
  const m = JSON.parse(fs.readFileSync("build.manifest.json", "utf8"));

  const multiKeys = process.env.ENGINE_PUBKEYS_HEX
    ? process.env.ENGINE_PUBKEYS_HEX.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const quorum = multiKeys
    ? Math.max(1, parseInt(process.env.ENGINE_QUORUM ?? "0", 10) || 0)
    : undefined;

  const msg = Buffer.from(m.hash);

  if (multiKeys && quorum) {
    const sigs: string[] = Array.isArray(m.signatures)
      ? m.signatures.map((x: any) => (typeof x === "string" ? x : x?.sig)).filter(Boolean)
      : m.signature
      ? [m.signature]
      : [];
    if (!verifyQuorum(msg, sigs, multiKeys, quorum)) {
      throw new Error("BUILD_TAMPERED");
    }
    return;
  }

  if (!pkSingle) throw new Error("ENGINE_PUBKEY_HEX not set");
  if (!verify(msg, Buffer.from(m.signature, "hex"), pkSingle))
    throw new Error("BUILD_TAMPERED");
}
