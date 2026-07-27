## Feature

Closes #<!-- issue number: the NEWS-X issue this PR implements -->

## What changed

<!-- One or two sentences. What does this PR do, and why? -->

## Database

- [ ] No schema change
- [ ] Includes a migration in `supabase/migrations/`, already applied to `news-scraper-dev`

<!-- If a migration is included: does production need it applied before or after the
     deploy? Note anything the reviewer must do at merge time. -->

## How this was tested

<!-- Which commands, which pages, which cases. "Ran the app" is not enough. -->

## Checklist

- [ ] `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` pass locally
- [ ] New logic under `src/lib/` has tests
- [ ] `features/INDEX.md` and the feature spec status are up to date
- [ ] No secrets in the diff
