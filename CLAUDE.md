# ChittySync

Enterprise data synchronization platform for Notion ↔ PostgreSQL ↔ Google Sheets.

## Product Vision

See [docs/PREMIER_PRODUCT_SPECIFICATION.md](docs/PREMIER_PRODUCT_SPECIFICATION.md) for the full product specification.

**TL;DR:** ChittySync is a standalone SaaS product ($15B+ TAM) that keeps canonical registries in perfect alignment across multiple systems with schema-driven validation, immutable audit trails, and zero-drift guarantees.

## Repository Structure

```
chittysync/
├── packages/
│   ├── engine/          # Server runtime (Hono + Neon)
│   │   └── src/
│   │       ├── audit/       # Append-only audit logging
│   │       ├── auth/        # Nonce + envelope verification
│   │       ├── bootstrap/   # Manifest verification
│   │       ├── crypto/      # ed25519, hashing, quorum
│   │       ├── db/          # Neon Postgres, sequencer
│   │       ├── routes/      # API endpoints
│   │       └── verifier/    # Fetch/verify client
│   └── verifier/        # CLI for batch verification + signing
├── migrations/          # Database migrations
├── docs/               # Documentation
└── scripts/            # Build/install scripts
```

## Current State vs Target

### What EXISTS (v1.1.0)

| Component | Status | Description |
|-----------|--------|-------------|
| Crypto foundation | Done | ed25519 signing, hashing, quorum consensus |
| Audit append | Done | Append-only cryptographic audit log |
| Auth/nonce | Done | Envelope verification, nonce management |
| Neon DB | Done | Basic Postgres connection via Neon serverless |
| Verifier CLI | Done | Batch verification and signing tool |
| Write route | Done | Single write endpoint with validation |

### What NEEDS TO BE BUILT (Q1 2026 MVP)

| Component | Priority | Description |
|-----------|----------|-------------|
| Notion adapter | P0 | OAuth integration, database read/write |
| Google Sheets adapter | P1 | API integration, range read/write |
| Schema validation | P0 | Integration with schema.chitty.cc |
| Sync engine | P0 | Fetch → Diff → Validate → Resolve → Apply |
| Conflict resolution | P0 | Last-write-wins, hash-based strategies |
| State tracking | P0 | Store last-known state for diff calculation |
| Web dashboard | P1 | Sync status, validation reports, audit logs |
| Scheduled sync | P1 | Cloudflare Workers cron triggers |
| Dry-run mode | P1 | Preview changes before applying |

### Architecture Gap

```
CURRENT:
┌─────────────┐      ┌─────────────┐
│  Verifier   │─────►│   Engine    │─────► Neon DB
│    CLI      │      │  (crypto)   │
└─────────────┘      └─────────────┘

TARGET:
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

## Development

### Prerequisites

- Node.js 20+
- pnpm 9.12+
- Neon PostgreSQL database

### Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run engine in dev mode
pnpm dev

# Run tests
pnpm test
```

### Environment Variables

```bash
# Engine
ENGINE_PUBKEY_HEX=...      # Ed25519 public key for verification
DATABASE_URL=postgres://...  # Neon connection string

# Future (not yet implemented)
NOTION_API_TOKEN=...        # Notion integration token
GOOGLE_SERVICE_ACCOUNT=...  # Google Sheets service account JSON
CHITTY_SCHEMA_URL=https://schema.chitty.cc
```

## Deployment

**Target:** Cloudflare Workers + Neon PostgreSQL

**Domain:** sync.chitty.cc

```bash
# Deploy to production (not yet configured)
wrangler deploy --env production
```

## Integration Points

| Service | Purpose | Status |
|---------|---------|--------|
| schema.chitty.cc | Schema validation | Not integrated |
| connect.chitty.cc | Credential management | Not integrated |
| ledger.chitty.cc | Audit log persistence | Not integrated |
| auth.chitty.cc | Service authentication | Not integrated |

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
- [ ] wrangler.toml configuration
- [ ] Health endpoint at sync.chitty.cc/health

## Related Services

- **ChittySchema** (schema.chitty.cc) - Canonical schema definitions
- **ChittyConnect** (connect.chitty.cc) - Credential management
- **ChittyLedger** (ledger.chitty.cc) - Immutable audit logs
- **ChittyCanon** (Notion) - Governance rules and Option Sets
