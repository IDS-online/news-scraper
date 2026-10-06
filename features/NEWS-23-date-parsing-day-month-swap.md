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
- [ ] **Property-based test (fuzz) — the machine that outlasts review rounds:** a test
      generates a large number of random valid calendar dates, renders each in the supported
      shapes (numeric day-first with 2- and 4-digit years, written-out and abbreviated German
      month names, optional weekday prefix, optional time suffix, optional surrounding text
      like `Veröffentlicht am …`), and asserts every single one parses back to exactly the
      generated calendar day — no silent swap, no silent scrape-timestamp fallback for a
      supported shape. Three review rounds each found a format trap humans had missed; this
      test searches the format space mechanically on every CI run.
- [ ] **Future-date guard in the pipeline:** an article whose parsed `published_at` lies more
      than 24 hours in the future is still stored (slightly-ahead publish dates are
      legitimate) but is **logged as a warning naming the source and the parsed value** — a
      future date is suspicious by definition and must surface as a signal in the logs, not
      as a months-later surprise in Bubble. The production defect this ticket fixes was found
      by a human happening to look; this guard removes the "happening to".

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

> Added 2026-10-06 on branch `docs/NEWS-23-architecture`. Design only — no code in this
> section. The spec above is frozen; this section maps every hardened requirement onto
> files, mechanisms and tests. Line references checked against the code on 2026-10-06:
> the defective function sits at `html-engine.ts:434-450` (the spec header says 428-444 —
> same function, minor drift, nothing else differs).

### 1. What gets built, in one paragraph

Date parsing moves out of `html-engine.ts` into a new, single-purpose module
`src/lib/scraping/parse-date.ts` that implements a fixed five-stage pipeline (strict
machine formats first, German chrono next, English chrono only for strings carrying an
alphabetic month name, never native `Date` for day-first-shaped numeric strings, scrape
timestamp as the caller's last resort). The HTML engine delegates to it; the RSS engine is
not touched. The scheduler gains a future-date warning at the single point where articles
from both engines pass on their way into the database. Stored damage is handled by a
report-only repair tool following the existing NEWS-21 pattern: thin CLI in `scripts/`,
tested logic in `src/lib/backfill/`, per-row manual approval, no automatic branch.

### 2. Component structure

```
Scraping pipeline (per source)
+-- RSS engine (rss-engine.ts)            — UNCHANGED, guard tests only
+-- HTML engine (html-engine.ts)
|   +-- parseDate()                        — becomes a thin delegate, kept exported
|       +-- NEW parse-date.ts              — the actual five-stage pipeline
+-- Scheduler (scheduler.ts)
    +-- NEW future-date guard              — warns (does not block) before insert

Repair tooling (one-off, never part of the pipeline)
+-- scripts/repair-swapped-dates.ts        — thin CLI (mirrors backfill-missing-images.ts)
    +-- NEW src/lib/backfill/swapped-dates.ts — candidate query, swap reading, apply-one
```

### 3. The parse pipeline (`src/lib/scraping/parse-date.ts`)

One exported entry point: it takes the raw scraped string plus an **injectable reference
time** (`refDate`, defaulting to "now") and returns an ISO timestamp or null. The caller —
unchanged in behavior — keeps the scrape timestamp when it gets null. Stages run strictly
in this order; each exists because a review round proved skipping it reintroduces a defect:

| # | Stage | What it does | Trap it closes |
|---|-------|--------------|----------------|
| 0 | Sanitize | Trim; strip a leading German weekday token (`Mo.,`/`Di.,`/… and full names, optional comma) before any matching | `chrono.de`'s *first* match on `Mo., 11.08.2026` is the bare weekday → "previous Monday". Stripping the prefix removes the decoy entirely; as a second belt, stage 2 never takes a first match blindly (see below) |
| 1 | Strict machine formats | Regex-detect full ISO 8601 and RFC 822/1123 shapes; only these may use the native date parser (which is correct and timezone-exact for them) | `chrono.de` partial-matches only the clock time of an RFC 822 string and returns the scrape day (verified in spec). Machine formats must therefore be recognized *before* chrono runs |
| 2 | German chrono (`chrono.de`) with `refDate` | Parse all candidates, then select the **best match**, not the first: prefer matches that contain an explicit year, then the longest matched text; take the first *complete* date (day + month known) under that ordering | First-match selection is exactly the weekday-prefix bug; year-preference also makes the "two dates in one string" case deterministic (first full date wins, per spec) |
| 3 | Guarded English chrono | Runs only after a stage-2 miss **and** only if the string contains an alphabetic month token (checked against the English month-name list, full and abbreviated — not "any letters") | German pages from English CMS templates emit `11 Oct 2026`, which `chrono.de` misses. Running English chrono on *numeric* strings would reintroduce the exact swap this ticket fixes, so numeric-only strings can never reach this stage |
| 4 | Null | Return null; caller falls back to scrape timestamp (today's behavior, unchanged) | Native `Date` is dead as a fallback: a `D(D).M(M).YY(YY)`-shaped string that chrono rejects (`1.8.26`, `11. 08. 2026`) ends here — it must never produce a silent US-order parse (today it turns `1.8.26` into January) |

Properties the pipeline guarantees (each pinned by tests, section 7):

- Day-first wins for ambiguous numeric dates (`05.04.2026` → 5 April) — deliberate default,
  German sources are the domain.
- Date ranges resolve to a date *within* the range; which endpoint is implementation-defined
  by chrono (dash forms → end, `bis` forms → start, as verified in the spec) and documented,
  not engineered around.
- Relative German expressions (`vor 2 Stunden`, `gestern`) now resolve against `refDate` —
  a documented behavior change (today they silently fall through to the scrape timestamp).
- Bare dates carry chrono's implicit time: **12:00 server-local** instead of the old native
  midnight. This is the documented side effect from the spec's dependency note on issue #2
  (see section 6).
- The source's `language` field plays no role: the pipeline is input-driven (format
  detection), so a `language != de` source showing German dates parses correctly and vice
  versa — exactly the edge case the spec demands.

The module also exports two small pure helpers for the repair tool (so they are unit-tested
under `src/lib/`, where the project's test rule applies): the **swapped reading** of a
stored timestamp (day and month exchanged; undefined when the exchange is invalid or when
day equals month — the swap-invariant case the repair must not flag).

### 4. Changes to existing pipeline files

- **`html-engine.ts`:** `parseDate` stays exported (its tests and signature survive) but
  becomes a one-line delegate into the new module. The call site (line ~191) is unchanged.
  The 550-line engine does not grow; the date logic becomes independently testable.
- **`scheduler.ts` — future-date guard:** placed in the insert path (around
  `insertArticles`), the one spot both engines' articles flow through and where the source
  name is in scope. Rule: parsed `published_at` more than 24 h after "now" → the article is
  **stored anyway** (slightly-ahead publish dates are legitimate) and a warning naming the
  source, the article URL and the parsed value goes to the log — matching the scheduler's
  existing `console.warn` conventions. No threshold configuration, no env variable.
- **`rss-engine.ts`:** zero changes. Its RFC 822/ISO behavior is already pinned by
  `rss-engine.test.ts:34-51`; those tests double as the required "RSS unaffected" proof and
  get one added guard test documenting the expected fallback for a non-conformant localized
  `pubDate` (per the spec's dependency note: documented, not fixed).

### 5. Repair tool — report-only, per-row approval

Follows the proven NEWS-21 split: `scripts/repair-swapped-dates.ts` is a thin tsx CLI
(same `.env.local` loading, same Supabase project-ref banner), all logic lives in
`src/lib/backfill/swapped-dates.ts` with tests. Uses existing env vars only
(`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

- **Candidate selection** (joined server-side, no N+1): articles of HTML sources that have
  a `selector_date`, whose `created_at` lies before the fix-deploy timestamp — passed as a
  mandatory `--deployed-before=<ISO>` argument, not hardcoded — and whose `published_at` is
  in the future relative to `created_at`. Rows where day equals month are excluded
  (swap-invariant per spec).
- **Report (default mode):** one line per candidate with article id, title, URL, source
  name, `created_at`, stored `published_at` and the swapped reading — everything the human
  needs to judge "swap victim or genuine announcement". Nothing is written.
- **Approval mechanism:** `--apply --id=<article-uuid>` corrects exactly one row per
  invocation — the row is re-validated against the candidate criteria at apply time, the
  before/after values are printed, nothing is deleted. There is **no** bulk apply, no
  auto-correction branch, no heuristic: round 3 proved every genuine swap has a swapped
  reading with day ≤ 12, and genuine future announcements are indistinguishable without the
  raw string (which is stored nowhere). `--apply` without `--id` is refused.
- **Mandatory output notes**, printed on every run: (a) the dark figure — swaps that landed
  in the past are unfindable, the parser fix is the real cure; (b) the Bubble limitation —
  already-synced records keep their wrong "Date publishing" until the NEWS-21-noted PATCH
  ticket exists.

### 6. GitHub issue #2 (bare-date midnight timezone) — recommendation: do NOT fix here

The spec permits fixing #2 alongside if the same lines are touched. They are — but the
recommendation is to leave #2 open: this ticket's pipeline already *changes* the bare-date
semantics as a side effect (implicit noon server-local instead of implicit midnight, which
under production UTC keeps the calendar day correct for German sources — the previous-day
symptom no longer reproduces), while #2's actual ask (define what a date-only string
*means*: source-locale timezone, date-typed storage, or an "unknown time" marker) is a
design decision of its own with schema implications this ticket explicitly excludes. Doing
a half-fix inside a bugfix PR muddies both tickets. Instead: the side effect is documented
here and in the PR text, and issue #2 gets a comment pointing at the changed baseline.
*(Decision point for review — flipping this means adding an explicit timezone policy to
stage 2 and calling it out in the PR as the spec requires.)*

### 7. Test plan — files and the machinery

Test style follows `og-image-fallback.test.ts` / `scheduler.test.ts` (plain vitest,
fixture-driven, no network). The suite runs under the existing `TZ=UTC` pin.

| File | New/extended | Contents |
|------|--------------|----------|
| `src/lib/scraping/parse-date.test.ts` | new | All mandated literal cases (section 8 table); relative expressions asserted against an injected `refDate`; weekday prefixes; ranges; two-date strings; machine-format regressions; the never-US-parse cases; the swap-invariant case; unit tests for the swapped-reading helper |
| same file — property/fuzz test | new | Generates a large number of random valid calendar days with a **self-written seeded PRNG** (no new package — `fast-check` would violate the no-new-dependency rule), renders each in every supported shape (numeric day-first 2-/4-digit year, written-out and abbreviated German months, optional weekday prefix, optional time suffix, optional surrounding text), asserts exact round-trip to the generated day; the seed is printed on failure so any find is reproducible |
| `src/lib/scraping/html-engine.test.ts` | extended | The verbatim production regression: an HTML fixture whose date cell reads `11.08.2026` yields a stored `published_at` of August 11. Existing `parseDate` tests keep passing (date-prefix assertions are noon-safe under UTC) |
| `src/lib/scraping/rss-engine.test.ts` | extended | Existing RFC 822/ISO tests remain the "unchanged" proof; plus one guard test pinning the fallback for a localized `pubDate` |
| `src/lib/scraping/scheduler.test.ts` | extended | Future-date guard: an article parsed > 24 h ahead is inserted *and* a warning naming source and value is logged; an article inside the window logs nothing |
| `src/lib/backfill/swapped-dates.test.ts` | new | Candidate predicate (in-scope/out-of-scope rows, day==month exclusion, deploy-timestamp boundary), swapped-reading output, apply-one re-validation, report notes present |

### 8. Acceptance-criteria coverage map

| Acceptance criterion | Covered by |
|---|---|
| German numeric day-first, day ≤ 12 and > 12, `DD.MM.YYYY`/`D.M.YYYY`/`DD.MM.YY`, ± time | parse-date unit tests + fuzz test |
| ISO 8601 / RFC 822 keep parsing exactly as today | parse-date machine-format regression tests + existing html-engine/rss-engine tests |
| Written-out German months (`8. Mai 2026`, `8. März 2026`, `11. August 2026`) | parse-date unit tests (umlaut case explicit) + fuzz test (month-name rendering) |
| Weekday prefixes (`Mo.,`/`Di., 11.08.2026` → literal date) | parse-date unit tests + fuzz test (optional prefix dimension) |
| Relative expressions as documented behavior change | parse-date unit tests with injected `refDate` |
| `1.8.26` / `11. 08. 2026` never US-parsed | parse-date unit tests (null-or-correct assertion) |
| RSS engine unaffected | existing + extended rss-engine guard tests, zero diff in `rss-engine.ts` |
| Production case verbatim (HTML fixture `11.08.2026` → stored Aug 11) | html-engine integration test |
| Repair: report-only, per-row manual approval, no auto branch | swapped-dates unit tests + CLI design (no bulk-apply path exists to test) |
| Dark figure documented | spec text + mandatory script output, asserted in swapped-dates tests |
| Bubble limitation documented | spec text + mandatory script output, asserted in swapped-dates tests |
| Property-based fuzz test | parse-date fuzz test (seeded, reproducible) |
| Future-date guard (store + warn, source + value named) | scheduler test |
| Edge: `08.08.2026` swap-invariant | parse-date unit test + repair candidate-predicate test |
| Edge: nonsense (`13.13.2026`) → scrape-timestamp fallback, no crash | parse-date unit test |
| Edge: ranges yield in-range date, endpoint documented | parse-date unit tests (dash and `bis` forms) |
| Edge: two dates in one string → first full date | parse-date unit test |
| Edge: `language != de` sources | by construction (format detection, no `language` input) + English-token unit tests |

### 9. Tech decisions, justified

- **Own module instead of growing `html-engine.ts`:** the engine file is ~550 lines; the
  pipeline needs its own exhaustive test file; the repair tool reuses the swap helper —
  three consumers, one module. The old export stays, so nothing outside the file notices.
- **Best-match selection instead of pre-stripping only:** stripping weekday prefixes
  handles the known decoy; year-preferring match selection also fixes decoys nobody listed
  yet (the fuzz test hunts for those mechanically).
- **Guard in the scheduler, not in the engines:** one placement covers both engines without
  touching the RSS engine (which this ticket must not change), and the source name needed
  for the warning is in scope there.
- **Repair as NEWS-21-pattern CLI, not SQL:** the spec leaves script-vs-SQL open; a script
  wins because the per-row approval loop, the re-validation at apply time and the mandatory
  caveat output are logic — and logic in this project lives under `src/lib/` with tests.
- **No new packages** (fuzzing hand-rolled, chrono 2.9.0 already installed), **no schema
  change** (the raw date string stays unstored — the dark figure is accepted and
  documented, per round 3), **no new env vars**, **no per-source configuration**.

### 10. Dependencies

None added. Uses `chrono-node` 2.9.0 (installed), `vitest` (installed), `tsx` (installed,
already the runner for `backfill:images`). One new npm script alias for the repair CLI in
`package.json` (pattern: the existing `backfill:*` entries).

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
