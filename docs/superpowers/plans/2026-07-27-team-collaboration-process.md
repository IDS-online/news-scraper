# Team Collaboration Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Newsgrap3r from a single-developer repository into one a second developer can clone, run, and safely contribute to in parallel.

**Architecture:** Three strands, executed in dependency order. First make the database reproducible from git (currently impossible — the schema lives only inside Supabase). Then add the automated safety net (typecheck, Vitest, GitHub Actions) so branch protection has real checks to enforce. Finally write the human-facing onboarding docs and correct the documentation that has drifted from the code.

**Tech Stack:** Next.js 16.1.1, React 19, TypeScript 5, Supabase CLI, Vitest, GitHub Actions, Vercel CLI.

## Global Constraints

- **Node version in CI:** 24. (Local development machine currently runs v25.7.0; both are fine.)
- **Supabase production project ref:** `xvkviaapboambbvsvnuz` (name `news-scraper`, region `eu-west-1`, org `omfdwopofmygowyijdss`).
- **Supabase development project:** `news-scraper-dev`, to be created in Task 3, same org and region.
- **Vercel project:** `news-scraper`, `projectId` `prj_6uelx7tIg54zpfCFWVwGblVxeVfU`, `orgId` `team_dEk59nIGBWKoyErY0NVpYKh8`.
- **Commit convention:** `type(NEWS-X): description`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `deploy`, `chore`. Work without a feature ID uses `chore:` or `docs:` with no ID.
- **Branch naming:** `<type>/NEWS-<id>-<slug>`, or `<type>/<slug>` for work without a feature ID.
- **After Task 2, schema changes via the Supabase MCP server or the Supabase dashboard are prohibited.** Use `supabase migration new <name>` and commit the file.
- **After Task 9, `main` is protected.** Every subsequent task must go through a pull request.
- **Documentation language:** new process documentation (`README.md`, `CONTRIBUTING.md`, `CLAUDE.md`) is written in English, matching the existing `CLAUDE.md` and `.claude/rules/*.md`. Existing German feature specs, German Zod validation messages, and `docs/architecture.md` stay German — do not translate them.
- **Never commit real secrets.** `.env.local` and `.mcp.json` stay gitignored. Example files carry dummy values only.
- **Supabase CLI invocation:** use `npx supabase@latest <command>` throughout; do not add the CLI as a project dependency.

## Deliberate deviation from the spec

Spec §7 anticipated testing the scraping engines through saved RSS/HTML **fixtures** in
`src/lib/scraping/__fixtures__/`. That is not what Tasks 5 and 6 do, and the difference is
intentional.

Testing via fixtures means calling `scrapeRssFeed(source)` or `scrapeHtmlPage(source)` —
both of which fetch over the network, so every test would need `fetch` mocked. The
behaviour actually worth pinning down (URL normalization, date parsing, image and category
extraction, language-code mapping, scrape-due arithmetic, dedup comparison) lives in pure
module-private helpers inside those files.

So instead: export the helpers and test them directly. No mocking, no fixture files, and
the tests fail for real reasons rather than because a mock drifted. The only production
change is adding the `export` keyword to eleven existing function declarations — no
signatures, bodies or behaviour change.

`src/lib/scraping/__fixtures__/` is therefore never created. Network-level behaviour of
`scrapeRssFeed` and `scrapeHtmlPage` stays untested, which is a known and accepted gap.

---

## Task 1: Commit the pending working-tree changes

The working tree has four uncommitted changes that predate this plan. They must land first so every later task starts from a clean tree.

**Files:**
- Modify: `.claude/settings.json` (already modified, uncommitted)
- Modify: `.gitignore` (already modified, uncommitted)
- Modify: `features/NEWS-10-source-extensions.md` (already modified, uncommitted)
- Create: `.claude/skills/handoff/` (already present, untracked)

**Interfaces:**
- Consumes: nothing
- Produces: a clean working tree on branch `main`

- [ ] **Step 1: Confirm you are on `main` and inspect what is pending**

```bash
git checkout main
git status --short
git diff .claude/settings.json .gitignore features/NEWS-10-source-extensions.md
```

Expected: the three modified files plus untracked `.claude/skills/handoff/`. Read the diff before committing — do not commit blind.

- [ ] **Step 2: Verify no secrets are in the untracked skill directory**

```bash
grep -rIn -E "(eyJ[A-Za-z0-9_-]{10,}|sk-ant-|service_role|SUPABASE_SERVICE_ROLE_KEY *=)" .claude/skills/handoff/ || echo "CLEAN"
```

Expected: `CLEAN`. If anything matches, stop and remove the secret before continuing.

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json .gitignore features/NEWS-10-source-extensions.md .claude/skills/handoff/
git commit -m "chore: Commit pending settings, gitignore, spec and handoff skill"
```

- [ ] **Step 4: Verify the tree is clean**

```bash
git status --short
```

Expected: no output.

---

## Task 2: Repair the migration history

**This is the highest-risk task and everything else depends on it.** Production has 12 migrations recorded in `supabase_migrations.schema_migrations`; the repo has one file. `sql/*.sql` are hand-kept copies, not a migration history.

`supabase db pull` produces a **single consolidated baseline migration** describing the current production schema — it does not reconstruct the 12 historical files. That is the intended outcome: the goal is reproducibility, not archaeology. The 12 historical versions remain recorded in the remote history table and are not re-applied.

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/<timestamp>_remote_schema.sql` (generated)
- Delete: `supabase/migrations/20260306_news6_articles_api_indexes.sql`
- Delete: `sql/002-sources.sql`, `sql/003-articles.sql`, `sql/004-categories.sql`, `sql/005-retention.sql`

**Interfaces:**
- Consumes: clean tree from Task 1
- Produces: `supabase/config.toml` (required by Task 3's `db push` and by the CI `migrations` job in Task 8); a baseline migration in `supabase/migrations/`

- [ ] **Step 1: Create a branch**

```bash
git checkout -b chore/repair-migration-history
```

- [ ] **Step 2: Initialise the Supabase project config**

```bash
npx supabase@latest init
```

If prompted about generating VS Code or IntelliJ settings, answer `n`. If it reports the directory already exists, re-run with `--force`:

```bash
npx supabase@latest init --force
```

Expected: `supabase/config.toml` now exists.

- [ ] **Step 3: Remove the stale lone migration file**

Its content is already applied in production and will be captured by the baseline. Leaving it causes a double-application conflict.

```bash
git rm supabase/migrations/20260306_news6_articles_api_indexes.sql
```

- [ ] **Step 4: Link to the production project**

```bash
npx supabase@latest link --project-ref xvkviaapboambbvsvnuz
```

You will be prompted for the database password (Supabase Dashboard → Project Settings → Database → Database password). Expected: `Finished supabase link.`

- [ ] **Step 5: Pull the schema into a baseline migration**

```bash
npx supabase@latest db pull
```

Expected: a new file appears at `supabase/migrations/<14-digit-timestamp>_remote_schema.sql`.

- [ ] **Step 6: Inspect the baseline before trusting it**

```bash
ls -la supabase/migrations/
grep -c "CREATE TABLE" supabase/migrations/*_remote_schema.sql
grep -E "CREATE TABLE|CREATE POLICY|CREATE INDEX" supabase/migrations/*_remote_schema.sql | head -40
```

Expected: the file contains `CREATE TABLE` statements for `profiles`, `sources`, `source_category_mappings`, `articles`, `article_categories`, `categories`, `system_settings`, `retention_log`, plus RLS policies and indexes. If any table from `docs/architecture.md` §2 is missing, stop — do not proceed to Task 3.

- [ ] **Step 7: Verify no credentials leaked into the generated file**

```bash
grep -nE "(eyJ[A-Za-z0-9_-]{10,}|sk-ant-|password|SECRET)" supabase/migrations/*_remote_schema.sql || echo "CLEAN"
```

Expected: `CLEAN`, or only harmless matches such as a column named `password`. Review anything that matches.

- [ ] **Step 8: Delete the superseded `sql/` directory**

```bash
git rm -r sql/
```

- [ ] **Step 9: Confirm nothing in the codebase references `sql/`**

```bash
grep -rn "sql/00" --include=*.ts --include=*.tsx --include=*.md --include=*.json . \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git || echo "NO REFERENCES"
```

Expected: `NO REFERENCES`, or only matches inside `docs/superpowers/` (this plan and the spec), which are historical records and stay as they are.

- [ ] **Step 10: Commit**

```bash
git add supabase/
git commit -m "chore: Move schema to git as a baseline migration

Production had 12 migrations recorded in Supabase but only one file in
the repo, so the schema could not be rebuilt from a clone. supabase db
pull captures the current schema as a single baseline migration.

Deletes sql/ — those four files were hand-kept copies of migrations
already applied via the Supabase MCP, not a migration history.

From here on, schema changes go through supabase migration new and are
committed with the feature that needs them."
```

- [ ] **Step 11: Merge to `main`**

Branch protection is not yet enabled, so merge directly.

```bash
git checkout main
git merge --no-ff chore/repair-migration-history -m "chore: Repair migration history"
git push origin main
```

---

## Task 3: Create the development environment

**Files:**
- Create: `supabase/seed.sql`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `supabase/config.toml` and the baseline migration from Task 2
- Produces: a `news-scraper-dev` Supabase project whose schema matches production; `supabase/seed.sql` for a usable dev dataset

- [ ] **Step 1: Create a branch**

```bash
git checkout -b chore/dev-environment
```

- [ ] **Step 2: Create the development project**

In the Supabase dashboard, create a new project:
- Name: `news-scraper-dev`
- Organization: `omfdwopofmygowyijdss` (the same org that holds `news-scraper`)
- Region: `eu-west-1` (match production)
- Plan: Free

Record the new project ref (a 20-character string) — it is needed in the next step.

- [ ] **Step 3: Apply the baseline migration to the development project**

This is the real test of Task 2: if the committed migration cannot build the schema from an empty database, you find out here.

```bash
npx supabase@latest link --project-ref <NEW_DEV_PROJECT_REF>
npx supabase@latest db push
```

Expected: `Finished supabase db push.` with the baseline migration listed as applied.

- [ ] **Step 4: Verify the schema actually landed**

In the Supabase dashboard for `news-scraper-dev`, open the Table Editor. Expected tables: `profiles`, `sources`, `source_category_mappings`, `articles`, `article_categories`, `categories`, `system_settings`, `retention_log`.

If any are missing, stop and fix the baseline migration in Task 2 before continuing.

- [ ] **Step 5: Write the seed file**

Create `supabase/seed.sql`:

```sql
-- Seed data for local and development environments.
-- Applied by `supabase db reset`. Never run against production.
--
-- Deliberately uses fixed UUIDs so that seeded data is stable across
-- resets and can be referenced from tests and manual QA.

insert into categories (id, name, description)
values
  ('11111111-1111-1111-1111-111111111111', 'Technologie',
   'Nachrichten zu Software, Hardware, IT-Sicherheit und digitaler Infrastruktur.'),
  ('22222222-2222-2222-2222-222222222222', 'Wirtschaft',
   'Berichte zu Unternehmen, Maerkten, Finanzen und Konjunktur.'),
  ('33333333-3333-3333-3333-333333333333', 'Politik',
   'Innen- und aussenpolitische Berichterstattung sowie Gesetzgebung.')
on conflict (id) do nothing;

insert into sources (
  id, name, slug, url, type, language, interval_minutes, is_active, default_category_id
)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'heise online', 'heise-online',
   'https://www.heise.de/rss/heise-atom.xml', 'rss', 'de', 30, true,
   '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'tagesschau', 'tagesschau',
   'https://www.tagesschau.de/index~rss2.xml', 'rss', 'de', 30, true,
   '33333333-3333-3333-3333-333333333333'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'BBC News', 'bbc-news',
   'https://feeds.bbci.co.uk/news/rss.xml', 'rss', 'en', 60, true,
   '33333333-3333-3333-3333-333333333333')
on conflict (id) do nothing;

insert into system_settings (key, value)
values ('retention_enabled', 'false')
on conflict (key) do nothing;
```

- [ ] **Step 6: Verify the seed file applies cleanly**

Run it against the development project via the Supabase dashboard SQL editor (paste the file contents and execute), or via psql if you have the connection string.

Expected: three categories, three sources, one settings row. Confirm in the Table Editor.

If a column name in the seed does not match the real schema, correct the seed — the schema is the source of truth. Note that the code uses `is_active` (see `src/lib/validations/source.ts:26`) even though `docs/architecture.md` calls it `active`; that documentation error is corrected in Task 11.

- [ ] **Step 7: Add the development keys to Vercel**

For each variable, add a `Development`-scoped environment variable in the Vercel project `news-scraper`:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<NEW_DEV_PROJECT_REF>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dev project anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | dev project service role key |
| `CRON_SECRET` | generate with `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | leave unset — NEWS-11 is not implemented (see Task 11) |

Use the dashboard, or:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL development
```

- [ ] **Step 8: Verify the `vercel env pull` onboarding path works**

```bash
cp .env.local .env.local.backup
vercel env pull .env.local
grep NEXT_PUBLIC_SUPABASE_URL .env.local
```

Expected: the URL points at the **development** project ref, not `xvkviaapboambbvsvnuz`.

- [ ] **Step 9: Verify the app runs against the development database**

```bash
npm run dev
```

Open `http://localhost:3000`, log in, and open the Sources page. Expected: the three seeded sources appear. Stop the dev server.

If login fails because no user exists in the dev project, register a new account at `/register`, then promote it in the dev project's SQL editor:

```sql
update profiles set role = 'admin' where email = '<your-email>';
```

- [ ] **Step 10: Restore your backup and clean up**

```bash
rm .env.local.backup
```

Keep the pulled `.env.local` — pointing local development at the dev database is the intended end state.

- [ ] **Step 11: Note the cron caveat in `.env.local.example`**

Modify `.env.local.example`, replacing the `CRON_SECRET` block:

```
# Vercel Cron Secret (NEWS-5: Scheduler authentication)
# Generate with: openssl rand -base64 32
# NOTE: vercel.json crons run in PRODUCTION only. In development, trigger a
# scrape manually via POST /api/sources/[id]/scrape — the absence of scheduled
# scraping locally is expected, not a bug.
CRON_SECRET=your-cron-secret
```

- [ ] **Step 12: Commit and merge**

```bash
git add supabase/seed.sql .env.local.example
git commit -m "chore: Add dev Supabase seed data and document cron caveat"
git checkout main
git merge --no-ff chore/dev-environment -m "chore: Add development environment"
git push origin main
```

---

## Task 4: Add typecheck and Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/env.test.ts`
- Delete: `.eslintrc.json`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `npm run typecheck` (`tsc --noEmit`), `npm run test` (`vitest run`), `npm run test:watch` — all three are called by the CI workflow in Task 8

`.eslintrc.json` is deleted because it is a leftover legacy-format config superseded by `eslint.config.mjs` (repaired in commit `9f20d06`); keeping both invites confusion about which one is live.

- [ ] **Step 1: Create a branch**

```bash
git checkout -b chore/testing-infrastructure
```

- [ ] **Step 2: Install Vitest**

```bash
npm install --save-dev vitest@^3
```

- [ ] **Step 3: Add the scripts and rename the package**

Modify `package.json`. Change the `name` field and the `scripts` block:

```json
{
  "name": "news-scraper",
  "version": "1.0.0",
  "description": "Newsgrap3r — automated multilingual news aggregation with RSS and HTML scraping",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Leave `dependencies` and `devDependencies` untouched apart from the Vitest entry added by Step 2.

- [ ] **Step 4: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
```

The alias mirrors the `@/*` path mapping in `tsconfig.json` so test files can import the same way application code does.

- [ ] **Step 5: Write the first failing test**

Create `src/lib/env.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { validateEnv } from '@/lib/env'

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

function setAllRequired() {
  for (const name of REQUIRED) process.env[name] = 'dummy-value'
}

function clearAllRequired() {
  for (const name of REQUIRED) delete process.env[name]
}

describe('validateEnv', () => {
  afterEach(() => {
    clearAllRequired()
  })

  it('passes when every required variable is set', () => {
    setAllRequired()
    expect(() => validateEnv()).not.toThrow()
  })

  it('throws listing the missing variable', () => {
    setAllRequired()
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => validateEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('treats a whitespace-only value as missing', () => {
    setAllRequired()
    process.env.NEXT_PUBLIC_SUPABASE_URL = '   '
    expect(() => validateEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('lists every missing variable in a single error', () => {
    clearAllRequired()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'dummy-value'
    expect(() => validateEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/)
    expect(() => validateEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
```

- [ ] **Step 6: Run the tests**

```bash
npm run test
```

Expected: 4 tests pass. If a test fails, the assertion is wrong about `src/lib/env.ts` — read that file and fix the test, not the implementation.

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: no output, exit code 0.

Two failures are possible here, both in `vitest.config.ts`:
- *Cannot find module `vitest/config`* — Step 2 did not complete; re-run the install.
- *`import.meta` is only allowed when module is `es2020` or later* — `tsconfig.json` is not
  in ESM mode. Confirm it has `"module": "esnext"` and `"moduleResolution": "bundler"`,
  which is the Next.js 16 default. Do not downgrade the config file to `__dirname`;
  `vitest.config.ts` is loaded as ESM.

- [ ] **Step 8: Delete the legacy ESLint config and confirm lint still works**

```bash
git rm .eslintrc.json
npm run lint
```

Expected: lint passes, as it did at commit `c880fe0`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/env.test.ts
git commit -m "chore: Add typecheck and Vitest, rename package to news-scraper

Adds npm run typecheck (tsc --noEmit), npm run test (vitest run) and
test:watch. First tests cover the startup env guard. Deletes the legacy
.eslintrc.json superseded by eslint.config.mjs."
```

---

## Task 5: Test the RSS engine

The valuable logic in `src/lib/scraping/rss-engine.ts` is module-private. Export the pure helpers so they can be tested directly — none of them perform I/O, so no network mocking is needed. `scrapeRssFeed` itself stays untested here; it fetches over the network.

**Files:**
- Modify: `src/lib/scraping/rss-engine.ts:108`, `:123`, `:133`, `:161`, `:217` (add `export` to five functions)
- Create: `src/lib/scraping/rss-engine.test.ts`

**Interfaces:**
- Consumes: Vitest setup from Task 4
- Produces: five newly exported functions from `@/lib/scraping/rss-engine`:
  - `normalizeUrl(raw: string): string`
  - `parseDate(raw: string | undefined | null): string | null`
  - `extractImageUrl(item: Record<string, unknown>): string | null`
  - `extractCategory(item: Record<string, unknown>): string | null`
  - `iso639_3to1(code3: string): string`

- [ ] **Step 1: Create a branch**

```bash
git checkout -b test/NEWS-3-rss-engine-unit-tests
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/scraping/rss-engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  normalizeUrl,
  parseDate,
  extractImageUrl,
  extractCategory,
  iso639_3to1,
} from '@/lib/scraping/rss-engine'

describe('normalizeUrl', () => {
  it('strips a trailing slash from the path', () => {
    expect(normalizeUrl('https://example.com/artikel/')).toBe('https://example.com/artikel')
  })

  it('strips repeated trailing slashes', () => {
    expect(normalizeUrl('https://example.com/artikel///')).toBe('https://example.com/artikel')
  })

  it('keeps the root slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('preserves query parameters', () => {
    expect(normalizeUrl('https://example.com/artikel/?id=7')).toBe(
      'https://example.com/artikel?id=7'
    )
  })

  it('returns unparseable input unchanged apart from trailing slashes', () => {
    expect(normalizeUrl('nicht-ganz-eine-url/')).toBe('nicht-ganz-eine-url')
  })
})

describe('parseDate', () => {
  it('converts an RFC 822 date to ISO 8601', () => {
    expect(parseDate('Mon, 06 Mar 2026 10:30:00 GMT')).toBe('2026-03-06T10:30:00.000Z')
  })

  it('passes an ISO 8601 date through', () => {
    expect(parseDate('2026-03-06T10:30:00Z')).toBe('2026-03-06T10:30:00.000Z')
  })

  it('returns null for an unparseable string', () => {
    expect(parseDate('kein datum')).toBeNull()
  })

  it('returns null for null, undefined and empty string', () => {
    expect(parseDate(null)).toBeNull()
    expect(parseDate(undefined)).toBeNull()
    expect(parseDate('')).toBeNull()
  })
})

describe('extractImageUrl', () => {
  it('reads media:content', () => {
    const item = { mediaContent: { $: { url: 'https://example.com/bild.jpg' } } }
    expect(extractImageUrl(item)).toBe('https://example.com/bild.jpg')
  })

  it('reads media:thumbnail', () => {
    const item = { mediaThumbnail: { $: { url: 'https://example.com/thumb.jpg' } } }
    expect(extractImageUrl(item)).toBe('https://example.com/thumb.jpg')
  })

  it('accepts an enclosure with an image MIME type', () => {
    const item = { enclosure: { url: 'https://example.com/bild.png', type: 'image/png' } }
    expect(extractImageUrl(item)).toBe('https://example.com/bild.png')
  })

  it('accepts an enclosure with an image extension but no MIME type', () => {
    const item = { enclosure: { url: 'https://example.com/bild.webp' } }
    expect(extractImageUrl(item)).toBe('https://example.com/bild.webp')
  })

  it('rejects a non-image enclosure', () => {
    const item = { enclosure: { url: 'https://example.com/folge.mp3', type: 'audio/mpeg' } }
    expect(extractImageUrl(item)).toBeNull()
  })

  it('returns null when the item carries no image', () => {
    expect(extractImageUrl({})).toBeNull()
  })

  it('prefers media:content over an enclosure', () => {
    const item = {
      mediaContent: { $: { url: 'https://example.com/bevorzugt.jpg' } },
      enclosure: { url: 'https://example.com/andere.jpg', type: 'image/jpeg' },
    }
    expect(extractImageUrl(item)).toBe('https://example.com/bevorzugt.jpg')
  })
})

describe('extractCategory', () => {
  it('returns a string category', () => {
    expect(extractCategory({ category: 'Technik' })).toBe('Technik')
  })

  it('returns the first entry of an array category', () => {
    expect(extractCategory({ category: ['Technik', 'Wirtschaft'] })).toBe('Technik')
  })

  it('returns null for an empty array', () => {
    expect(extractCategory({ category: [] })).toBeNull()
  })

  it('returns null when no category is present', () => {
    expect(extractCategory({})).toBeNull()
  })
})

describe('iso639_3to1', () => {
  it('maps German', () => {
    expect(iso639_3to1('deu')).toBe('de')
  })

  it('maps English', () => {
    expect(iso639_3to1('eng')).toBe('en')
  })

  it('returns the three-letter code when no mapping exists', () => {
    expect(iso639_3to1('xyz')).toBe('xyz')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm run test -- src/lib/scraping/rss-engine.test.ts
```

Expected: FAIL. Vitest reports that `normalizeUrl`, `parseDate`, `extractImageUrl`, `extractCategory` and `iso639_3to1` are not exported by `@/lib/scraping/rss-engine`.

- [ ] **Step 4: Export the five helpers**

In `src/lib/scraping/rss-engine.ts`, add the `export` keyword to five existing function declarations. Change nothing else — no bodies, no signatures.

Line 108: `function normalizeUrl(raw: string): string {` becomes:

```ts
export function normalizeUrl(raw: string): string {
```

Line 123: `function parseDate(raw: string | undefined | null): string | null {` becomes:

```ts
export function parseDate(raw: string | undefined | null): string | null {
```

Line 133: `function extractImageUrl(item: Record<string, unknown>): string | null {` becomes:

```ts
export function extractImageUrl(item: Record<string, unknown>): string | null {
```

Line 161: `function extractCategory(item: Record<string, unknown>): string | null {` becomes:

```ts
export function extractCategory(item: Record<string, unknown>): string | null {
```

Line 217: `function iso639_3to1(code3: string): string {` becomes:

```ts
export function iso639_3to1(code3: string): string {
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm run test -- src/lib/scraping/rss-engine.test.ts
```

Expected: PASS, 23 tests (5 `normalizeUrl`, 4 `parseDate`, 7 `extractImageUrl`, 4 `extractCategory`, 3 `iso639_3to1`).

- [ ] **Step 6: Verify typecheck and lint still pass**

```bash
npm run typecheck && npm run lint
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scraping/rss-engine.ts src/lib/scraping/rss-engine.test.ts
git commit -m "test(NEWS-3): Add unit tests for RSS engine helpers

Exports normalizeUrl, parseDate, extractImageUrl, extractCategory and
iso639_3to1 so they can be tested directly. These are pure functions, so
the tests need no network mocking."
```

---

## Task 6: Test the HTML engine, feed detector and scheduler

Same approach as Task 5: export pure helpers, test them directly.

**Files:**
- Modify: `src/lib/scraping/html-engine.ts:383`, `:396`, `:417` (add `export` to three functions)
- Modify: `src/lib/scraping/feed-detector.ts:89` (add `export` to one function)
- Modify: `src/lib/scraping/scheduler.ts:128`, `:330` (add `export` to two functions)
- Create: `src/lib/scraping/html-engine.test.ts`
- Create: `src/lib/scraping/feed-detector.test.ts`
- Create: `src/lib/scraping/scheduler.test.ts`

**Interfaces:**
- Consumes: Vitest setup from Task 4
- Produces:
  - from `@/lib/scraping/html-engine`: `resolveUrl(rawHref: string, baseUrl: URL): string`, `normalizeUrl(raw: string): string`, `parseDate(raw: string): string | null`
  - from `@/lib/scraping/feed-detector`: `extractLinkTagFeeds(html: string, baseUrl: string): string[]` (`normalizeUrl` is already exported at line 40)
  - from `@/lib/scraping/scheduler`: `isSourceDue(source: { last_scraped_at: string | null; interval_minutes: number }): boolean`, `normalizeUrlForComparison(url: string): string`

- [ ] **Step 1: Create a branch**

```bash
git checkout -b test/NEWS-4-scraping-unit-tests
```

- [ ] **Step 2: Write the failing HTML engine test**

Create `src/lib/scraping/html-engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveUrl, normalizeUrl, parseDate } from '@/lib/scraping/html-engine'

describe('resolveUrl', () => {
  const base = new URL('https://example.com/news/index.html')

  it('resolves a root-relative href against the origin', () => {
    expect(resolveUrl('/artikel/1', base)).toBe('https://example.com/artikel/1')
  })

  it('resolves a bare relative href against the origin', () => {
    expect(resolveUrl('artikel/1', base)).toBe('https://example.com/artikel/1')
  })

  it('leaves an absolute href on another host untouched', () => {
    expect(resolveUrl('https://andere.de/x', base)).toBe('https://andere.de/x')
  })

  it('preserves the query string', () => {
    expect(resolveUrl('/artikel?id=7', base)).toBe('https://example.com/artikel?id=7')
  })
})

describe('normalizeUrl', () => {
  it('strips a trailing slash from the path', () => {
    expect(normalizeUrl('https://example.com/artikel/')).toBe('https://example.com/artikel')
  })

  it('keeps the root slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('preserves query parameters', () => {
    expect(normalizeUrl('https://example.com/artikel/?id=7')).toBe(
      'https://example.com/artikel?id=7'
    )
  })
})

describe('parseDate', () => {
  it('passes an ISO 8601 date through', () => {
    expect(parseDate('2026-03-06T10:30:00Z')).toBe('2026-03-06T10:30:00.000Z')
  })

  it('parses a natural-language English date via chrono', () => {
    const result = parseDate('January 15, 2024')
    expect(result).not.toBeNull()
    expect(result!.startsWith('2024-01-15')).toBe(true)
  })

  it('returns null for an empty string', () => {
    expect(parseDate('')).toBeNull()
  })

  it('returns null for text containing no date', () => {
    expect(parseDate('weder Datum noch Uhrzeit')).toBeNull()
  })
})
```

- [ ] **Step 3: Write the failing feed detector test**

Create `src/lib/scraping/feed-detector.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeUrl, extractLinkTagFeeds } from '@/lib/scraping/feed-detector'

describe('normalizeUrl', () => {
  it('prepends https:// when no scheme is given', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
  })

  it('leaves an https URL untouched', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
  })

  it('leaves an http URL untouched', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com')
  })

  it('trims before deciding whether a scheme is present', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com')
  })
})

describe('extractLinkTagFeeds', () => {
  it('finds an RSS link tag and resolves it against the base URL', () => {
    const html = `
      <html><head>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      </head><body></body></html>`
    expect(extractLinkTagFeeds(html, 'https://example.com')).toEqual([
      'https://example.com/feed.xml',
    ])
  })

  it('finds an Atom link tag', () => {
    const html = `
      <html><head>
        <link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml">
      </head></html>`
    expect(extractLinkTagFeeds(html, 'https://example.com')).toEqual([
      'https://example.com/atom.xml',
    ])
  })

  it('returns every matching feed link', () => {
    const html = `
      <html><head>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        <link rel="alternate" type="application/atom+xml" href="/atom.xml">
      </head></html>`
    expect(extractLinkTagFeeds(html, 'https://example.com')).toEqual([
      'https://example.com/feed.xml',
      'https://example.com/atom.xml',
    ])
  })

  it('ignores link tags whose type is not a feed MIME type', () => {
    const html = `
      <html><head>
        <link rel="stylesheet" type="text/css" href="/style.css">
      </head></html>`
    expect(extractLinkTagFeeds(html, 'https://example.com')).toEqual([])
  })

  it('returns an empty array when the document has no link tags', () => {
    expect(extractLinkTagFeeds('<html><body>nichts</body></html>', 'https://example.com')).toEqual(
      []
    )
  })
})
```

- [ ] **Step 4: Write the failing scheduler test**

Create `src/lib/scraping/scheduler.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isSourceDue, normalizeUrlForComparison } from '@/lib/scraping/scheduler'

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

describe('isSourceDue', () => {
  it('is due when it has never been scraped', () => {
    expect(isSourceDue({ last_scraped_at: null, interval_minutes: 15 })).toBe(true)
  })

  it('is due when the interval has elapsed', () => {
    expect(isSourceDue({ last_scraped_at: minutesAgo(20), interval_minutes: 15 })).toBe(true)
  })

  it('is not due when the interval has not elapsed', () => {
    expect(isSourceDue({ last_scraped_at: minutesAgo(5), interval_minutes: 15 })).toBe(false)
  })

  it('is due exactly at the interval boundary', () => {
    expect(isSourceDue({ last_scraped_at: minutesAgo(15), interval_minutes: 15 })).toBe(true)
  })

  it('respects a long interval', () => {
    expect(isSourceDue({ last_scraped_at: minutesAgo(60), interval_minutes: 1440 })).toBe(false)
  })
})

describe('normalizeUrlForComparison', () => {
  it('lowercases the whole URL', () => {
    expect(normalizeUrlForComparison('HTTPS://Example.COM/Artikel')).toBe(
      'https://example.com/artikel'
    )
  })

  it('strips a trailing slash', () => {
    expect(normalizeUrlForComparison('https://example.com/artikel/')).toBe(
      'https://example.com/artikel'
    )
  })

  it('treats case and trailing-slash variants as the same URL', () => {
    const a = normalizeUrlForComparison('https://Example.com/Artikel/')
    const b = normalizeUrlForComparison('https://example.com/artikel')
    expect(a).toBe(b)
  })

  it('keeps the root slash', () => {
    expect(normalizeUrlForComparison('https://example.com/')).toBe('https://example.com/')
  })

  it('lowercases unparseable input and strips trailing slashes', () => {
    expect(normalizeUrlForComparison('Nicht Eine URL/')).toBe('nicht eine url')
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

```bash
npm run test -- src/lib/scraping/
```

Expected: FAIL — the six helpers are not exported.

- [ ] **Step 6: Export the six helpers**

Add the `export` keyword to six existing function declarations. Change nothing else.

In `src/lib/scraping/html-engine.ts`:

```ts
export function resolveUrl(rawHref: string, baseUrl: URL): string {
```

```ts
export function normalizeUrl(raw: string): string {
```

```ts
export function parseDate(raw: string): string | null {
```

In `src/lib/scraping/feed-detector.ts`:

```ts
export function extractLinkTagFeeds(html: string, baseUrl: string): string[] {
```

In `src/lib/scraping/scheduler.ts`:

```ts
export function isSourceDue(source: { last_scraped_at: string | null; interval_minutes: number }): boolean {
```

```ts
export function normalizeUrlForComparison(url: string): string {
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm run test -- src/lib/scraping/
```

Expected: PASS. 23 from `rss-engine.test.ts` (Task 5) plus 11 html-engine, 10 feed-detector and 10 scheduler tests.

If `scheduler.test.ts` fails at import time because importing the module triggers Supabase client construction, check that `createAdminClient` at `src/lib/scraping/scheduler.ts:28` is only *called* inside functions and not at module scope. It is a function declaration, so a plain import must not construct anything. If a module-scope side effect does exist, move the two tested helpers into a new `src/lib/scraping/scheduler-utils.ts`, re-export them from `scheduler.ts`, and import from the new module in the test.

- [ ] **Step 8: Verify typecheck and lint still pass**

```bash
npm run typecheck && npm run lint
```

Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/lib/scraping/
git commit -m "test(NEWS-4,NEWS-5,NEWS-14): Add unit tests for HTML engine, feed detector and scheduler

Covers URL resolution and normalization, chrono date parsing, feed link
tag discovery, scrape-due interval logic and the dedup URL comparison
that decides whether an article counts as already seen."
```

---

## Task 7: Test the validation schemas

**Files:**
- Create: `src/lib/validations/source.test.ts`
- Create: `src/lib/validations/category.test.ts`
- Create: `src/lib/validations/article.test.ts`

**Interfaces:**
- Consumes: Vitest setup from Task 4. Uses only already-exported symbols — no source changes needed.
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Create a branch**

```bash
git checkout -b test/NEWS-2-validation-schema-tests
```

- [ ] **Step 2: Write the source schema test**

Create `src/lib/validations/source.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  createSourceSchema,
  updateSourceSchema,
  sourceCategoryMappingSchema,
} from '@/lib/validations/source'

const validSource = {
  name: 'heise online',
  url: 'https://www.heise.de/rss/heise-atom.xml',
  type: 'rss' as const,
  interval_minutes: 30,
}

describe('createSourceSchema', () => {
  it('accepts a minimal valid source', () => {
    const result = createSourceSchema.safeParse(validSource)
    expect(result.success).toBe(true)
  })

  it('defaults language to auto and is_active to true', () => {
    const result = createSourceSchema.parse(validSource)
    expect(result.language).toBe('auto')
    expect(result.is_active).toBe(true)
  })

  it('rejects a URL without an http scheme', () => {
    const result = createSourceSchema.safeParse({ ...validSource, url: 'ftp://example.com/feed' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty name', () => {
    const result = createSourceSchema.safeParse({ ...validSource, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects an interval below five minutes', () => {
    const result = createSourceSchema.safeParse({ ...validSource, interval_minutes: 4 })
    expect(result.success).toBe(false)
  })

  it('accepts an interval of exactly five minutes', () => {
    const result = createSourceSchema.safeParse({ ...validSource, interval_minutes: 5 })
    expect(result.success).toBe(true)
  })

  it('rejects a non-integer interval', () => {
    const result = createSourceSchema.safeParse({ ...validSource, interval_minutes: 15.5 })
    expect(result.success).toBe(false)
  })

  it('rejects a type other than rss or html', () => {
    const result = createSourceSchema.safeParse({ ...validSource, type: 'json' })
    expect(result.success).toBe(false)
  })

  it('accepts a lowercase hyphenated slug', () => {
    const result = createSourceSchema.safeParse({ ...validSource, slug: 'heise-online' })
    expect(result.success).toBe(true)
  })

  it('rejects a slug containing uppercase letters', () => {
    const result = createSourceSchema.safeParse({ ...validSource, slug: 'Heise-Online' })
    expect(result.success).toBe(false)
  })

  it('rejects a slug containing spaces', () => {
    const result = createSourceSchema.safeParse({ ...validSource, slug: 'heise online' })
    expect(result.success).toBe(false)
  })

  it('rejects an unsupported language code', () => {
    const result = createSourceSchema.safeParse({ ...validSource, language: 'kli' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-UUID default_category_id', () => {
    const result = createSourceSchema.safeParse({ ...validSource, default_category_id: 'nope' })
    expect(result.success).toBe(false)
  })

  it('accepts null retention_days meaning never delete', () => {
    const result = createSourceSchema.safeParse({ ...validSource, retention_days: null })
    expect(result.success).toBe(true)
  })

  it('rejects zero or negative retention_days', () => {
    expect(createSourceSchema.safeParse({ ...validSource, retention_days: 0 }).success).toBe(false)
    expect(createSourceSchema.safeParse({ ...validSource, retention_days: -1 }).success).toBe(false)
  })
})

describe('updateSourceSchema', () => {
  it('accepts a single field', () => {
    expect(updateSourceSchema.safeParse({ name: 'Neuer Name' }).success).toBe(true)
  })

  it('rejects an empty object', () => {
    expect(updateSourceSchema.safeParse({}).success).toBe(false)
  })

  it('still enforces the interval minimum', () => {
    expect(updateSourceSchema.safeParse({ interval_minutes: 1 }).success).toBe(false)
  })
})

describe('sourceCategoryMappingSchema', () => {
  it('accepts a raw category paired with a category UUID', () => {
    const result = sourceCategoryMappingSchema.safeParse({
      source_category_raw: 'Tech',
      category_id: '11111111-1111-1111-1111-111111111111',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty raw category', () => {
    const result = sourceCategoryMappingSchema.safeParse({
      source_category_raw: '',
      category_id: '11111111-1111-1111-1111-111111111111',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-UUID category_id', () => {
    const result = sourceCategoryMappingSchema.safeParse({
      source_category_raw: 'Tech',
      category_id: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 3: Write the category schema test**

Create `src/lib/validations/category.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createCategorySchema, updateCategorySchema } from '@/lib/validations/category'

const validCategory = {
  name: 'Technologie',
  description: 'Nachrichten zu Software, Hardware und IT-Sicherheit.',
}

describe('createCategorySchema', () => {
  it('accepts a valid category', () => {
    expect(createCategorySchema.safeParse(validCategory).success).toBe(true)
  })

  it('rejects a description shorter than twenty characters', () => {
    const result = createCategorySchema.safeParse({ ...validCategory, description: 'Zu kurz' })
    expect(result.success).toBe(false)
  })

  it('accepts a description of exactly twenty characters', () => {
    const result = createCategorySchema.safeParse({
      ...validCategory,
      description: 'a'.repeat(20),
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(createCategorySchema.safeParse({ ...validCategory, name: '' }).success).toBe(false)
  })

  it('rejects a name longer than one hundred characters', () => {
    const result = createCategorySchema.safeParse({ ...validCategory, name: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('trims surrounding whitespace from name and description', () => {
    const result = createCategorySchema.parse({
      name: '  Technologie  ',
      description: `  ${validCategory.description}  `,
    })
    expect(result.name).toBe('Technologie')
    expect(result.description).toBe(validCategory.description)
  })

  it('applies the minimum length after trimming', () => {
    const result = createCategorySchema.safeParse({
      name: 'Test',
      description: `  ${'a'.repeat(19)}  `,
    })
    expect(result.success).toBe(false)
  })
})

describe('updateCategorySchema', () => {
  it('accepts a single field', () => {
    expect(updateCategorySchema.safeParse({ name: 'Neuer Name' }).success).toBe(true)
  })

  it('rejects an empty object', () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(false)
  })
})
```

- [ ] **Step 4: Write the article query schema test**

Create `src/lib/validations/article.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { articlesQuerySchema } from '@/lib/validations/article'

const UUID = '11111111-1111-1111-1111-111111111111'

describe('articlesQuerySchema', () => {
  it('defaults page to 1 and limit to 20 when absent', () => {
    const result = articlesQuerySchema.parse({})
    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)
  })

  it('parses numeric strings', () => {
    const result = articlesQuerySchema.parse({ page: '3', limit: '50' })
    expect(result.page).toBe(3)
    expect(result.limit).toBe(50)
  })

  it('falls back to page 1 for a non-numeric page', () => {
    expect(articlesQuerySchema.parse({ page: 'abc' }).page).toBe(1)
  })

  it('falls back to page 1 for a page below 1', () => {
    expect(articlesQuerySchema.parse({ page: '0' }).page).toBe(1)
  })

  it('caps limit at 100', () => {
    expect(articlesQuerySchema.parse({ limit: '500' }).limit).toBe(100)
  })

  it('falls back to limit 20 for a limit below 1', () => {
    expect(articlesQuerySchema.parse({ limit: '0' }).limit).toBe(20)
  })

  it('accepts a valid source_id UUID', () => {
    expect(articlesQuerySchema.safeParse({ source_id: UUID }).success).toBe(true)
  })

  it('rejects a malformed source_id', () => {
    expect(articlesQuerySchema.safeParse({ source_id: 'nope' }).success).toBe(false)
  })

  it('rejects a malformed category_id', () => {
    expect(articlesQuerySchema.safeParse({ category_id: '123' }).success).toBe(false)
  })

  it('accepts a date-only from value', () => {
    expect(articlesQuerySchema.safeParse({ from: '2026-03-06' }).success).toBe(true)
  })

  it('accepts a full ISO 8601 from value', () => {
    expect(articlesQuerySchema.safeParse({ from: '2026-03-06T10:30:00Z' }).success).toBe(true)
  })

  it('rejects a malformed date', () => {
    expect(articlesQuerySchema.safeParse({ from: '06.03.2026' }).success).toBe(false)
  })

  it('accepts a range where from precedes to', () => {
    const result = articlesQuerySchema.safeParse({ from: '2026-03-01', to: '2026-03-06' })
    expect(result.success).toBe(true)
  })

  it('rejects a range where from is after to', () => {
    const result = articlesQuerySchema.safeParse({ from: '2026-03-06', to: '2026-03-01' })
    expect(result.success).toBe(false)
  })

  it('accepts a range where from equals to', () => {
    const result = articlesQuerySchema.safeParse({ from: '2026-03-06', to: '2026-03-06' })
    expect(result.success).toBe(true)
  })

  it('rejects a search term longer than two hundred characters', () => {
    expect(articlesQuerySchema.safeParse({ search: 'a'.repeat(201) }).success).toBe(false)
  })
})
```

- [ ] **Step 5: Run the tests**

```bash
npm run test -- src/lib/validations/
```

Expected: PASS. If any assertion fails, read the corresponding schema file and correct the *test* — these schemas are in production use and their behaviour is the specification.

- [ ] **Step 6: Run the whole suite, typecheck and lint**

```bash
npm run test && npm run typecheck && npm run lint
```

Expected: all pass. Total across Tasks 4–7 is roughly 100 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validations/
git commit -m "test(NEWS-2,NEWS-6,NEWS-9): Add unit tests for Zod validation schemas

Covers source create/update rules (URL scheme, interval floor, slug
format, retention), category description minimum with trimming, and the
article query schema's pagination coercion and date-range refinement."
```

---

## Task 8: Add the CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/pull_request_template.md`

**Interfaces:**
- Consumes: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` from Task 4; `supabase/config.toml` and the baseline migration from Task 2
- Produces: two required status checks named `verify` and `migrations`, referenced by branch protection in Task 9

- [ ] **Step 1: Create a branch**

```bash
git checkout -b chore/github-actions-ci
```

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    name: verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm run test

      - name: Build
        run: npm run build
        env:
          # src/instrumentation.ts calls validateEnv() at startup and throws on
          # missing required variables, which next build can trigger. These are
          # syntactically valid dummies — no real credentials belong in CI.
          NEXT_PUBLIC_SUPABASE_URL: https://dummy.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: dummy-anon-key
          SUPABASE_SERVICE_ROLE_KEY: dummy-service-role-key
          CRON_SECRET: dummy-cron-secret

  migrations:
    name: migrations
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Start the local Supabase stack
        run: supabase start

      - name: Rebuild the schema from committed migrations
        run: supabase db reset

      - name: Stop the local Supabase stack
        if: always()
        run: supabase stop
```

The `migrations` job runs only here, on a GitHub-hosted runner where Docker is available. Neither developer needs Docker locally — that is what keeps the "shared cloud dev project, no local Supabase" decision intact.

- [ ] **Step 3: Write the pull request template**

Create `.github/pull_request_template.md`:

```markdown
## Feature

Closes #<issue-number>  <!-- the NEWS-X issue this PR implements -->

## What changed

<!-- One or two sentences. What does this PR do, and why? -->

## Database

- [ ] No schema change
- [ ] Includes a migration in `supabase/migrations/`, applied to `news-scraper-dev`

<!-- If a migration is included: does it need to run on production before or
     after the deploy? Note anything the reviewer must do at merge time. -->

## How this was tested

<!-- Which commands, which pages, which cases. "Ran the app" is not enough. -->

## Checklist

- [ ] `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` pass locally
- [ ] New logic under `src/lib/` has tests
- [ ] `features/INDEX.md` and the feature spec status are up to date
- [ ] No secrets in the diff
```

- [ ] **Step 4: Verify the workflow YAML parses**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"
```

Expected: `YAML OK`.

- [ ] **Step 5: Verify the whole pipeline passes locally first**

Running the same four commands locally catches failures before burning a CI cycle.

```bash
npm ci && npm run lint && npm run typecheck && npm run test && npm run build
```

Expected: all four pass.

- [ ] **Step 6: Commit and push the branch**

```bash
git add .github/
git commit -m "chore: Add GitHub Actions CI and pull request template

verify runs lint, typecheck, test and build. migrations rebuilds the
schema from supabase/migrations on an ephemeral Postgres, which is what
stops the committed history from silently rotting."
git push -u origin chore/github-actions-ci
```

- [ ] **Step 7: Open a pull request and watch CI run**

```bash
gh pr create --fill
gh pr checks --watch
```

Expected: both `verify` and `migrations` succeed. **Do not proceed to Task 9 until both are green** — enabling branch protection against failing or non-existent checks blocks all merging.

If `migrations` fails, the most likely cause is that `supabase/config.toml` (Task 2 Step 2) was not committed. Check with `git ls-files supabase/`.

- [ ] **Step 8: Merge the pull request**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull
```

---

## Task 9: Enable branch protection

This task is performed in the GitHub web UI or via `gh`, not in the codebase. After it completes, every later task must go through a pull request.

**Files:** none

**Interfaces:**
- Consumes: the `verify` and `migrations` status checks from Task 8, proven green
- Produces: a protected `main` branch

- [ ] **Step 1: Confirm both checks have run at least once on `main`**

```bash
gh run list --branch main --limit 5
```

Expected: at least one successful run listing both jobs. GitHub cannot require a status check it has never observed.

- [ ] **Step 2: Apply the protection rule**

```bash
gh api -X PUT repos/IDS-online/news-scraper/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["verify", "migrations"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

`enforce_admins: true` is what makes the rule apply to you as well, which was an explicit decision.

- [ ] **Step 3: Restrict merges to squash only**

```bash
gh api -X PATCH repos/IDS-online/news-scraper \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true
```

- [ ] **Step 4: Verify the protection is active**

```bash
gh api repos/IDS-online/news-scraper/branches/main/protection \
  --jq '{checks: .required_status_checks.contexts, admins: .enforce_admins.enabled, reviews: .required_pull_request_reviews.required_approving_review_count}'
```

Expected: `{"checks":["verify","migrations"],"admins":true,"reviews":1}`.

- [ ] **Step 5: Prove a direct push is rejected**

```bash
git checkout main && git pull
echo "" >> README.md
git commit -am "chore: Verify branch protection blocks direct pushes"
git push origin main
```

Expected: the push is **rejected** with a protected-branch error.

- [ ] **Step 6: Undo the test commit**

```bash
git reset --hard origin/main
git status --short
```

Expected: clean tree, and the local branch matches `origin/main`.

- [ ] **Step 7: Invite the second developer**

Add them to the repository with the `Write` role:

```bash
gh api -X PUT repos/IDS-online/news-scraper/collaborators/<their-github-username> -f permission=push
```

Also grant them access to: the Supabase organization `omfdwopofmygowyijdss` (both `news-scraper` and `news-scraper-dev`), and the Vercel team `team_dEk59nIGBWKoyErY0NVpYKh8`. Vercel access is what makes `vercel env pull` work for them.

---

## Task 10: Write the onboarding documentation

From here on, `main` is protected — this task and the ones after it go through pull requests.

**Files:**
- Modify: `README.md` (full rewrite)
- Create: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: the development environment from Task 3, the scripts from Task 4, the CI and PR template from Task 8, the protection rules from Task 9
- Produces: the documents the Task 13 dry run is measured against

- [ ] **Step 1: Create a branch**

```bash
git checkout main && git pull
git checkout -b docs/onboarding
```

- [ ] **Step 2: Rewrite `README.md`**

Replace the entire contents — the current file is the upstream starter kit's README and tells the reader to clone `ai-coding-starter-kit`.

````markdown
# Newsgrap3r

Automated multilingual news aggregation. Newsgrap3r scrapes configured RSS/Atom feeds
and HTML pages on a schedule, deduplicates articles by URL, detects their language, and
serves everything through an authenticated REST API and a web dashboard.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Database, auth | Supabase (PostgreSQL, Auth, RLS) |
| Scraping | `rss-parser` (feeds), `cheerio` (HTML), `franc` (language), `chrono-node` (dates) |
| Validation | Zod + react-hook-form |
| Scheduling | Vercel Cron |
| Hosting | Vercel |
| Tests | Vitest |

## Setup

Prerequisites: Node.js 24 or newer, and access to the Vercel team and the Supabase
organization. Ask Michael if you do not have both.

```bash
git clone https://github.com/IDS-online/news-scraper.git
cd news-scraper
npm ci

npx vercel login
npx vercel link            # select the existing "news-scraper" project
npx vercel env pull .env.local

npm run dev
```

Open http://localhost:3000.

`vercel env pull` writes the **development** credentials, which point at the
`news-scraper-dev` Supabase project. You will not touch production data.

If you have no account yet, register at `/register`, then promote yourself to admin in
the `news-scraper-dev` SQL editor:

```sql
update profiles set role = 'admin' where email = 'you@example.com';
```

## Environment variables

All are supplied by `vercel env pull`. See `.env.local.example` for the canonical list.

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Public Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Admin key for scraping, cron and retention |
| `CRON_SECRET` | server only | Secures `/api/cron/*` |
| `ANTHROPIC_API_KEY` | server only | Reserved for NEWS-11, which is not implemented |

Missing required variables fail fast at startup with a readable message — see
`src/lib/env.ts`.

## Commands

```bash
npm run dev         # development server on :3000
npm run build       # production build
npm run start       # serve the production build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run test        # Vitest, single run
npm run test:watch  # Vitest, watch mode
```

## Environments

| Tier | Supabase project | Vercel | Written by |
|------|-----------------|--------|-----------|
| Development | `news-scraper-dev` | Preview deployments | Both developers, freely |
| Production | `news-scraper` | Production | Merges to `main` only |

Scheduled scraping runs **in production only** — `vercel.json` crons do not fire against
development. Trigger a scrape locally with `POST /api/sources/[id]/scrape`.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before your first pull request. `main` is
protected: no direct pushes, CI must pass, one approving review required.

## Documentation

| Document | Contents |
|----------|----------|
| [docs/PRD.md](docs/PRD.md) | Product vision, target users, roadmap |
| [docs/architecture.md](docs/architecture.md) | Database schema, API routes, scraping pipeline |
| [docs/styleguide.md](docs/styleguide.md) | Design tokens from the IDS.online CI |
| [features/INDEX.md](features/INDEX.md) | All features and their status |
| [features/NEWS-*.md](features/) | Individual feature specifications |
| [docs/production/](docs/production/) | Security headers, rate limiting, performance |

Feature specs are written in German; code, code comments and process documentation are in
English.

## AI-assisted workflow

This repository is set up for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).
`CLAUDE.md` carries the project instructions, `.claude/rules/` the coding conventions, and
`.claude/skills/` a workflow of `/requirements` → `/architecture` → `/frontend` →
`/backend` → `/qa` → `/deploy`. Using it is optional; the conventions it encodes are not.

To use the Supabase MCP server, copy `.mcp.json.example` to `.mcp.json` and insert your
own access token. Point it at `news-scraper-dev`, never production. `.mcp.json` is
gitignored because it carries a credential.
````

- [ ] **Step 3: Write `CONTRIBUTING.md`**

````markdown
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

## Database changes

The schema lives in `supabase/migrations/` and **git is the source of truth**.

Never change the schema through the Supabase dashboard or the Supabase MCP server. That is
how the schema drifted out of the repository before, and it made the database impossible to
rebuild from a clone.

```bash
npx supabase@latest migration new add_source_health_fields
# edit the generated file in supabase/migrations/

npx supabase@latest link --project-ref <news-scraper-dev-ref>
npx supabase@latest db push          # apply to development

git add supabase/migrations/
git commit -m "feat(NEWS-19): Add source health fields migration"
```

Tick the migration box in the pull request template and say whether production needs the
migration applied before or after the deploy. After the pull request merges, apply it to
production:

```bash
npx supabase@latest link --project-ref xvkviaapboambbvsvnuz
npx supabase@latest db push
```

CI rebuilds the schema from scratch on every pull request, so a migration that does not
apply cleanly fails before it reaches anyone.

## Tests

```bash
npm run test        # single run
npm run test:watch  # watch mode
```

**New logic under `src/lib/` arrives with a test.** There is no coverage threshold and no
requirement to backfill tests for code you did not touch.

Tests target pure functions — no database, no network, no UI rendering. Where the logic
worth testing is module-private, export it rather than mocking around it; see
`src/lib/scraping/rss-engine.ts` for the pattern.

## Before opening a pull request

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

CI runs exactly these four, plus a schema rebuild. Running them locally first saves a
round trip.

## Pull requests

`main` is protected. No direct pushes — this applies to everyone, including repository
admins.

To merge you need: `verify` green, `migrations` green, one approving review, and the
branch up to date with `main`. Merges are squash-only, so the pull request title becomes
the commit message on `main` — write it in the `type(NEWS-X): description` form.

With two of us, we review each other's work. That is deliberate: review is the main way
knowledge about this codebase spreads.

## Development environment notes

- Local development points at the `news-scraper-dev` Supabase project, not production.
  `vercel env pull .env.local` is what configures this.
- **Scheduled scraping does not run in development.** `vercel.json` crons fire against
  production deployments only. Trigger a scrape by hand with
  `POST /api/sources/[id]/scrape`.
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

## Feature status

Update `features/INDEX.md` and the spec's own status header as part of the feature's own
pull request, not up front. Valid statuses: `Planned`, `In Progress`, `In Review`,
`Deployed`.
````

- [ ] **Step 4: Verify every internal link resolves**

```bash
for f in docs/PRD.md docs/architecture.md docs/styleguide.md features/INDEX.md \
         .claude/rules/frontend.md .claude/rules/backend.md .claude/rules/security.md \
         .env.local.example CONTRIBUTING.md README.md src/lib/env.ts; do
  [ -e "$f" ] && echo "OK   $f" || echo "MISSING $f"
done
```

Expected: every line reads `OK`. `.mcp.json.example` is created in Task 12 and is expected to be missing at this point.

- [ ] **Step 5: Commit, open a pull request, merge**

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs: Rewrite README for Newsgrap3r and add CONTRIBUTING

The README was still the upstream starter kit's and told readers to
clone ai-coding-starter-kit. CONTRIBUTING documents the issue-claim
flow, branch and commit conventions, the migration workflow and the
pull request gate."
git push -u origin docs/onboarding
gh pr create --fill
gh pr checks --watch
```

Request review from your colleague, then merge once approved:

```bash
gh pr merge --squash --delete-branch
```

---

## Task 11: Correct the documentation that drifted

Three concrete errors mislead a newcomer: NEWS-11 is documented as though it exists,
`features/INDEX.md` statuses are stale, and a dead re-export shim sits next to the real
Supabase clients.

**Files:**
- Modify: `features/INDEX.md`
- Modify: `docs/architecture.md`
- Modify: `features/NEWS-11-auto-categorization.md` (status header only)
- Delete: `src/lib/supabase.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Create a branch**

```bash
git checkout main && git pull
git checkout -b docs/correct-drifted-documentation
```

- [ ] **Step 2: Confirm the dead shim really is unused**

```bash
grep -rn "from ['\"]@/lib/supabase['\"]" src/ || echo "NO IMPORTERS"
```

Expected: `NO IMPORTERS`. The file is a backwards-compatibility re-export of
`@/lib/supabase/client`. If this command finds importers, **skip Step 3** and leave the
file in place.

- [ ] **Step 3: Delete the shim**

```bash
git rm src/lib/supabase.ts
npm run typecheck && npm run build
```

Expected: both pass. If the build fails, restore with `git checkout HEAD -- src/lib/supabase.ts` and skip this step.

- [ ] **Step 4: Confirm NEWS-11 is genuinely unimplemented before downgrading it**

```bash
grep -rli "anthropic" src/ ; ls src/lib/categorization 2>/dev/null ; grep -n "anthropic" package.json
```

Expected: the only match is `src/lib/env.ts` (the `ANTHROPIC_API_KEY` declaration at line 25); no `src/lib/categorization/` directory; no Anthropic SDK dependency. This confirms the feature is designed but not built.

- [ ] **Step 5: Correct `features/INDEX.md`**

Fourteen of the eighteen rows currently read `In Progress` or `In Review` despite the
features being live. Work through them one at a time against the running production app —
do not bulk-edit and do not guess.

| ID | Current status | How to verify |
|----|---------------|---------------|
| NEWS-1 | In Progress | Log in and out at `/login`; register at `/register` |
| NEWS-2 | In Progress | Create, edit and delete a source at `/dashboard/sources` |
| NEWS-3 | In Progress | Scrape an RSS source; articles appear |
| NEWS-4 | In Progress | Scrape an HTML source; articles appear |
| NEWS-5 | In Progress | `sources.last_scraped_at` advances; no duplicate URLs |
| NEWS-6 | In Review | `GET /api/articles?limit=5` returns paginated JSON |
| NEWS-7 | In Progress | `/dashboard/news` lists articles with working filters |
| NEWS-8 | In Progress | Source detail article list; delete an article as admin |
| NEWS-9 | In Review | Category CRUD at `/dashboard/categories` |
| NEWS-10 | In Progress | Source form has slug, default category and mapping table |
| NEWS-11 | In Progress | **→ `Planned`.** Confirmed unimplemented in Step 4 |
| NEWS-12 | In Review | Retention settings save; `retention_log` receives rows |
| NEWS-13 | In Progress | Statistics dashboard renders |
| NEWS-14 | In Progress | Feed auto-detection in the source form |

Set a row to `Deployed` when its check passes on production. Leave it as-is when the check
fails, and open a GitHub Issue describing what is broken. NEWS-15 through NEWS-18 are
already `Deployed` (commit `3d379a5`) and need no change.

Apply the same status to each feature's own spec header in `features/NEWS-*.md`.

Then correct the trailing line to the next genuinely free ID, accounting for any `NEWS-` issues already opened on GitHub:

```markdown
## Next Available ID: NEWS-19
```

Add a note under the status legend recording where IDs are now claimed:

```markdown
> Feature IDs are claimed by opening a GitHub Issue titled `NEWS-<id>: <Feature name>`.
> Check the open issues as well as this table before taking the next number.
```

- [ ] **Step 6: Correct the NEWS-11 spec header**

In `features/NEWS-11-auto-categorization.md`, set the status field in the header to `Planned` and add a line directly beneath it:

```markdown
> Not implemented. Only `ANTHROPIC_API_KEY` is declared, in `src/lib/env.ts`.
> There is no `src/lib/categorization/` module and no Anthropic SDK dependency.
```

- [ ] **Step 7: Correct `docs/architecture.md`**

Two fixes.

First, in the component tree in §8, the entry `categorization/llm-categorizer.ts ← NEWS-11` describes a file that does not exist. Mark it:

```
│   ├── categorization/
│   │   └── llm-categorizer.ts    ← NEWS-11 (GEPLANT — noch nicht implementiert)
```

Second, in the `sources` table in §2, the column is documented as `active` but the code uses `is_active` (see `src/lib/validations/source.ts:26`). Verify against the real schema:

```bash
grep -n "is_active\|[^_]active" supabase/migrations/*_remote_schema.sql | head
```

Correct the documented column name to whatever the migration actually declares.

Add a note at the top of `docs/architecture.md`, right under the existing subtitle:

```markdown
> Stand: dieses Dokument beschreibt den Zielzustand. Abweichungen zwischen Entwurf und
> Implementierung sind mit "GEPLANT" markiert. Der verbindliche Stand des Schemas ist
> `supabase/migrations/`, nicht dieses Dokument.
```

- [ ] **Step 8: Verify the build is unaffected**

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

Expected: all four pass.

- [ ] **Step 9: Commit, open a pull request, merge**

```bash
git add features/ docs/architecture.md src/lib/supabase.ts
git commit -m "docs: Correct documentation drifted from the codebase

NEWS-11 was marked In Progress and architecture.md documented
src/lib/categorization/llm-categorizer.ts, but the feature is not
implemented — only the env var is declared. Corrects feature statuses to
reality, marks the planned module as such, fixes the sources column name
and deletes the unused src/lib/supabase.ts re-export shim."
git push -u origin docs/correct-drifted-documentation
gh pr create --fill
gh pr checks --watch
gh pr merge --squash --delete-branch
```

---

## Task 12: Update the AI workflow configuration

**Files:**
- Modify: `CLAUDE.md`
- Create: `.mcp.json.example`

**Interfaces:**
- Consumes: the conventions established in Tasks 2, 9 and 10
- Produces: `.mcp.json.example`, referenced by the README written in Task 10

- [ ] **Step 1: Create a branch**

```bash
git checkout main && git pull
git checkout -b chore/claude-collaboration-config
```

- [ ] **Step 2: Confirm `.mcp.json` is gitignored and has never been committed**

```bash
git check-ignore -v .mcp.json
git log --all --oneline -- .mcp.json || echo "NEVER COMMITTED"
```

Expected: the ignore rule is reported, and the file has never been committed. If it *was* committed at some point, the token in it must be rotated in the Supabase dashboard.

- [ ] **Step 3: Write the MCP example file**

Read your real `.mcp.json` to mirror its structure, then create `.mcp.json.example` with the credential replaced:

```bash
cat .mcp.json
```

Create `.mcp.json.example`:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--project-ref=YOUR_DEV_PROJECT_REF"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "YOUR_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

If your real `.mcp.json` has a different shape, match it — the point is that a colleague can copy this file, drop in their own token, and have a working configuration.

Adjust the JSON so the surrounding comment lives in the README rather than the file (JSON has no comments). Confirm it parses:

```bash
python3 -c "import json; json.load(open('.mcp.json.example')); print('JSON OK')"
```

Expected: `JSON OK`.

- [ ] **Step 4: Verify the example contains no real credential**

```bash
grep -nE "(sbp_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{10,}|xvkviaapboambbvsvnuz)" .mcp.json.example \
  || echo "CLEAN"
```

Expected: `CLEAN`. The production project ref must not appear — the example points at development.

- [ ] **Step 5: Add the collaboration section to `CLAUDE.md`**

Append to `CLAUDE.md`, after the existing `Key Conventions` section:

```markdown
## Collaboration

Two developers work on this repository in parallel. These rules are not optional.

- **Never push to `main`.** It is protected. Work on a branch and open a pull request.
  See `CONTRIBUTING.md`.
- **Never change the database schema through the Supabase MCP server or the Supabase
  dashboard.** Create a migration with `npx supabase@latest migration new <name>` and
  commit it. `supabase/migrations/` is the source of truth; the schema drifted out of the
  repository once already this way.
- **The Supabase MCP server points at `news-scraper-dev`, never production.**
- **Claim a feature ID by opening a GitHub Issue** titled `NEWS-<id>: <Feature name>`
  before running `/requirements`. GitHub allocates the number; `features/INDEX.md` is
  updated later, in the feature's own pull request.
- **New logic under `src/lib/` arrives with a test.** Run
  `npm run lint && npm run typecheck && npm run test && npm run build` before opening a
  pull request — CI runs exactly these.
- `.claude/settings.json` is shared and committed. `.claude/settings.local.json` is
  personal and gitignored. `.mcp.json` is gitignored; `.mcp.json.example` documents it.
```

- [ ] **Step 6: Add the build and test commands to `CLAUDE.md`**

The `Build & Test Commands` block in `CLAUDE.md` is missing the two scripts added in Task 4. Update it:

```bash
npm run dev        # Development server (localhost:3000)
npm run build      # Production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run test       # Vitest
npm run start      # Production server
```

- [ ] **Step 7: Commit, open a pull request, merge**

```bash
git add CLAUDE.md .mcp.json.example
git commit -m "chore: Add collaboration rules to CLAUDE.md and MCP example config

Records the rules that bind AI-assisted work as well: never push to
main, never change the schema outside a committed migration, point the
Supabase MCP at the dev project, claim feature IDs via GitHub Issues."
git push -u origin chore/claude-collaboration-config
gh pr create --fill
gh pr checks --watch
gh pr merge --squash --delete-branch
```

---

## Task 13: Onboarding dry run

The acceptance test for the whole plan. Perform it in a **fresh clone in a different
directory**, so nothing in your existing working copy can mask a missing step.

Ideally the second developer performs this while you watch, and you fix what trips them up.

**Files:**
- Modify: `README.md` and/or `CONTRIBUTING.md`, only if the dry run exposes a gap

**Interfaces:**
- Consumes: everything from Tasks 1–12
- Produces: the verified onboarding path

- [ ] **Step 1: Clone into a scratch directory**

```bash
cd /tmp && rm -rf news-scraper-dryrun
git clone https://github.com/IDS-online/news-scraper.git news-scraper-dryrun
cd news-scraper-dryrun
```

- [ ] **Step 2: Follow the README literally, without improvising**

Run only the commands the README gives. Every time you have to do something the README
does not tell you, write it down — that is a documentation bug.

```bash
npm ci
npx vercel link
npx vercel env pull .env.local
npm run dev
```

Expected: the app starts on `http://localhost:3000`.

- [ ] **Step 3: Verify it is talking to the development database**

```bash
grep NEXT_PUBLIC_SUPABASE_URL .env.local
```

Expected: the development project ref, **not** `xvkviaapboambbvsvnuz`.

- [ ] **Step 4: Verify the app works end to end**

Log in, open the Sources page, confirm the three seeded sources appear, and trigger one
manual scrape. Expected: articles appear in the news feed.

- [ ] **Step 5: Verify the full check suite passes on a clean clone**

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

Expected: all four pass with no additional setup.

- [ ] **Step 6: Verify the schema rebuilds from git alone**

This is the criterion that was impossible before Task 2.

```bash
ls supabase/migrations/
grep -c "CREATE TABLE" supabase/migrations/*_remote_schema.sql
```

Expected: the baseline migration is present and declares the full set of tables. The
authoritative check is the `migrations` CI job, which rebuilds the schema on every pull
request.

- [ ] **Step 7: Verify branch protection blocks a direct push from a fresh clone**

```bash
git commit --allow-empty -m "chore: Dry run protection check"
git push origin main
```

Expected: **rejected**.

- [ ] **Step 8: Clean up**

```bash
cd /tmp && rm -rf news-scraper-dryrun
```

- [ ] **Step 9: Fix every gap the dry run exposed**

For each undocumented step you wrote down in Step 2, add it to `README.md` or
`CONTRIBUTING.md`. Then open a pull request:

```bash
cd ~/projects/news-scraper
git checkout main && git pull
git checkout -b docs/onboarding-dry-run-fixes
# make the edits
git add README.md CONTRIBUTING.md
git commit -m "docs: Close gaps found in the onboarding dry run"
git push -u origin docs/onboarding-dry-run-fixes
gh pr create --fill
gh pr checks --watch
gh pr merge --squash --delete-branch
```

If the dry run exposed no gaps, skip this step and say so — that is the successful outcome.

---

## Acceptance criteria

Mapped from §12 of the design spec. Verify each after Task 13.

- [ ] A fresh clone plus `npm ci`, `vercel env pull .env.local` and `npm run dev` yields a running application against `news-scraper-dev`, with no undocumented manual steps *(Task 13 Steps 2–4)*
- [ ] The CI `migrations` job rebuilds the full schema from `supabase/migrations/` against an empty database, and `supabase db push` against `news-scraper-dev` succeeds from scratch *(Task 8 Step 7, Task 3 Step 3)*
- [ ] A direct push to `main` is rejected for both developers *(Task 9 Step 5, Task 13 Step 7)*
- [ ] A pull request cannot merge while `verify` or `migrations` is failing *(Task 9 Step 4)*
- [ ] A pull request cannot merge without one approving review *(Task 9 Step 4)*
- [ ] `npm run test` passes and covers the scraping engines, feed detector, scheduler and validation schemas *(Tasks 5–7)*
- [ ] `features/INDEX.md` and `docs/architecture.md` describe the codebase as it is, with NEWS-11 marked Planned *(Task 11)*
- [ ] No secret is stored anywhere except Vercel environment variables and local `.env.local` files *(Task 2 Step 7, Task 12 Step 4)*
