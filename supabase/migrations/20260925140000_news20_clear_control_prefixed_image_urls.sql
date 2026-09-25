-- NEWS-20 BUG-7: close the last gap in the stored-image_url cleanup.
--
-- The previous migration (20260925090000) mirrored isUsableImageUrl() using
-- btrim(), which removes spaces only. The WHATWG URL parser also strips every
-- leading and trailing C0 control (U+0001-U+001F), so a value such as
-- <SOH>data:, survived that predicate here and was normalised straight back to
-- 'data:,' by new URL() on the way out -- the exact value NEWS-20 removes.
--
-- This migration re-runs the image_url cleanup with the corrected predicate,
-- matching normalizeImageUrl() in src/lib/image-url.ts character for character.
--
-- U+0000 is not in the class: PostgreSQL text cannot hold a NUL byte, so no
-- stored value can carry one.
--
-- Data-only, no schema change. Idempotent: re-running it matches rows that are
-- already NULL. Unlike 20260925090000 this does NOT touch bubble_synced_at or
-- bubble_id, so it is safe to apply to any environment.

update public.articles
set image_url = null
where image_url is not null
  and (
    -- empty once the URL parser's own stripping is applied
    btrim(translate(image_url, E'\t\n\r', ''), E' \x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0F\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1A\x1B\x1C\x1D\x1E\x1F\x20') = ''
    -- carries a URI scheme that is neither http nor https
    or (
      lower(btrim(translate(image_url, E'\t\n\r', ''), E' \x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0F\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1A\x1B\x1C\x1D\x1E\x1F\x20')) ~ '^[a-z][a-z0-9+.-]*:'
      and lower(btrim(translate(image_url, E'\t\n\r', ''), E' \x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0F\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1A\x1B\x1C\x1D\x1E\x1F\x20')) !~ '^https?:'
    )
  );
