-- Separate non-fatal scrape warnings from hard errors on sources.
-- last_error stays reserved for total scrape failures (nothing found/inserted);
-- last_scrape_warning holds skip messages from runs that still produced articles.
alter table "public"."sources"
  add column "last_scrape_warning" "text";
