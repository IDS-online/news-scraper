# NEWS-17: HTML-Quellen Scraping-Vorschau

## Status: In Review
**Created:** 2026-03-07
**Last Updated:** 2026-03-07

## Dependencies
- Requires: NEWS-2 (News-Quellen-Verwaltung) — extends the source form dialog
- Requires: NEWS-4 (HTML DOM Scraping Engine) — reuses the HTML scraping logic for the dry run
- Related: NEWS-16 (HTML-Selektor-Assistent) — selectors detected by the assistant feed into this preview

## Summary
When configuring a new HTML scraping source, admins cannot know whether their CSS selectors actually work until they save the source and wait for the first scheduled scrape. This feature adds a "Scraping testen" button inside the source form dialog (HTML type only). Clicking it sends the current form values (URL + selectors) to a new backend endpoint that performs a live dry-run fetch — scraping the page but NOT saving any articles to the database. The endpoint returns up to 5 scraped article candidates which are shown as preview cards inside the dialog. The "Speichern" button remains disabled until at least one successful preview run has been completed, ensuring admins verify their configuration works before committing.

## User Stories
- As an admin, I want to test my HTML scraping configuration before saving the source so that I don't end up with a broken source that scrapes nothing.
- As an admin, I want to see scraped article cards (title, URL, description, image, date) from the preview so that I can verify the selectors are targeting the right content.
- As an admin, I want to be prevented from saving a source until the preview succeeds so that misconfigured sources don't get silently added.
- As an admin, I want to see a clear error message if the preview fails (e.g., site unreachable, no articles found) so that I know what to fix.
- As an admin, I want to be able to adjust selectors and re-run the preview as many times as needed before saving.

## Acceptance Criteria
- [ ] AC-1: A "Scraping testen" button appears in the HTML selectors section of the source form dialog, visible only when `type === 'html'`
- [ ] AC-2: Clicking the button sends a POST request to `POST /api/sources/preview` with the current form values (url, all selector fields, language) — the source is NOT saved at this point
- [ ] AC-3: The endpoint performs a live HTTP fetch of the URL, runs the HTML scraping engine against it using the provided selectors, and returns up to 5 article candidates (no DB write)
- [ ] AC-4: While the preview is running, the button shows a spinner and is disabled; a loading indicator is shown in the results area
- [ ] AC-5: On success (≥1 article scraped), the results area shows up to 5 scraped article cards, each displaying: title, clickable URL, description excerpt, image thumbnail (if available), and date (if available)
- [ ] AC-6: On failure (0 articles found, or fetch error), a clear error message is displayed: what went wrong and a suggestion to check the URL and selectors
- [ ] AC-7: The "Speichern" / "Quelle hinzufügen" button is **disabled** until at least one successful preview run has returned ≥1 article; after a successful preview the button becomes enabled
- [ ] AC-8: If the admin changes any selector field or the URL after a successful preview, the preview result is cleared and the save button is disabled again — requiring a re-run
- [ ] AC-9: The preview endpoint requires admin authentication; unauthenticated or non-admin requests are rejected with 401/403
- [ ] AC-10: The preview endpoint has a 15-second timeout; if the target website doesn't respond in time, a timeout error is returned
- [ ] AC-11: In edit mode (editing an existing source), the preview button is present but the save button is NOT gated — editing an existing source does not require a preview run

## Edge Cases
- **URL not yet entered:** The "Scraping testen" button is disabled if the URL field is empty, with a tooltip "Bitte zuerst eine URL eingeben".
- **Required selectors missing:** If `selector_container` or `selector_title` or `selector_link` are empty, the preview button is disabled with a tooltip "Container-, Titel- und Link-Selektor sind Pflichtfelder fuer die Vorschau".
- **Website returns 403/blocked:** The preview endpoint returns the HTTP status and a human-readable message ("Die Webseite hat die Anfrage blockiert (403). Einige Seiten erlauben kein automatisches Abrufen.").
- **Articles found but no images/dates:** Cards are shown without the missing fields — no broken placeholder needed; the other fields are sufficient to verify the selectors work.
- **Preview succeeds, admin changes URL:** The results area is cleared immediately, a notice is shown ("Konfiguration geaendert — bitte Vorschau erneut ausfuehren"), and the save button is disabled again.
- **Network error on admin's side:** A generic network error message is shown; the preview can be retried.
- **Redirect chains:** The scraper follows up to 3 redirects (same as the regular scrape engine) — no special handling needed.
- **Very large page:** The same response size cap used by the regular HTML engine applies (e.g., first 2MB of response body) to prevent timeouts on huge pages.

## Technical Notes
- New endpoint: `POST /api/sources/preview` — accepts a JSON body with `{ url, selector_container, selector_title, selector_link, selector_description?, selector_date?, selector_category?, selector_image?, language? }`
- The endpoint reuses the existing HTML scraping engine (`src/lib/scraping/html-engine.ts`) but returns the scraped items instead of writing them to the database
- The scraping engine needs to accept an inline config object rather than a full source record (small refactor or wrapper)
- The save button gating is handled client-side in `source-form-dialog.tsx` via a `previewPassed` boolean state
- `previewPassed` resets to `false` whenever `url`, `selector_container`, `selector_title`, `selector_link`, `selector_description`, `selector_date`, `selector_image`, or `selector_category` changes
- Preview result cards use the same `ArticleGridCard` or a simplified read-only card component

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

**Designed:** 2026-03-07 (retrospective — implementation already complete)

### Overview
This feature adds one new backend API endpoint and extends the existing source form dialog with preview UI. No new pages, no database tables, no new third-party packages.

---

### A) Component Structure

```
SourceFormDialog (existing, extended)
+-- [HTML type only] CSS Selector Section
|   +-- SelectorAssistant (NEWS-16, unchanged)
|   +-- "Scraping testen" Button
|       +-- Spinner (while loading)
|   +-- Preview Results Area
|       +-- [idle] Hint text: "Click button to test"
|       +-- [loading] Loading spinner
|       +-- [success] Green badge "X Artikel gescrapt"
|       |   +-- PreviewCard x up to 5
|       |       +-- Thumbnail image (if available)
|       |       +-- Title + link
|       |       +-- Description excerpt
|       |       +-- Date (if available)
|       +-- [error] Red alert: error message + suggestion
+-- Save Button (disabled for new HTML sources until preview passes)
```

---

### B) Data Flow

```
Admin fills selectors
        |
        v
[Scraping testen] clicked
        |
        v
POST /api/sources/preview
  { url, selector_container, selector_title, selector_link,
    selector_description?, selector_date?, selector_category?,
    selector_image?, language? }
        |
        v
Backend: scrapeHtmlPreview()
  -- Fetches the live URL (15s timeout, max 5MB response)
  -- Runs HTML scraping engine with provided selectors
  -- Returns up to 5 scraped article objects (NO DB write)
        |
     success?
    /        \
  yes         no
   |           |
 Show cards  Show error + suggestion
 Enable Save  Save stays disabled
```

---

### C) Backend: New API Endpoint

**`POST /api/sources/preview`**

| Aspect | Detail |
|--------|--------|
| Auth | Admin only (`requireAdmin()`) |
| Input | JSON body: url (required), 3 required selectors, 4 optional selectors, language |
| Validation | Zod schema — rejects missing or invalid fields with 422 |
| Core logic | Delegates to `scrapeHtmlPreview()` in the HTML engine |
| Output (success) | `{ success: true, articles: [...up to 5], count, errors }` |
| Output (0 results) | `{ success: false, articles: [], error, suggestion }` — still HTTP 200 |
| Timeout | 15 seconds (built into `scrapeHtmlPreview`) |
| DB writes | None |

**Why HTTP 200 for 0 results?** Zero articles is a valid scrape outcome (bad selectors), not a server error. The client distinguishes success vs. failure via the `success` boolean, not HTTP status.

---

### D) Backend: HTML Engine Extension

The existing `html-engine.ts` was extended with:

- **`HtmlScrapeConfig` interface** — a lightweight config type containing only the 8 selector fields + URL + language. This avoids requiring a full database `Source` record for preview runs.
- **`scrapeHtmlPreview(config, limit)` function** — builds a temporary in-memory pseudo-Source from the config, delegates to the existing `scrapeHtmlPage()` function, and returns the first `limit` results. Zero database access.

This design means the preview and the real scraper use **identical scraping logic** — there is no risk of the preview behaving differently than the real scrape.

---

### E) Frontend: Source Form Dialog Changes

| What changed | How |
|-------------|-----|
| "Scraping testen" button | Added inside the HTML selectors section, only visible when `type === 'html'` |
| `previewPassed` state | Boolean — starts `false` for new sources, gates the Save button |
| Save button gating | Disabled when `form.type === 'html' && !isEditing && !previewPassed` |
| Preview invalidation | A `PREVIEW_SENSITIVE_FIELDS` list: changing URL or any selector resets `previewPassed` to `false` and clears results |
| Edit mode exception | `isEditing === true` skips the gate — existing sources can be saved without a preview |
| `PreviewCard` component | Small inline read-only card showing thumbnail, title, description, date |
| Error messages | Error + contextual suggestion shown as a destructive Alert |

---

### F) Tech Decisions

**Why reuse `scrapeHtmlPage()` rather than writing a separate preview scraper?**
Using the same engine guarantees the preview is an exact dry run — no surprises when the actual scheduled scrape runs. Code duplication would risk divergence.

**Why gate the Save button on the client?**
The save gating is a UX guardrail, not a security control. The server doesn't need to know if a preview was run — it just validates and saves the source as normal. This keeps the API surface clean.

**Why return `success: false` with HTTP 200 instead of HTTP 4xx?**
Zero articles found is not an error in the HTTP sense — the server did its job. Returning 4xx would cause the client to treat it as a fetch failure, making error handling more complex. The `success` boolean gives the client full control over what to display.

---

### G) No New Dependencies
This feature uses only packages already installed:
- `zod` — input validation (already used project-wide)
- `cheerio`, `chrono-node`, `franc` — already used by the HTML engine

## QA Test Results

**Tested:** 2026-03-07
**Build status:** ✓ Compiled successfully
**Result:** All 11 acceptance criteria PASS — no bugs found

### AC Results

| AC | Description | Status | Notes |
|----|-------------|--------|-------|
| AC-1 | "Scraping testen" button only visible when `type === 'html'` | ✅ PASS | Gated by `form.type === 'html'` condition in source-form-dialog |
| AC-2 | POST to `/api/sources/preview` with all form values | ✅ PASS | `handlePreview()` sends all 8 fields + language |
| AC-3 | Live fetch, runs scraping engine, returns ≤5 candidates, no DB write | ✅ PASS | `scrapeHtmlPreview()` delegates to `scrapeHtmlPage()`, no DB calls |
| AC-4 | Spinner on button + loading indicator in results area | ✅ PASS | `previewLoading` drives spinner + loading state in results section |
| AC-5 | Success: shows ≤5 preview cards with title, URL, description, image, date | ✅ PASS | `PreviewCard` renders all 5 fields, image/date shown only when available |
| AC-6 | Failure: clear error + suggestion | ✅ PASS | Destructive Alert with `previewError` + `previewSuggestion`; contextual messages for TIMEOUT, HTTP_ERROR (403/404), NETWORK_ERROR |
| AC-7 | Save button disabled until ≥1 article preview succeeds | ✅ PASS | `disabled={saving \|\| (form.type === 'html' && !isEditing && !previewPassed)}` |
| AC-8 | Changing URL or selector resets preview and disables Save | ✅ PASS | `PREVIEW_SENSITIVE_FIELDS` triggers reset in `updateField()` when `previewPassed === true` |
| AC-9 | Preview endpoint requires admin auth | ✅ PASS | `requireAdmin()` called first, returns 401/403 on failure |
| AC-10 | 15-second timeout | ✅ PASS | Timeout built into `scrapeHtmlPreview()` via the HTML engine (15s fetch timeout) |
| AC-11 | Edit mode: preview button present but Save not gated | ✅ PASS | `!isEditing` condition in save button disable logic |

### Edge Case Coverage

| Edge Case | Status | Notes |
|-----------|--------|-------|
| URL not entered → button disabled | ✅ PASS | `!form.url` check in `isPreviewButtonDisabled` |
| Missing required selectors → button disabled | ✅ PASS | container/title/link checked; tooltip shown |
| Website returns 403 | ✅ PASS | `HTTP_ERROR` + `httpStatus === 403` → specific German message |
| Articles found but no images/dates | ✅ PASS | `PreviewCard` renders without missing optional fields |
| Preview succeeds, admin changes URL | ✅ PASS | `PREVIEW_SENSITIVE_FIELDS` includes `url`; resets to hint state |
| Network error | ✅ PASS | `NETWORK_ERROR` code → specific message + suggestion |

### Security Audit
- ✅ Admin auth verified before any processing
- ✅ Zod schema validates all inputs server-side (422 on invalid)
- ✅ No database writes in preview endpoint
- ✅ JSON parse error handled (400 response)
- ✅ Unexpected errors caught with 500 + console.error

## Deployment

**Deployed:** 2026-03-07
**Tag:** v1.18.0
**Branch:** main → origin/main (pushed)
**Vercel:** Auto-deploy triggered on push to main
