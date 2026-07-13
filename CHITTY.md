---
uri: chittycanon://core/services/chittysync
namespace: chittycanon://core/services
type: architecture
version: 2.0.0
status: PENDING
registered_with: chittycanon://core/services/chittyregistry
title: "ChittySync"
certifier: chittycanon://core/services/chittycertify
visibility: INTERNAL
canonical_domain: sync.chitty.cc
tier: 3
last_reviewed: "2026-07-13"
---

# ChittySync

> `chittycanon://core/services/chittysync` | Tier 3 (Service) | sync.chitty.cc

## What It Does

Corporate-papers ingestion and enterprise data synchronization. Enforces case-agnostic legal-boundary routing for all document ingestion; records ALLOW_GENERAL events to ChittyFinance; maintains canonical registry alignment across Notion, Neon PostgreSQL, and Google Sheets.

## Architecture

Cloudflare Workers + Hono engine. Neon PostgreSQL for operational registries. All secrets resolved at runtime from ChittySecrets (`secrets.chitty.cc`). No private keys held by this service.

## Stack

| Component | Value |
|---|---|
| Runtime | Cloudflare Workers + Hono |
| Database | Neon PostgreSQL (operational registries) |
| Finance | ChittyFinance `finance.chitty.cc` — ALLOW_GENERAL import recording |
| Ingest Router | ChittyRouter — Stage 1 Preflight + Stage 2 Secure Inspection (JWS) |
| Auth Issuer | ChittyAuth `auth.chitty.cc` — JWKS publication and JWT policy |
| Secret Authority | ChittySecrets `secrets.chitty.cc` — all runtime credentials |
| Real Estate | ChittyRental — leases, properties, maintenance |
| API Boundary | Cloudflare API Gateway |

## Data Ingestion & Routing Flow

```
Intake (Gmail / Drive / Corporate source)
         │
         ▼
   streaming SHA-256 hash (never buffered)
         │
         ▼
   ChittyRouter Stage 1: Preflight
   (sha256 + MIME + size + source ref → JWS decision token)
         │
    ┌────┴──────────────────┐───────────────┐
    ▼                       ▼               ▼
ALLOW_GENERAL          ROUTE_LEGAL        REVIEW
    │                       │               │
    ▼                       ▼               ▼
ChittyFinance          ChittyEvidence   AppSheet
finance.chitty.cc      ingest           (opaque handle only)
POST /import           (Legal space)
    │                       │
    ▼                       ▼
Sheets projection      Read-only metadata stub:
(Transactions tab)     { case_id, sha256, authorized_url }
```

Stage 2 (Secure Inspection) fires when Stage 1 preflight is inconclusive. The Legal service fetches document bytes through ChittyConnect; the corporate engine submits only a source handle and a single-use transfer authorization.

## Endpoints

| Method | Path | Auth | Scope |
|---|---|---|---|
| GET | /health | public | — |
| GET | /api/v1/status | public | — |
| POST | /api/v1/review/queue | service token or JWT | `chittysync:review:write` |
| POST | /api/v1/review/action | service token or JWT | `chittysync:review:resolve` |
| POST | /api/sync/* | internal | — |
| GET | /api/registry/* | internal | — |
| GET | /api/audit/* | internal | — |

## Critical Dependencies

All four required for `healthy` / HTTP 200:

| Dependency | URI | Failure Mode |
|---|---|---|
| Neon PostgreSQL | — | unhealthy / 503 |
| ChittyRouter JWKS | `auth.chitty.cc/.well-known/jwks.json` | unhealthy / 503 |
| ChittySecrets | `secrets.chitty.cc` | unhealthy / 503 |
| ChittyFinance | `finance.chitty.cc` | unhealthy / 503 |

Projection services (Sheets, AppSheet) degrade to `degraded` / HTTP 207 when unavailable.

## Authority Boundaries

| Plane | Owner | This Service |
|---|---|---|
| Evidentiary truth | ChittyEvidence | Read-only reference only |
| Corporate finance records | ChittyFinance | Write via POST /import (ALLOW_GENERAL only) |
| Routing decisions | ChittyRouter / ChittyAuth | Consumer — never issues decisions |
| Secret custody | ChittySecrets | Consumer — no private key access |
| Reporting projections | This service | Sheets + AppSheet review queue |

## Required Runtime Secrets

Resolved via ChittySecrets. `ENVIRONMENT=development` enables wrangler dev var fallback only.

| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `CF_ACCESS_CLIENT_ID` | CF Access client ID for ChittySecrets |
| `CF_ACCESS_CLIENT_SECRET` | CF Access client secret |
| `CHITTY_SYNC_SERVICE_CREDENTIALS` | Bearer for ChittyFinance + ChittyRouter calls |
| `APPSHEET_API_KEY` | AppSheet API key |
| `GOOGLE_SERVICE_ACCOUNT` | Google service account JSON for Sheets |
| `SHEETS_SPREADSHEET_ID` | Target spreadsheet ID |
| `APPSHEET_APP_ID` | AppSheet application ID |

## Compliance

- [x] Health endpoint at sync.chitty.cc/health
- [x] /api/v1/status with full dependency readiness (DB + JWKS + Secrets + Finance)
- [x] CHARTER.md with canonical frontmatter (`type: policy`, `status: PENDING`)
- [x] CHITTY.md with canonical frontmatter (`type: architecture`, `status: PENDING`)
- [x] AGENTS.md with development guidelines
- [x] Legal-boundary routing (case-agnostic, ChittyRouter-driven)
- [x] Review routes authenticated — separate scopes per endpoint
- [x] No case constants in source (scan verified)
- [ ] ChittyCertify gate — PENDING
- [ ] Production cutover — BLOCKED on ChittySecrets runtime verification
