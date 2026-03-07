# NEWS-14: RSS Feed Auto-Erkennung

## Status: In Progress
**Created:** 2026-03-06
**Last Updated:** 2026-03-06

## Dependencies
- Requires: NEWS-2 (News-Quellen-Verwaltung) — feature is embedded in the Add Source form

## Summary
When an admin creates a new news source, they should not need to manually find the RSS/Atom feed URL. Instead, the admin enters the website's homepage URL, clicks "Feeds erkennen", and the system automatically discovers, validates, and lists all available feeds. The admin then selects one to pre-fill the source form.

## User Stories
- As an admin, I want to enter a website URL and click "Feeds erkennen" so that the system finds all available RSS/Atom feeds for me automatically.
- As an admin, I want to see all discovered feeds listed with their title and type (RSS/Atom) so that I can choose the most appropriate one.
- As an admin, I want to select a discovered feed and have it pre-fill the URL field in the source form so that I don't have to copy-paste URLs manually.
- As an admin, I want to see a clear error message if no feeds are found or the URL is unreachable, so I know I need to enter the feed URL manually.
- As an admin, I want the system to only show feeds that are confirmed to be parseable so I don't accidentally add broken sources.

## Acceptance Criteria
- [ ] AC-1: A "Feeds erkennen" button appears in the Add Source form next to or below the URL field
- [ ] AC-2: Clicking "Feeds erkennen" triggers a backend API call with the entered URL
- [ ] AC-3: The backend detects feeds via three methods:
  - HTML `<link>` tags with `type="application/rss+xml"` or `type="application/atom+xml"`
  - Common URL path patterns: `/feed`, `/rss`, `/atom.xml`, `/feed.xml`, `/rss.xml`, `/feeds/posts/default`
  - `sitemap.xml` link discovery (check `<loc>` entries for feed URLs)
- [ ] AC-4: Each candidate feed URL is fetched and parsed — only feeds that parse successfully (valid RSS/Atom structure, at least 1 item) are returned
- [ ] AC-5: Discovered feeds are displayed as a selectable list with: feed title, feed type (RSS/Atom), and feed URL
- [ ] AC-6: When the admin selects a feed from the list, the form's URL field is pre-filled with that feed URL and the type (rss/html) is set to "rss"
- [ ] AC-7: If the website URL is unreachable (network error, timeout, non-200 response), an inline error is shown and the admin can still enter the URL manually
- [ ] AC-8: If no valid feeds are found after all detection methods, a message "Keine Feeds gefunden — bitte URL manuell eingeben" is shown
- [ ] AC-9: The detection API has a timeout of max 10 seconds total (to avoid blocking the UI)
- [ ] AC-10: A loading state is shown during detection (spinner/skeleton on the button)
- [ ] AC-11: The feature is admin-only (non-admins cannot access the source form at all)

## Edge Cases
- **URL without scheme:** If the admin enters `example.com` without `https://`, the backend should prepend `https://` automatically before fetching.
- **URL is already a feed URL:** If the entered URL is itself a valid RSS/Atom feed, it should be returned as a discovered feed directly (skip HTML parsing).
- **Duplicate feed URLs:** If the same feed URL is discovered via multiple methods (e.g., both `<link>` tag and pattern guessing), de-duplicate before returning.
- **Feed found but empty:** A feed that parses but has 0 items should NOT be returned (AC-4 requires at least 1 item).
- **Sitemap.xml is very large:** Sitemap parsing should be limited (e.g., check only the first 50 entries) to avoid timeout.
- **Redirect chains:** If the website URL redirects (e.g., http → https, or www → non-www), follow up to 3 redirects.
- **CORS / server errors on feeds:** Individual feed validation failures should not abort the entire detection — skip that candidate and continue.
- **Rate limiting:** The detection endpoint should be admin-only and limited to prevent abuse (e.g., 10 requests/min per user).

## Technical Requirements
- Detection API: `POST /api/sources/detect-feeds` — accepts `{ url: string }`, returns `{ feeds: DetectedFeed[] }`
- `DetectedFeed`: `{ url: string, title: string, type: 'rss' | 'atom', item_count: number }`
- Total timeout: 10 seconds (server-side abort signal)
- Authentication: Admin only
- The detection runs server-side (avoids CORS issues with external sites)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
