-- Migration 002: Add metadata index for job lookup optimization.
CREATE INDEX IF NOT EXISTS idx_jobs_metadata ON jobs(scope, scope_key, status, next_run_at);
