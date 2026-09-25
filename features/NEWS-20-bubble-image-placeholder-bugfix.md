# NEWS-20: Bugfix — Lazy-loading placeholder stored as image_url breaks the Bubble sync

## Status: In Review
**Created:** 2026-09-25
**Last Updated:** 2026-09-25 (QA re-verification, round 4)

## Dependencies
- Affects NEWS-4 (HTML DOM Scraping Engine) — where the bug lives
- Affects NEWS-19 (Bubble Sync) — where the guard belongs and where the symptoms showed

## Bug Report

**Finding of 2026-09-25:** The first production Bubble sync at 06:00 UTC transferred 136
of 184 articles. All 48 rejected articles come from the source ZM-online and all carry the
value `data:,` in the `image_url` column. None of the 136 successful articles has a
`data:` URI there. The correlation is complete. The same pattern already occurred on
2026-09-23 (roughly 20 of 96 articles).

**Root cause:** [html-engine.ts:211](../src/lib/scraping/html-engine.ts#L211)

```ts
const src = imgEl.attr('src') ?? imgEl.attr('data-src') ?? imgEl.attr('data-lazy-src')
```

ZM-online serves `<img src="data:," data-src="https://real-url...">`. The `src` attribute
is present (even though it holds a placeholder), so the `??` fallback to `data-src` never
fires — `??` only tests for `null`/`undefined`, not for "is this value usable". The
placeholder `data:,` is stored. Bubble's image field "Picture" rejects it as invalid and
refuses the whole record.

**Scope note:** NEWS-19 behaved correctly — the partial-success path recognised the 136
good articles despite the HTTP 400 and stamped them, while the 48 bad ones stayed
unstamped (no data loss, no duplicate risk). This is a scraper bug in NEWS-4, not a
regression in NEWS-19.

## User Stories
- As an editor, I want articles from sources that use lazy-loaded images to reach Bubble
  reliably, so that I can see them in the ids.online frontend.
- As an operator, I want an invalid placeholder value to never be sent to Bubble, even if
  it somehow ends up in the database.
- As an operator, I want the 48 already affected articles to be retried automatically on
  the next sync run, without manual intervention per article.
- As an operator, I want to see immediately in the log which article was rejected for
  which reason, instead of having to reconstruct it from the database.

## Acceptance Criteria

### 1. Image extraction (html-engine.ts)
- [ ] A `data:` URI in the `src` attribute does not count as a valid image URL (checked
      e.g. via `src.startsWith('data:')`, regardless of what follows the colon).
- [ ] When `src` is a `data:` URI, the extraction falls through to `data-src`,
      `data-lazy-src` and `srcset`, in that order (the existing precedence of `data-src`
      over `data-lazy-src` is preserved; `srcset` is added as a new, final fallback step).
- [ ] For `srcset`, the first **usable** URL of the candidate list is used. _Revised
      2026-09-25 (QA BUG-4): the original wording required the literal first candidate.
      A source that puts a `data:` placeholder in the first `srcset` slot would then
      yield NULL even though a real image sits behind it — the exact failure this ticket
      exists to remove. The rule is now: iterate the candidates in source order and take
      the first one that passes `isUsableImageUrl()`._
      Candidate splitting follows the HTML `srcset` grammar, not a naive comma split
      (QA BUG-1): a comma only separates candidates when it terminates a candidate
      (followed by a descriptor such as ` 2x`/` 300w`, or by the end of the list), so
      commas *inside* a URL — routine in CDN transformation paths such as Cloudinary's
      `/w_300,h_200/` — are preserved. Within a candidate the URL is the run up to the
      first whitespace.
- [ ] If none of the four attributes yields a usable (non-`data:`, non-empty) URL, then
      `image_url = NULL` is the correct result — articles without an image are silently
      skipped by the Bubble mapping (existing behaviour in
      [mapping.ts:74](../src/lib/bubble/mapping.ts#L74)) and are still scraped and stored.
- [ ] A normal `src` value (not a `data:` URI) behaves exactly as before — no regression
      for the 136 sources that already work.
- [ ] Relative URLs coming from `data-src`/`data-lazy-src`/`srcset` are resolved against
      `baseUrl.origin`, just as they are today.

### 2. Guard in the Bubble mapping (mapping.ts)
- [ ] `toBubbleRecord()` treats an `image_url` value that is a `data:` URI (or
      empty/whitespace-only) as "no image present" — the fields `Picture` and
      `Picture URL` are then not set, regardless of what the database holds.
- [ ] This check is in addition to the fix in item 1, not a replacement for it — it is the
      second line of defence for values that were already stored incorrectly or that may
      arrive incorrectly from another source in the future.

### 3. One-off data correction (SQL migration) — _revised 2026-09-25, supersedes the original narrow scope_
- [ ] A new Supabase migration (`npx supabase@latest migration new ...`) clears the Bubble
      sync stamps on **all** articles: `bubble_synced_at = NULL` and `bubble_id = NULL`.
- [ ] The same migration sets `image_url = NULL` for every article whose `image_url` is
      not a usable http(s) address. _Revised 2026-09-25 (QA BUG-3): the original
      `like 'data:%'` predicate was case-sensitive and did not trim, so `DATA:,` and
      ` data:,` survived, and it diverged from the TypeScript helper it claims to mirror.
      The predicate now trims and lower-cases and rejects every non-http(s) scheme, so the
      SQL and `isUsableImageUrl()` state the same rule._
- [ ] Rationale for the widened scope: the PM has confirmed the Bubble **test** environment
      is wiped manually before deployment. Emptying Bubble without clearing the stamps would
      permanently skip the 136 already-stamped articles, so the reset is required for the
      re-sync to cover the full set. The data is disposable test data, so the placeholder
      clean-up no longer needs to be limited to the single observed literal `data:,`.
- [ ] **Test environment only.** The migration must not be applied to a production database
      whose Bubble counterpart has not been emptied in the same step — it would produce
      duplicate Bubble records. This constraint is noted in the migration's header comment.
- [ ] After the migration, `runBubbleSync()` picks up every article on its next scheduled
      run — no manual per-article trigger and no re-sync endpoint.
- [ ] The migration is idempotent (re-running it simply matches rows that are already NULL).
- [ ] The migration is schema-qualified (`public.articles`), per project conventions.

### 4. Logging of individual rejection reasons (sync.ts)
- [ ] Every record rejected by Bubble is logged individually with at least: the article ID
      and the error message returned by Bubble (`outcome.error`).
- [ ] The existing summary log (`X transferred, Y failed`) is kept as well — it is
      extended by the individual reasons, not replaced.
- [ ] `result.errors` (already present, currently only visible in the return value) is
      also written to `console.error` when `syncBatch()` / `runBubbleSync()` finishes, so
      the reasons show up in the Vercel logs without having to query the database.
- [ ] The batch-level failure paths (mapping not possible, stamping failed) are
      unaffected — they are already logged.

## Edge Cases
- **`src="data:,"` with no fallback attribute at all:** `image_url` becomes `NULL`, the
  article is still stored and synced (just without an image).
- **`src` is a `data:` URI but `data-src` is itself empty or whitespace-only:** does not
  count as a usable URL, the next fallback (`data-lazy-src`, then `srcset`) is checked;
  ultimately `NULL` if nothing is usable.
- **`srcset` holds multiple resolutions** (`"a.jpg 480w, b.jpg 800w"`): the first URL is
  taken, not the highest-resolution one — this covers the lazy-loading case without
  introducing image-selection logic that is not asked for here.
- **Source configured without `selector_image`:** unchanged — `image_url` stays `NULL`, as
  today.
- **A real image happens to use `data:image/png;base64,...` as its only source** (no lazy
  loading, no fallback attribute present): under this spec it becomes `NULL` (no image)
  rather than being transferred and rejected — an accepted trade-off, since Bubble does
  not accept `data:` URIs as "Picture" anyway. The widened migration clean-up treats such a
  value the same way, which is consistent with the scraper's new rule.
- **The data-correction migration runs against a database that no longer holds any
  `data:,` value** (e.g. a repeat deploy): the migration is idempotent (the WHERE clause
  simply matches 0 rows).
- **Articles that already carry a `bubble_synced_at`:** the revised migration clears that
  stamp too, so they are re-sent on the next run. This is intended — the Bubble test
  environment is emptied beforehand, so the re-send restores them rather than duplicating
  them.
- **Bubble rejects an article for an entirely different, non-image reason:** the new
  logging (item 4) makes it just as visible as the case fixed here — the logging is
  generic, not image-specific.

## Technical Requirements
- No new dependencies. Uses the existing `cheerio` API (`imgEl.attr(...)`).
- New logic under `src/lib/` (html-engine.ts, mapping.ts) ships with tests
  (see CLAUDE.md: "New logic under `src/lib/` arrives with a test") — in particular:
  - `data:` URI in `src` with a valid `data-src` → `data-src` is used
  - `data:` URI in `src`, `data-src` missing, `data-lazy-src` valid → `data-lazy-src`
  - all four attributes missing/invalid → `NULL`
  - normal `src` without `data:` → unchanged (regression guard)
  - `toBubbleRecord()` with `image_url: 'data:,'` → `Picture`/`Picture URL` not set
- The migration follows the existing naming and schema conventions in
  `supabase/migrations/`.
- `npm run lint && npm run typecheck && npm run test && npm run build` must pass before
  the PR (CI requirement per CLAUDE.md).

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

**Designed:** 2026-09-25 · **Type:** Bugfix, backend only — no UI changes

### Summary for stakeholders

One news source (ZM-online) hides its real picture behind a "loading placeholder".
Our scraper mistook the placeholder for the actual picture and stored it. Bubble then
refused those 48 articles outright. We fix this in four small places: pick the real
picture, refuse to send placeholders even if one slips through, clean up the 48 rows
already stored wrongly, and make every future rejection visible in the log.

Nothing changes for editors in the app. Nothing changes for the 136 articles that
already work. After the next scheduled sync the 48 missing articles appear in Bubble
by themselves.

### Where the changes sit (no new files, no new screens)

```
Scraping (runs on schedule)
+-- HTML Scraping Engine .............. FIX 1 - pick the real image, not the placeholder
|                                       src/lib/scraping/html-engine.ts
Database
+-- articles.image_url ................ FIX 3 - one-off cleanup of 48 existing rows
|                                       supabase/migrations/<new>.sql
Bubble Sync (runs on schedule)
+-- Record Mapping .................... FIX 2 - safety net, never send a placeholder
|   |                                   src/lib/bubble/mapping.ts
+-- Sync Runner ....................... FIX 4 - log every single rejection reason
                                        src/lib/bubble/sync.ts
```

### Design decisions

**1. "Is this value usable?" instead of "does this value exist?"**
Today the code asks only whether an attribute is present. A placeholder is present, so
it wins. We change the question to "is this a real web address?" — a value starting with
`data:` is never a real address for our purposes, so we move on to the next candidate.
Checked in a single shared helper so both the scraper and the Bubble mapping apply the
exact same rule and cannot drift apart later.

**2. A fixed order of candidates, with one new last resort**
The scraper looks for the picture in this order: the normal source, then the two common
lazy-loading attributes, and finally the "responsive images" list (`srcset`), which is new.
From that list we take the first entry — not the largest. Choosing the best resolution is
image-quality work and not part of this bugfix.

**3. No picture is an acceptable outcome**
If nothing usable is found we store "no image". The article is still scraped, still stored
and still synced — Bubble simply receives it without a picture. That is strictly better
than today, where the whole article is rejected.

**4. Two lines of defence, deliberately redundant**
Fix 1 stops bad values from being *created*; Fix 2 stops bad values from being *sent*.
We keep both. Fix 2 costs nothing at runtime and protects against rows that were stored
before this fix, or that arrive from a future source we have not written yet.

**5. Full reset instead of a narrow correction** _(revised 2026-09-25 after PM input)_
The original plan corrected only the 48 rows holding the exact value `data:,`. The PM has
since confirmed that the Bubble **test** environment can be wiped entirely and re-verified
on the following day. That changes the cleanup for the better: the migration clears the
sync stamps for **all** articles, so the next scheduled run re-sends the complete set
against the fixed extraction logic.

This is necessary, not merely convenient: our database records per article whether it has
already been pushed (`bubble_synced_at`), and the sync job selects only unstamped rows. If
Bubble were emptied without resetting those stamps, the 136 previously-accepted articles
would be skipped forever and only the 48 unstamped ones would return.

The migration therefore does two things: clear `bubble_synced_at` and `bubble_id` on all
rows, and set `image_url` to NULL wherever it holds a `data:` placeholder. Because the data
is disposable test data, the placeholder clean-up can now safely cover every `data:` value
rather than the one observed literal. Re-running the migration is harmless.

**Restricted to the test environment.** This reset is only acceptable because the target is
test data. It must not be carried into production as-is — a production re-sync would create
duplicate records in Bubble unless the Bubble side is emptied in the same step.

**6. No re-sync trigger is built**
Once the stamps are cleared, the existing scheduled sync picks everything up on its own.
Building a manual re-sync button would be new functionality that this bugfix does not need.

**7. Rejections become readable without a database query**
Today the reasons exist but only inside the function's return value. We write them to the
log as well, one line per rejected article with its ID and Bubble's own error text. The
existing summary line stays. This is generic — it will explain the *next* unrelated
rejection just as well as this one.

### What is stored (unchanged)

Each article keeps the same fields as today. Only the meaning of one becomes stricter:

- `image_url` — either a real web address, or empty. Never a placeholder.

No new tables, no new columns, no schema change. The migration only corrects data —
it clears the sync stamps (`bubble_synced_at`, `bubble_id`) and blanks placeholder
`image_url` values.

### Dependencies

None. No new packages. Uses the HTML-reading library (`cheerio`) already in the project.

### Risk & verification

- **Regression risk:** low and contained — sources with a normal image are untouched by
  design and covered by an explicit regression test.
- **Verified by:** unit tests for each image case (placeholder with fallback, placeholder
  without fallback, normal image, responsive list) and for the Bubble mapping guard, plus
  the standard CI gate (lint, typecheck, test, build).
- **Success signal:** the next scheduled sync reports 0 failed articles and Bubble holds
  the full set again (184 at the time of the finding), ZM-online included — verified the
  morning after deployment.
- **Reset risk:** the stamp reset is a test-environment action. Deploying it against
  production without emptying Bubble first would duplicate records.

### Build order

1. Shared "is this a usable image address?" rule + scraper fix (with tests)
2. Bubble mapping guard (with test)
3. Rejection logging in the sync runner
4. Migration: clear sync stamps + blank placeholder image values
5. Empty the Bubble test environment (manual, by the PM)
6. Deploy, then verify the next scheduled sync the following morning

This is backend-only work — run `/backend`, not `/frontend`.

## QA Test Results

**Tested:** 2026-09-25 · **Tester:** QA skill · **Build under test:** uncommitted working tree on `main`
(`src/lib/image-url.ts` [new], `html-engine.ts`, `mapping.ts`, `sync.ts`,
`supabase/migrations/20260925090000_news20_reset_bubble_sync_and_clear_placeholder_images.sql`)

### Summary

| | |
|---|---|
| Acceptance criteria | **24 of 24 passed**, 0 failed |
| Documented edge cases | **7 of 7 passed** |
| Bugs found | 0 Critical · 0 High · 1 Medium · 4 Low — **all 5 FIXED** (2026-09-25, `/backend` follow-up) |
| CI gate (lint/typecheck/test/build) | **PASS** — 0 errors, 198/198 tests green, build succeeds · **re-run after bugfixes: 209/209 green** |
| Security audit | No vulnerabilities introduced. Hardening gap (BUG-2) closed — http(s) allowlist. 1 deployment hazard (RISK-1) still open |
| **Production-ready** | **YES for the test environment**, conditional on RISK-1 being consciously accepted |

### 1. Image extraction (html-engine.ts) — 6/6 PASS

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1.1 | `data:` URI in `src` is not a valid image URL, regardless of what follows the colon | PASS | `isUsableImageUrl()` in `src/lib/image-url.ts` rejects `data:,`, `data:image/png;base64,...`, and (better than required) mixed case `DATA:,` |
| 1.2 | Falls through to `data-src` → `data-lazy-src` → `srcset`, precedence preserved | PASS | `pickImageUrl()` candidate array is in exactly that order; verified end-to-end through `scrapeHtmlPreview()` |
| 1.3 | `srcset`: the first *usable* URL of the candidate list is used | PASS | `firstSrcsetUrl('a.jpg 480w, b.jpg 800w')` → `a.jpg`. Amended 2026-09-25 (BUG-4 fix): unusable candidates are skipped instead of yielding NULL |
| 1.4 | No usable URL → `image_url = NULL`, article still scraped and stored | PASS | `<img src="data:,">` yields `image_url: null` while title and URL are still extracted |
| 1.5 | Normal `src` behaves exactly as before (no regression) | PASS | Explicit regression test present and green; all 19 html-engine tests pass |
| 1.6 | Relative URLs from the fallback attributes resolved against `baseUrl.origin` | PASS | `data-src="/media/a.jpg"` → `https://example.com/media/a.jpg`; the `new URL(src, baseUrl.origin)` call is unchanged, only its input changed |

Note: both the live scrape (`scrapeHtmlPage`) and the NEWS-17 preview (`scrapeHtmlPreview`) share
the single patched extraction site — verified there is no second copy of the old `??` chain in
`src/lib/`.

### 2. Guard in the Bubble mapping (mapping.ts) — 2/2 PASS

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 2.1 | `data:` / empty / whitespace-only `image_url` → `Picture` and `Picture URL` unset | PASS | Both keys absent for `data:,`, `data:image/png;base64,...` and `'   '`; normal URL still sent (regression test green) |
| 2.2 | Guard is additive, not a replacement for fix 1 | PASS | Both layers present and independently tested; they share one helper, so they cannot drift apart |

### 3. One-off data correction (migration) — 7/7 PASS

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 3.1 | Clears `bubble_synced_at` and `bubble_id` on all articles | PASS | First `update` statement, no row filter beyond the NULL short-circuit |
| 3.2 | `image_url = NULL` for every non-http(s) value | PASS | Second `update`. Amended 2026-09-25 (BUG-3 fix): trims, lower-cases and rejects every non-http(s) scheme, mirroring `isUsableImageUrl()` |
| 3.3 | Rationale for the widened scope documented | PASS | Header comment |
| 3.4 | Test-environment-only constraint noted in the header comment | PASS | Present and prominent (`!! TEST ENVIRONMENT ONLY !!`). See RISK-1 — a comment is documentation, not a safeguard |
| 3.5 | `runBubbleSync()` picks everything up on its next run, no manual trigger | PASS | `loadUnsyncedArticles()` filters on `.is('bubble_synced_at', null)`; cron `0 6 * * *` in `vercel.json`. See RISK-2 for the 1000-row ceiling |
| 3.6 | Idempotent | PASS | Both `WHERE` clauses match 0 rows on a second run |
| 3.7 | Schema-qualified (`public.articles`) | PASS | Both statements qualified |

### 4. Rejection logging (sync.ts) — 4/4 PASS

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 4.1 | Every rejected record logged individually with article ID and Bubble's error | PASS | `console.error('[BubbleSync] Artikel abgelehnt: ${article.id} ("${article.title}") — ${reason}')` |
| 4.2 | Summary log kept, extended not replaced | PASS | The `X übertragen, Y fehlgeschlagen` line is untouched; `logErrors()` runs after it |
| 4.3 | `result.errors` also written to `console.error` at the end of the run | PASS | `logErrors(result)` at the end of `runBubbleSync()`; no-ops on a clean run |
| 4.4 | Batch-level failure paths unaffected | PASS | Diff touches only the per-outcome branch; all 12 sync tests still pass |

### Documented edge cases — 7/7 PASS

`src="data:,"` with no fallback → NULL · blank `data-src` skipped, next candidate used ·
multi-resolution `srcset` takes the first · source without `selector_image` unchanged ·
genuine `data:image/...;base64` becomes NULL (accepted trade-off, behaves as specified) ·
migration idempotent on a clean database · already-stamped articles are reset and re-sent.

### Bugs found — all fixed 2026-09-25

**Fix round (`/backend`, 2026-09-25).** All five bugs below were fixed in the same working
tree that QA assessed. Gate re-run afterwards: lint 0 errors (13 pre-existing warnings),
typecheck clean, **209/209 tests green** (198 baseline + 11 new regression tests, one per
bug using the concrete example from this report), `npm run build` exit 0.
`MAX_ARTICLES_PER_RUN` and the deploy behaviour were not touched, so RISK-1 and RISK-2
below stand unchanged and still need the two sign-offs named in the verdict.
BUG-4's fix deviates from AC 1.3 as originally written; AC 1.3 has been revised above and
the reasoning recorded there.

**BUG-1 — Medium — `srcset` URL containing a comma is silently truncated — ✅ FIXED**
`firstSrcsetUrl()` splits on `/[\s,]+/`, but a comma is legal inside a URL and is common in
CDN paths (Cloudinary/imgix transformation segments such as `.../w_300,h_200/a.jpg`).
- Reproduce: `firstSrcsetUrl('https://cdn/a,b.jpg 1x, https://cdn/c.jpg 2x')`
- Expected: `https://cdn/a,b.jpg` · Actual: `"https://cdn/a"`
- Impact: a truncated, dead URL is stored and sent to Bubble instead of either the real image or
  a clean NULL — this is the *wrong-value* class of failure the whole ticket is about, just one
  layer down. Only reachable when `src`, `data-src` and `data-lazy-src` are all unusable, which
  keeps it out of Critical territory.
- Priority: fix before deploy is optional; fix before a second lazy-loading source is onboarded.
- **Fix:** `srcsetUrls()` in `src/lib/image-url.ts` replaces the `/[\s,]+/` split with a scan
  following the HTML `srcset` grammar — the URL is the run of non-whitespace characters, and a
  comma only separates candidates when it terminates one (trailing comma, or after the
  descriptor). `firstSrcsetUrl()` now delegates to it.
- **Regression tests:** `firstSrcsetUrl('https://cdn/a,b.jpg 1x, https://cdn/c.jpg 2x')` →
  `https://cdn/a,b.jpg`, plus the Cloudinary `/w_300,h_200/` case and a `srcsetUrls()` case with
  a comma in both candidates.

**BUG-2 — Low (security hardening) — the rule is a `data:` blacklist, not an http(s) allowlist — ✅ FIXED**
`isUsableImageUrl('javascript:alert(1)')` and `isUsableImageUrl('vbscript:...')` both return
`true`, and `new URL()` preserves the scheme, so such a value would be stored in `image_url` and
sent to Bubble as `Picture`.
- Not exploitable as XSS today: `<img src="javascript:...">` does not execute in any current
  browser, and the value only ever reaches an `img` attribute.
- Real impact is the same failure mode as this ticket: Bubble rejects the record, one article is
  lost. An allowlist (`http:` / `https:` / protocol-relative) would close both at once.
- Priority: low, but it is a one-line change in the shared helper.
- **Fix:** `isUsableImageUrl()` is now an allowlist: a value carrying a URI scheme is accepted
  only for `http:`/`https:` (case-insensitive, after trimming). Scheme-less values —
  protocol-relative `//cdn/a.jpg` and site-relative `/media/a.jpg` — stay accepted, since
  resolving them against the page URL is the caller's job.
- **Regression tests:** `javascript:alert(1)`, `JavaScript:alert(1)`, `about:blank`,
  `blob:…`, `file:///etc/passwd` all reject; `http:`/`HTTPS:`/`//cdn…` all accept; and
  `pickImageUrl({src:'javascript:alert(1)', dataSrc:'…real.jpg'})` falls through correctly.

**BUG-3 — Low — migration `like 'data:%'` is case-sensitive and does not trim — ✅ FIXED**
The TypeScript helper lower-cases and trims; the SQL does neither. Rows holding `DATA:,` or
` data:,` survive the clean-up. Harmless in practice (the mapping guard stops them from being
sent), but the two halves of the "same shared rule" claim differ. `where lower(trim(image_url))
like 'data:%'` would align them.
- **Fix:** the migration predicate now mirrors the helper exactly — it blanks `image_url` when
  `btrim(image_url) = ''` or when `lower(btrim(image_url))` carries a scheme that is not
  `http`/`https`. So `'DATA:,'` and `' data:,'` are caught, as is any other non-http(s) scheme,
  matching the BUG-2 allowlist rather than only `data:`. AC 3.2 revised above.
- **Verification:** the SQL is the same rule as the helper, which is covered by the
  `isUsableImageUrl()` case tests (`'DATA:,'`, `'  data:,  '`, `'   '`).

**BUG-4 — Low — `srcset` whose first candidate is itself a `data:` URI yields NULL — ✅ FIXED**
`pickImageUrl({src:'data:,', srcset:'data:image/gif;base64,R0lGOD 1x, https://cdn/real.jpg 2x'})`
→ `null`, even though a usable candidate exists later in the list. This matches AC 1.3 as
written ("the first URL is used"), so it is not a spec violation — logged so the trade-off is a
recorded decision rather than an accident.
- **Fix:** `pickImageUrl()` now iterates *all* `srcset` candidates in source order and takes the
  first that passes `isUsableImageUrl()`, instead of testing only the first one. `src`,
  `data-src` and `data-lazy-src` keep their precedence ahead of the whole `srcset` list.
- **Spec impact:** this deviates from AC 1.3 as originally written ("the first URL is used").
  AC 1.3 has been revised above with the reasoning — a placeholder in the first slot is the same
  wrong-value failure the ticket exists to remove, so "first usable" is the correct rule.
- **Regression test:** `pickImageUrl({src:'data:,', srcset:'data:image/gif;base64,R0lGOD 1x,
  https://example.com/real.jpg 2x'})` → `https://example.com/real.jpg`.

**BUG-5 — Low — the visual wizard still shows the placeholder — ✅ FIXED**
`src/components/dashboard/sources/selector-assistant.tsx:81` and `:293-300` still use the old
`getAttribute('src') || getAttribute('data-src') || ...` chain. An admin configuring a
lazy-loading source sees `data:,` in the selector preview even though the scraper now resolves
the real image — misleading, and it may push someone to pick a worse selector. Out of the stated
scope of this ticket (spec names only `html-engine.ts` and `mapping.ts`), but the same root
cause.
- **Fix:** both call sites now go through the shared `pickImageUrl()` via a single
  `imagePreview()` helper, so the wizard shows exactly the address the scraper would store
  (or `(kein Bild)`). Out of the ticket's stated scope but same root cause and a strict
  improvement, so it was fixed alongside.

### Risks (not bugs — for explicit sign-off)

**RISK-1 — High impact, requires a deliberate decision — the migration's only safeguard is a comment**
The migration lives in `supabase/migrations/`, which `CLAUDE.md` declares the single source of
truth applied to every environment. Nothing in the file prevents it from running against
production; the `!! TEST ENVIRONMENT ONLY !!` header is documentation, not enforcement. If it is
ever applied to a production database whose Bubble counterpart has not been emptied in the same
step, every previously-synced article is re-sent and Bubble ends up with duplicates.
This is exactly what AC 3.4 asks for, so it **passes** as specified — but it should be an
explicit, recorded human decision at deploy time, not something discovered later.
*Mitigation options if you want one: guard the statements behind a check for a value that only
exists in the test database, or apply the reset manually and ship the migration as a no-op.*

**RISK-2 — Low — full-reset volume vs. the per-run ceiling**
`MAX_ARTICLES_PER_RUN = 1000` in `src/lib/bubble/sync.ts` and the sync runs once a day (`0 6 * * *`).
The migration un-stamps *all* articles. At the 184 articles cited in the bug report this is fine
(one run restores everything). If the article count has grown past 1000 by deploy day, the
restore silently takes several days and the "0 failed, full set present the next morning"
success signal will not hold. Verify the row count before deploying.

### Regression testing

| Area | Result |
|---|---|
| Full test suite (12 files, 198 tests) | PASS — no pre-existing test broken |
| NEWS-19 Bubble sync (`sync.test.ts` 12, `client.test.ts` 34, `mapping.test.ts` 13) | PASS |
| NEWS-3 RSS engine (28 tests) | PASS — RSS image extraction untouched; the mapping guard now also covers it |
| NEWS-4 HTML engine (19 tests incl. `resolveUrl`, `normalizeUrl`, `parseDate`) | PASS |
| NEWS-5 scheduler (13 tests) | PASS |
| NEWS-14 feed detection (10 tests) | PASS |
| NEWS-1/2/9 validations (47 tests) | PASS |
| `npm run build` | PASS — all routes compile |
| Lint | PASS — 0 errors, 13 warnings, all pre-existing and unrelated |

### Cross-browser and responsive

**Not applicable — assessed, not skipped.** This change is backend-only: no component, page,
style or API response shape is modified. `git diff --stat` touches `src/lib/` and
`supabase/migrations/` exclusively. The only user-visible consequence is that some articles now
render *with* an image where they previously did not appear in Bubble at all, through the
existing, already-tested card components. No rendering path changed, so Chrome/Firefox/Safari and
375/768/1440px behaviour is unchanged by construction.

### Security audit (red team)

| Vector | Finding |
|---|---|
| Auth bypass / authorization | No auth or RLS surface touched. No route handler modified. No change |
| Injection (SQL) | Migration uses static literals, no interpolation. Supabase client calls remain parameterized |
| Injection (XSS via `image_url`) | Attacker-controlled scraped values can still carry non-http schemes (BUG-2), but `data:` — the one scheme with real XSS potential in an `img`/`srcset` context — is now *more* strictly filtered than before. Net improvement |
| Log injection / data leaking into logs | New `console.error` lines emit an article ID, a title and Bubble's error text. Titles are attacker-influenced (scraped) and are not escaped, so a crafted title could inject newlines into the Vercel log. Cosmetic only — no secrets, no credentials, no tokens are logged. Noted, not filed as a bug |
| Secret exposure | No new env vars. Bubble token still read only via `getBubbleConfig()` server-side and never logged |
| Rate limiting / DoS | Unchanged. `BATCH_SIZE` and `MAX_ARTICLES_PER_RUN` caps still in place |
| Data loss | The migration destroys the `bubble_id` back-references irreversibly. Intended and spec'd, but it is a one-way door — see RISK-1 |

### Process observations

- The implementation is **uncommitted on `main`**. `CLAUDE.md` requires a feature branch and a
  pull request (`main` is protected, squash-only). Move the work to a branch before merging.
- `features/INDEX.md` still lists NEWS-20 as *In Progress*; updated to *In Review* with this QA pass.
- New logic under `src/lib/` ships with tests as required — `src/lib/image-url.test.ts` (18 cases)
  is thorough and includes the regression guard the spec asked for.

### Verdict

**Production-ready: YES** (for the intended test-environment deployment). Every acceptance
criterion passes, the CI gate is green, and no Critical or High *defect* exists. The one Medium
bug (BUG-1) is in a fallback path that the currently affected source does not reach.

**Update 2026-09-25 after the bugfix round:** all five bugs are fixed and the gate is green at
209/209 tests. The Medium bug is gone rather than merely out of reach, and the hardening gap is
closed. The two deploy conditions below are unchanged — they are risks of the migration, not
defects, and nothing in the fix round touched `MAX_ARTICLES_PER_RUN` or the deploy behaviour.

Two conditions before deploying:
1. Consciously accept RISK-1 and confirm the Bubble test environment is emptied in the same step.
2. Check the `public.articles` row count against RISK-2's 1000-per-run ceiling.


### QA Re-Verification — round 2, 2026-09-25

**Build under test:** branch `fix/NEWS-20-image-url-hardening` @ `0392f7d`
(2 commits ahead of `origin/main`; **not pushed, no pull request open**).
**Method:** independent re-execution of the CI gate plus an ad-hoc probe suite written from
this report's own reproduction cases — the bugfix claims were re-tested against the code, not
read off the report.

| Check | Result |
|---|---|
| `npm run lint` | PASS — 0 errors, 13 warnings (all pre-existing, unrelated files) |
| `npm run typecheck` | PASS — clean |
| `npm run test` | PASS — 12 files, **209/209** green (matches the claimed count) |
| `npm run build` | PASS — all routes compile |
| BUG-1 fix (comma in `srcset` URL) | **CONFIRMED** — `firstSrcsetUrl('https://cdn/a,b.jpg 1x, https://cdn/c.jpg 2x')` → `https://cdn/a,b.jpg`; Cloudinary `/w_300,h_200/` case correct. `srcsetUrls('a.jpg,b.jpg')` → one candidate, which matches the HTML `srcset` grammar (a comma only terminates a candidate when followed by whitespace/descriptor) |
| BUG-2 fix (http(s) allowlist) | **CONFIRMED with one residual gap — see BUG-6** — `javascript:`, `JavaScript:`, `about:`, `blob:`, `file:`, `data:`, `DATA:`, `' data:,'`, `''`, `'   '`, null, undefined all reject; `http:`, `HTTPS:`, `//cdn/…`, `/media/…`, `a.jpg` all accept |
| BUG-3 fix (migration predicate) | **CONFIRMED** — migration blanks `btrim(image_url) = ''` and any `lower(btrim(...))` scheme that is not `http`/`https`; the regex `^[a-z][a-z0-9+.-]*:` is character-for-character the helper's `SCHEME_PATTERN` |
| BUG-4 fix (first *usable* `srcset` candidate) | **CONFIRMED** — `pickImageUrl({src:'data:,', srcset:'data:image/gif;base64,R0lGOD 1x, https://example.com/real.jpg 2x'})` → `https://example.com/real.jpg`. Precedence intact: `src` → `data-src` → `data-lazy-src` → whole `srcset` list |
| BUG-5 fix (wizard preview) | **CONFIRMED** — `selector-assistant.tsx` imports `pickImageUrl`; both former call sites (`:100`, `:312`) route through the single `imagePreview()` helper; no `getAttribute('src') \|\|` chain remains |
| Guard in `mapping.ts` | **CONFIRMED** — `Picture`/`Picture URL` set only behind `isUsableImageUrl()`, and the value is `.trim()`ed before sending |
| Logging in `sync.ts` | **CONFIRMED** — per-article `[BubbleSync] Artikel abgelehnt: <id> ("<title>") — <reason>` at `:199`, summary line at `:85` untouched, `logErrors(result)` at `:87` after it |

**Process note corrected:** round 1 recorded the work as "uncommitted on `main`". It is now
committed on a feature branch, which satisfies `CLAUDE.md`. Still outstanding: push the branch
and open a pull request so the `verify`/`migrations` checks run in CI.

#### BUG-6 — Low (new, found in round 2) — the allowlist is bypassable with whitespace inside the scheme

`isUsableImageUrl('java\nscript:alert(1)')` returns `true` and
`isUsableImageUrl('https:/a')` returns `true`. `SCHEME_PATTERN` is tested against the
outer-trimmed string only, so any whitespace *inside* the scheme makes the pattern miss and the
value is treated as scheme-less (and therefore allowed). The value then reaches
`new URL(src, baseUrl.origin)`, and the WHATWG URL parser strips tab/CR/LF from URLs — so
`java\nscript:alert(1)` is normalised back to `javascript:alert(1)` and stored in `image_url`.

- Reproduce: scrape `<img src="data:," data-src="java&#10;script:alert(1)">`, or call
  `isUsableImageUrl('java\nscript:alert(1)')` directly.
- Impact: the same failure mode BUG-2 was fixed to prevent — a non-http(s) value is stored and
  sent to Bubble, which rejects the record and the article is lost. **Not an XSS:** the value
  only ever lands in an `img`/`srcset` attribute, where no current browser executes
  `javascript:`. Requires a hostile or compromised source page, so the likelihood is low.
- Priority: Low. Optional before this deploy; the mapping guard uses the same helper, so both
  layers share the gap. Fix shape: strip ASCII whitespace (`/[\t\n\r\f ]/g`) before matching
  the scheme, or accept only values that parse to an `http:`/`https:` protocol via `new URL()`.

#### Verdict (round 2)

**Production-ready: YES for the test environment** — unchanged. All five round-1 bugs are
genuinely fixed in the code, not just in the report, and the gate is green at 209/209. BUG-6 is
a Low residual in the same helper and does not block. RISK-1 and RISK-2 from round 1 stand
untouched and still need the two sign-offs named above.


## Deployment
_To be added by /deploy_

---

## BUG-6 Fix (round 3, 2026-09-25)

**Status: fixed.** All six round-1/round-2 bugs are now closed; no known open bug remains.

### Change

`src/lib/image-url.ts` gained `normalizeImageUrl()`, which removes tab, LF and CR from
anywhere in the value and then trims it — exactly the characters the WHATWG URL parser
drops before parsing. `isUsableImageUrl()` matches `SCHEME_PATTERN` against that
normalised form, so a scheme split by whitespace (`java\nscript:`) can no longer look
scheme-less and slip through the allowlist. `pickImageUrl()` returns the normalised value,
so what gets stored in `image_url` is what the parser would have resolved anyway.

`supabase/migrations/20260925090000_news20_reset_bubble_sync_and_clear_placeholder_images.sql`
mirrors the same rule: the predicate now wraps `image_url` in
`translate(image_url, E'\t\n\r', '')` before `btrim`/`lower`, keeping the SQL half and the
TypeScript half stating one rule (the BUG-3 property).

### Verification

Six new tests in `src/lib/image-url.test.ts` cover the scheme split by `\n`, `\t` and `\r`,
the `da\nta:,` variant, a whitespace-only value, an http address carrying such characters
(still accepted), the fall-through to `data-src`, and that the stored value is normalised.
One test asserts the premise directly: `new URL('java\nscript:alert(1)').protocol` is
`'javascript:'`.

Full CI gate re-run after the change: lint 0 errors (13 pre-existing warnings),
typecheck clean, **215/215 tests green**, `npm run build` PASS.

### Still open — not bugs

RISK-1 (the migration's only safeguard against a production run is a header comment) and
RISK-2 (`MAX_ARTICLES_PER_RUN = 1000` vs. the full re-sync) are unchanged and still need
the two sign-offs before deployment. Process item: the branch has never been pushed, so
`verify`/`migrations` have not run in CI.

---

## QA Re-Verification — round 4, 2026-09-25

**Build under test:** branch `fix/NEWS-20-image-url-hardening` @ `0392f7d` **plus uncommitted
working-tree changes** (`src/lib/image-url.ts`, `src/lib/image-url.test.ts`, the migration and
this spec). The round-3 BUG-6 fix is *not committed*.
**Method:** independent re-execution of the CI gate plus an ad-hoc probe suite driven by
character codes rather than by the report's prose, so the allowlist was attacked rather than
read.

| Check | Result |
|---|---|
| `npm run lint` | PASS — 0 errors, 13 warnings (all pre-existing, unrelated files) |
| `npm run typecheck` | PASS — clean |
| `npm run test` | PASS — 12 files, **215/215** green (matches the claimed count) |
| `npm run build` | PASS — all routes compile |
| BUG-6 fix (whitespace inside the scheme) | **CONFIRMED FIXED** — `isUsableImageUrl` returns `false` for `java\nscript:`, `java\tscript:`, `java\rscript:` and `da\nta:,`; `pickImageUrl({src:'data:,', dataSrc:'java\nscript:alert(1)', dataLazySrc:'https://x/real.jpg'})` → `https://x/real.jpg`. Vertical tab (`\v`) and form feed (`\f`) are also caught, via `trim()` |
| BUG-6 migration mirror | **CONFIRMED** — the SQL wraps `image_url` in `translate(image_url, E'\t\n\r', '')` before `btrim`/`lower`, and the regex `^[a-z][a-z0-9+.-]*:` is character-for-character the helper's `SCHEME_PATTERN` |
| BUG-1 (comma in `srcset` URL) | **still fixed** — `srcsetUrls('https://cdn/a,b.jpg 1x, https://cdn/c.jpg 2x')` → two candidates, first is `https://cdn/a,b.jpg`; Cloudinary `/w_300,h_200/` preserved |
| BUG-4 (first *usable* candidate) | **still fixed** — `data:` placeholder in slot 1 falls through to `https://example.com/real.jpg` |
| BUG-2 allowlist | **holds for the ordinary cases** — `javascript:`, `data:`, `about:`, `blob:`, `file:` reject; `http:`, `HTTPS:`, `//cdn/…`, `/m/a.jpg`, `a.jpg` accept. One residual, see BUG-7 |
| BUG-5 (wizard preview) | **still fixed** — `selector-assistant.tsx:14` imports `pickImageUrl`; no `getAttribute('src') \|\|` chain remains anywhere in `src/` |
| Single extraction site | **CONFIRMED** — `pickImageUrl` has exactly one caller in the scraper (`html-engine.ts:216`) and one in the wizard; `isUsableImageUrl` one in `mapping.ts:80`. No second copy of the old chain |

### BUG-7 — Low (new, round 4) — a leading C0 control character still bypasses the allowlist

`normalizeImageUrl()` strips only tab, LF and CR. The WHATWG URL parser strips **all** leading
C0 controls (U+0000–U+001F) and spaces, and `String.prototype.trim()` does not remove the
non-whitespace ones (U+0000–U+0008, U+000E–U+001F). So those characters make `SCHEME_PATTERN`
miss, the value looks scheme-less, and it is accepted.

- Reproduce (character codes, not literals):
  - `isUsableImageUrl(String.fromCharCode(1) + 'javascript:alert(1)')` → `true`
  - `isUsableImageUrl(String.fromCharCode(0) + 'data:,')` → `true`
  - `pickImageUrl({src: String.fromCharCode(0) + 'data:,'})` → `"\u0000data:,"`
  - `html-engine.ts:226` then calls `new URL(src, baseUrl.origin)`, which normalises it back to
    `data:,` / `javascript:alert(1)` and stores exactly that in `image_url`.
- Verified boundary: codes 0, 1 and 31 are accepted (bug); 11 (`\v`), 12 (`\f`) and 32 (space)
  are correctly rejected because `trim()` removes them.
- Impact: identical to BUG-6 and to the ticket's own root cause — a non-http(s) value is stored
  and sent, Bubble rejects the record, one article is lost. **Not an XSS:** the value only ever
  lands in an `img`/`srcset` attribute, where no current browser executes `javascript:`.
  Requires a hostile or compromised source page, so likelihood is low.
- The migration shares the gap: `translate(..., E'\t\n\r', '')` leaves the other C0 controls in
  place, so such a row survives the clean-up. The mapping guard catches it on send, so no record
  is lost from the database — but the two halves again state slightly different rules.
- Priority: Low. Does not block this deploy. Fix shape: widen the strip to
  `/[\u0000-\u001F\u007F]/g` (and `E'\x00'`–style equivalent in SQL), or — more robustly and
  ending this class of bug for good — decide usability by `new URL(value, base).protocol` and
  drop the regex allowlist entirely.

### Observation (not a bug) — `mapping.ts` sends the un-normalised value

`mapping.ts:83` sends `article.image_url.trim()`, while `pickImageUrl()` returns
`normalizeImageUrl(...)`. For a stored `https://x/a<LF>.jpg` the guard accepts it (correctly —
the parser would too) but Bubble receives the value with the newline still in it. Cosmetic and
unreachable from the scraper (which normalises before storing); worth aligning to
`normalizeImageUrl()` when BUG-7 is addressed, so "one shared rule" holds on the send path too.

### Regression testing (round 4)

Full suite green at 215/215 across 12 files — NEWS-3 RSS (28), NEWS-4 HTML engine (19),
NEWS-5 scheduler (13), NEWS-14 feed detection (10), NEWS-19 sync/client/mapping (12/34/13),
NEWS-1/2/9 validations. No pre-existing test broken. `npm run build` exit 0.

### Cross-browser and responsive (round 4)

Still not applicable, assessed rather than skipped. The round-3 diff touches `src/lib/` and
`supabase/migrations/` only — no component, page, style or API response shape changed, so
Chrome/Firefox/Safari and 375/768/1440px behaviour is unchanged by construction.

### Security audit (round 4)

No new vector. The `data:` scheme — the only one with real XSS potential in an `img`/`srcset`
context — is filtered more strictly than before on both layers. BUG-7 is a *correctness* gap
(a rejected record) rather than an exploitable one. No secrets, env vars, auth, RLS or route
handlers were touched. The log-injection note from round 1 (unescaped scraped titles in
`console.error`) stands unchanged: cosmetic, no credentials logged.

### Process items (unchanged or new)

1. **NEW — the round-3 BUG-6 fix is uncommitted.** `git status` shows `image-url.ts`,
   `image-url.test.ts`, the migration and this spec modified but not committed. Commit it before
   anything else, or the fix will not ship.
2. **Still open — the branch has never been pushed and no pull request exists.** The `verify` and
   `migrations` checks have therefore never run in CI. `CLAUDE.md` requires both.
3. **RISK-1 unchanged** — the migration's only safeguard against a production run is its header
   comment. Needs an explicit, recorded sign-off at deploy time.
4. **RISK-2 unchanged** — `MAX_ARTICLES_PER_RUN = 1000` versus a full re-sync. Check the
   `public.articles` row count before deploying.

### Verdict (round 4)

**Production-ready: YES for the test environment.** BUG-6 is genuinely fixed in the code, the
gate is green at 215/215, and no Critical or High defect exists. BUG-7 is a new Low residual of
the same class in the same helper and does not block. The three deploy conditions are: commit and
push the work and open a pull request, accept RISK-1 in writing, and check the row count for
RISK-2.
