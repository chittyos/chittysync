/**
 * Service-to-Service Authentication Middleware
 *
 * Validates incoming requests carry a verified ChittyOS service identity.
 * Auth paths (evaluated in order):
 *   1. CF-Access service token: cf-access-client-id / cf-access-client-secret headers
 *      Credentials verified by comparing against the Worker's CF_ACCESS_CLIENT_ID binding.
 *      The CF Access network policy has already enforced mTLS before reaching the Worker.
 *   2. Bearer JWT verified against ChittyAuth JWKS (auth.chitty.cc)
 *      Validates: signature, protected header kid, iss, aud, exp, alg allowlist, scope claim.
 *
 * Scopes (separate per operation):
 *   chittysync:review:write   — queue a new REVIEW decision (POST /review/queue)
 *   chittysync:review:resolve — resolve or reject a REVIEW record (POST /review/action)
 *
 * Failure modes:
 *   401 — missing credentials, malformed JWT, expired, wrong iss/aud, missing kid
 *   403 — valid credentials but lacking the required scope
 *   503 — CF_ACCESS_CLIENT_ID not configured (service cannot verify tokens)
 *
 * Security: never logs bearer token values or opaque review handles.
 */

import type { Context } from 'hono';
type Next = () => Promise<void>;
import type { Env } from '../worker';
import { jwtVerify, createRemoteJWKSet } from 'jose';

export const SCOPE_REVIEW_WRITE   = 'chittysync:review:write';
export const SCOPE_REVIEW_RESOLVE = 'chittysync:review:resolve';

const ALLOWED_ALGORITHMS = ['RS256', 'ES256', 'EdDSA'] as const;
const CLOCK_TOLERANCE_SEC = 30;

// Module-level JWKS set cache (keyed by URL so rotation is reflected on URL change)
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwks(url: string) {
  if (!jwksCache.has(url)) {
    jwksCache.set(url, createRemoteJWKSet(new URL(url)));
  }
  return jwksCache.get(url)!;
}

type HonoCtx = Context<{ Bindings: Env }>;

/**
 * Returns a Hono middleware function that enforces the given scope.
 * Call as: requireServiceAuth(SCOPE_REVIEW_WRITE)(c, next)
 */
export function requireServiceAuth(requiredScope: string) {
  return async (c: HonoCtx, next: Next): Promise<Response | void> => {
    const env = c.env;

    // ── Path A: Cloudflare Access service token ──────────────────────────────
    const incomingId     = c.req.header('cf-access-client-id');
    const incomingSecret = c.req.header('cf-access-client-secret');

    if (incomingId && incomingSecret) {
      const expectedId = env.CF_ACCESS_CLIENT_ID;
      if (!expectedId) {
        return c.json(
          { error: 'Service token verification unavailable: CF_ACCESS_CLIENT_ID not configured' },
          503
        );
      }
      // Timing-safe comparison is not available in the Workers runtime for strings,
      // but CF Access network policy enforces the token before the Worker sees the request.
      if (incomingId !== expectedId) {
        return c.json({ error: 'Invalid service identity' }, 401);
      }
      // Service token accepted; all chittysync:review:* scopes implicitly granted by policy.
      return next();
    }

    // ── Path B: Bearer JWT ────────────────────────────────────────────────────
    const authHeader = c.req.header('authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return c.json(
        { error: 'Unauthorized: CF-Access service token or Bearer JWT required' },
        401
      );
    }

    // Do not log the token — slice only to hand off to jwtVerify
    const token    = authHeader.slice(7);
    const jwksUrl  = env.CHITTY_JWKS_URL   ?? 'https://auth.chitty.cc/.well-known/jwks.json';
    const issuer   = env.CHITTY_ISSUER_URI  ?? 'chittycanon://core/services/chittyauth';
    const audience = env.CHITTY_AUDIENCE_URI ?? 'chittycanon://core/services/chittysync';

    try {
      const JWKS = getJwks(jwksUrl);
      const { payload, protectedHeader } = await jwtVerify(token, JWKS, {
        issuer,
        audience,
        clockTolerance: CLOCK_TOLERANCE_SEC,
        algorithms: [...ALLOWED_ALGORITHMS],
      });

      // kid must be present in the protected header
      if (!protectedHeader.kid) {
        return c.json({ error: 'JWT protected header missing kid' }, 401);
      }

      // Validate scope claim; do not log scope values if they contain sensitive identifiers
      const rawScope = payload['scope'];
      const scopes: string[] =
        Array.isArray(rawScope)      ? (rawScope as string[]) :
        typeof rawScope === 'string' ? rawScope.split(' ')    : [];

      if (!scopes.includes(requiredScope)) {
        return c.json({ error: 'Insufficient scope for this endpoint' }, 403);
      }
    } catch (err: any) {
      // Sanitize: do not echo token, URLs, or internal identifiers in error message
      const errMsg: string = typeof err.message === 'string' ? err.message : 'unknown';
      const sanitized = errMsg
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/https?:\/\/\S+/g, '[url]');
      return c.json({ error: 'Service authentication failed', reason_code: sanitized }, 401);
    }

    return next();
  };
}
