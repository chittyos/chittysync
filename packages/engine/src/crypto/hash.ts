import { createHash } from "crypto";

export const sha256 = (b: Buffer | string) =>
  createHash("sha256").update(b).digest();

