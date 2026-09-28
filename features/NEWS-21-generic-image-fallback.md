# NEWS-21: Generic Image Fallback (og:image / twitter:image) in the Scraping Scheduler

## Status: In Progress
**Created:** 2026-09-28
**Last Updated:** 2026-09-28 (review round 4: budget-clipped articles are recovered only by
the backfill script, budget wording covers both entry points; round 3: Bubble re-sync + env
guard, budget at every entry point, redirect/base-URL wording, HTML fixture, dedup defect noted)

## Dependencies
- Builds on NEWS-20 (`src/lib/image-url.ts` — `isUsableImageUrl()`, `pickImageUrl()`, `normalizeImageUrl()`). Reused, not replaced.
- Affects NEWS-5 (Scraping Scheduler) — the fallback is hooked in there, post-deduplication.
- Covers articles from NEWS-3 (RSS engine) and NEWS-4 (HTML engine) alike, but changes neither engine (see review correction 2a).
- **Known pre-existing defect, tracked separately (review correction 3C):** `deduplicateArticles()`
  queries `.in('url', urlsToCheck)` with lower-cased URLs against the raw, case-sensitive `url`
  column (`scheduler.ts:323-326`), while the unique index is on `lower(url)`
  (migration `20260727172338:334`). The in-code comment "to match the LOWER(url) index" is wrong —
  `url IN (...)` does not lower the column. Any stored article whose URL contains an uppercase
  character is therefore never recognised as a duplicate, lands in `newArticles` on every run,
  and is only stopped by the `23505` unique-violation at insert time. With this ticket's fallback
  that would mean one page fetch per run per affected image-less article, forever — the same trap
  as review correction 2a, reached through the dedup bug instead of the hook point.
  **Measured impact today: nil for this ticket.** The source that triggers the defect is
  `dentalmarketing-magazin` (URLs such as `?rubric=Medien` carry uppercase) and it has working
  images, so no fallback fires; the two image-less sources use all-lowercase URLs. It therefore
  does **not** block NEWS-21, but it must be fixed before a source with mixed-case URLs and no
  image appears. Related: on a dedup query error the function returns *every* article as new
  (`scheduler.ts:328-332`), which would fire the fallback for the whole feed window, bounded only
  by the run-wide budget.
- Feeds NEWS-22 (source-wizard image diagnostics), which surfaces the outcome of this fallback at source-creation time. NEWS-22 depends on this ticket; this ticket does not depend on NEWS-22.

## Background

~50 articles from 2 of 6 sources (`mgb-dental`, `dental-tribune`, both RSS) arrive without
`image_url` and are therefore missing their picture in Bubble. Root cause: `extractImageUrl()`
in `src/lib/scraping/rss-engine.ts` only reads `media:content`, `media:thumbnail`, and
`enclosure`; the two feeds carry none of these.

Live-checked facts this spec is based on (see ticket description for the full table):
- `mgb-dental.de/feed/`: no media/enclosure tags, but a first `<img>` in `content` that is the
  site logo, not the article image — **not** a safe source of truth.
- `de.dental-tribune.com/news/feed/`: no media/enclosure tags and no `<img>` in content at all —
  nothing usable is in the feed, full stop.
- `og:image` is present on the article page for 5 of 6 sources. The 6th (`dentalmarketing-magazin`)
  is an older PHP site with no Open Graph tags.

## Independent Review of the Proposed Approach

**Verdict: the direction (shared last-resort fetch of the article page, same engine-agnostic
fallback for HTML and RSS) is right. Two changes to the proposal below.**

**1. `og:image` alone is not enough — add `twitter:image` as a second in-page fallback, skip
the "largest `<img>` in the article container" idea.**

- `og:image` and `twitter:image` are read from the exact same already-fetched HTML in the exact
  same way (one `cheerio.load()`, one `$('meta[property="og:image"]')` / `$('meta[name="twitter:image"]')`
  lookup). The marginal cost of also trying `twitter:image` is a few lines and ~0ms — there's no
  reason not to take it, since some sites publish only a Twitter Card and no Open Graph.
- **JSON-LD `image`** (schema.org `NewsArticle`/`Article`) is the next logical rung, but it adds
  real parsing surface (the `image` property can be a string, an array of strings, or an
  `ImageObject`) for value it doesn't have here: this spec is about the 2 sources actually
  affected, and both expose `og:image` per the live check. I'd only add JSON-LD if a future
  source lacks both meta tags — building it speculatively now is scope creep against the
  "generic, not per-source" goal, not in service of it. **Recommendation: record it in this
  ticket's acceptance criteria as a documented "not implemented, add if a real source needs it"
  note, not as code.**
- **"Largest `<img>` in the article container" should be rejected outright**, not just deferred.
  It requires a `selector_container`/article-body heuristic per source (which is exactly the
  per-source special-casing the requester explicitly ruled out), has no reliable way to
  distinguish a hero image from an inline chart or an ad creative, and turns a 10-line meta-tag
  lookup into a layout-sniffing heuristic. It doesn't belong in a "generic system" — it belongs
  in a per-source selector, which sources already have (`selector_image`) for exactly this
  reason when it's worth configuring.

So the fallback chain is:
```
HTML engine: selector_image  ─┐
RSS engine:  media:*/enclosure ┴→ (unusable/absent?) → [scheduler, post-dedup]
                                   → og:image → twitter:image
```
Both meta tags are read from a single fetch of the article page; `og:image` wins if both are
present. The engines are unchanged in *what* they extract — they simply leave `image_url: null`
as they do today, and the scheduler fills the gap for the articles it is about to insert.

**2. The "fetch every image-less article's page" design needs explicit limits before it ships,
not as an afterthought.** See Edge Cases and Technical Requirements below — this is the part of
the proposal that most needed scrutiny and is now spelled out: per-request timeout, one page
fetch per article (not per fallback step), a `robots.txt`-independent but polite fixed delay is
unnecessary at this volume (~10–20/day) but a run-wide time budget is not.

**2a. Review correction — the fallback belongs in the scheduler, not in the two engines.**
The first draft of this spec hung the fallback inside `rss-engine.ts` and `html-engine.ts`.
That was wrong, and the volume estimate it produced was off by roughly two orders of magnitude:

- `scrapeSource()` deduplicates against the database only in **step 3**
  (`src/lib/scraping/scheduler.ts:186`), *after* the engine has already extracted every item
  in the feed/page window. A fallback inside an engine therefore fires for every image-less
  item on every run — including the ones that have been in the database for weeks.
- Both affected feeds carry ~10 items and the cron runs every 15 minutes
  (`vercel.json`), so the real figure is ≈ 20 × 96 ≈ **1,900 requests/day** against two
  third-party servers, for data already stored. Not 10–20.
- The engines also run under a per-source `JOB_TIMEOUT_MS = 30_000`
  (`src/lib/scraping/scheduler.ts:9`). The ~35s worst case the first draft budgeted would not
  even have survived that timeout — the fallback would have killed the source's own scrape
  before it ever reached the 60s function limit.

**Corrected hook point: once in `scrapeSource()`, between step 3 (deduplicate) and step 4
(insert) — applied only to `newArticles`.** The fallback then fires only for genuine new
arrivals, which restores the ~10–20/day estimate, and it gives one shared code path instead of
two hook points — closer to the "generic system" requirement than the per-engine version was.
Consequence for NEWS-22: the wizard preview does **not** go through the scheduler, so the
preview path must call the shared helper directly (noted in that spec).

**2b. Review correction — the cap must be run-wide, not per source.** The first draft capped
"20 fallback fetches per source per run" and deferred the `maxDuration` check to implementation.
Checked: `maxDuration = 60` (`src/app/api/cron/scrape/route.ts:5`) covers the **whole** run, and
`scheduler.ts:77` awaits every due source sequentially in a single invocation. A per-source
budget of ~35s blows the window at two affected sources (70s) and reaches 200s+ at six — the
function would be killed mid-run. The limit is therefore a **run-wide time budget**: past a
fixed elapsed-time mark, no further fallback fetches are started and the remaining articles
are simply inserted without an image. Once inserted they are excluded by dedup on every later
run, so the fallback never revisits them — the backfill script is the only path that fills them
afterwards (review round 4). Correction 2a makes this a backstop rather than a routine
constraint, but it must exist so the cron run cannot die of image fetching.

**3. Split into two tickets (NEWS-21 + NEWS-22).** The scraping-engine fallback and the source
wizard's create-time preview are testable and deployable independently, and they touch different
layers (scraping library vs. wizard UI) — combining them would violate the single-feature-per-spec
rule. NEWS-22 depends on NEWS-21 (it displays this fallback's outcome) but can be built, reviewed
and shipped separately.

**4. Backfill: script over delete+rescrape.** The scheduler uses `insert` (not `upsert`) keyed on
a unique `url` constraint (`src/lib/scraping/scheduler.ts:387`), so already-stored articles are
silently skipped on the next run — they never get a second chance at gaining an image. Two options
were on the table:
  - *Delete affected rows and let the scheduler re-insert them* — cheap to implement, but any
    article that has since scrolled out of the source's current feed/page window (RSS feeds
    and HTML lists both only expose recent items) is gone for good. That's real, uncontrolled
    data loss for a formatting bugfix, not an acceptable trade-off.
  - *Targeted backfill script* — for each article currently missing an `image_url` (not just
    from the 2 known sources — any source, so it also cleans up nulls that predate this fix
    for any reason), refetch only the article's own page, run it through the same fallback
    chain, and `UPDATE` `image_url` if a usable one was found. Nothing is deleted; sources that
    already have an image are untouched. This is the only option that doesn't trade data
    integrity for convenience — it belongs in this ticket's acceptance criteria as a one-off
    script (`scripts/`), not as a permanent code path or a change to `insertArticles`'s
    insert-only dedup semantics (out of scope here, and NEWS-19/20 already depend on the
    current dedup behavior).

## User Stories
- As an editor, I want articles from sources without RSS media tags to still get a picture in
  Bubble, so that the frontend doesn't show a blank card.
- As an operator, I want image extraction to work the same way for every new source I add
  (RSS or HTML), without writing source-specific code, so that onboarding a new source doesn't
  require a scraper change.
- As an operator, I want the extra page fetch to only happen when it's actually needed (i.e.
  the primary selector/RSS field produced nothing usable), so that sources with working image
  extraction see no behavior change and no added load.
- As an operator, I want a source whose article pages have no `og:image`/`twitter:image` either
  (like `dentalmarketing-magazin`) to keep scraping normally, just without a picture, exactly
  like today.

## Acceptance Criteria
- [ ] A new shared helper (e.g. `src/lib/scraping/og-image-fallback.ts`) fetches the article
      page and returns the first usable value from `og:image`, then `twitter:image`. It reuses
      `isUsableImageUrl()` / `normalizeImageUrl()` from `src/lib/image-url.ts` — a placeholder
      or non-http(s) meta value is rejected exactly like a bad `src` attribute is today.
- [ ] The fallback is invoked **once, in `scrapeSource()` between step 3 (deduplicate) and step 4
      (insert)**, for the articles in `newArticles` whose `image_url` is null — using each
      article's own (absolute) URL, not the feed/listing URL. `rss-engine.ts` and
      `html-engine.ts` are **not** modified to fetch pages themselves.
- [ ] Articles that already exist in the database trigger **zero** fallback fetches: a test
      asserts that a run in which every scraped article is filtered out by `deduplicateArticles`
      performs no fallback HTTP request at all. (This is the regression guard for the
      ~1,900-requests/day defect described in review correction 2a.)
- [ ] The fallback is purely a last resort: a source with a working `selector_image` or RSS
      media field causes zero additional HTTP requests (verified in a test that asserts the
      fallback fetch function is not called when the primary path already produced an image).
- [ ] A run-wide time budget guards the cron window: once the elapsed time of the whole
      scheduled run passes a fixed mark, no further fallback fetches are started; the remaining
      new articles are inserted with `image_url: null` and no error. A test asserts that
      exceeding the budget skips fetches rather than failing the run or dropping articles.
- [ ] **The budget is created at every entry point, not only the cron one (review correction
      3D).** `scrapeSourceById()` (`scheduler.ts:120`) reaches `scrapeSource()` without passing
      through `runScheduledScrape()`, and its route also declares `maxDuration = 60`
      (`src/app/api/sources/[id]/scrape/route.ts:6`). An unbudgeted manual trigger is the *more*
      dangerous path, because triggering a scrape by hand is the normal way to test a source the
      operator just added — the first run of a new source is exactly the case with the most
      image-less articles. Both `runScheduledScrape()` and `scrapeSourceById()` therefore create
      a budget context and pass it into `scrapeSource()`; a test covers the manual path too.
- [ ] **Why this is mandatory rather than nice-to-have**: `releaseLock()` runs in a `finally`
      block (`scheduler.ts:213-215`), and a hard Vercel timeout kill does not run `finally`.
      `acquireLock()` only grants the lock when `scraping_in_progress = false` and there is no
      stale-lock recovery anywhere in the codebase, so a run killed during the fallback phase
      leaves the source **permanently locked** until someone edits the database by hand. A test
      asserts the budget is enforced before any fetch is started, not merely honoured between
      fetches.
- [ ] `mgb-dental` and `dental-tribune` (or an equivalent fixture of their real feed/page HTML)
      produce a usable `image_url` after this change, verified with a scrape run against
      recorded fixtures, not the live site.
- [ ] **HTML-path fixture (review correction, Q7).** A fixture source of `type: html` with
      `selector_image` absent (or matching nothing) produces a usable `image_url` via the
      fallback. Without this the fixtures only prove the RSS half, and the "engine-agnostic"
      claim is untested for the engine that most new sources use.
- [ ] A source whose article pages have no `og:image`/`twitter:image` (fixture modeled on
      `dentalmarketing-magazin`) completes the scrape with `image_url: null` and no error —
      exactly today's behavior for a source with no usable image, not a new failure mode.
- [ ] Result plumbing: `ScrapeResult`/scheduler logging distinguishes "image found via
      selector/RSS field" vs. "image found via page fallback" only to the extent needed for
      NEWS-22's diagnostics (see that spec) — no new required field on `NormalizedArticle`.
- [ ] One-off backfill script (`scripts/backfill-missing-images.ts` or similar) that: selects
      articles with `image_url IS NULL`, refetches each article's own page (not the source feed),
      runs the same fallback chain, and updates `image_url` where a usable value was found.
      Dry-run mode by default (prints what would change); a `--apply` flag performs the update.
      Existing articles with a non-null `image_url` are never touched. The script is re-runnable
      and is the **standing recovery path** whenever the run-wide budget left newly inserted
      articles imageless (review round 4) — not only a one-off post-deploy step, because an
      article inserted without an image is never revisited by the scheduler's fallback.
- [ ] Running the backfill script against the current ~50 affected + any other pre-existing
      null-image articles is documented as a manual post-deploy step (not itself part of the
      cron pipeline).
- [ ] **Re-sync step (review correction 3A).** Filling `image_url` in Supabase does *not* update
      Bubble: `src/lib/bubble/client.ts` exports only `bulkCreate` (`method: 'POST'`) — there is
      no PATCH/update path — and `loadUnsyncedArticles()` (`sync.ts:118`) only ever selects
      `bubble_synced_at IS NULL`. Articles already stamped therefore keep their blank picture in
      Bubble forever. The backfill script gains a second, separately invoked `--resync` step that
      clears `bubble_synced_at` and `bubble_id` for exactly the rows it filled, so the next
      scheduled sync re-creates them **with** the image.
- [ ] **Hard environment guard on `--resync`.** Re-creating already-synced records is only safe
      because the stale Bubble records are deleted first; run against a Bubble database where
      they are not, it produces duplicates. The script therefore MUST read the Bubble config it
      would be re-syncing into and **abort unless `BUBBLE_USE_TEST_VERSION === 'true'`** (the
      `/version-test` development database — see `client.ts:59`). No flag may override this; a
      production re-sync needs the PATCH path instead (see the follow-up ticket below).
- [ ] **List-before-reset procedure** documented in this spec and printed by the script: (1) run
      the backfill in dry-run, (2) `--apply` to fill `image_url`, (3) `--resync --list` prints the
      affected `bubble_id`s so the operator can delete exactly those records in Bubble, (4)
      operator deletes them in the Bubble development database, (5) `--resync --apply` clears the
      stamps, (6) the next scheduled sync (06:00 UTC) re-creates them with images. Step 4 is
      manual and deliberately not automated — nothing in this codebase deletes Bubble records.
- [ ] **Documented assumption**: this delete-and-recreate route is valid *only while the sync
      target is the Bubble development database*. A follow-up ticket (Bubble record update via
      `PATCH /obj/{type}/{bubble_id}`) is required before any production Bubble target exists;
      NEWS-19 showed how much care Bubble's responses need, so a second write path is its own
      ticket, not a side-effect of a backfill script.

## Edge Cases
- **Article page is unreachable, times out, or returns non-200**: the article is still scraped
  and stored with `image_url: null` — a failed fallback fetch must never fail the whole article
  or the whole source run. Logged as a warning, not an error (same severity class as "no image
  found" today).
- **Fallback fetch is slow**: capped at a fixed 5s timeout per page. Because the fallback runs
  in the scheduler *after* the engine call, it sits outside the per-source
  `JOB_TIMEOUT_MS = 30_000` (`scheduler.ts:9`) — it can no longer abort a source's own scrape,
  which the per-engine placement would have done.
- **Many image-less articles in one run**: fallback fetches are limited by a small concurrency
  (e.g. 3 in flight) and, decisively, by the **run-wide time budget** — not by a per-source
  count. A newly added source whose first run brings 100 image-less articles therefore fetches
  what fits in the budget and leaves the rest at `image_url: null`; **only the backfill script
  can close that gap afterwards** (review round 4) — once inserted, those articles are excluded
  by dedup on every later run, so the fallback never revisits them. This ordering matters:
  a per-source count cap would still allow 6 sources × 20 fetches to overrun the 60s function
  limit.
- **Backlog after a deploy or an outage**: the first run after this ships may see an unusually
  large `newArticles` set. The run-wide budget bounds it; nothing fails, articles are inserted
  either way, and the backfill script exists precisely for the remainder.
- **`og:image` present but relative or scheme-invalid** (e.g. `//cdn/x.jpg`, a `data:` URI, a
  bare path): resolved against **the article page's own full URL**, then run through
  `isUsableImageUrl()` — a bad value is discarded, not stored. Note the wording correction
  (review 3E): this is deliberately *not* "the same way `html-engine.ts` does it".
  `html-engine.ts:224` resolves against `baseUrl.origin`, which drops the path and therefore
  resolves a path-relative value wrongly; for a meta tag read off a specific article page the
  full article URL is the correct base.
- **`og:image` points at a tracking pixel / 1×1 placeholder**: out of scope. `isUsableImageUrl()`
  checks the URL's *scheme*, not the image's dimensions — no existing source has demonstrated
  this problem, and fetching + decoding every fallback image to check pixel dimensions is a much
  bigger cost than this ticket's problem justifies. Revisit only if a real source hits it.
- **Source's article pages require auth / are behind a paywall / block the scraper's User-Agent**:
  fallback fetch fails or returns a page without the meta tags → `image_url: null`, same as "no
  `og:image`" above. No special-casing.
- **Backfill script runs while the cron scraper is also running**: the script only ever sets
  `image_url` on an existing row by `id`/`url`; it never inserts or deletes, so it cannot race
  the scheduler's insert-only dedup path. Running it a second time is a no-op for rows it already
  filled in (idempotent: it always re-checks `image_url IS NULL` before writing, so a completed
  row is simply skipped, not re-fetched).

## Technical Requirements
- Fallback fetch: 5s timeout; same `User-Agent` string as the primary fetch
  (`Newsgrap3r/1.0 (+https://github.com/newsgrap3r)`) — no separate identity needed, and reusing
  it means no extra allowlisting on the source side.
- **Redirects (review correction 3E): do not claim `MAX_REDIRECTS = 3`.** The constant exists in
  `html-engine.ts:11` but is *not enforced* there — the code comment at `:273-275` states plainly
  that native `fetch` follows up to 20 redirects and that a manual redirect loop is out of scope.
  Only the RSS engine enforces it, via an `rss-parser` option. The fallback helper copies the
  HTML engine's fetch path, so it inherits `fetch`'s default redirect behaviour. Document that
  honestly rather than promising a limit the code does not apply; implementing a real redirect
  cap is a separate change to `html-engine.ts` and out of scope here.
- Response size cap: reuse or match the HTML engine's existing 5 MB cap — the fallback only needs
  the `<head>`, but capping the read is simpler and safer than trying to short-circuit after
  `</head>`.
- No caching layer for this ticket: at ~10–20 fallback fetches/day the added request volume is
  negligible, and a cache adds staleness/invalidation questions (an article's `og:image` changing
  after publish) that aren't worth solving for this volume. Revisit if a source's real fallback
  volume turns out far higher than estimated.
- No dedicated rate limiting beyond the concurrency/per-run caps above — polite behavior here is
  "small number of sequential-ish requests to sites we already scrape every 15 minutes," not a
  new class of traffic that needs its own throttle.
- Vercel function limits (checked, not deferred): `maxDuration = 60`
  (`src/app/api/cron/scrape/route.ts:5`) applies to the entire run, and `scheduler.ts:77`
  processes all due sources sequentially in one invocation. The fallback budget must therefore
  be **run-wide elapsed time**, measured from the start of the entry point —
  `runScheduledScrape()` or `scrapeSourceById()`, see the budget acceptance criteria (review
  round 4: naming only the cron entry point here contradicted criterion 3D) — suggested
  ~20s, leaving the remaining ~40s for the scrapes and database work that the run cannot skip.
  A per-source budget is explicitly rejected: at 6 sources it would permit 200s+ inside a 60s
  window.
- Expected steady-state volume at the corrected hook point: ~10–20 fallback fetches per **day**
  across all sources (one per newly inserted image-less article), not per run.

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

> Architecture only — no code. The spec above (frozen after four review rounds) is the
> requirement; this section maps it onto modules, responsibilities, data flow, tests and
> build order. Where the spec pins a decision (hook point, run-wide budget, no engine
> changes, no redirect promise, resync guard), this design repeats it as a constraint
> rather than re-deciding it.

### What gets built, in one paragraph

One new library module extracts a fallback image (`og:image`, then `twitter:image`) from
an article's own page with a single bounded fetch. One new tiny module represents the
run-wide time budget. The scheduler calls the fallback exactly once per run *per source*,
between deduplication (step 3) and insert (step 4), only for `newArticles` whose
`image_url` is null, and only while the budget — created at **both** entry points — has
time left. A backfill script (testable core in `src/lib/`, thin CLI in `scripts/`)
repairs existing and budget-clipped null-image rows and, as a separately invoked step,
resets the Bubble sync stamps for exactly the rows it filled — guarded so it can never
run against a non-test Bubble target. No UI, no schema change, no engine change.

### New and changed files

| File | New/Changed | Responsibility |
|------|-------------|----------------|
| `src/lib/scraping/og-image-fallback.ts` | **New** | The shared fallback helper: fetch one article page, read `og:image` → `twitter:image`, validate/normalize, resolve relative values against the full article URL. Plus the batch orchestrator that applies it to a list of articles under a budget with small concurrency. No Supabase dependency — reusable by the scheduler, by NEWS-22's preview path, and by the backfill core. |
| `src/lib/scraping/run-budget.ts` | **New** | The run-wide time budget: created once per run at an entry point, answers "is there budget left?". Isolated so budget semantics are unit-testable without the scheduler. |
| `src/lib/scraping/scheduler.ts` | **Changed** | Creates the budget in `runScheduledScrape()` (once, before the source loop — the budget spans all sources of the run) and in `scrapeSourceById()`; passes it into `scrapeSource()`; invokes the fallback orchestrator between step 3 and step 4; counts fallback results for logging. |
| `src/lib/backfill/missing-images.ts` | **New** | Testable core of the backfill: select null-image articles, run them through the shared helper, dry-run/apply semantics, journal of filled rows, resync-stamp clearing with the hard environment guard. |
| `scripts/backfill-missing-images.ts` | **New** | Thin CLI wrapper: flag parsing (`--apply`, `--resync`, `--list`), env loading from `.env.local`, prints the six-step procedure, delegates everything else to the core module. Follows the journal/dry-run precedent of `scripts/backfill-bubble-synced.mjs`. |
| `src/lib/scraping/og-image-fallback.test.ts`, `run-budget.test.ts`, additions to `scheduler.test.ts`, `src/lib/backfill/missing-images.test.ts` | **New** | See test strategy below. |
| `package.json` | **Changed** | New npm script for the backfill; `tsx` as devDependency so the CLI can execute TypeScript and therefore *reuse* the shared helper instead of duplicating it (decision point — see below). |

Deliberately **unchanged**: `rss-engine.ts`, `html-engine.ts` (spec correction 2a),
`deduplicateArticles()` (known case-sensitivity defect is tracked separately and neither
relied upon nor fixed here), `insertArticles()` insert-only semantics, both API routes
(`maxDuration` stays 60; the budget lives in the scheduler functions, which *are* the two
entry points named by the spec), `src/lib/image-url.ts` (reused as-is), `vercel.json`,
`NormalizedArticle` (no new required field), Bubble client/sync (no PATCH path — that is
the documented follow-up ticket).

### Module responsibilities and signatures (described, not coded)

**`og-image-fallback.ts`** exposes two functions:

1. *Single-page extraction* — takes an absolute article URL, returns a usable image URL
   or null (as a promise). Behavior contract:
   - Exactly **one** fetch per article, serving both meta-tag lookups (`og:image` wins
     over `twitter:image` when both exist).
   - 5s timeout via abort, 5 MB response cap (same guard style as `html-engine.ts`'s
     `fetchHtml`, including the content-length early abort and streamed-read cap), same
     `User-Agent` (`Newsgrap3r/1.0 (+https://github.com/newsgrap3r)`), `Accept: text/html`.
   - Redirects: **no cap is promised or implemented** — native fetch's default
     (up to 20 redirects) applies; the module documents this explicitly, mirroring the
     honest comment in `html-engine.ts:273-275` (spec correction 3E).
   - Candidate values run through `isUsableImageUrl()` / `normalizeImageUrl()` from
     `src/lib/image-url.ts` — a placeholder, `data:` or non-http(s) value is rejected
     exactly like a bad `src` today.
   - Relative/scheme-relative values are resolved against **the full article URL**, not
     the origin — the deliberate, spec-mandated deviation from `html-engine.ts:224`.
   - **Never throws.** Timeout, non-200, network error, oversized body, unparsable HTML,
     no meta tags → null, plus one `console.warn` line. Failures are *not* pushed into
     the scheduler's `result.errors`, so they cannot surface as `last_scrape_warning` —
     the spec classes them with today's silent "no image found", not with skip warnings.

2. *Batch orchestration* — takes the list of new articles, the run budget, and returns
   how many images it filled (mutating/returning the articles' `image_url`). Behavior:
   - Selects only articles with `image_url` null; articles with an image are never
     touched and cause zero requests.
   - Checks the budget **before starting every fetch, including the very first** — this
     is the acceptance criterion protecting the un-`finally`-able `releaseLock()` path.
     Once the budget is exhausted, remaining articles are left at null silently.
   - Small fixed concurrency (3 in flight) so a burst of image-less articles doesn't
     serialize into the budget nor stampede a host.

**`run-budget.ts`** exposes a factory that captures a start time and a fixed allowance
(suggested constant: 20 000 ms, per the spec's ~20s recommendation) and returns an object
answering "has time left?". Nothing else — no timers, no callbacks. Both entry points
construct it; `scrapeSource()` receives it as a required context parameter and hands it
to the orchestrator. In `runScheduledScrape()` it is created **once before the source
loop**, so the budget is genuinely run-wide across all sequentially processed sources;
in `scrapeSourceById()` it is created per invocation (a manual trigger *is* the whole
run there).

**`scheduler.ts` changes**, kept minimal:
- `scrapeSource()` gains the budget context parameter; between step 3 and step 4 it calls
  the orchestrator for `newArticles`. That is the only new step in the pipeline.
- `SchedulerResult` gains one optional numeric field (count of images filled via
  fallback) and the per-source log line reports it — the minimal plumbing the spec
  allows for NEWS-22's diagnostics. `ScrapeResult` and the engines' outputs are untouched;
  NEWS-22's wizard preview will call the extraction function directly.

**`backfill/missing-images.ts` core** (CLI-independent, mockable Supabase client and
fetch injected or module-mocked in tests):
- *Fill phase* (default dry-run): pages through `articles` with `image_url IS NULL`
  (all sources, not just the two known ones), runs each article's own URL through the
  shared single-page extraction, and — only with `--apply` — updates `image_url` for
  usable finds. Re-checks `image_url IS NULL` immediately before each write, so reruns
  are idempotent and rows never regress from non-null. It never inserts or deletes, so
  it cannot race the scheduler's insert-only dedup.
- *Journal*: every `--apply` writes a journal file (pattern proven by
  `scripts/backfill-bubble-synced.mjs`) recording the ids, `bubble_id`s and
  `bubble_synced_at` state of exactly the rows it filled. The journal is what gives
  `--resync` its spec-required "exactly the rows it filled" scope — there is no database
  marker that could.
- *Resync phase* (separately invoked): reads the journal; `--resync --list` prints the
  `bubble_id`s of filled rows that carry a sync stamp (rows never synced need no resync);
  `--resync --apply` clears `bubble_synced_at` and `bubble_id` for those rows so the next
  06:00 UTC sync re-creates them with images.
- *Hard environment guard*: any `--resync` action first reads the Bubble config
  (`getBubbleConfig()` semantics) and **aborts unless `BUBBLE_USE_TEST_VERSION === 'true'`**.
  No flag overrides this — deliberately stricter than the `--confirm-test-target` pattern
  of the NEWS-19 script, because here the *test* target is the only permitted one.
- The CLI prints the six-step procedure from the spec (dry-run → `--apply` →
  `--resync --list` → manual Bubble deletion → `--resync --apply` → next scheduled sync)
  on every run, and this spec documents running the fill phase against the ~50 affected
  articles as a manual post-deploy step. The script is the **standing recovery path** for
  budget-clipped articles, not a one-off.

### Data flow

```
Cron (*/15) ─→ /api/cron/scrape ─→ runScheduledScrape()
                                       │  create RunBudget (once, run-wide)
Admin button ─→ /api/sources/[id]/scrape ─→ scrapeSourceById()
                                       │  create RunBudget (per manual run)
                                       ▼
                              scrapeSource(source, budget)
                                1. acquire lock
                                2. engine (RSS | HTML)  ← unchanged
                                3. deduplicateArticles  ← unchanged
                                3.5 NEW: fallback orchestrator
                                     for newArticles with image_url null:
                                       budget left? ── no ─→ leave null
                                       └ yes → fetch article page (5s/5MB, UA)
                                               og:image → twitter:image
                                               validate (image-url.ts)
                                               resolve vs full article URL
                                4. insertArticles       ← unchanged
                                5. status update, log "+N via fallback"
                                6. release lock (finally)

scripts/backfill-missing-images.ts ─→ lib/backfill core
   fill:  articles WHERE image_url IS NULL → same extraction → UPDATE (--apply)
   resync: journal rows with bubble stamp → clear stamps (test-Bubble guard)
            → next bubble-sync run re-creates records with images
```

### Data model and dependencies

- **No schema change.** Only the existing nullable `articles.image_url` is written; the
  resync phase clears the existing `bubble_synced_at` / `bubble_id` columns.
- **No new runtime dependency.** `cheerio` (parsing) and native fetch are already in use.
- **One dev dependency**: `tsx`, to run the TypeScript CLI so it can import the shared
  helper — the alternative (a `.mjs` that re-implements extraction) would let the script
  and the scheduler drift apart, defeating "same fallback chain" (decision point below).
- **No new environment variables.** The script reads the existing Supabase and Bubble
  variables; `.env.local.example` is untouched.

### Test strategy — which test type covers which acceptance criterion

New test infrastructure: a chainable Supabase client stub and a global-fetch mock for
scheduler-level tests (today `scheduler.test.ts` only covers pure functions). Fixtures:
recorded head-sections of real `mgb-dental` and `dental-tribune` article pages, their
media-tag-less feed XML, an HTML listing page, and a meta-tag-less page modeled on
`dentalmarketing-magazin` — stored with the tests, never fetched live.

| Acceptance criterion | Test type / location |
|---|---|
| Helper returns first usable of `og:image` → `twitter:image`, reuses `image-url.ts` validation | Unit, `og-image-fallback.test.ts`: og wins over twitter; twitter used when og absent/unusable; `data:`/`javascript:`/empty values rejected |
| Relative/scheme-relative meta values resolved against the **full article URL** | Unit, same file: path-relative value on a deep article URL resolves to the article's directory, not the origin (the exact case `html-engine.ts:224` gets wrong) |
| One fetch per article, 5s timeout, 5 MB cap, same UA; failures → null + warn, never throw | Unit, same file, with fetch mock: single call asserted; timeout/non-200/oversize/network paths return null; UA header asserted |
| Zero fallback fetches for dedup-filtered articles (regression guard for the ~1 900/day defect) | Scheduler integration test: dedup stub reports every URL as existing → assert the fetch mock saw no article-page request |
| Zero extra requests when the primary path produced an image | Scheduler integration test: articles arrive with `image_url` set → orchestrator performs no fetch (spy on the extraction function) |
| Budget exhausted → skip fetches, insert with null, no error | Scheduler integration test with fake timers: budget expires mid-batch → remaining articles inserted, `errors` empty |
| Budget created at **both** entry points | Scheduler tests for `runScheduledScrape()` *and* `scrapeSourceById()` with a pre-expired clock: both paths perform zero fetches |
| Budget enforced **before the first fetch** (lock-loss protection) | Unit test on the orchestrator: already-exhausted budget → zero fetch calls, not "one then stop"; plus `run-budget.test.ts` for the deadline math |
| `mgb-dental` / `dental-tribune` fixtures produce a usable `image_url` | Two-layer: engine-level test proves the feed fixtures yield `image_url: null` (media-tag-less), scheduler-level test with fetch-mocked article pages proves the fallback fills them before insert |
| HTML-path fixture without `selector_image` gains an image via fallback | End-to-end scheduler test (html-engine uses fetch, so one mock serves listing + article pages): inserted row carries the `og:image` value |
| No-meta-tag source completes with `image_url: null`, no error | Scheduler test with the `dentalmarketing-magazin`-style fixture: run succeeds, `last_error` path untouched |
| Result plumbing (fallback count) | Assertion piggybacked on the scheduler tests: `SchedulerResult` reports the filled count |
| Backfill: dry-run default, `--apply`, only-null selection, idempotent reruns | Unit tests on the backfill core with Supabase stub: dry-run performs zero writes; apply updates only usable finds; non-null rows never selected; second run skips filled rows |
| `--resync` guard aborts unless `BUBBLE_USE_TEST_VERSION === 'true'`, no override | Unit test on the core: guard fires for unset/`false`/production config regardless of other flags; `--resync --list` prints exactly the journal's stamped `bubble_id`s |
| Six-step procedure documented and printed | Covered by this spec section + CLI help text; verified by code review, not automated |
| Post-deploy run against the ~50 affected articles | Manual operational step (documented above); not automated |

No acceptance criterion is left without a named test or an explicit "manual/documented"
classification.

### Implementation order

1. `og-image-fallback.ts` + fixtures + unit tests (pure value, no scheduler risk).
2. `run-budget.ts` + unit tests.
3. Scheduler wiring: budget at both entry points, hook between steps 3 and 4, result
   plumbing/log line; scheduler integration tests (supabase stub + fetch mock) including
   the two regression guards (dedup-filtered → zero fetches, pre-fetch budget check).
4. Backfill core module + unit tests (fill, journal, resync guard).
5. CLI wrapper, npm script, `tsx` devDependency; verify against local Supabase.
6. Documentation: post-deploy procedure recorded for the `/deploy` phase.
7. `npm run lint && npm run typecheck && npm run test && npm run build` (the CI gate).

Steps 1–3 are shippable without 4–5 in a pinch, but the spec makes the script the only
recovery path for budget-clipped rows, so the feature is "done" only with all steps.

### Explicitly out of scope (per spec)

JSON-LD `image` (documented "add if a real source needs it", not code) · "largest `<img>`"
heuristics · redirect cap · caching · rate limiting beyond concurrency+budget · pixel-size
validation of fallback images · the dedup case-sensitivity fix (`scheduler.ts:323-326`,
separate ticket) · any Bubble PATCH/update path (separate ticket; until then `--resync`
is test-database-only by hard guard).

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
