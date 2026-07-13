---
service_chittyid: "TBD-pending-canonical-mint"
service_name: "chittysync"
canonical_uri: "chittycanon://core/services/chittysync"
pentad_version: "2.0.0"
tier: 3
last_reviewed: "2026-07-12"
---

# chittysync — AGENTS

Guidelines for agents working on the ChittySync / chitty-corp-papers codebase.

## Developer Guidelines

1. **Strict Case-Agnostic Routing**:
   - Never hardcode case-specific constants (case numbers like `2024D007847` or party names like `Arias`, `Bianchi`) in this repository.
   - All routing decisions must query `ChittyRouter` or the Legal policy endpoint.
   
2. **No Evidentiary Ingestion**:
   - The corporate engine is strictly blocked from saving or processing raw case documents.
   - If `ROUTE_LEGAL` is returned, calculate the SHA-256 in memory, forward the file handle/grant, and write a read-only metadata stub to the operational store only after `ChittyEvidence` returns the canonical ID. Discard raw bytes immediately.

3. **Signed Token Verification**:
   - Always verify JWS/JWT routing decisions returned by the policy service using the `jose` library and the issuer's public JWKS.
   - Never retrieve private signing keys in the corporate engine context.
   - Validate `iss`, `aud`, `kid`, `jti`, `sha256`, `hashed_source_reference`, `decision`, `policy_version`, `iat`, and `exp`. Enforce clock skew bounds.

4. **Secrets Resolution**:
   - Scoped service credentials must resolve dynamically via **ChittySecrets at `secrets.chitty.cc`**.
   - No local or 1Password credential fallbacks are allowed. Unavailability of secrets must fail closed.

5. **Opaque Review References**:
   - AppSheet `REVIEW` records must contain **metadata only** and an opaque reference handle. Never store direct R2 URLs or document contents.
