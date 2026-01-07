import canonicalize from "canonicalize";

export const canonicalBuffer = (o: unknown): Uint8Array =>
  new TextEncoder().encode(canonicalize(o) ?? "");

export const canonicalString = (o: unknown): string =>
  canonicalize(o) ?? "";
