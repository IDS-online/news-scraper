-- Seed data for local and development environments.
-- Applied by `supabase db reset`. Never run against production.
--
-- Deliberately uses fixed UUIDs so seeded data is stable across resets and can be
-- referenced from tests and manual QA. They are RFC 4122 v4-conformant (version nibble 4,
-- variant nibble 8) because createSourceSchema validates default_category_id with Zod's
-- .uuid(), which rejects the more obvious 1111...-style placeholders even though Postgres
-- accepts them.

insert into categories (id, name, description)
values
  ('11111111-1111-4111-8111-111111111111', 'Technologie',
   'Nachrichten zu Software, Hardware, IT-Sicherheit und digitaler Infrastruktur.'),
  ('22222222-2222-4222-8222-222222222222', 'Wirtschaft',
   'Berichte zu Unternehmen, Maerkten, Finanzen und Konjunktur.'),
  ('33333333-3333-4333-8333-333333333333', 'Politik',
   'Innen- und aussenpolitische Berichterstattung sowie Gesetzgebung.')
on conflict (id) do nothing;

insert into sources (
  id, name, slug, url, type, language, interval_minutes, is_active, default_category_id
)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'heise online', 'heise-online',
   'https://www.heise.de/rss/heise-atom.xml', 'rss', 'de', 30, true,
   '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'tagesschau', 'tagesschau',
   'https://www.tagesschau.de/index~rss2.xml', 'rss', 'de', 30, true,
   '33333333-3333-4333-8333-333333333333'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'BBC News', 'bbc-news',
   'https://feeds.bbci.co.uk/news/rss.xml', 'rss', 'en', 60, true,
   '33333333-3333-4333-8333-333333333333')
on conflict (id) do nothing;

insert into system_settings (key, value)
values ('retention_enabled', 'false')
on conflict (key) do nothing;
