-- NEWS-20: one-off data correction after the lazy-loading placeholder bugfix.
--
-- Two things happen here, both data-only — no schema change:
--   1. Every article's Bubble sync stamp is cleared (bubble_synced_at, bubble_id),
--      so the next scheduled runBubbleSync() re-sends the complete set against the
--      fixed image extraction.
--   2. Every image_url that is not a usable http(s) address is blanked. Bubble's
--      "Picture" field rejects such a value and refuses the whole record; NULL
--      means "no image", which the Bubble mapping skips silently.
--      The predicate mirrors isUsableImageUrl() in src/lib/image-url.ts: it
--      strips the tab/CR/LF characters the URL parser drops, then trims and
--      lower-cases, so ' DATA:,' and 'java<LF>script:' are both caught, and it
--      rejects every non-http(s) scheme rather than only `data:`.
--
-- !! TEST ENVIRONMENT ONLY !!
-- Clearing the stamps makes the sync re-send articles Bubble has already accepted.
-- That is only safe because the Bubble TEST environment is emptied manually in the
-- same deployment step. Applying this to a production database whose Bubble
-- counterpart has NOT been emptied would create duplicate Bubble records.
--
-- Idempotent: re-running it simply matches rows that are already NULL.

update public.articles
set bubble_synced_at = null,
    bubble_id = null
where bubble_synced_at is not null
   or bubble_id is not null;

update public.articles
set image_url = null
where image_url is not null
  and (
    -- empty or whitespace-only
    btrim(translate(image_url, E'\t\n\r', '')) = ''
    -- carries a URI scheme that is neither http nor https
    or (
      lower(btrim(translate(image_url, E'\t\n\r', ''))) ~ '^[a-z][a-z0-9+.-]*:'
      and lower(btrim(translate(image_url, E'\t\n\r', ''))) !~ '^https?:'
    )
  );
