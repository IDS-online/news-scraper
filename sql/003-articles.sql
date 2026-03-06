-- NEWS-5: Articles table, article_categories, and scraping_in_progress lock
-- NEWS-11: categorization_status field (placeholder for LLM categorization)

-- =============================================================================
-- ALTER TABLE: sources — add scraping_in_progress lock column
-- =============================================================================
ALTER TABLE sources ADD COLUMN scraping_in_progress BOOLEAN NOT NULL DEFAULT false;

-- =============================================================================
-- TABLE: articles
-- =============================================================================
CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core fields
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  language TEXT NOT NULL DEFAULT 'und',
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Categorization (NEWS-10 raw category from feed, NEWS-11 LLM status)
  source_category_raw TEXT,
  categorization_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (categorization_status IN ('pending', 'done', 'failed', 'skipped')),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- URL uniqueness constraint (case-insensitive)
CREATE UNIQUE INDEX idx_articles_url_unique ON articles (LOWER(url));

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read articles
CREATE POLICY "Authenticated users can read articles"
  ON articles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admins can insert articles (via API/scheduler)
CREATE POLICY "Admins can insert articles"
  ON articles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can update articles
CREATE POLICY "Admins can update articles"
  ON articles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can delete articles
CREATE POLICY "Admins can delete articles"
  ON articles FOR DELETE
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
CREATE INDEX idx_articles_source_id ON articles(source_id);
CREATE INDEX idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX idx_articles_language ON articles(language);
CREATE INDEX idx_articles_categorization_status ON articles(categorization_status);
CREATE INDEX idx_articles_created_at ON articles(created_at DESC);

-- =============================================================================
-- UPDATED_AT TRIGGER (reuses function from 002-sources.sql)
-- =============================================================================
CREATE TRIGGER articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- TABLE: article_categories (n:m relation for NEWS-11)
-- =============================================================================
CREATE TABLE article_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL DEFAULT 'llm'
    CHECK (assigned_by IN ('llm', 'mapping', 'default', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate category assignments
  UNIQUE (article_id, category_id)
);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE article_categories ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read article categories
CREATE POLICY "Authenticated users can read article categories"
  ON article_categories FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admins can insert article categories
CREATE POLICY "Admins can insert article categories"
  ON article_categories FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can update article categories
CREATE POLICY "Admins can update article categories"
  ON article_categories FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can delete article categories
CREATE POLICY "Admins can delete article categories"
  ON article_categories FOR DELETE
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
CREATE INDEX idx_article_categories_article_id ON article_categories(article_id);
CREATE INDEX idx_article_categories_category_id ON article_categories(category_id);
