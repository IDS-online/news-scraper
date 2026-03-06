-- NEWS-6: Performance indexes for the Articles REST API
--
-- These indexes support the query patterns used by:
--   GET /api/articles (paginated, filtered, sorted by published_at DESC)
--   GET /api/articles/[id] (single article lookup by PK — already indexed)
--
-- Run this in the Supabase SQL Editor or via supabase db push.

-- Index for sorting by published_at DESC (default order for all list queries)
CREATE INDEX IF NOT EXISTS idx_articles_published_at
  ON articles (published_at DESC);

-- Index for filtering by source_id (common filter)
CREATE INDEX IF NOT EXISTS idx_articles_source_id
  ON articles (source_id);

-- Index for filtering by language
CREATE INDEX IF NOT EXISTS idx_articles_language
  ON articles (language);

-- Index for filtering by category_id (NEWS-9/NEWS-11 categorization)
CREATE INDEX IF NOT EXISTS idx_articles_category_id
  ON articles (category_id);

-- Composite index for the most common query pattern:
-- Filter by source + order by published_at
CREATE INDEX IF NOT EXISTS idx_articles_source_published
  ON articles (source_id, published_at DESC);

-- Index to support ILIKE search on title
-- pg_trgm extension must be enabled for GIN trigram indexes
-- If pg_trgm is not available, the ILIKE query still works (sequential scan)
-- Uncomment the following lines if pg_trgm is enabled:
--
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS idx_articles_title_trgm
--   ON articles USING GIN (title gin_trgm_ops);

-- Index for date range queries (from/to filters)
-- The idx_articles_published_at above already covers this case.

-- Verify RLS is enabled on articles table (should already be from NEWS-5)
-- ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- RLS policy: All authenticated users can read articles
-- (This should already exist from NEWS-5, but ensure it's present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'articles' AND policyname = 'Authenticated users can read articles'
  ) THEN
    CREATE POLICY "Authenticated users can read articles"
      ON articles FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;
