CREATE TABLE registry_sequencer (
  registry TEXT PRIMARY KEY,
  seq BIGINT NOT NULL CHECK (seq >= 0)
);

CREATE TABLE commit_intent (
  intent_id UUID PRIMARY KEY,
  registries TEXT[],
  status TEXT CHECK (status IN ('pending','complete','incomplete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  audit_seq BIGSERIAL PRIMARY KEY,
  registry TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  hash_prev BYTEA,
  hash_self BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES
  REVOKE UPDATE, DELETE, TRUNCATE, ALTER, COPY ON TABLES FROM PUBLIC;

CREATE ROLE break_glass NOLOGIN;

