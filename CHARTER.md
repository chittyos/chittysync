---
uri: chittycanon://docs/ops/charter/chittysync
namespace: chittycanon://docs/ops
type: policy
version: 2.0.0
status: PENDING
registered_with: chittycanon://core/services/chittyregistry
title: "ChittySync Service Charter"
certifier: chittycanon://core/services/chittycertify
visibility: INTERNAL
canonical_domain: sync.chitty.cc
tier: 3
last_reviewed: "2026-07-13"
---

# ChittySync Service Charter

> Policy document for  | Tier 3 | sync.chitty.cc

## Classification

| Field | Value |
|---|---|
| Tier | 3 (Service Layer) |
| Organization | ChittyOS |
| Canonical URI |  |
| Domain | sync.chitty.cc |
| Status | PENDING (awaiting ChittyCertify gate) |

## Mission

ChittySync is an **enterprise data synchronization and corporate-papers ingestion platform**. It maintains canonical registry alignment across Notion, Neon PostgreSQL, and Google Sheets, enforces case-agnostic legal-boundary routing for all document ingestion, and records corporate import events to ChittyFinance.

## Scope

### IS Responsible For

- Corporate document ingestion with case-agnostic legal-boundary routing (ChittyRouter)
- Forwarding ALLOW_GENERAL records to ChittyFinance ()
- Routing ROUTE_LEGAL documents to ChittyEvidence (via ChittyConnect); storing only read-only metadata stubs
- Queueing REVIEW decisions to AppSheet with opaque handles (no document preview)
- Bidirectional registry sync: Notion ↔ Neon PostgreSQL ↔ Google Sheets
- Providing the  operational readiness endpoint

### IS NOT Responsible For

- Evidentiary truth (ChittyEvidence / chittyevidence-db)
- Token provisioning (ChittyAuth)
- Service registration (ChittyRegistry)
- Schema definition (ChittySchema)
- Secret custody (ChittySecrets)
- Issuing routing decisions (ChittyRouter / ChittyAuth)
- Corporate banking sync from Mercury (ChittyFinance)

## Critical Dependencies

All four must be available for the service to report :

| Dependency | URI | Purpose |
|---|---|---|
| Database | Neon PostgreSQL | Operational registry storage |
| ChittyRouter / JWKS |  | Legal-boundary routing decisions |
| ChittySecrets |  | Runtime credential resolution |
| ChittyFinance |  | ALLOW_GENERAL import recording |

## Projection Services (Non-Critical, Reported Separately)

| Service | Purpose |
|---|---|
| Google Sheets | Reporting projection (Transactions tab) |
| AppSheet | REVIEW decision queue |

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /health | public | Liveness check |
| GET | /api/v1/status | public | Full dependency readiness |
| POST | /api/v1/review/queue | service token or JWT  | Enqueue REVIEW decision |
| POST | /api/v1/review/action | service token or JWT  | Resolve/reject REVIEW record |
| POST | /api/sync/* | internal | Registry sync operations |
| GET | /api/registry/* | internal | Registry reads |
| GET | /api/audit/* | internal | Audit log reads |

## Required Runtime Secrets

Resolved via ChittySecrets in production and staging. Development environments may use 
 ⛅️ wrangler 4.56.0 (update available 4.110.0)
────────────────────────────────────────────── var fallback only when  is set.

| Secret | Purpose |
|---|---|
|  | Neon PostgreSQL connection string |
|  | Cloudflare Access client ID for ChittySecrets |
|  | Cloudflare Access client secret |
|  | Bearer token for ChittyFinance and ChittyRouter calls |
|  | AppSheet API key for review queue |
|  | Google service account JSON for Sheets projection |
|  | Target spreadsheet for Transactions projection |
|  | AppSheet application ID |

## Legal Boundary Rules

- No case constants (case numbers, party names) in source or configuration
- ROUTE_LEGAL documents: forward file handle only; store only  after ChittyEvidence returns canonical ID
- REVIEW decisions: AppSheet receives opaque handle only — no R2 URLs, no document preview
- Production deployment blocked until ChittySecrets runtime verification succeeds

## Compliance Checklist

- [x] Health endpoint at sync.chitty.cc/health
- [x] /api/v1/status with full dependency readiness
- [x] CHARTER.md with canonical frontmatter (type: policy)
- [x] CHITTY.md with canonical frontmatter (type: architecture)
- [x] AGENTS.md with development guidelines
- [x] Legal-boundary routing enforced (case-agnostic, ChittyRouter-driven)
- [x] Review routes authenticated (separate scopes per endpoint)
- [x] No case constants in source (scan verified)
- [ ] ChittyCertify gate — PENDING
- [ ] Production cutover — BLOCKED on ChittySecrets runtime verification
