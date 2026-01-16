# ChittySync Charter

## Classification
- **Tier**: 3 (Service Layer)
- **Organization**: CHITTYOS
- **Domain**: sync.chitty.cc

## Mission

ChittySync is an **enterprise data synchronization platform** that keeps canonical registries in perfect alignment across Notion, PostgreSQL, and Google Sheets with schema-driven validation, immutable audit trails, and zero-drift guarantees.

## Scope

### IS Responsible For
- Bidirectional synchronization: Notion ↔ PostgreSQL ↔ Google Sheets
- Schema-driven validation against schema.chitty.cc
- Cryptographic audit logging (ed25519 signatures)
- Conflict resolution strategies (last-write-wins, hash-based)
- State tracking (last-known snapshots for diff calculation)
- Quorum consensus for multi-system consistency
- Envelope verification and nonce management
- Batch verification and signing (verifier CLI)

### IS NOT Responsible For
- Identity generation (ChittyID)
- Token provisioning (ChittyAuth)
- Service registration (ChittyRegister)
- Schema definition (ChittySchema)
- Evidence management (ChittyLedger)

## Current State (v1.1.0)

| Component | Status |
|-----------|--------|
| Crypto foundation | Done - ed25519 signing, hashing, quorum |
| Audit append | Done - Append-only cryptographic audit log |
| Auth/nonce | Done - Envelope verification, nonce management |
| Neon DB | Done - Basic Postgres connection |
| Verifier CLI | Done - Batch verification and signing |
| Write route | Done - Single write endpoint with validation |

## Target Architecture

```
┌─────────┐       ┌──────────────┐       ┌──────────┐
│ Notion  │◄─────►│  ChittySync  │◄─────►│ Neon DB  │
└─────────┘       │    Engine    │       └──────────┘
                  │              │
                  │  schema.cc   │
                  │  validation  │
                  │              │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ Google Sheets│
                  └──────────────┘
```

## Sync Engine Flow

```
Fetch → Diff → Validate → Resolve → Apply
```

## Dependencies

| Type | Service | Purpose |
|------|---------|---------|
| Upstream | ChittySchema | Schema validation |
| Upstream | ChittyAuth | Service authentication |
| Peer | ChittyConnect | Credential management |
| Peer | ChittyLedger | Audit log persistence |
| External | Notion API | Database read/write |
| External | Google Sheets API | Range read/write |
| Storage | Neon PostgreSQL | Primary database |

## Package Structure

```
chittysync/
├── packages/
│   ├── engine/          # Server runtime (Hono + Neon)
│   │   └── src/
│   │       ├── audit/       # Append-only audit logging
│   │       ├── auth/        # Nonce + envelope verification
│   │       ├── crypto/      # ed25519, hashing, quorum
│   │       ├── db/          # Neon Postgres, sequencer
│   │       └── routes/      # API endpoints
│   └── verifier/        # CLI for batch verification + signing
├── migrations/          # Database migrations
└── docs/               # Documentation
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ENGINE_PUBKEY_HEX` | Ed25519 public key for verification |
| `DATABASE_URL` | Neon connection string |
| `NOTION_API_TOKEN` | Notion integration token (future) |
| `GOOGLE_SERVICE_ACCOUNT` | Google Sheets service account (future) |
| `CHITTY_SCHEMA_URL` | Schema validation endpoint |

## Ownership

| Role | Owner |
|------|-------|
| Service Owner | ChittyOS |
| Technical Lead | @chittyos-infrastructure |
| Contact | sync@chitty.cc |

## Compliance

- [ ] Service registered in ChittyRegistry
- [ ] Health endpoint at sync.chitty.cc/health
- [ ] CLAUDE.md development guide present
- [ ] Cryptographic audit logging active
- [ ] Schema validation against schema.chitty.cc
- [ ] wrangler.toml configured for Cloudflare Workers

## Q1 2026 MVP Checklist

- [ ] Notion OAuth integration
- [ ] Notion database read/write adapter
- [ ] Schema validation against schema.chitty.cc
- [ ] Bidirectional sync engine (Notion ↔ Neon)
- [ ] State tracking (last-known snapshots)
- [ ] Conflict resolution (last-write-wins)
- [ ] Audit logging to ChittyLedger
- [ ] Basic web dashboard
- [ ] Cloudflare Workers deployment

---
*Charter Version: 1.0.0 | Last Updated: 2026-01-13*
