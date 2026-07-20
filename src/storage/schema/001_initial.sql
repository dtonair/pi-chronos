-- Chronos initial schema (v1)
-- Creates tables for jobs, runs, approvals, scheduler instances, and audit events.

-- ============================================================================
-- jobs
-- ============================================================================

CREATE TABLE IF NOT EXISTS jobs (
  id                      TEXT NOT NULL PRIMARY KEY,
  schema_version          INTEGER NOT NULL DEFAULT 1,
  name                    TEXT NOT NULL,
  normalized_name         TEXT NOT NULL,
  description             TEXT,
  prompt                  TEXT NOT NULL,
  tags_json               TEXT NOT NULL DEFAULT '[]',
  status                  TEXT NOT NULL DEFAULT 'draft',
  scope                   TEXT NOT NULL,
  scope_key               TEXT NOT NULL,
  source                  TEXT NOT NULL,
  import_key              TEXT,
  schedule_json           TEXT NOT NULL,
  execution_json          TEXT NOT NULL,
  permissions_json        TEXT NOT NULL,
  approval_required       INTEGER NOT NULL DEFAULT 0,
  approved_fingerprint    TEXT,
  next_run_at             TEXT,
  last_scheduled_at       TEXT,
  last_run_at             TEXT,
  last_success_at         TEXT,
  consecutive_failures    INTEGER NOT NULL DEFAULT 0,
  diagnostic_code         TEXT,
  diagnostic_message      TEXT,
  created_at              TEXT NOT NULL,
  created_by              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  updated_by              TEXT NOT NULL,
  revision                INTEGER NOT NULL DEFAULT 1
);

-- Case-insensitive scoped name uniqueness (FR4)
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_scope_name
  ON jobs (scope, scope_key, normalized_name);

-- Indexed next-due query (FR24)
CREATE INDEX IF NOT EXISTS idx_jobs_next_run
  ON jobs (next_run_at, status, approval_required)
  WHERE next_run_at IS NOT NULL;

-- Lookup by import_key for reconciliation (FR67)
CREATE INDEX IF NOT EXISTS idx_jobs_import_key
  ON jobs (scope, scope_key, import_key)
  WHERE import_key IS NOT NULL;

-- ============================================================================
-- job_runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS job_runs (
  id                  TEXT NOT NULL PRIMARY KEY,
  job_id              TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  occurrence_key      TEXT NOT NULL,
  trigger             TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at        TEXT NOT NULL,
  queued_at           TEXT NOT NULL,
  claimed_at          TEXT,
  started_at          TEXT,
  finished_at         TEXT,
  status              TEXT NOT NULL DEFAULT 'queued',
  attempt             INTEGER NOT NULL DEFAULT 1,
  executor_id         TEXT,
  lease_expires_at    TEXT,
  parent_run_id       TEXT,
  output_summary      TEXT,
  output_location     TEXT,
  output_truncated    INTEGER NOT NULL DEFAULT 0,
  error_code          TEXT,
  error_message       TEXT,
  error_details       TEXT,
  metadata_json       TEXT,
  duration_ms         INTEGER,
  created_at          TEXT NOT NULL
);

-- Occurrence uniqueness: one run per job per occurrence key (FR30)
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_occurrence
  ON job_runs (job_id, occurrence_key);

-- Claim lookup: find runs owned by an executor (FR32)
CREATE INDEX IF NOT EXISTS idx_runs_executor
  ON job_runs (executor_id, status)
  WHERE executor_id IS NOT NULL;

-- Lease expiration scan for recovery (FR35)
CREATE INDEX IF NOT EXISTS idx_runs_lease
  ON job_runs (lease_expires_at, status)
  WHERE lease_expires_at IS NOT NULL;

-- Job history pagination (FR73)
CREATE INDEX IF NOT EXISTS idx_runs_job_status_created
  ON job_runs (job_id, status, created_at);

-- ============================================================================
-- job_approvals
-- ============================================================================

CREATE TABLE IF NOT EXISTS job_approvals (
  id              TEXT NOT NULL PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  fingerprint     TEXT NOT NULL,
  approved_by     TEXT NOT NULL,
  approved_at     TEXT NOT NULL,
  revoked_at      TEXT,
  source          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approvals_job
  ON job_approvals (job_id, approved_at DESC);

-- ============================================================================
-- scheduler_instances
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheduler_instances (
  id              TEXT NOT NULL PRIMARY KEY,
  hostname        TEXT,
  process_id      INTEGER,
  started_at      TEXT NOT NULL,
  heartbeat_at    TEXT NOT NULL,
  stopped_at      TEXT
);

-- Stale instance detection (FR36)
CREATE INDEX IF NOT EXISTS idx_instances_heartbeat
  ON scheduler_instances (heartbeat_at)
  WHERE stopped_at IS NULL;

-- ============================================================================
-- audit_events
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_events (
  id              TEXT NOT NULL PRIMARY KEY,
  event_name      TEXT NOT NULL,
  actor           TEXT NOT NULL,
  job_id          TEXT,
  run_id          TEXT,
  timestamp       TEXT NOT NULL,
  old_fingerprint TEXT,
  new_fingerprint TEXT,
  details_json    TEXT NOT NULL DEFAULT '{}'
);

-- Audit lookup by entity (FR81)
CREATE INDEX IF NOT EXISTS idx_audit_job
  ON audit_events (job_id, timestamp DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_run
  ON audit_events (run_id, timestamp)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_timestamp
  ON audit_events (timestamp DESC);
