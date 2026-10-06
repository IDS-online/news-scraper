# NEWS-23: Bugfix — German Day-First Dates Parsed Month-First (Day/Month Swap)

## Status: Deployed
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

> Added 2026-10-06 by `/qa` against branch `feat/NEWS-23-date-parsing` (commit `1015f84`).
> Method: the committed test suite was run, but **every acceptance criterion was re-verified
> independently** with probe harnesses written from the spec text, not from the implementation's
> own test file. In addition the pre-NEWS-23 `parseDate()` was reconstructed verbatim from
> `git show main:src/lib/scraping/html-engine.ts` and diffed against the new pipeline over a
> 49-format corpus, to find regressions the new tests could not be expected to catch.

### CI gate

| Check | Result |
|---|---|
| `npm run lint` | PASS — 0 errors, 12 warnings, all pre-existing on `main` (incl. the `MAX_REDIRECTS` warning in `html-engine.ts`, verified present before this branch) |
| `npm run typecheck` | PASS |
| `npm run test` | PASS — 17 files, 405 tests |
| `npm run build` | PASS |

### Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | German numeric day-first, day ≤ 12 and > 12, `DD.MM.YYYY`/`D.M.YYYY`/`DD.MM.YY`, ± time | **PASS** | `11.08.2026`→Aug 11, `28.08.2026`→Aug 28, `1.8.2026`→Aug 1, `11.08.26`→Aug 11, `11.08.2026 14:30`→Aug 11 14:30, `31.12.2026`, `12.12.2026`, `01.01.2026` all literal |
| 2 | ISO 8601 / RFC 822 keep parsing exactly as today | **PASS as written** | Old-vs-new diff: all 17 ISO and RFC 822 variants byte-identical, including offsets (`+02:00`, `+0200`), `EST`, 2-digit RFC year, milliseconds, no-seconds. **But see BUG-1** — unambiguous *non-ISO* year-first formats that worked before now return null |
| 3 | Written-out German months parse to the correct day | **PASS** | All 3 mandated cases correct (`8. Mai 2026`→May 8, `8. März 2026`→Mar 8, `11. August 2026`→Aug 11). All 13 full and 14 abbreviated German month spellings verified, incl. `Mrz.`, `Sept.`, `Maerz`, upper/lowercase. **Gap: BUG-2** (dotless variant) |
| 4 | Weekday-prefixed dates → literal date | **PASS** | `Mo.,`/`Di.,`/`Montag,`/`Samstag,`/`SO.,` → Aug 11. Also verified beyond spec: no comma (`Mo. 11.08.2026`, `So 11.08.2026`), `Sonnabend`, and the non-clipping case `Mondlandung am 11.08.2026`→Aug 11. No "previous Monday" result in any form |
| 5 | Relative German expressions resolve against `refDate` | **PASS** | `vor 2 Stunden`, `vor 3 Tagen`, `gestern`, `heute`, `vorgestern`, `vor einer Stunde`, `vor 2 Wochen`, `in 2 Tagen` all exact against the injected reference. `vor 1 Monat`→null (chrono limit, harmless: falls back to scrape timestamp) |
| 6 | Unrecognized numeric strings never reach the native US parse | **PASS** | `1.8.26`→null (old: 8 Jan), `11. 08. 2026`→null (old: 8 Nov). Also verified the stage-3 veto holds: `August 11, 2026 11.08.2026` → Aug 11, not Nov 8 |
| 7 | RSS engine proven unaffected by test | **PASS** | `rss-engine.ts` has a zero-line diff. Guard tests cover RFC 822 and ISO for day ≤ 12 and > 12, plus an honest `DOCUMENTED LIMITATION` test pinning the out-of-scope localized-`pubDate` swap rather than hiding it |
| 8 | Production case reproduced verbatim | **PASS** | `html-engine.test.ts` drives a real HTML fixture whose `.datum` cell reads `11.08.2026` through `scrapeHtmlPreview` → which delegates to `scrapeHtmlPage` (verified: same code path, not a preview-only shortcut) → `published_at` starts `2026-08-11` |
| 9 | Repair: report-only, per-row manual approval, no auto branch | **PASS** | No bulk-apply or automatic code path exists. `--deployed-before` mandatory, `--apply` without `--id` refused, `--id` without `--apply` refused, `--id` UUID-validated, unknown options refused, apply re-validates the live row and guards the write with `.eq('published_at', <read value>)`. **See BUG-3, BUG-4, BUG-5** |
| 10 | Documented dark figure | **PASS** | `REPAIR_NOTES[0]`, printed by both `runSwapReport` and `applySwapRepair` via `printRepairNotes`, never skippable |
| 11 | Documented Bubble limitation | **PASS** | `REPAIR_NOTES[1]`, same unconditional path |
| 12 | Property-based fuzz test | **PASS** | 2000 iterations, hand-rolled mulberry32 (no new dependency), seed printed on failure and overridable via `PARSE_DATE_FUZZ_SEED`. **QA stressed it with 20 additional seeds — 0 failures.** Coverage gap noted below |
| 13 | Future-date guard: store + warn, naming source and value | **PASS** | Warns per offending article (not per batch), names source/URL/parsed value, 24 h boundary inclusive (exactly 24 h ahead stays silent), unparseable `published_at` neither warns nor crashes, article still inserted. Covered as a pure function *and* end-to-end through `runScheduledScrape` |
| 14 | Edge `08.08.2026` swap-invariant, repair must not flag | **PASS** | Parses to Aug 8; `swappedDateReading('2026-08-08…')`→`undefined`, so `evaluateSwapCandidate` can never flag it |
| 15 | Edge `13.13.2026` → fallback, no crash | **PASS** | null. Also verified: `30.02.2026`, `29.02.2026` (non-leap), `32.01.2026`, `00.01.2026`, `11.00.2026`, `00.00.0000`, `2026-13-01` → all null; `29.02.2024` → Feb 29 correctly accepted |

**15 criteria: 15 passed, 0 failed.**

### Documented edge cases

| Edge case | Result |
|---|---|
| `08.08.2026` day == month | PASS — Aug 8, never flagged by the repair |
| `13.13.2026` nonsense | PASS — null, no crash |
| Genuine future-dated article | PASS — no automatic correction path exists; the human sees both readings plus title and URL |
| Date ranges | PASS — `11.–13.08.2026` and `11.-13.08.2026` → Aug 13 (end), `11. bis 13. August 2026` → Aug 11 (start). Always inside the range, never a swap, never the scrape timestamp |
| Two dates in one string | PASS — `… 11.08.2026 \| Aktualisiert am 12.08.2026` → Aug 11 (first full date). Year preference verified: `11.08. \| Aktualisiert am 12.08.2026` → Aug 12 |
| `11.08.2026 – 14:30 Uhr` | PASS as documented — Aug 11, time dropped (implicit noon). Same for the `\|` separator variant |
| Sources with `language != de` | PASS — the pipeline takes no language input at all; correctness is format-driven by construction |
| Ambiguous `05.04.2026` | PASS — Apr 5 (day-first, the deliberate default) |

### Additional edge cases tested by QA (beyond the spec)

Fragment rejection (the most dangerous failure mode — inventing a plausible date) is solid:
`14:30 Uhr`, `2026`, `Mo.`, `Montag`, `August`, `August 2026`, `11.08.`, `Uhr`, `--`, `n/a`,
`Datum unbekannt`, `kürzlich`, `soeben` → all null. No silent invention.

Also verified clean: 2-digit year boundaries (`26`→2026, `49`→2049, `50`→1950, `99`→1999 —
consistent with the module's own `expandTwoDigitYear`), 8 time-suffix variants incl. `14.30 Uhr`
and `2:30 PM`, NBSP/U+202F/tab/newline normalization, 7 German prose wrappers, hyphen day-first
(`11-08-2026`→Aug 11, where the old parser gave Nov 8), and hostile inputs
(`11.08.2026'; DROP TABLE articles;--`, `<script>` prefix, NUL byte, RLO override, 5 KB of
leading prose) — all either parsed correctly or null, never a throw.

### Security audit (red team)

| Vector | Finding |
|---|---|
| New attack surface | **None.** Zero diff in any API route, component, `middleware.ts`, RLS policy or migration. No new endpoint, no new env var, no schema change |
| Auth / authorization bypass | **N/A** — no auth or RLS code touched. The repair tool is a local CLI, not reachable over HTTP |
| Secret handling | **PASS** — `createRepairClient()` reads `SUPABASE_SERVICE_ROLE_KEY` from env only; never logged. The banner prints only the public `NEXT_PUBLIC_SUPABASE_URL` and project ref (deliberate wrong-project guard, matching the NEWS-21 pattern) |
| Injection via scraped date cell | **PASS** — parser output is always either a machine-generated ISO string or null; no scraped text reaches a query. Supabase parameterizes the repair's UPDATE |
| ReDoS / DoS on unbounded scraped input | **PASS** — measured linear: 500 KB of densely date-like text parses in 213 ms (1 KB: 5 ms). No nested quantifiers in any of the 5 regexes. Well inside the scheduler's 30 s `JOB_TIMEOUT_MS` |
| Destructive-operation safety | **PASS** — no DELETE anywhere; UPDATE is single-row, id-pinned, re-validated, and optimistically guarded on the previously-read `published_at` so a concurrent edit errors instead of being clobbered |
| Log / terminal injection into the human-approval report | **BUG-4 (Low)** — see below |
| Data leaked to logs | Report lines print article title and URL to the operator's terminal only. Appropriate for the purpose; no credentials or user data |

### Bugs found

No **Critical** and no **High** bugs. 3 Medium, 4 Low.

---

#### BUG-1 — Medium — REGRESSION: unambiguous year-first dates lost, silently replaced by the scrape timestamp

Formats the **old** parser handled correctly now return `null`, so the article silently receives
the scrape timestamp — the same silent-wrong-date failure class this ticket exists to remove.

| Input | Old parser | New pipeline |
|---|---|---|
| `2026/08/11` | `2026-08-11T00:00:00.000Z` | **null** |
| `2026/08/11 10:30` | `2026-08-11T10:30:00.000Z` | **null** |
| `2026/8/11` | `2026-08-11T00:00:00.000Z` | **null** |
| `2026.08.11` | `2026-08-11T00:00:00.000Z` | **null** |

Cause: `ISO_8601` admits hyphens only, so these fall past stage 1; `chrono.de` does not recognize
them; stage 3 is month-token-gated. These shapes carry **no swap risk at all** (the 4-digit year
is first, so day/month order is the only remaining ambiguity and both readings were already
day-second), and `<time datetime="2026/08/11">` is a real CMS output.

Steps to reproduce: `parseScrapedDate('2026/08/11')` → `null`; the reconstructed old
`parseDate('2026/08/11')` → `2026-08-11T00:00:00.000Z`.

Priority: **fix before deploy** — it is the only true regression found, and it is in the same
"silently wrong `published_at`" category as the original defect.

---

#### BUG-2 — Medium — German month names without the ordinal dot are not parsed, and the behaviour differs per month

`8. Mai 2026` parses; `8 Mai 2026` returns null → scrape timestamp.

| Input | Result |
|---|---|
| `11 März 2026`, `8 Mai 2026`, `11 Dezember 2026`, `11 Januar 2026`, `11 Februar 2026`, `11 Juni 2026`, `11 Juli 2026`, `11 Oktober 2026`, `11 Maerz 2026` | **null** |
| `11 April 2026`, `11 August 2026`, `11 September 2026`, `11 November 2026` | correct |

The inconsistency is the real problem: the months that work do so only because their names are
*also* English tokens and reach stage 3. So the same source template silently produces correct
dates in April and wrong (scrape-timestamp) dates in March — hard to diagnose from the symptom.

Not a regression (the old parser failed these too), but it falls under AC-3's statement that
written-out German month names parse to the correct day. The mandated test cases all use the dot,
so AC-3 is formally met.

Steps to reproduce: `parseScrapedDate('11 März 2026')` → `null`, while
`parseScrapedDate('11 April 2026')` → `2026-04-11T…`.

Priority: recommended before deploy.

---

#### BUG-3 — Medium — the repair CLI's own `--deployed-before` is parsed US-month-first

`parseRepairCliArgs` validates only `!Number.isNaN(new Date(value).getTime())`, so the repair tool
for the day/month swap accepts a day/month-swapped cutoff:

| `--deployed-before=` | Interpreted as |
|---|---|
| `11.08.2026` | **2026-11-07T23:00Z** (8 November, server-local) — the exact V8 US-first reading this ticket fixes |
| `2026` | 2026-01-01T00:00Z |
| `0` | 1999-12-31T23:00Z |
| `Oct 7 2026` | accepted |

A cutoff silently in the future makes `created_at < deployedBefore` true for every row, so the
candidate set widens to include articles scraped *after* the fix — whose future dates are genuine
announcements. A human approving from that report can be led to "correct" a correct date.

Impact is bounded (report-only by default, one row per apply, each re-validated, nothing deleted)
but the validation should require a strict ISO 8601 shape. Values are also not trimmed
(`"  2026-10-07  "` is accepted and shifts by the local offset).

Steps to reproduce: `parseRepairCliArgs(['--deployed-before=11.08.2026'])` is accepted and yields
a November cutoff.

Priority: recommended before the repair run (not needed for the parser deploy itself).

---

#### BUG-4 — Low (security) — a scraped article title can forge a report line in the human-approval output

`formatCandidateLine()` interpolates the raw scraped `title` with no control-character stripping.
The tool's entire safety model is "the operator reads one line per candidate and approves ids one
at a time", and a title containing a newline produces a second, fully plausible line:

```
[Repair] id=11111111-…  Quelle="Quelle"  gescrapt=…  gespeichert=…  getauscht=…  "Harmloser Titel
[Repair] id=99999999-9999-9999-9999-999999999999  Quelle="Andere"  gescrapt=…  gespeichert=…  getauscht=…  "ERFUNDENE ZEILE"  https://evil.example"  https://quelle.de/a
```

ANSI escapes survive too (`ESC[2K` + CR overwrites the line the operator just read). Damage is
bounded: `applySwapRepair` re-validates, so a forged non-candidate id is refused with an error —
the attack misleads the operator rather than corrupting data. Requires control over a title on an
already-configured source.

Precedent for the fix exists in this codebase: NEWS-20/BUG-7 strips leading C0 controls before the
image-scheme allowlist.

Steps to reproduce: call `formatCandidateLine` with a `title` containing `\n` followed by a
`[Repair] id=…` string; the output is two lines.

Priority: fix with BUG-3 (same file, same operator-trust surface).

---

#### BUG-5 — Low — report pagination can silently skip candidates

`loadSwapCandidates` paginates with `.order('created_at', { ascending: true })` + offset
`.range(from, from + pageSize - 1)`. `created_at` is **not unique** — `insertArticles` writes in
batches of up to 100, so a batch shares one `created_at` — and Postgres does not guarantee a
stable order for ties across separate queries. A candidate sitting on a 500-row page boundary can
therefore be duplicated or, worse, **skipped and never reported**.

Only reachable above `CANDIDATE_PAGE_SIZE` (500) pre-filter rows, and the spec expects "a handful"
of candidates, so impact is low today. Fix: add a unique tiebreaker (`.order('id')`).

Steps to reproduce: not reproducible on the current data volume; identified by code inspection of
`swapped-dates.ts:207-227`.

Priority: low, but cheap to fix.

---

#### BUG-6 — Low — the midnight→noon side effect narrows the articles API `to=` filter

`GET /api/articles` applies `query.lte('published_at', to)` on the raw parameter
(`src/app/api/articles/route.ts:116`). A bare-date HTML article is now stored at 12:00 instead of
00:00, so `?to=2026-08-11` (which resolves to 00:00Z) **excludes** an article dated 11 August that
the old midnight value included. Affects NEWS-6 and the NEWS-7 feed filters.

This is the documented noon side effect meeting an existing filter that compares a date against a
timestamp; articles with a real time of day were already affected, so the class pre-exists. Belongs
with GitHub issue #2 (what a date-only string should mean), which the tech design deliberately
leaves open — the right call, but the interaction should be named in the PR text.

Priority: low; document in the PR, resolve with issue #2.

---

#### BUG-7 — Low (informational) — bare dates use 12:00 *server-local*, so a non-UTC runtime shifts the day

Measured across timezones for `11.08.2026`:

| TZ | Stored |
|---|---|
| UTC (production) | `2026-08-11T12:00:00.000Z` ✅ |
| Europe/Berlin | `2026-08-11T10:00:00.000Z` ✅ |
| America/Los_Angeles | `2026-08-11T19:00:00.000Z` ✅ |
| Asia/Tokyo | `2026-08-11T03:00:00.000Z` ✅ |
| **Pacific/Kiritimati (UTC+14)** | **`2026-08-10T22:00:00.000Z` — one day early** |

Noon gives ±12 h of headroom, so every realistic deployment is safe and Vercel runs UTC. Recorded
so the implicit "production is UTC" assumption is a stated precondition rather than luck.

Priority: informational — no code change requested; worth a line in the deployment notes.

### Fuzz-test coverage gap (not a bug — a note for whoever fixes BUG-1/BUG-2)

The property test is genuinely effective (clean across 21 seeds, 2000 iterations each), but its
generated space is narrower than the spec's "supported shapes": it renders only `DD.MM.YYYY`,
`D.M.YYYY`, `DD.MM.YY`, `DD/MM/YYYY`, `D. Monat YYYY` and `D. Mon. YYYY`. It does **not** generate
the dotless month form (BUG-2), any year-first form (BUG-1), hyphen separators, weekday prefixes
without a comma, or 2-digit years ≥ 50 (excluded on purpose, with a comment). Both Medium bugs sit
exactly in that blind spot — adding the two shapes to the generator would have caught them and
would keep them caught.

### Cross-browser and responsive testing

**Not executed — and it is not applicable to this change.** The branch has a zero-line diff in
`src/components/**`, `src/app/**`, `middleware.ts` and the Tailwind config; nothing renders
differently by construction. No browser automation is available in this QA environment, so rather
than claim coverage: the two surfaces where a user *sees* a parsed date are the wizard/scrape
preview (`step-preview.tsx`) and the relative-time line on `article-card.tsx:122`, both of which
only display `published_at` and are unchanged. The spec itself names the wizard preview as the
useful manual verification point — recommended as a 2-minute post-deploy spot check at 375 px /
768 px / 1440 px on one German HTML source, confirming the preview shows the literal date.

### Regression testing (features with status "Deployed")

| Feature | Result |
|---|---|
| NEWS-3 RSS engine | PASS — `rss-engine.ts` zero diff; 30 tests pass incl. new guard tests |
| NEWS-4 HTML engine | PASS — `parseDate` still exported with a compatible signature (new `refDate` is optional); call site unchanged; 405-test suite green |
| NEWS-5 Scheduler & dedup | PASS — guard added before `insertArticles` warns only, never filters; dedup, budget, `resolveScrapeStatus` untouched and tested |
| NEWS-6 News REST API / NEWS-7 Dashboard | PASS, one caveat — no code diff; see BUG-6 for the `to=` filter interaction |
| NEWS-12 Retention | PASS — deletes by age; the ≤12 h noon/midnight shift is immaterial. Future-dated rows were retention-immune; the fix removes the cause and the guard now surfaces new ones |
| NEWS-19 Bubble sync | PASS — `mapping.test.ts` green; "Date publishing" now receives the correct day for new records. Create-only limitation unchanged and documented in `REPAIR_NOTES[1]` |
| NEWS-20 Image URL hardening / NEWS-21 Image fallback | PASS — untouched; `og-image-fallback` and scheduler image tests green |
| NEWS-1/2/8/9/14/15/16/17/18 | PASS — no diff in any route, component or policy; build green |

### Production-ready recommendation

**Per the project rule (no Critical or High bugs): READY.**

**QA recommendation: fix BUG-1 first.** It is the one genuine regression — four unambiguous
year-first formats that worked on `main` now silently fall back to the scrape timestamp, which is
the same wrong-date-nobody-notices failure mode this ticket was opened to eliminate. Shipping the
fix while reintroducing a narrower version of the symptom would be a poor trade. BUG-2 and BUG-3
are recommended in the same pass; BUG-4 through BUG-7 can follow or be accepted as documented.

The core of the work is strong: the five-stage ordering is correct and well justified, fragment
rejection (the most dangerous failure mode) is airtight, the calendar-rollover guard catches a trap
the old code silently passed, the repair tool's refusal rules and apply-time re-validation are
exactly right, and the fuzz test held across 21 seeds.

### Post-QA fixes (CTO addendum, 2026-10-07)

All QA findings were fixed on the same branch before the PR left draft state, each pinned by
tests (total suite 405 → 413):
- **BUG-1** (regression, year-first `2026/08/11` / `2026.08.11`): new stage-1 branch with
  calendar validation; good and bad cases pinned.
- **BUG-2** (dotless German month names): stage-0 normalization — `11 März 2026` and
  `11 April 2026` now parse consistently; non-month counter-case pinned.
- **BUG-3** (repair CLI accepted `11.08.2026` for `--deployed-before`, US-reading it):
  strict ISO-only validation, every reported bad case pinned individually.
- **BUG-4** (control characters in titles could forge report lines): all C0+DEL flattened.
- **BUG-5** (pagination tiebreaker): `.order('id')` added.
- **BUG-6/7** and the code-review notes L1/L2: documented in the module docstrings.

## Deployment

**Shipped 2026-10-07 (PR #32), stored data repaired the same day. Timeline:**

- **2026-10-07:** merged and auto-deployed via Vercel. The five-stage parse pipeline and the
  future-date guard have been live since; every new article parses German dates day-first,
  and any parsed date more than 24 h in the future surfaces as a log warning.
- **2026-10-07 — repair round (per-row manual approval, as specced):** the operator exported
  the candidate set from production (30 rows). 16 of them were noon-semantics false alarms
  (stored day > 12 — the repair predicate excludes them; their dates are correct). The
  remaining **14 genuine swap victims** (all source ZWP: 1× Dec 8 → Aug 12, 5× Nov 8 →
  Aug 11, 1× Oct 9 → Sep 10, 7× Oct 8 → Aug 10) were approved **individually by the
  operator** ("alle 14 freigeben") and corrected via operator-executed SQL — one guarded
  single-row UPDATE each, pinned to the stored wrong value, nothing deleted. Verification
  query afterwards: **0 remaining swaps**. Supporting argument recorded for the approval:
  the old parser could only have produced these stored values from swapped German input,
  and every corrected date lands shortly before its article's `created_at`.
- **Process note:** the tested repair CLI (`npm run repair:dates`) exists and is the
  documented tool; for this production run the operator-executed-SQL path was chosen
  deliberately, per the team rule that only the operator writes to the production database.
  The CLI's predicate and the SQL used the identical candidate criteria.
- **Known, documented limitation:** the 14 corrected articles keep their wrong
  "Date publishing" in Bubble Live (create-only sync) until the PATCH follow-up ticket
  noted in NEWS-21 exists. Supabase ordering, date filters and retention are correct as of
  this repair.

### Addendum — the dark figure turned out findable after all (2026-10-07)

The documented dark figure (swaps landing in the past are unidentifiable from the date
fields) surfaced in production the day after deploy: an article published 01.10. showed
"January 10" in Bubble — scraped pre-fix, its swapped value lay in the past, invisible to
the future-date net. The accepted-as-unfindable class was then recovered by a better
method than the one the spec had ruled on: **re-fetching every pre-fix article page and
re-reading its date with the fixed parser**, turning the missing raw string into ground
truth from the source itself.

- **Sweep scope:** every pre-fix article of the three `selector_date` HTML sources (ZWP,
  ZM-online, Haufe) from a full table export — each page fetched read-only, its
  `datePublished` compared against the stored day.
- **Result:** ~90 confirmed correct (including the first 14 repairs), **53 deviations
  corrected** — each approved by the operator via the evidence-annotated SQL (page value
  quoted per row, single-row guarded updates) and executed by the operator. 2 pages were
  deleted upstream (404, one a source-side lorem-ipsum test article) and stay unverified.
- **Notable:** Haufe had carried swaps since **2012–2024** (e.g. stored 04.06.2012, page
  says 04.04. read day-first) — past-dated from day one and structurally invisible until
  the page sweep. Three further deviations were source-side republications, not swaps;
  the page value was adopted as truth.
- **Bubble:** after the corrections the operator wiped Bubble Live and re-synced in full.
  Verified afterwards: 258 records, 0 without picture, **0 future-dated**, spot check
  confirms the triggering article now reads 2026-10-01 — matching its source page. The
  earlier Bubble limitation note is thereby resolved for dates (the full re-sync carried
  the corrected values); it still applies to any future in-place corrections until the
  PATCH ticket exists.
- **Lesson recorded:** "report-only because unfindable" was a spec decision made before a
  cheaper ground-truth source (the live page) was considered. Future repair tickets should
  weigh re-fetching the source before accepting a dark figure.
