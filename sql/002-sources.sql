-- NEWS-2: Sources table (News-Quellen-Verwaltung)
-- NEWS-10: Extended with slug, default_category_id, selector_category, retention_days

-- =============================================================================
-- TABLE: sources
-- =============================================================================
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core fields (NEWS-2)
  name TEXT NOT NULL,
  url TEXT NOT NULL CHECK (char_length(url) <= 2000),
  type TEXT NOT NULL CHECK (type IN ('rss', 'html')),
  language TEXT NOT NULL DEFAULT 'auto',
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes >= 5),
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- HTML-specific CSS selectors (NEWS-2)
  selector_container TEXT,        -- CSS selector for article container
  selector_title TEXT,            -- CSS selector for article title
  selector_link TEXT,             -- CSS selector for article link
  selector_description TEXT,      -- CSS selector for article description/teaser
  selector_date TEXT,             -- CSS selector for article date
  selector_category TEXT,         -- CSS selector for article category (NEWS-10)

  -- Slug & category (NEWS-10)
  slug TEXT UNIQUE CHECK (slug ~ '^[a-z0-9-]+$' AND char_length(slug) <= 80),
  default_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,

  -- Retention (NEWS-10 / NEWS-12)
  retention_days INTEGER CHECK (retention_days IS NULL OR retention_days > 0),

  -- Scraping metadata
  last_scraped_at TIMESTAMPTZ,
  last_error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read sources
CREATE POLICY "Authenticated users can read sources"
  ON sources FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admins can insert sources
CREATE POLICY "Admins can insert sources"
  ON sources FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can update sources
CREATE POLICY "Admins can update sources"
  ON sources FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can delete sources
CREATE POLICY "Admins can delete sources"
  ON sources FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX idx_sources_is_active ON sources(is_active);
CREATE INDEX idx_sources_type ON sources(type);
CREATE INDEX idx_sources_slug ON sources(slug);
CREATE INDEX idx_sources_default_category_id ON sources(default_category_id);
CREATE INDEX idx_sources_last_scraped_at ON sources(last_scraped_at);

-- =============================================================================
-- UPDATED_AT TRIGGER
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sources_updated_at
  BEFORE UPDATE ON sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- TABLE: source_category_mappings (NEWS-10)
-- =============================================================================
CREATE TABLE source_category_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_category_raw TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate mappings for the same source + raw category
  UNIQUE (source_id, source_category_raw)
);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE source_category_mappings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read mappings
CREATE POLICY "Authenticated users can read source category mappings"
  ON source_category_mappings FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admins can insert mappings
CREATE POLICY "Admins can insert source category mappings"
  ON source_category_mappings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can update mappings
CREATE POLICY "Admins can update source category mappings"
  ON source_category_mappings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can delete mappings
CREATE POLICY "Admins can delete source category mappings"
  ON source_category_mappings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX idx_source_category_mappings_source_id ON source_category_mappings(source_id);
CREATE INDEX idx_source_category_mappings_category_id ON source_category_mappings(category_id);
