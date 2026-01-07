-- ChittySync Engine Tables
-- Migration: 002_sync_engine.sql

-- Sync configurations (registries)
CREATE TABLE sync_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source JSONB NOT NULL,      -- { type, id, schema }
  target JSONB NOT NULL,      -- { type, id, schema }
  mode TEXT NOT NULL DEFAULT 'bidirectional'
    CHECK (mode IN ('bidirectional', 'source_to_target', 'target_to_source')),
  conflict_resolution TEXT NOT NULL DEFAULT 'last_write_wins'
    CHECK (conflict_resolution IN ('last_write_wins', 'source_wins', 'target_wins', 'manual')),
  field_mapping JSONB NOT NULL DEFAULT '[]',
  schedule TEXT,              -- Cron expression for scheduled syncs
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sync audit log (immutable record of all syncs)
CREATE TABLE sync_audit_log (
  id BIGSERIAL PRIMARY KEY,
  sync_id UUID NOT NULL UNIQUE,
  config_id UUID NOT NULL REFERENCES sync_configs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  stats JSONB NOT NULL DEFAULT '{}',
  changes_count INTEGER NOT NULL DEFAULT 0,
  conflicts_count INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Detailed change log for each sync
CREATE TABLE sync_change_log (
  id BIGSERIAL PRIMARY KEY,
  sync_id UUID NOT NULL,
  row_id TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
  direction TEXT NOT NULL CHECK (direction IN ('source_to_target', 'target_to_source')),
  fields TEXT[] NOT NULL DEFAULT '{}',
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Snapshots for diff calculation
CREATE TABLE sync_snapshots (
  id BIGSERIAL PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES sync_configs(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (config_id, row_id)
);

-- Conflict queue for manual resolution
CREATE TABLE sync_conflicts (
  id BIGSERIAL PRIMARY KEY,
  sync_id UUID NOT NULL,
  config_id UUID NOT NULL REFERENCES sync_configs(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL,
  field TEXT NOT NULL,
  source_value JSONB,
  target_value JSONB,
  resolution TEXT,            -- null until resolved
  resolved_value JSONB,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_sync_audit_config ON sync_audit_log(config_id);
CREATE INDEX idx_sync_audit_started ON sync_audit_log(started_at DESC);
CREATE INDEX idx_sync_audit_status ON sync_audit_log(status);
CREATE INDEX idx_sync_change_sync ON sync_change_log(sync_id);
CREATE INDEX idx_sync_snapshots_config ON sync_snapshots(config_id);
CREATE INDEX idx_sync_conflicts_pending ON sync_conflicts(config_id) WHERE resolution IS NULL;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for sync_configs
CREATE TRIGGER update_sync_configs_updated_at
  BEFORE UPDATE ON sync_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE sync_configs IS 'Sync configuration definitions (registries)';
COMMENT ON TABLE sync_audit_log IS 'Immutable audit log of all sync operations';
COMMENT ON TABLE sync_change_log IS 'Detailed record of individual row changes';
COMMENT ON TABLE sync_snapshots IS 'Last known state for diff calculation';
COMMENT ON TABLE sync_conflicts IS 'Queue for manual conflict resolution';
