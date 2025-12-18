import canonicalize from "canonicalize";

export const canonicalBuffer = (o: unknown) =>
  Buffer.from(canonicalize(o) ?? "");

