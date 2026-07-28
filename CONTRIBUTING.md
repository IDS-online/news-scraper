# Contributing to Newsgrap3r

## Before you start: claim the work

Open a GitHub Issue titled `NEWS-<id>: <Feature name>` and assign it to yourself.

The issue number allocates the feature ID without collisions, and the issue list is how we
each see what the other is working on. Check
[features/INDEX.md](features/INDEX.md) and the open issues for the next free `NEWS-` number.

Small work — dependency bumps, CI tweaks, typo fixes — needs no issue.

## Branches

```
<type>/NEWS-<id>-<short-slug>
```

Examples: `feat/NEWS-19-source-health-alerts`, `fix/NEWS-12-retention-timezone`. Work
without a feature ID uses `chore/<slug>` or `docs/<slug>`.

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `deploy`.

## Commits

```
type(NEWS-X): description
```

Example: `feat(NEWS-19): Add source health alert thresholds`. Omit the ID for work that
has none: `chore: Bump eslint to 9.20`.

## Environment variables in Vercel

Local development is covered by `vercel env pull .env.local` (see the README). This
section is about editing environment variables in the Vercel dashboard itself — do this
carefully, it has broken production twice already:

- **Editing a variable that exists in multiple scopes (Production, Preview,
  Development) removes it from every scope, not just the one you're changing.** This is
  how `SUPABASE_SERVICE_ROLE_KEY` and later `NEXT_PUBLIC_SUPABASE_ANON_KEY` were deleted
  from Production while someone was only trying to update Development. If a variable
  needs a different value in Development/Preview than in Production, **add a second,
  separately scoped entry** — never edit the existing one to "narrow" its scope.
- **`vercel env pull` cannot be used to back up secrets.** It writes sensitive values as
  empty strings, not their real contents. A "backup" taken this way is worthless, and
  restoring from it writes an empty value, which `src/lib/env.ts` treats as missing and
  refuses to boot on.
- **`vercel env pull` lags behind writes.** It has reported a variable as absent when
  `vercel env ls` showed it had been created a minute earlier. Don't use `pull` to verify
  that a dashboard change landed — use `vercel env ls`.
- **`vercel env add` needs `--value` and `--yes` when scripting it.** Piping the value on
  stdin silently fails for the `production` and `preview` targets, because those targets
  prompt for additional input that consumes the piped value instead.
- To verify env var state, trust (in order): `vercel env ls` for which variables exist in
  which scopes, the Supabase dashboard/API for what the real key values should be, and
  actually running the app for behaviour.
- **Damage from a bad edit is latent, not immediate.** A running deployment keeps the
  environment it was built with, so nothing looks wrong until the next deploy starts up,
  hits the `validateEnv()` guard in `src/lib/env.ts`, and fails.

## Database changes

The schema lives in `supabase/migrations/` and **git is the source of truth**.

Never change the schema through the Supabase dashboard or the Supabase MCP server. That is
how the schema drifted out of the repository before, and it made the database impossible to
rebuild from a clone. (`docs/architecture.md` is a design document, not a live reflection
of the schema, and has already drifted from it in places — treat the migrations directory
as the authority, not the doc.)

```bash
npx supabase@latest migration new add_source_health_fields
# edit the generated file in supabase/migrations/

npx supabase@latest link --project-ref cekgyjynxgyktzouepkp   # news-scraper-dev
npx supabase@latest db push          # apply to development

git add supabase/migrations/
git commit -m "feat(NEWS-19): Add source health fields migration"
```

`supabase link` prompts interactively for the database password — it cannot be scripted
without supplying the password some other way.

Tick the migration box in the pull request template and say whether production needs the
migration applied before or after the deploy. After the pull request merges, apply it to
production:

```bash
npx supabase@latest link --project-ref xvkviaapboambbvsvnuz   # news-scraper, production
npx supabase@latest db push
```

**Before any `db push` or `db reset`, check what you're actually linked to:**
`cat supabase/.temp/project-ref`. `cekgyjynxgyktzouepkp` is dev, `xvkviaapboambbvsvnuz`
is production.

If you're testing a migration against a local stack rather than the shared dev project,
**always run `supabase db reset --local`, never a bare `supabase db reset`.** Without
`--local` the command can target whatever project you're currently linked to — including
production. A local reset replays every migration from scratch and then applies
`supabase/seed.sql` (3 categories, 3 sources — heise online, tagesschau, BBC News — and
one `system_settings` row), so you get real data to look at immediately.

**Every table reference in a migration or in `supabase/seed.sql` must be schema-qualified**
(`public.categories`, not `categories`). The CLI applies both migrations and the seed on a
connection with an empty `search_path`, so a bare table name fails with
`relation "..." does not exist (SQLSTATE 42P01)` even though the table exists — easy to
miss because `psql` applies the same file fine, since its default `search_path` includes
`public`. If a seed fails, `supabase start` only reports
`failed to send batch: effect/sql/SqlError: Failed to execute statement`, and `--debug`
adds nothing useful. To see the actual Postgres error, run
`supabase db reset --local --sql-paths ./seed.sql` directly.

CI rebuilds the schema from scratch on every pull request (the `migrations` job runs
`supabase db reset --local` against a real local Supabase stack), so a migration that does
not apply cleanly fails before it reaches anyone.

## Tests

```bash
npm run test        # single run
npm run test:watch  # watch mode
```

**New logic under `src/lib/` arrives with a test.** There is no coverage threshold and no
requirement to backfill tests for code you did not touch.

Tests target pure functions — no database, no network, no UI rendering. Where the logic
worth testing is module-private, export it rather than mocking around it; see
`src/lib/scraping/rss-engine.ts` for the pattern. The public entry points (the ones that do
network I/O) are deliberately not unit-tested.

A few things that aren't obvious from reading the test files:

- `vitest.config.ts` pins the suite to `TZ=UTC`. Date parsing in the scraping engines is
  timezone-sensitive (`new Date('January 15, 2024')` resolves to local midnight), so
  without the pin a test can pass in CI and fail on a developer machine in any non-UTC
  timezone. Do not remove the pin.
- `process.env` is process-global, and Vitest can reuse a worker across test files. A test
  that mutates environment variables must restore them in `afterEach`, or the mutation
  leaks into other test files depending on run order. `src/lib/env.test.ts` is the pattern
  to copy.
- **A test that passes against a broken implementation is worse than no test.** More than
  one review round has found tests whose input happened to satisfy two independent
  conditions at once, so the specific rule the test claimed to check was never actually
  isolated. Before you commit a test, ask: if I deleted the rule this test names, would it
  actually go red? Where it's cheap to check, prove it by temporarily breaking the
  implementation and watching the test fail.

## Before opening a pull request

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

CI runs exactly these four (the `verify` job), plus a full schema rebuild (the
`migrations` job). Running them locally first saves a round trip.

## Pull requests

`main` is protected. No direct pushes — this applies to everyone, including repository
admins.

To merge you need: `verify` green, `migrations` green, one approving review, and the
branch up to date with `main`. Merges are squash-only, so the pull request title becomes
the commit message on `main` — write it in the `type(NEWS-X): description` form.

With two of us, we review each other's work. That is deliberate: review is the main way
knowledge about this codebase spreads.

## Development environment notes

- Local development and Preview deployments both point at the `news-scraper-dev` Supabase
  project, not production. `vercel env pull .env.local` is what configures this locally.
- **Scheduled scraping does not run outside production.** `vercel.json` crons fire against
  production deployments only. Trigger a scrape by hand with
  `POST /api/sources/[id]/scrape`. An empty dev feed is expected, not a fault.
- `.env.local` and `.mcp.json` are gitignored and must stay that way. Secrets live in
  Vercel environment variables and nowhere else.

## Frontend conventions

Read [.claude/rules/frontend.md](.claude/rules/frontend.md). The rule that matters most:
never hand-write a component shadcn/ui already provides. Check `src/components/ui/` first,
and install what is missing with `npx shadcn@latest add <name> --yes`.

## Backend conventions

Read [.claude/rules/backend.md](.claude/rules/backend.md) and
[.claude/rules/security.md](.claude/rules/security.md). Every table has RLS enabled. Every
API route validates its input with Zod and checks authentication before doing work.

## Known-broken things

These are filed and tracked as issues, not secrets — check before you re-discover them:

- [#2](https://github.com/IDS-online/news-scraper/issues/2) — bare publish dates are
  timestamped at server-local midnight instead of UTC
- [#3](https://github.com/IDS-online/news-scraper/issues/3) — scheme-less URLs bypass
  normalization and can duplicate articles
- [#4](https://github.com/IDS-online/news-scraper/issues/4) — two different UUID
  validation standards exist across the API
- [#7](https://github.com/IDS-online/news-scraper/issues/7) — `registerSchema` is
  duplicated (and untested) between the register API route and the register page

## Feature status

Update `features/INDEX.md` and the spec's own status header as part of the feature's own
pull request, not up front. Valid statuses: `Planned`, `In Progress`, `In Review`,
`Deployed`.
