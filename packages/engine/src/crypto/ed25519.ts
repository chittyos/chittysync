import nacl from "tweetnacl";

export const verify = (
  msg: Uint8Array,
  sig: Uint8Array,
  pk: Uint8Array
): boolean => nacl.sign.detached.verify(msg, sig, pk);

export const sign = (
  msg: Uint8Array,
  secretKey: Uint8Array
): Uint8Array => nacl.sign.detached(msg, secretKey);

export const generateKeyPair = (): { publicKey: Uint8Array; secretKey: Uint8Array } =>
  nacl.sign.keyPair();
