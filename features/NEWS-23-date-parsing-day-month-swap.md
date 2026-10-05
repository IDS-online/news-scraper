# NEWS-23: Bugfix — German Day-First Dates Parsed Month-First (Day/Month Swap)

## Status: Planned
**Created:** 2026-10-05
**Claimed via:** GitHub Issue #28

## Dependencies
- Affects NEWS-4 (HTML DOM Scraping Engine) — the defect lives in `parseDate()`
  (`src/lib/scraping/html-engine.ts:428-444`).
- NEWS-3 (RSS engine) has its own `parseDate()` (`rss-engine.ts:123-128`, native `Date` only).
  RSS feeds deliver RFC 822 / ISO dates, which parse unambiguously — it is **in scope to verify
  this with a test**, but no behavior change is expected there.
- **Related but separate defect in the same function:** GitHub issue #2 (bare dates are
  timestamped at server-local midnight instead of a defined timezone). Not fixed by this ticket;
  if `/architecture` finds the two fixes share the same few lines, fixing #2 alongside is
  permitted but must be called out explicitly in the PR.
- Downstream consumer note: `published_at` feeds the news feed ordering (NEWS-7), the Bubble
  sync (NEWS-19, field "Date publishing"), and retention (NEWS-12) — retention deletes by
  article age, so a future-dated article is also **retention-immune** until its false date
  passes. This raises the defect above "cosmetic".

## Background

Observed in production on 2026-10-05, directly after the Bubble live switch: the "newest"
articles carry `published_at` values of 2026-11-08 and 2026-12-08 — **in the future**. Several
articles share the same false date.

Root cause, reproduced on 2026-10-05 against the installed dependencies:

| Input (German, day-first) | `new Date(raw)` (step 1) | `chrono.parseDate` (step 2, en) | `chrono.de.parseDate` |
|---|---|---|---|
| `11.08.2026` (= 11 Aug) | **2026-11-07/08 — wrong** (US month-first + timezone shift) | **2026-11-08 — wrong** | 2026-08-11 ✅ |
| `28.08.2026` (= 28 Aug) | Invalid Date (day > 12) | — | 2026-08-28 ✅ |

`parseDate()` tries native `Date` first; V8 reads `11.08.2026` as US month-first. For day ≤ 12
this *succeeds silently* with swapped day/month, so the chrono fallback never runs — and even
when it does, the default (English) locale is month-first-ambiguous too. Only dates with
day > 12 are immune (native parse fails, and chrono tends to resolve them correctly).

**Blast radius:** every HTML source whose `selector_date` yields a German numeric date with
day ≤ 12 — statistically ~40% of all days, across all current and future German HTML sources.
Wrong order in the news feed, wrong "Date publishing" in Bubble, distorted retention age.

## User Stories
- As an editor, I want the news feed and Bubble to order articles by their real publication
  date, so that an article from August does not sit above today's news flagged as November.
- As an operator, I want German sources to parse dates correctly without per-source
  configuration, so that adding a new German source does not silently produce future dates.

## Acceptance Criteria
- [ ] `parseDate()` in `html-engine.ts` parses German day-first numeric dates correctly for
      days ≤ 12 (`11.08.2026` → 11 Aug) and > 12 (`28.08.2026` → 28 Aug), with and without a
      time component, for `DD.MM.YYYY`, `D.M.YYYY` and `DD.MM.YY` shapes.
- [ ] Unambiguous formats keep parsing exactly as today: ISO 8601 (`2026-08-11T10:30:00Z`),
      RFC 822 (`Mon, 11 Aug 2026 10:30:00 GMT`), and written-out German dates
      (`11. August 2026`) — covered by regression tests, not assumed.
- [ ] Relative German expressions that work today (`vor 2 Stunden`) still work — the fix must
      not regress chrono's existing relative-date handling.
- [ ] The RSS engine's `parseDate()` behavior on RFC 822 / ISO inputs is covered by a test
      proving it is unaffected (no code change expected there).
- [ ] A regression test reproduces the production case verbatim: a date cell of `11.08.2026`
      on an HTML fixture results in a stored `published_at` of August 11 — the exact swap this
      ticket exists for.
- [ ] **Repair of stored data:** a one-off, dry-run-by-default script (or documented SQL,
      decided in `/architecture`) identifies articles whose `published_at` lies in the future
      relative to their `created_at`/now and corrects them by swapping day and month where the
      swap yields a plausible past date; everything else is only reported, never guessed.
      Nothing is deleted; rows are corrected in place.
- [ ] **Documented limitation:** already-synced Bubble records keep their wrong
      "Date publishing" — the sync has no update path (create-only; see the NEWS-21 follow-up
      note on the future PATCH ticket). The repair fixes Supabase; Bubble catches up only for
      records synced after the fix, or once the PATCH ticket exists. This is stated in the
      spec and the repair script's output, not silently omitted.

## Edge Cases
- `08.08.2026` (day == month): swap-invariant — must parse to 8 Aug either way; the repair
  script must not flag it.
- `13.13.2026` or other nonsense: parse fails → fallback to scrape timestamp (today's
  behavior), no crash.
- A genuinely future-dated article (source pre-publishes an event announcement): the repair
  script must not "correct" a date whose swap is implausible (e.g. day > 12) — report-only.
- Sources with `language != de` whose pages still show German dates (and vice versa): the fix
  must not key off the source's `language` field alone; `/architecture` decides between
  locale-aware parsing order and format detection.
- Ambiguous `05.04.2026` where both readings are past dates: day-first wins (German sources are
  the project's domain); documented as the deliberate default.

## Technical Requirements
- Expected shape of the fix (final call in `/architecture`): stop handing ambiguous numeric
  strings to native `Date` first; prefer `chrono.de` for day-first parsing (already proven
  correct for both reproduced cases, already a dependency — no new package).
- No schema change, no new environment variables, no per-source configuration.
- New logic under `src/lib/` arrives with tests (project rule); the CI gate
  (`lint && typecheck && test && build`) must stay green.

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
