const seen = new Map<string, Set<string>>();

export function assertFreshNonce(actor: string, nonce: string) {
  const s = seen.get(actor) ?? new Set<string>();
  if (s.has(nonce)) throw new Error("REPLAY");
  s.add(nonce);
  if (s.size > 1000) {
    const first = s.values().next().value as string | undefined;
    if (first !== undefined) s.delete(first);
  }
  seen.set(actor, s);
}
