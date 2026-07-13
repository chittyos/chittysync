import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../worker";
import { resolveSecret } from "../auth/secrets";

export type RoutingDecisionType = "ALLOW_GENERAL" | "ROUTE_LEGAL" | "REVIEW";

export interface RoutingDecision {
  decision_id: string;
  policy_version: string;
  decision: RoutingDecisionType;
  reason_codes: string[];
  expires_at: number;
  sha256: string;
  hashed_source_reference: string;
  opaque_review_handle?: string;
  transfer_auth_token?: string;
}

// Simple in-memory cache for decisions (idempotency support)
const decisionCache = new Map<string, { decision: RoutingDecision; expiresAt: number }>();

// Simple in-memory cache for JWKS to handle temporary network failures
let jwksCache: any = null;
let jwksCacheExpires = 0;
const JWKS_CACHE_TTL = 3600 * 1000; // 1 hour

/**
 * Exported for testing only — clears the JWKS cache so tests with rotating keypairs work correctly.
 */
export function clearJwksCache(): void {
  jwksCache = null;
  jwksCacheExpires = 0;
}

/**
 * Calculates SHA-256 hash of a stream chunk-by-chunk to prevent buffering.
 */
export async function computeStreamHash(stream: ReadableStream<Uint8Array>): Promise<string> {
  const hash = createHash("sha256");
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }
  return hash.digest("hex");
}

/**
 * Hash source reference to obfuscate it
 */
export function hashSourceReference(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

/**
 * Validate JWS token using the public JWKS endpoint.
 */
export async function validateJWS(
  token: string,
  expectedHash: string,
  expectedSource: string,
  env: Env
): Promise<RoutingDecision> {
  const jwksUrl = env.CHITTY_JWKS_URL || "https://auth.chitty.cc/.well-known/jwks.json";
  const expectedIssuer = env.CHITTY_ISSUER_URI || "chittycanon://core/services/chittyrouter";
  const expectedAudience = env.CHITTY_AUDIENCE_URI || "chittycanon://core/services/chittysync";

  // 1. Fetch JWKS with caching and fail-closed handling
  let jwks: any;
  const now = Date.now();
  if (jwksCache && now < jwksCacheExpires) {
    jwks = jwksCache;
  } else {
    try {
      jwks = createRemoteJWKSet(new URL(jwksUrl), {
        timeoutDuration: 5000,
      });
      jwksCache = jwks;
      jwksCacheExpires = now + JWKS_CACHE_TTL;
    } catch (err) {
      if (jwksCache) {
        // Fall back to expired cache temporarily if registry is down
        jwks = jwksCache;
      } else {
        throw new Error("JWKS policy endpoint temporarily unavailable and no cache exists");
      }
    }
  }

  // 2. Validate JWS JWT signature and payload claims using jose
  const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    issuer: expectedIssuer,
    audience: expectedAudience,
    algorithms: ["RS256", "ES256", "EdDSA"], // Strict algorithm allowlist
    clockTolerance: 5, // 5s clock tolerance
  });

  // 3. Confirm JWS protected header parameters kid and alg exist
  if (!protectedHeader.kid) {
    throw new Error("JWS protected header is missing required kid (Key ID)");
  }
  if (!protectedHeader.alg) {
    throw new Error("JWS protected header is missing required alg (Algorithm)");
  }

  // 4. Validate payload claims match our expected hash and source reference (Replay prevention)
  const payloadData = payload as any;
  if (payloadData.sha256 !== expectedHash) {
    throw new Error("JWS payload sha256 mismatch (Cross-document decision reuse rejected)");
  }

  const hashedSource = hashSourceReference(expectedSource);
  if (payloadData.hashed_source_reference !== hashedSource) {
    throw new Error("JWS payload hashed_source_reference mismatch (Cross-document decision reuse rejected)");
  }

  return {
    decision_id: payloadData.jti || payloadData.decision_id,
    policy_version: payloadData.policy_version,
    decision: payloadData.decision as RoutingDecisionType,
    reason_codes: payloadData.reason_codes || [],
    expires_at: payloadData.exp || 0,
    sha256: payloadData.sha256,
    hashed_source_reference: payloadData.hashed_source_reference,
    opaque_review_handle: payloadData.opaque_review_handle,
    transfer_auth_token: payloadData.transfer_auth_token,
  };
}

/**
 * Stage 1: Preflight check.
 * Query ChittyRouter policy service with hash and metadata.
 */
export async function preflightCheck(
  hash: string,
  source: string,
  mimeType: string,
  size: number,
  env: Env
): Promise<RoutingDecision> {
  // Check local cache for idempotent reuse
  const cacheKey = `${hash}:${hashSourceReference(source)}`;
  const cached = decisionCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.decision;
  }

  const routerUrl = env.CHITTY_ROUTER_URL || "https://scrape.chitty.cc";
  const hashedSource = hashSourceReference(source);

  // Get service credentials via ChittySecrets
  let credentials;
  try {
    credentials = await resolveSecret("CHITTY_SYNC_SERVICE_CREDENTIALS", env);
  } catch (err) {
    // Fail closed to REVIEW if ChittySecrets is unreachable
    return createDefaultReviewDecision(hash, hashedSource, ["chittysecrets_outage"]);
  }

  try {
    const res = await fetch(`${routerUrl}/api/v1/route/preflight`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials}`,
      },
      body: JSON.stringify({
        sha256: hash,
        hashed_source_reference: hashedSource,
        mime_type: mimeType,
        size: size,
      }),
      signal: AbortSignal.timeout(10000), // 10s preflight timeout
    });

    if (!res.ok) {
      return createDefaultReviewDecision(hash, hashedSource, [`router_http_error_${res.status}`]);
    }

    const data = await res.json() as any;
    if (!data.success || !data.token) {
      return createDefaultReviewDecision(hash, hashedSource, ["inconclusive_preflight"]);
    }

    // Verify token signature and claims
    const decision = await validateJWS(data.token, hash, source, env);

    // Cache the verified decision
    decisionCache.set(cacheKey, {
      decision,
      expiresAt: decision.expires_at * 1000,
    });

    return decision;
  } catch (err: any) {
    // Fail closed to REVIEW on any timeout or connection error
    return createDefaultReviewDecision(hash, hashedSource, ["preflight_timeout_or_error"]);
  }
}

/**
 * Stage 2: Secure Inspection.
 * Request transfer authorization and call the Legal service to inspect content.
 */
export async function secureInspectionCheck(
  hash: string,
  source: string,
  env: Env
): Promise<RoutingDecision> {
  const routerUrl = env.CHITTY_ROUTER_URL || "https://scrape.chitty.cc";
  const hashedSource = hashSourceReference(source);

  let credentials;
  try {
    credentials = await resolveSecret("CHITTY_SYNC_SERVICE_CREDENTIALS", env);
  } catch (err) {
    return createDefaultReviewDecision(hash, hashedSource, ["chittysecrets_outage"]);
  }

  try {
    // 1. Request single-use transfer authorization
    const authRes = await fetch(`${routerUrl}/api/v1/route/transfer-auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials}`,
      },
      body: JSON.stringify({
        sha256: hash,
        hashed_source_reference: hashedSource,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!authRes.ok) {
      return createDefaultReviewDecision(hash, hashedSource, ["transfer_auth_failed"]);
    }

    const authData = await authRes.json() as any;
    if (!authData.success || !authData.transfer_auth_token) {
      return createDefaultReviewDecision(hash, hashedSource, ["transfer_auth_invalid"]);
    }

    // 2. Dispatch inconclusive item to Legal service for secure inspection
    const inspectRes = await fetch(`${routerUrl}/api/v1/route/inspect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials}`,
      },
      body: JSON.stringify({
        sha256: hash,
        hashed_source_reference: hashedSource,
        transfer_auth_token: authData.transfer_auth_token, // Single-use transfer grant
      }),
      signal: AbortSignal.timeout(15000), // 15s inspection timeout
    });

    if (!inspectRes.ok) {
      return createDefaultReviewDecision(hash, hashedSource, [`inspection_http_error_${inspectRes.status}`]);
    }

    const data = await inspectRes.json() as any;
    if (!data.success || !data.token) {
      return createDefaultReviewDecision(hash, hashedSource, ["inspection_inconclusive"]);
    }

    // Verify final JWS routing decision
    return await validateJWS(data.token, hash, source, env);
  } catch (err) {
    return createDefaultReviewDecision(hash, hashedSource, ["inspection_timeout_or_error"]);
  }
}

/**
 * Standard factory helper for review decisions.
 */
function createDefaultReviewDecision(hash: string, hashedSource: string, reasonCodes: string[]): RoutingDecision {
  return {
    decision_id: crypto.randomUUID(),
    policy_version: "failed_closed",
    decision: "REVIEW",
    reason_codes: reasonCodes,
    expires_at: Math.floor(Date.now() / 1000) + 300, // 5 min TTL
    sha256: hash,
    hashed_source_reference: hashedSource,
    opaque_review_handle: `opaque_review_${crypto.randomUUID()}`,
  };
}
