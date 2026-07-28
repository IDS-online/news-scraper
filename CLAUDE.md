# AI Coding Starter Kit

> A Next.js template with an AI-powered development workflow using specialized skills for Requirements, Architecture, Frontend, Backend, QA, and Deployment.

## Tech Stack

- **Framework:** Next.js 16 (App Router), TypeScript
- **Styling:** Tailwind CSS + shadcn/ui (copy-paste components)
- **Backend:** Supabase (PostgreSQL + Auth + Storage) - optional
- **Deployment:** Vercel
- **Validation:** Zod + react-hook-form
- **State:** React useState / Context API

## Project Structure

```
src/
  app/              Pages (Next.js App Router)
  components/
    ui/             shadcn/ui components (NEVER recreate these)
  hooks/            Custom React hooks
  lib/              Utilities (supabase.ts, utils.ts)
features/           Feature specifications (PROJ-X-name.md)
  INDEX.md          Feature status overview
docs/
  PRD.md            Product Requirements Document
  production/       Production guides (Sentry, security, performance)
```

## Development Workflow

1. `/requirements` - Create feature spec from idea
2. `/architecture` - Design tech architecture (PM-friendly, no code)
3. `/frontend` - Build UI components (shadcn/ui first!)
4. `/backend` - Build APIs, database, RLS policies
5. `/qa` - Test against acceptance criteria + security audit
6. `/deploy` - Deploy to Vercel + production-ready checks

## Feature Tracking

All features tracked in `features/INDEX.md`. Every skill reads it at start and updates it when done. Feature specs live in `features/PROJ-X-name.md`.

## Key Conventions

- **Feature IDs:** NEWS-1, NEWS-2, etc. (sequential)
- **Commits:** `feat(NEWS-X): description`, `fix(NEWS-X): description`
- **Single Responsibility:** One feature per spec file
- **shadcn/ui first:** NEVER create custom versions of installed shadcn components
- **Human-in-the-loop:** All workflows have user approval checkpoints

## Collaboration

Two developers work on this repository in parallel. These rules are not optional.

- **Never push to `main`.** It is protected — no direct pushes, the `verify` and
  `migrations` checks must pass, and merges are squash-only. Required approving reviews
  is currently 0 and moving to 1. Work on a branch and open a pull request. See
  `CONTRIBUTING.md`.
- **Never change the database schema through the Supabase MCP server or the Supabase
  dashboard.** Create a migration with `npx supabase@latest migration new <name>` and
  commit it. `supabase/migrations/` is the source of truth; the schema drifted out of the
  repository once already this way.
- **The Supabase MCP server is account-scoped, not project-scoped.** It uses the hosted
  endpoint (`https://mcp.supabase.com/mcp`) with a personal access token in the
  `Authorization` header, and that token alone grants access to every project on the
  account, production included. Always pin the session to development with a
  `project_ref` query parameter (`?project_ref=cekgyjynxgyktzouepkp`), adding
  `&read_only=true` when you don't need write access. Without `project_ref` the token
  reaches production. See `.mcp.json.example`.
- **Never modify Vercel environment variables from the CLI on this project.** Editing a
  variable that exists in multiple scopes removes it from every scope, not just the one
  being changed — this has deleted production variables twice. Use the dashboard and add
  a second, separately scoped entry rather than narrowing an existing one. See
  `CONTRIBUTING.md` for the full detail.
- **`supabase db reset` must always be run with `--local`.** A bare `db reset` can target
  whatever project is currently linked, including production.
- **Everything in seeds and migrations must be schema-qualified** (`public.categories`,
  not `categories`) — both run against a connection with an empty `search_path`.
- **Claim a feature ID by opening a GitHub Issue** titled `NEWS-<id>: <Feature name>`
  before running `/requirements`. GitHub allocates the number; `features/INDEX.md` is
  updated later, in the feature's own pull request.
- **New logic under `src/lib/` arrives with a test.** Run
  `npm run lint && npm run typecheck && npm run test && npm run build` before opening a
  pull request — CI runs exactly these.
- `.claude/settings.json` is shared and committed. `.claude/settings.local.json` is
  personal and gitignored. `.mcp.json` is gitignored because it holds a live credential —
  if it is ever committed, rotate the token in the Supabase dashboard immediately.
  `.mcp.json.example` documents its shape.

## Build & Test Commands

```bash
npm run dev        # Development server (localhost:3000)
npm run build      # Production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run test       # Vitest
npm run start      # Production server
```

## System Architecture

@docs/architecture.md

## Design System

@docs/styleguide.md

## Product Context

@docs/PRD.md

## Feature Overview

@features/INDEX.md
