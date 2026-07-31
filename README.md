# Newsgrap3r 

Automated multilingual news aggregation. Newsgrap3r scrapes configured RSS/Atom feeds
and HTML pages on a schedule, deduplicates articles by URL, detects their language, and
serves everything through an authenticated REST API and a web dashboard.

> ### The deployed app is production. Develop on `localhost`.
>
> The deployed Vercel URL runs against the **production** database — real sources, real
> articles, no undo. As an admin there you can delete a source, which cascades to every
> article it scraped.
>
> Local development (`npm run dev`, http://localhost:3000) runs against a **separate**
> database, `news-scraper-dev`, with throwaway seed data. Break whatever you like.
>
> **The two look identical in the browser.** Nothing on screen tells you which database you
> are connected to. If you are about to delete something, check the URL first.
>
> Registering an account on the deployed app creates a production user; registering on
> `localhost` creates a development one. They are different databases and different
> accounts, even with the same email address.

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

Prerequisites: Node.js 24 or newer, plus membership of the **IDS online Team** on Vercel
and of the Supabase organization. Neither is self-service — ask Michael, and check you can
actually see the `news-scraper` project in both before starting.

```bash
git clone https://github.com/IDS-online/news-scraper.git
cd news-scraper
npm ci

npx vercel login
npx vercel link            # scope: IDS online Team, then the existing "news-scraper" project
npx vercel env pull .env.local

npm run dev
```

Open http://localhost:3000.

`vercel env pull` writes the credentials for the **Development** environment, which
point at the `news-scraper-dev` Supabase project (ref `cekgyjynxgyktzouepkp`). Preview
deployments (one per pull request) resolve to the same dev project. Only **Production**
points at the separate `news-scraper` project (ref `xvkviaapboambbvsvnuz`); you will not
touch it from local development. There is no hosted "dev" app to browse — development
means `localhost:3000`.

### First run — read this before you file a bug

Registering a new account and logging in surfaces a few dead ends with no error message.
All of them are expected:

- The registration form requires a `passwordConfirmation` field, and Supabase rejects
  `@example.com` addresses outright — both surprising if you're calling
  `/api/auth/register` directly instead of using the form.
- Depending on the Supabase project's auth settings, a new account may need email
  confirmation before it can log in. On `news-scraper-dev` it is fine to confirm it
  yourself in the SQL editor:
  ```sql
  update auth.users set email_confirmed_at = now() where email = 'you@example.com';
  ```
- A freshly registered account has `profiles.role = 'user'`. **Admin-only controls are
  simply absent — there is no error, no redirect message, nothing.** Creating and
  editing sources on `/dashboard/sources`, managing categories on
  `/dashboard/categories`, and deleting articles all check the role client-side and
  render nothing if you are not an admin. Promote yourself in the SQL editor:
  ```sql
  update public.profiles set role = 'admin' where email = 'you@example.com';
  ```
  Note there is no `/dashboard/admin` route despite what `docs/architecture.md`
  describes — admin capability is gated per page, not by a separate URL segment.
- Once you're in, the news feed will likely be empty and stay empty. **Scheduled
  scraping only runs in production** — the crons in `vercel.json` fire against
  production deployments, never against development or previews. A quiet dev
  environment is expected, not a fault. Trigger a scrape by hand:
  ```bash
  curl -X POST http://localhost:3000/api/sources/<source-id>/scrape
  ```
  (Admin session required — call it from a logged-in browser tab, or attach your
  session cookie.)

## Environment variables

All are supplied by `vercel env pull`. See `.env.local.example` for the canonical list.

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Admin key for scraping, cron and retention |
| `CRON_SECRET` | No (warns) | Secures `/api/cron/*`; without it, cron requests are rejected |
| `ANTHROPIC_API_KEY` | No (warns) | Reserved for NEWS-11 (LLM auto-categorization) — **not implemented, nothing reads this variable yet** |

"Required" here means `src/lib/env.ts` throws at startup and refuses to boot if the
variable is missing or empty; "warns" means it logs a warning and continues. This runs
once via the `instrumentation.ts` hook, so a misconfigured deployment fails immediately
with a readable message instead of an opaque 500 inside some request handler later.

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
| Development | `news-scraper-dev` (`cekgyjynxgyktzouepkp`) | Local (`npm run dev`) + Preview deployments | Both developers, freely |
| Production | `news-scraper` (`xvkviaapboambbvsvnuz`) | Production | Merges to `main` only |

Scheduled scraping runs **in production only** — `vercel.json` crons do not fire against
development or preview deployments. Trigger a scrape locally with
`POST /api/sources/[id]/scrape`.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before your first pull request. `main` is
protected: no direct pushes (including for repository admins), CI must pass, merges are
squash-only.

## Documentation

| Document | Contents |
|----------|----------|
| [docs/PRD.md](docs/PRD.md) | Product vision, target users, roadmap |
| [docs/architecture.md](docs/architecture.md) | Database schema, API routes, scraping pipeline — a design document that has drifted from the real schema in places; `supabase/migrations/` is the authority (see CONTRIBUTING) |
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
