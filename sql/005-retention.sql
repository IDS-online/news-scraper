-- NEWS-12: Retention policy tables
-- Applied via Supabase MCP migration: news12_retention_tables

-- =============================================================================
-- TABLE: system_settings
-- =============================================================================
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value) VALUES ('retention_enabled', 'false');

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read system_settings"
  ON system_settings FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can update system_settings"
  ON system_settings FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE POLICY "Service role can read system_settings"
  ON system_settings FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role can update system_settings"
  ON system_settings FOR UPDATE TO service_role USING (true);

-- =============================================================================
-- TABLE: retention_log
-- =============================================================================
CREATE TABLE retention_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  source_name TEXT,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_retention_log_run_at ON retention_log(run_at DESC);
CREATE INDEX idx_retention_log_source_id ON retention_log(source_id);

ALTER TABLE retention_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read retention_log"
  ON retention_log FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can insert retention_log"
  ON retention_log FOR INSERT TO service_role WITH CHECK (true);

-- =============================================================================
-- RLS: allow service_role to DELETE articles (for retention cron)
-- =============================================================================
CREATE POLICY "Service role can delete articles"
  ON articles FOR DELETE TO service_role USING (true);
