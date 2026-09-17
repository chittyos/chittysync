-- ChittySync Intake Ledger
-- Migration: 003_intake_ledger.sql
-- Namespace: chittysync_intake (isolated; no collision with public sync_* tables)
-- Phase 1: Google Sheets is the SOLE chain authority. Neon is a shadow projection —
--   it records source_sheet_row / source_previous_event_hash / source_event_hash
--   rather than inventing its own chain sequence. (Phase 3 may promote Neon to authority.)
-- Canonical serialization: JCS (RFC 8785) — see fixtures/chitty-intake-sheet-array-v1.json

CREATE SCHEMA IF NOT EXISTS chittysync_intake;

-- ── Config ──────────────────────────────────────────────────────────
CREATE TABLE chittysync_intake.config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,
  value      JSONB NOT NULL DEFAULT {},
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Items (mutable current-state; plaintext filename lives HERE, not in the event stream) ──
CREATE TABLE chittysync_intake.items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system  TEXT NOT NULL,        -- workspace-studio | drop-watcher | ...
  source_account TEXT NOT NULL,        -- e.g. nick@jeanarlene.com
  drive_file_id  TEXT NOT NULL,
  sha256         TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  file_name      TEXT,                 -- plaintext, access-controlled
  mime_type      TEXT,
  size_bytes     BIGINT,
  state          TEXT NOT NULL DEFAULT 'staging'
                   CHECK (state IN ('staging','processed','filed','errored')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, source_account, drive_file_id)
);
-- content-hash dedupe (same doc re-emailed gets a new drive_file_id but identical sha256)
CREATE INDEX idx_intake_items_sha256 ON chittysync_intake.items (sha256);

-- ── Chain ordering: unique, monotonically allocated (NOT gap-free) ──
CREATE SEQUENCE chittysync_intake.event_order_seq;

-- ── Events (append-only outbox journal; file_name_hash only — privacy) ──
CREATE TABLE chittysync_intake.events (
  id                          BIGINT PRIMARY KEY DEFAULT nextval('chittysync_intake.event_order_seq'),
  item_id                     UUID NOT NULL REFERENCES chittysync_intake.items(id) ON DELETE RESTRICT,
  transition                  TEXT NOT NULL
                                CHECK (transition IN ('PREPARED','PRIMARY_COMMITTED','PUBLISHED','ABORTED')),
  sha256                      TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  file_name_hash              TEXT NOT NULL CHECK (file_name_hash ~ '^[a-f0-9]{64}$'),
  -- Phase 1 source authority (Google Sheets), NOT a Neon-invented chain_position:
  source_sheet_row            INTEGER,
  source_previous_event_hash  TEXT CHECK (source_previous_event_hash IS NULL OR source_previous_event_hash ~ '^[a-f0-9]{64}$'),
  source_event_hash           TEXT NOT NULL CHECK (source_event_hash ~ '^[a-f0-9]{64}$'),
  payload                     JSONB NOT NULL DEFAULT {},   -- JCS-canonical upstream serialization
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_event_hash)
);
CREATE INDEX idx_intake_events_item ON chittysync_intake.events (item_id, id);
-- relay publishes ONLY transition='PRIMARY_COMMITTED' rows to Neon (no split-brain)
CREATE INDEX idx_intake_events_relay ON chittysync_intake.events (transition, id);

-- ── Metrics ─────────────────────────────────────────────────────────
CREATE TABLE chittysync_intake.metrics (
  id          BIGSERIAL PRIMARY KEY,
  metric      TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT {},
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Grants (templated runtime role — resolved at apply time; do NOT hardcode) ──
GRANT USAGE ON SCHEMA chittysync_intake TO {{RUNTIME_ROLE}};
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA chittysync_intake TO {{RUNTIME_ROLE}};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA chittysync_intake TO {{RUNTIME_ROLE}};
ALTER DEFAULT PRIVILEGES IN SCHEMA chittysync_intake GRANT SELECT, INSERT, UPDATE ON TABLES TO {{RUNTIME_ROLE}};
ALTER DEFAULT PRIVILEGES IN SCHEMA chittysync_intake GRANT USAGE, SELECT ON SEQUENCES TO {{RUNTIME_ROLE}};
