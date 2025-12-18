import nacl from "tweetnacl";

export const verify = (
  msg: Buffer,
  sig: Buffer,
  pk: Buffer
) => nacl.sign.detached.verify(msg, sig, pk);

