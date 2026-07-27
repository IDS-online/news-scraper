# Team Collaboration Process — Design

> Moving Newsgrap3r from a single-developer project to a two-developer project.
> Created: 2026-07-27
> Status: Approved, not yet implemented

---

## 1. Goal

Newsgrap3r has been built and operated by one person. A second developer — experienced,
already working with Claude Code — will join and work on features in parallel.

This document defines the development process that makes that safe: how work is claimed,
how code reaches production, how the database is reproduced, and what a newcomer reads
on day one.

**Explicit non-goals.** No staging tier, no Dependabot, no error tracking (Sentry), no
architecture decision records, no test coverage gates, no mandatory E2E suite. These were
considered and deliberately excluded as beyond the agreed "pragmatic minimum". They can
be added later without reworking anything below.

---

## 2. Starting point

### 2.1 What already exists

| Asset | State |
|-------|-------|
| GitHub remote | `IDS-online/news-scraper` |
| Feature specs | 18 specs in `features/` plus `INDEX.md` status table |
| Architecture docs | `docs/architecture.md`, `docs/PRD.md`, `docs/styleguide.md` |
| Coding rules | `.claude/rules/{general,backend,frontend,security}.md` |
| AI workflow | 7 skills, 3 sub-agents (`/requirements` → `/deploy`) |
| Commit convention | `feat(NEWS-X): …`, followed consistently across 33 commits |
| Deployment | Vercel project `news-scraper`, crons configured in `vercel.json` |
| Lint | `npm run lint` (ESLint 9 flat config, repaired in `9f20d06`) |
| Env validation | `src/lib/env.ts` + `src/instrumentation.ts` fail fast on missing vars |

The 17 commits authored by `alexvisualmakers` are the upstream starter-kit template's
history, not a prior collaborator. The project is effectively single-author.

### 2.2 Gaps that block a second developer

| Gap | Consequence |
|-----|-------------|
| No branches, no PRs — 33 commits direct to `main` | Two people pushing to `main` produce conflicts and broken production |
| No CI — no `.github/` directory at all | Nothing prevents a broken build reaching production |
| No tests — zero test files, no runner | No way to know a change broke someone else's feature |
| **Schema not reproducible from the repo** | A clone cannot build the database (detail below) |
| Single Supabase project, which is production | A newcomer's experiments hit live data |
| No secrets-sharing process | No defined way to hand over `SUPABASE_SERVICE_ROLE_KEY` etc. |
| `README.md` is still the starter kit's | A clone tells the reader nothing about Newsgrap3r |
| No `typecheck` script | TypeScript errors surface only at build time |
| `package.json` named `ai-coding-starter-kit` | Signals an unowned project |
| Docs drifted from reality | See §2.4 |

### 2.3 The schema gap in detail

The remote Supabase project (`news-scraper`, ref `xvkviaapboambbvsvnuz`) has a proper
migration history of 12 migrations, applied over time via the Supabase MCP:

```
20260306082203  create_profiles_table_and_auth_trigger
20260306091256  create_sources_and_mappings_tables
20260306102904  add_scraping_in_progress_and_articles_table
20260306103844  news6_articles_api_additional_indexes
20260306121812  news9_categories_table
20260306121855  news9_category_article_count_fn
20260306122657  news9_category_counts_batch_fn
20260306125528  news12_retention_tables
20260306133952  fix_profiles_rls_recursion
20260306144257  add_sources_categories_fk
20260306152035  add_source_category_mappings_category_fk
20260306154759  add_selector_image_to_sources
```

The repository contains **one** of these (`supabase/migrations/20260306_news6_articles_api_indexes.sql`).
The remaining eleven exist only inside Supabase's `supabase_migrations.schema_migrations`
table. The four files in `sql/` are hand-maintained copies of some of that work — their
own headers say so ("Applied via Supabase MCP migration: news12_retention_tables") — and
they are not a migration history.

The history is recoverable via `supabase db pull`. This is the highest-risk item in the
rollout and is sequenced first.

### 2.4 Documentation drift

- **NEWS-11 (LLM categorization) is not implemented.** The only trace in the codebase is
  the `ANTHROPIC_API_KEY` declaration in `src/lib/env.ts:25`. There is no
  `src/lib/categorization/` directory and `@anthropic-ai/sdk` is not a dependency.
  `docs/architecture.md` §8 documents `src/lib/categorization/llm-categorizer.ts` as
  though it exists, and `features/INDEX.md` marks the feature "In Progress".
- **`features/INDEX.md` statuses are stale.** NEWS-6, NEWS-7 and NEWS-8 are demonstrably
  working but are marked "In Progress" / "In Review".
- **`src/lib/supabase.ts`** is a backwards-compatibility re-export shim with zero
  importers, sitting alongside the real `src/lib/supabase/{client,server}.ts`.

---

## 3. Decisions

| Area | Decision |
|------|----------|
| Branching | Trunk-based, short-lived feature branches off `main` |
| Merge gate | PR required, CI green, 1 approval, squash-merge |
| Branch protection | Applies to both developers, no exemptions |
| Database environments | New shared `news-scraper-dev` Supabase project; existing project stays production. No local Docker Supabase. |
| Schema source of truth | `supabase/migrations/` in git. No further schema changes via MCP or dashboard. |
| Secrets distribution | Vercel environment variables, retrieved with `vercel env pull` |
| Testing | Vitest on pure logic in `src/lib/`. No UI tests, no E2E, no coverage gate. |
| Work claiming | GitHub Issue titled `NEWS-X: Name`, self-assigned, opened before work starts |
| CI | GitHub Actions: lint, typecheck, test, build |

---

## 4. Git and branching model

```
main (protected)  ──────●────────●────────●──────→  Vercel production
                       ╱        ╱        ╱
   feat/NEWS-19-…  ───●        ╱        ╱
   fix/NEWS-12-…   ──────────●         ╱
   feat/NEWS-20-…  ───────────────────●
```

### Branch protection rules on `main`

- Direct pushes blocked, including for repository administrators
- Pull request required before merging
- 1 approving review required
- All CI status checks must pass
- Branch must be up to date with `main` before merging
- Squash merge only; merge commits and rebase merging disabled

### Branch naming

`<type>/NEWS-<id>-<short-slug>` — for example `feat/NEWS-19-source-health-alerts`,
`fix/NEWS-12-retention-timezone`. Types match the existing commit convention:
`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `deploy`.

Work without a feature ID (tooling, dependencies, CI) uses `chore/<slug>` and needs no
issue.

### Why squash merge

Feature branches will contain many AI-generated intermediate commits. Squashing keeps
`main` at one commit per feature and preserves the `feat(NEWS-X): description` convention
already used across the project's history. The squash commit message is the PR title,
which the PR template requires to be in that format.

---

## 5. Environments and database

### 5.1 Tiers

| Tier | Supabase project | Vercel | Written by |
|------|-----------------|--------|-----------|
| Development | `news-scraper-dev` (new, free tier) | Preview deployments | Both developers, freely |
| Production | `news-scraper` (`xvkviaapboambbvsvnuz`) | Production | Merges to `main` only |

Local development (`npm run dev`) points at `news-scraper-dev`.

### 5.2 Repairing the migration history

1. `supabase link --project-ref xvkviaapboambbvsvnuz`
2. `supabase db pull` — reconstructs all 12 migrations as files in `supabase/migrations/`
3. Commit them. Git is now the source of truth for the schema.
4. Delete the `sql/` directory. The commit message records that migrations moved to
   `supabase/migrations/`.
5. Create the `news-scraper-dev` project and run `supabase db push` against it. This
   proves the committed history reproduces the schema from an empty database. If it does
   not, that is discovered now rather than on the new developer's first day.
6. Add `supabase/seed.sql` containing three or four sample sources and the category set,
   so a fresh development database is immediately usable.

### 5.3 Rules from this point forward

- New schema changes are created with `supabase migration new <name>`, committed as part
  of the feature's PR, applied to `news-scraper-dev` during development, and applied to
  production after the PR merges.
- Schema changes via the Supabase MCP server or the Supabase dashboard are prohibited.
  This rule is recorded in `CLAUDE.md` so it also binds AI-assisted work.

### 5.4 Cron behaviour in development

`vercel.json` crons run against production deployments only. The development project will
not scrape on a schedule. Scrapes are triggered manually in development via
`POST /api/sources/[id]/scrape`. This is documented in `CONTRIBUTING.md` so it is not
mistaken for a bug.

### 5.5 Secrets

Vercel already holds the production secrets and is the distribution mechanism.

- Development-tier keys (`news-scraper-dev` URL, anon key, service role key, plus
  `CRON_SECRET` and `ANTHROPIC_API_KEY` when needed) are added to the Vercel project as
  `Development`-scoped environment variables.
- Both developers run `vercel env pull .env.local` to obtain them.
- `.env.local.example` remains as documentation of which variables exist, with dummy
  values, per `.claude/rules/security.md`.

No password manager, no keys sent over chat, and revocation happens in one place.

---

## 6. CI pipeline

A single workflow at `.github/workflows/ci.yml`, triggered on `pull_request` and on
`push` to `main`.

### Job: `verify`

Node 24, `npm ci`, then in order:

| Step | Command | Status |
|------|---------|--------|
| Lint | `npm run lint` | exists |
| Type check | `npm run typecheck` | new — `tsc --noEmit` |
| Test | `npm run test` | new — `vitest run` |
| Build | `npm run build` | exists |

`src/instrumentation.ts` fails startup when environment variables are missing, and
`next build` may execute it. The workflow therefore supplies dummy values for all
variables listed in `src/lib/env.ts` through the step's `env:` block. No real credentials
are stored in CI.

### Job: `migrations`

Runs `supabase db reset` against the committed migrations in an ephemeral Postgres on the
GitHub Actions runner, verifying that the history still applies cleanly from an empty
database. This is what prevents the schema history from silently rotting again.

This job runs **only in CI**, where Docker is available on the runner. It does not require
either developer to run Docker locally, which keeps the "shared cloud dev project, no local
Supabase" decision in §3 intact. It is a required status check for merging.

### Additional `package.json` changes

- Add scripts: `typecheck`, `test`, `test:watch`
- Rename the package from `ai-coding-starter-kit` to `news-scraper`

---

## 7. Testing

Vitest, targeting logic that fails silently — the scraping core and validation layer.
No database, no network, no UI rendering.

| Module | Coverage |
|--------|----------|
| `src/lib/scraping/rss-engine.ts` | RSS 2.0 and Atom fixtures normalized to the article shape; missing fields; unparseable dates |
| `src/lib/scraping/html-engine.ts` | cheerio selector extraction against a saved HTML fixture; relative-to-absolute URL resolution |
| `src/lib/scraping/feed-detector.ts` | feed discovery from `<link rel="alternate">` |
| `src/lib/scraping/scheduler.ts` | which sources are due given `interval_minutes`; deduplication by URL |
| `src/lib/validations/source.ts` | Zod schema accepts valid and rejects invalid source payloads |
| `src/lib/validations/category.ts` | as above for categories |
| `src/lib/validations/article.ts` | as above for articles |

Fixtures live in `src/lib/scraping/__fixtures__/`. Target is roughly 20 tests.

There is no coverage threshold. The standing expectation is: **new logic added under
`src/lib/` arrives with a test.** This is recorded in `CONTRIBUTING.md`.

---

## 8. Onboarding documentation

### 8.1 `README.md` — rewrite

The current file is the starter kit's README and instructs the reader to
`git clone …/ai-coding-starter-kit`. Replace it with:

- What Newsgrap3r is and does
- Tech stack
- Setup path: `clone` → `npm ci` → `vercel env pull .env.local` → `npm run dev`
- Environment variable table
- Links into `docs/` and `features/`
- Where the AI workflow skills live and how to use them

Target: a new developer reaches a running application in under ten minutes.

### 8.2 `CONTRIBUTING.md` — new

- Branch naming and the commit convention
- The issue-claim flow (§9)
- How to add a database migration
- How to run tests and what is expected of new logic
- The PR checklist
- The development-cron caveat (§5.4)

### 8.3 `.github/pull_request_template.md` — new

Fields: feature ID and linked issue, summary of the change, whether a migration is
included, how it was tested.

### 8.4 Documentation truth pass

- Correct all statuses in `features/INDEX.md` to reflect reality
- Mark NEWS-11 as **Planned** (it is not implemented — see §2.4)
- Correct `docs/architecture.md` so it distinguishes what exists from what is designed
  but unbuilt; add an explicit implemented/planned marker where the two diverge
- Delete `src/lib/supabase.ts` (unused re-export shim)

---

## 9. Work coordination

Before starting a feature, the developer opens a GitHub Issue titled
`NEWS-<id>: <Feature name>` and assigns it to themselves.

```
GitHub Issues
  #23  NEWS-19: Source health alerts        @michael
  #24  NEWS-20: Article full-text search    @alex
```

This serves two purposes:

- **Atomic ID allocation.** GitHub assigns issue numbers without collision, so the
  `NEWS-X` claim is unambiguous. `features/INDEX.md` no longer needs to be edited merely
  to reserve an ID, which removes the recurring merge conflict on its
  "Next Available ID" line.
- **Shared visibility.** The issue list answers "what is the other person working on".

`features/INDEX.md` remains the directory of specs and their statuses, updated within the
feature's own PR rather than up front.

---

## 10. Keeping the AI workflow working for two people

The `.claude/` directory is an asset: a colleague using Claude Code inherits the project's
conventions automatically. Three adjustments are needed.

- **`.claude/settings.json`** is shared and committed; `.claude/settings.local.json` is
  personal and already gitignored. The pending uncommitted change to `settings.json` is
  committed so it is inherited.
- **`.mcp.json`** is gitignored because it carries a Supabase access token. Add
  `.mcp.json.example` documenting the required MCP configuration, pointed at the
  **development** project rather than production.
- **`CLAUDE.md`** gains a `Collaboration` section stating: never push to `main`; never
  apply schema changes via the Supabase MCP or dashboard — migrations only; claim a
  feature ID by opening a GitHub Issue before running `/requirements`.

---

## 11. Rollout order

| # | Step | Rationale |
|---|------|-----------|
| 1 | Commit the pending working-tree changes (`.claude/settings.json`, `.gitignore`, `features/NEWS-10-source-extensions.md`, `.claude/skills/handoff/`) | Clean slate |
| 2 | `supabase db pull`, commit the 12 migrations, delete `sql/` | Highest-risk item; everything else depends on a reproducible schema |
| 3 | Create `news-scraper-dev`, `supabase db push`, add `supabase/seed.sql` | Proves step 2 works from an empty database |
| 4 | Add development-scoped env vars in Vercel | Enables the `vercel env pull` onboarding path |
| 5 | Add `typecheck` script, Vitest, and the first tests | Gives CI something meaningful to run |
| 6 | Add `.github/workflows/ci.yml` and the PR template | |
| 7 | Enable branch protection on `main` | Must come after CI is green, otherwise merging is blocked by checks that do not exist |
| 8 | Rewrite `README.md`, write `CONTRIBUTING.md`, run the docs truth pass | |
| 9 | Update `CLAUDE.md`, add `.mcp.json.example` | |
| 10 | Dry run: the second developer clones and reaches a running application | Acceptance test |

Steps 1–4 must complete before anyone else touches the repository. Steps 5–10 can land
incrementally.

---

## 12. Acceptance criteria

1. A fresh clone plus `npm ci`, `vercel env pull .env.local` and `npm run dev` yields a
   running application against `news-scraper-dev`, with no undocumented manual steps.
2. The CI `migrations` job reproduces the full schema from `supabase/migrations/` against
   an empty database, and `supabase db push` against `news-scraper-dev` succeeds from
   scratch.
3. A direct push to `main` is rejected by GitHub for both developers.
4. A pull request cannot merge while lint, typecheck, test, build or the `migrations` job
   is failing.
5. A pull request cannot merge without one approving review.
6. `npm run test` passes and covers the modules listed in §7.
7. `features/INDEX.md` and `docs/architecture.md` describe the codebase as it actually is,
   with NEWS-11 marked Planned.
8. No secret is stored anywhere except Vercel environment variables and local
   `.env.local` files.
