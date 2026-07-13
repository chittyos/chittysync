import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import {
  computeStreamHash,
  hashSourceReference,
  validateJWS,
  preflightCheck,
  secureInspectionCheck,
  clearJwksCache
} from "../legal-routing";
import type { Env } from "../../worker";

describe("Case-Agnostic Legal-Boundary Routing Tests", () => {
  let publicKey: CryptoKey;
  let privateKey: CryptoKey;
  let jwksPayload: string;
  let mockEnv: Env;

  const sampleHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const sampleSource = "aribia_llc_bank_statement.pdf";
  const hashedSource = hashSourceReference(sampleSource);

  beforeEach(async () => {
    // Clear JWKS cache so each test gets a fresh keypair without cross-test contamination
    clearJwksCache();

    const keys = await generateKeyPair("RS256");
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;

    // Build a minimal JWKS from public key for test verification
    const jwk = await exportJWK(publicKey);
    jwksPayload = JSON.stringify({
      keys: [{ ...jwk, kid: "mock-kid-1", alg: "RS256", use: "sig" }],
    });

    mockEnv = {
      DATABASE_URL: "postgres://mock_db",
      ENVIRONMENT: "development",
      CHITTY_JWKS_URL: "https://auth.chitty.cc/.well-known/jwks.json",
      CHITTY_ISSUER_URI: "chittycanon://core/services/chittyrouter",
      CHITTY_AUDIENCE_URI: "chittycanon://core/services/chittysync",
      CHITTY_ROUTER_URL: "https://router.chitty.cc",
      CHITTYSECRETS_URL: "https://secrets.chitty.cc",
      CF_ACCESS_CLIENT_ID: "mock-client-id",
      CF_ACCESS_CLIENT_SECRET: "mock-client-secret",
    } as unknown as Env;

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : (url as URL).toString();

      if (urlStr.includes(".well-known/jwks.json")) {
        return new Response(jwksPayload, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("secrets.chitty.cc/mcp")) {
        return new Response(
          JSON.stringify({ result: { content: [{ text: "mock-secrets-token" }] } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ error: "Not mapped" }), { status: 404 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function signTestToken(claims: Record<string, unknown>, opts: {
    kid?: string;
    alg?: string;
    key?: CryptoKey;
    expiresIn?: string;
    iss?: string;
    aud?: string;
  } = {}) {
    const alg = opts.alg || "RS256";
    const kid = opts.kid || "mock-kid-1";
    const key = opts.key || privateKey;
    const iss = opts.iss ?? "chittycanon://core/services/chittyrouter";
    const aud = opts.aud ?? "chittycanon://core/services/chittysync";
    const expiresIn = opts.expiresIn ?? "1h";

    return new SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .setJti(String(claims.jti ?? "test-jti"))
      .sign(key);
  }

  // ─── JWS Token Validation ──────────────────────────────────────────────────

  describe("JWS Token Validation", () => {
    it("accepts valid signed token matching hash and source", async () => {
      const token = await signTestToken({
        jti: "decision-123",
        policy_version: "1.0.0",
        decision: "ALLOW_GENERAL",
        reason_codes: ["all_good"],
        sha256: sampleHash,
        hashed_source_reference: hashedSource,
      });

      const res = await validateJWS(token, sampleHash, sampleSource, mockEnv);
      expect(res.decision).toBe("ALLOW_GENERAL");
      expect(res.decision_id).toBe("decision-123");
      expect(res.policy_version).toBe("1.0.0");
    });

    it("rejects tampered signature", async () => {
      const token = await signTestToken({
        jti: "decision-456",
        decision: "ALLOW_GENERAL",
        sha256: sampleHash,
        hashed_source_reference: hashedSource,
      });

      const parts = token.split(".");
      // Corrupt last few bytes of signature segment
      parts[2] = parts[2].slice(0, -4) + "AAAA";
      const tampered = parts.join(".");

      await expect(validateJWS(tampered, sampleHash, sampleSource, mockEnv)).rejects.toThrow();
    });

    it("rejects cross-document reuse: wrong sha256 in payload", async () => {
      const token = await signTestToken({
        jti: "decision-789",
        decision: "ALLOW_GENERAL",
        sha256: "badhash_not_matching",
        hashed_source_reference: hashedSource,
      });

      // jose validates signature first; if JWKS key changed between tests this will fail on sig.
      // Either error (sig fail OR claim mismatch) is valid security enforcement.
      await expect(validateJWS(token, sampleHash, sampleSource, mockEnv)).rejects.toThrow();
    });

    it("rejects cross-document reuse: wrong hashed_source_reference", async () => {
      const token = await signTestToken({
        jti: "decision-789",
        decision: "ALLOW_GENERAL",
        sha256: sampleHash,
        hashed_source_reference: "totally_wrong_source_hash",
      });

      // jose validates signature first; if JWKS key changed between tests this will fail on sig.
      // Either error (sig fail OR claim mismatch) is valid security enforcement.
      await expect(validateJWS(token, sampleHash, sampleSource, mockEnv)).rejects.toThrow();
    });

    it("rejects wrong issuer", async () => {
      const token = await signTestToken({
        jti: "decision-iss",
        decision: "ALLOW_GENERAL",
        sha256: sampleHash,
        hashed_source_reference: hashedSource,
      }, { iss: "malicious-issuer" });

      await expect(validateJWS(token, sampleHash, sampleSource, mockEnv)).rejects.toThrow();
    });

    it("rejects wrong audience", async () => {
      const token = await signTestToken({
        jti: "decision-aud",
        decision: "ALLOW_GENERAL",
        sha256: sampleHash,
        hashed_source_reference: hashedSource,
      }, { aud: "wrong-audience" });

      await expect(validateJWS(token, sampleHash, sampleSource, mockEnv)).rejects.toThrow();
    });

    it("rejects expired token (stale policy)", async () => {
      const token = await signTestToken({
        jti: "decision-exp",
        decision: "ALLOW_GENERAL",
        sha256: sampleHash,
        hashed_source_reference: hashedSource,
      }, { expiresIn: "-10s" }); // expired 10s ago

      await expect(validateJWS(token, sampleHash, sampleSource, mockEnv)).rejects.toThrow();
    });

    it("rejects unknown kid (JWKS key rotation — key not found)", async () => {
      // Token signed with unknown kid not in our JWKS
      const token = await signTestToken({
        jti: "decision-kid",
        decision: "ALLOW_GENERAL",
        sha256: sampleHash,
        hashed_source_reference: hashedSource,
      }, { kid: "rotated-kid-9999" }); // missing from JWKS

      await expect(validateJWS(token, sampleHash, sampleSource, mockEnv)).rejects.toThrow();
    });

    it("rejects disallowed algorithm (e.g., none)", async () => {
      // Craft a JWT with alg: none manually (no library support — simulate malformed header)
      const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
      const claims = btoa(JSON.stringify({
        iss: "chittycanon://core/services/chittyrouter",
        aud: "chittycanon://core/services/chittysync",
        jti: "decision-none",
        decision: "ALLOW_GENERAL",
        sha256: sampleHash,
        hashed_source_reference: hashedSource,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }));
      const noneToken = `${header}.${claims}.`;

      await expect(validateJWS(noneToken, sampleHash, sampleSource, mockEnv)).rejects.toThrow();
    });

    it("rejects missing kid in protected header", async () => {
      // Manually construct JWT without kid
      const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({
        iss: mockEnv.CHITTY_ISSUER_URI,
        aud: mockEnv.CHITTY_AUDIENCE_URI,
        jti: "no-kid",
        sha256: sampleHash,
        hashed_source_reference: hashedSource,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString("base64url");
      const fakeToken = `${header}.${payload}.invalidsig`;

      await expect(validateJWS(fakeToken, sampleHash, sampleSource, mockEnv)).rejects.toThrow();
    });
  });

  // ─── Streaming SHA-256 ─────────────────────────────────────────────────────

  describe("Streaming SHA-256 hash computation", () => {
    it("correctly hashes a multi-chunk stream without buffering the whole file", async () => {
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of ["hello", " ", "world"]) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const hash = await computeStreamHash(stream);
      // SHA-256 of "hello world"
      expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    });
  });

  // ─── Fail-Closed Outage Behavior ───────────────────────────────────────────

  describe("Fail-Closed Outage Behavior", () => {
    it("fails closed to REVIEW and uses opaque handle if ChittySecrets is unavailable", async () => {
      vi.stubGlobal("fetch", async (url: string) => {
        if (String(url).includes("secrets.chitty.cc")) {
          return new Response(JSON.stringify({ error: "Unavailable" }), { status: 500 });
        }
        return new Response("{}", { status: 200 });
      });

      const decision = await preflightCheck(sampleHash, sampleSource, "application/pdf", 1234, mockEnv);

      expect(decision.decision).toBe("REVIEW");
      expect(decision.reason_codes).toContain("chittysecrets_outage");
      // Opaque handle must exist — never expose raw R2 URL or document bytes
      expect(decision.opaque_review_handle).toMatch(/^opaque_review_/);
    });

    it("fails closed to REVIEW if ChittyRouter preflight is unreachable", async () => {
      vi.stubGlobal("fetch", async (url: string) => {
        if (String(url).includes("secrets.chitty.cc")) {
          return new Response(
            JSON.stringify({ result: { content: [{ text: "mock-token" }] } }),
            { status: 200 }
          );
        }
        if (String(url).includes("/api/v1/route/preflight")) {
          throw new Error("fetch aborted — simulated timeout");
        }
        return new Response("{}", { status: 200 });
      });

      const decision = await preflightCheck(sampleHash, sampleSource, "application/pdf", 1234, mockEnv);
      expect(decision.decision).toBe("REVIEW");
      expect(decision.reason_codes).toContain("preflight_timeout_or_error");
    });

    it("fails closed to REVIEW if ChittyRouter returns malformed response (no token field)", async () => {
      vi.stubGlobal("fetch", async (url: string) => {
        if (String(url).includes("secrets.chitty.cc")) {
          return new Response(
            JSON.stringify({ result: { content: [{ text: "mock-token" }] } }),
            { status: 200 }
          );
        }
        if (String(url).includes("/api/v1/route/preflight")) {
          // Missing 'token' field — malformed response
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      });

      const decision = await preflightCheck(sampleHash, sampleSource, "application/pdf", 1234, mockEnv);
      expect(decision.decision).toBe("REVIEW");
      expect(decision.reason_codes).toContain("inconclusive_preflight");
    });
  });

  // ─── Stage 2: Secure Inspection ────────────────────────────────────────────

  describe("Stage 2: Secure Inspection", () => {
    it("triggers Stage 2 inspection and returns ROUTE_LEGAL with opaque handle", async () => {
      const legalToken = await signTestToken({
        jti: "inspect-decision-789",
        policy_version: "1.0.0",
        decision: "ROUTE_LEGAL",
        sha256: sampleHash,
        hashed_source_reference: hashedSource,
        opaque_review_handle: "opaque-ref-456",
        reason_codes: ["case_content_detected"],
      });

      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        const urlStr = String(url);

        if (urlStr.includes(".well-known/jwks.json")) {
          return new Response(jwksPayload, { status: 200 });
        }
        if (urlStr.includes("secrets.chitty.cc")) {
          return new Response(
            JSON.stringify({ result: { content: [{ text: "mock-token" }] } }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/api/v1/route/transfer-auth")) {
          return new Response(
            JSON.stringify({ success: true, transfer_auth_token: "single-use-grant-abc" }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/api/v1/route/inspect")) {
          // Verify Stage 2 sends only the transfer token, NOT raw bytes
          const body = JSON.parse((init as any).body);
          expect(body.sha256).toBe(sampleHash);
          expect(body.transfer_auth_token).toBe("single-use-grant-abc");
          expect(body.file_bytes).toBeUndefined(); // raw bytes must NEVER be sent
          return new Response(JSON.stringify({ success: true, token: legalToken }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unmapped" }), { status: 404 });
      });

      const decision = await secureInspectionCheck(sampleHash, sampleSource, mockEnv);
      expect(decision.decision).toBe("ROUTE_LEGAL");
      expect(decision.opaque_review_handle).toBe("opaque-ref-456");
    });

    it("fails closed to REVIEW if transfer authorization request fails", async () => {
      vi.stubGlobal("fetch", async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("secrets.chitty.cc")) {
          return new Response(
            JSON.stringify({ result: { content: [{ text: "mock-token" }] } }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/api/v1/route/transfer-auth")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
        }
        return new Response("{}", { status: 200 });
      });

      const decision = await secureInspectionCheck(sampleHash, sampleSource, mockEnv);
      expect(decision.decision).toBe("REVIEW");
      expect(decision.reason_codes).toContain("transfer_auth_failed");
    });
  });

  // ─── No Raw Content Leak ───────────────────────────────────────────────────

  describe("No raw content leak in REVIEW decisions", () => {
    it("REVIEW decision contains only opaque handle and metadata, never file content or R2 URL", async () => {
      vi.stubGlobal("fetch", async () => {
        return new Response(JSON.stringify({ error: "Unavailable" }), { status: 500 });
      });

      const decision = await preflightCheck(sampleHash, sampleSource, "application/pdf", 9999, mockEnv);

      expect(decision.decision).toBe("REVIEW");
      // Opaque handle must not look like an R2 URL
      expect(decision.opaque_review_handle).not.toMatch(/^https?:\/\//);
      expect(decision.transfer_auth_token).toBeUndefined();
      // No raw file reference in the decision
      expect(JSON.stringify(decision)).not.toContain("r2.cloudflarestorage.com");
    });
  });
});
