-- NEWS-19: Bubble-Sync — track which articles have been pushed to the Bubble
-- "News Scraped" data type.
--
-- bubble_synced_at stays NULL until the article has been accepted by Bubble.
-- The daily sync job selects exactly those rows, so a failed or partial run is
-- simply retried on the next pass — no article is lost, none is sent twice.
-- bubble_id holds the unique id Bubble returns, so a row can be traced back to
-- (or later updated in) the Bubble database.

alter table public.articles
  add column if not exists bubble_synced_at timestamp with time zone,
  add column if not exists bubble_id text;

-- The sync job's only query: unsynced articles, oldest first.
create index if not exists articles_bubble_unsynced_idx
  on public.articles (created_at)
  where bubble_synced_at is null;

comment on column public.articles.bubble_synced_at is
  'NEWS-19: timestamp of the successful push to Bubble; NULL = not yet synced.';
comment on column public.articles.bubble_id is
  'NEWS-19: unique id of the corresponding record in the Bubble "News Scraped" data type.';
