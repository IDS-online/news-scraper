-- NEWS-9: Categories table and article count helper function
-- Applied via Supabase MCP migrations: news9_categories_table, news9_category_article_count_fn

-- =============================================================================
-- TABLE: categories
-- =============================================================================
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive unique index on name
CREATE UNIQUE INDEX idx_categories_name_lower ON categories (LOWER(name));

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read categories"
  ON categories FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can insert categories"
  ON categories FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "Admins can update categories"
  ON categories FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "Admins can delete categories"
  ON categories FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "Service role can insert categories"
  ON categories FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role can update categories"
  ON categories FOR UPDATE TO service_role USING (true);

-- =============================================================================
-- UPDATED_AT TRIGGER
-- =============================================================================
CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- HELPER FUNCTION: combined deduplicated article count per category
-- =============================================================================
CREATE OR REPLACE FUNCTION get_category_article_count(cat_id UUID)
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COUNT(DISTINCT article_id)
  FROM (
    SELECT id AS article_id FROM articles WHERE category_id = cat_id
    UNION
    SELECT article_id FROM article_categories WHERE category_id = cat_id
  ) combined;
$$;

-- =============================================================================
-- ALTER articles: add category_id FK (if not added in 003)
-- =============================================================================
ALTER TABLE articles ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;
