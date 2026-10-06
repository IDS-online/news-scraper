# NEWS-23: Bugfix — German Day-First Dates Parsed Month-First (Day/Month Swap)

## Status: Planned
**Created:** 2026-10-05
**Last Updated:** 2026-10-06 (review round 3: auto-repair branch proven mathematically dead —
repair is now fully manual-approve; date-range, multi-date and English-month-token edge cases
pinned; round 2: repair made conservative, weekday-prefix and machine-format-ordering traps,
relative-dates premise, blast radius)
**Claimed via:** GitHub Issue #28

## Dependencies
- Affects NEWS-4 (HTML DOM Scraping Engine) — the defect lives in `parseDate()`
  (`src/lib/scraping/html-engine.ts:428-444`).
- NEWS-3 (RSS engine) has its own `parseDate()` (`rss-engine.ts:123-128`, native `Date` only).
  RSS feeds *normally* deliver RFC 822 / ISO dates, which parse unambiguously — it is **in scope
  to verify this with a test**, but no behavior change is expected there. A non-conformant feed
  delivering a localized `pubDate` (`11.08.2026`) hits the identical swap in the RSS path
  (verified 2026-10-06); that stays **out of scope** here, documented, optionally pinned by a
  guard test defining the expected fallback.
- **Related but separate defect in the same function:** GitHub issue #2 (bare dates are
  timestamped at server-local midnight instead of a defined timezone). Not fixed by this ticket;
  if `/architecture` finds the two fixes share the same few lines, fixing #2 alongside is
  permitted but must be called out explicitly in the PR. Verified boundary (2026-10-06):
  `chrono.de` implies **12:00 server-local** for bare dates — not midnight — so the
  previous-day symptom of #2 does not reproduce in the new path (checked under Europe/Berlin
  and UTC). Side effect to document: the implicit time of bare dates changes from midnight to
  noon and remains server-timezone-dependent.
- Downstream consumer note: `published_at` feeds the news feed ordering (NEWS-7), the Bubble
  sync (NEWS-19, field "Date publishing"), retention (NEWS-12) — retention deletes by article
  age, so a future-dated article is also **retention-immune** until its false date passes —,
  the articles API's `from`/`to` date filters (`src/app/api/articles/route.ts:112-116`;
  future-dated articles escape every date-window query), the relative-time display
  (`article-card.tsx:122`), and the wizard/scrape preview, which shows the parsed date to the
  admin at setup time — a useful manual verification point after the fix. This raises the
  defect above "cosmetic".

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
- [ ] Unambiguous machine formats keep parsing exactly as today: ISO 8601
      (`2026-08-11T10:30:00Z`) and RFC 822 (`Mon, 11 Aug 2026 10:30:00 GMT`) — covered by
      regression tests, not assumed.
- [ ] **Written-out German month names parse to the correct day after the fix** — this is a
      second silent defect the same fix covers, found during spec review (2026-10-06, verified
      against the installed dependencies): today `8. Mai 2026` and `8. März 2026` (umlaut) are
      not recognized at all (the article silently receives the scrape timestamp instead of its
      real date), and `11. August 2026` comes back as August **10** (native parse + timezone
      shift) or August **1** (English chrono fallback). Required test cases: `8. Mai 2026`,
      `8. März 2026`, `11. August 2026` — each resolving to its literal day.
- [ ] **Weekday-prefixed dates parse to the literal date:** `Mo., 11.08.2026` and
      `Di., 11.08.2026` → 11 Aug. Verified 2026-10-06: `chrono.de`'s *first* match on such a
      string is the bare weekday token — `parseDate('Mo., 11.08.2026')` returns the *previous
      Monday*, a plausible near-past date and therefore a silent defect worse than today's.
      Implementation note for `/architecture`: never take the first match blindly; prefer the
      longest match / the match carrying a year, or strip weekday prefixes beforehand.
- [ ] Relative German expressions (`vor 2 Stunden`, `vor 3 Tagen`, `gestern`) parse to the
      computed time — **as a documented behavior change, not a regression guard.** Verified
      2026-10-06: today these are not recognized at all (English chrono returns null; the
      article silently receives the scrape timestamp), so there is nothing existing to
      preserve; the fix makes them work for the first time, covered by tests.
- [ ] Numeric strings the German parser does not recognize (`1.8.26`, `11. 08. 2026`) must
      **never** fall through to the native US-style parse — verified 2026-10-06: that path
      turns `1.8.26` into January. The outcome is either a correct day-first date or the
      scrape-timestamp fallback; native `Date` no longer acts as a fallback for strings shaped
      like `D(D).M(M).YY(YY)`.
- [ ] The RSS engine's `parseDate()` behavior on RFC 822 / ISO inputs is covered by a test
      proving it is unaffected (no code change expected there).
- [ ] A regression test reproduces the production case verbatim: a date cell of `11.08.2026`
      on an HTML fixture results in a stored `published_at` of August 11 — the exact swap this
      ticket exists for.
- [ ] **Repair of stored data — report-only, every correction manually approved (review
      round 3).** A one-off, dry-run-by-default script (or documented SQL, decided in
      `/architecture`) identifies candidates among articles of **HTML sources with a
      `selector_date`** whose `created_at` predates the fix deploy and whose `published_at`
      lies in the future relative to `created_at`, and prints each with both readings
      (stored / swapped). There is **no automatic-correction branch at all** — round 3 proved
      the earlier "swapped day > 12 may be auto-corrected" rule mathematically dead: a genuine
      V8/chrono-en swap stores month = original day (≤ 12, else the parse had failed) and
      day = original month (≤ 12 by definition), so **every** real swap victim has a swapped
      reading with day ≤ 12 — the auto branch could never match a single genuine case. And no
      `created_at`-window heuristic can replace it: a genuine future-dated announcement
      (`08.10.`, scraped 05.10.) and a swap (`10.08.` misread) produce identical stored
      values, indistinguishable without the raw date string — which is not stored. With the
      affected volume being a handful of rows, per-row human approval is cheap and the only
      correct option. Nothing is deleted; approved rows are corrected in place.
- [ ] **Documented dark figure:** swapped dates that happen to land in the past (e.g.
      `03.04.2026` read as March 4th) are **not identifiable at all** — the raw date string is
      stored nowhere (`articles` has no raw-date column), so no query can tell them from
      correct dates; depending on the scrape month this hides most swap candidates. The spec
      and the repair script's output state this plainly: the repair fixes what is findable;
      correctness going forward comes from the parser fix, not from the repair.
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
- A genuinely future-dated article (source pre-publishes an event announcement): protected by
  the repair rule above — nothing is ever swapped automatically; the human approving the row
  sees both readings and the article title/URL to judge.
- **Date ranges** (event/trade-fair announcements): verified 2026-10-06 — `11.–13.08.2026`
  (dash forms) parses to the range's **end** date, `11. bis 13. August 2026` to its **start**.
  Required: a range always yields a date *within* the range (never a swap, never the silent
  scrape-timestamp); which endpoint wins is implementation-defined and documented, not worth
  preprocessing machinery.
- **Two dates in one string** (`Veröffentlicht am 11.08.2026 | Aktualisiert am 12.08.2026`):
  the first full-date match wins — in the common German layout that is the publish date.
  Documented caveat: a source leading with its update date would win instead; acceptable, no
  keyword heuristics.
- `11.08.2026 – 14:30 Uhr` (dash between date and time): the date parses correctly, the time
  component is dropped (implicit noon) — acceptable, documented, no fix required.
- Sources with `language != de` whose pages still show German dates (and vice versa): the fix
  must not key off the source's `language` field alone; `/architecture` decides between
  locale-aware parsing order and format detection.
- Ambiguous `05.04.2026` where both readings are past dates: day-first wins (German sources are
  the project's domain); documented as the deliberate default.

## Technical Requirements
- Expected shape of the fix (final call in `/architecture`): stop handing ambiguous numeric
  strings to native `Date` first; prefer `chrono.de` for day-first parsing (already proven
  correct for both reproduced cases, already a dependency — no new package).
- **Parsing order is part of correctness, not an implementation detail:** `chrono.de` must
  never run unfiltered before unambiguous machine formats — on an RFC 822 string it
  partial-matches only the time of day and returns the scrape date (verified 2026-10-06:
  `Mon, 11 Aug 2026 10:30:00 GMT` → today). Order: strict ISO/RFC 822 detection first,
  `chrono.de` for the remainder, no native-`Date` fallback for day-first-shaped numeric
  strings (see acceptance criteria).
- **Guarded English fallback for month-name tokens only (review round 3):** German pages
  rendered by English CMS templates emit `11 Oct 2026` / `11 Dec 2026` — `chrono.de` returns
  null on these while English chrono parses them correctly (verified 2026-10-06; conversely
  `11. Okt. 2026` / `11. Dez. 2026` only parse in `de`). After a `chrono.de` miss, English
  chrono may run **only for strings containing an alphabetic month token — never for purely
  numeric strings**, where the English parser would reintroduce the very swap this ticket
  fixes.
- **Deterministic tests:** the parse function accepts an injectable reference time
  (`refDate`), so relative-expression tests (`vor 2 Stunden`) assert fixed outputs instead of
  racing the wall clock.
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
