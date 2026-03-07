# NEWS-6: News REST API

**Status:** In Review
**Priority:** P0 (MVP)
**Created:** 2026-03-05

## Dependencies
- Requires: NEWS-1 (User Authentication) — alle Endpunkte erfordern gültigen JWT
- Requires: NEWS-5 (Scraping Scheduler) — Artikel müssen in der DB vorhanden sein

## Overview
Eine authentifizierte REST API (Next.js API Routes), über die eingeloggte Nutzer gespeicherte News-Artikel abrufen können. Unterstützt Filterung nach Quelle, Sprache und Datum sowie Pagination. Alle Endpunkte erfordern einen gültigen Supabase JWT im `Authorization: Bearer <token>`-Header.

## User Stories

1. Als **eingeloggter Nutzer** möchte ich alle News-Artikel paginiert abrufen können, damit ich die Daten in eigene Systeme integrieren kann.
2. Als **eingeloggter Nutzer** möchte ich Artikel nach Quelle filtern können, damit ich nur relevante Quellen abfragen kann.
3. Als **eingeloggter Nutzer** möchte ich Artikel nach Sprache filtern können, damit ich sprachspezifische News erhalte.
4. Als **eingeloggter Nutzer** möchte ich Artikel nach Zeitraum filtern können, damit ich nur aktuelle News erhalte.
5. Als **eingeloggter Nutzer** möchte ich einen einzelnen Artikel per ID abrufen können.
6. Als **Developer** möchte ich eine API-Dokumentation (OpenAPI/Swagger) haben, damit ich die Endpunkte ohne Trial-and-Error nutzen kann.

## Acceptance Criteria

### Endpunkte

- [ ] `GET /api/articles` — Liste aller Artikel (paginiert)
  - Query-Parameter: `page` (default: 1), `limit` (default: 20, max: 100), `source_id`, `language`, `from` (ISO 8601), `to` (ISO 8601), `search` (Volltextsuche in Titel)
  - Response: `{ data: Article[], total: number, page: number, limit: number }`
- [ ] `GET /api/articles/[id]` — Einzelner Artikel per UUID
  - Response: `{ data: Article }` oder 404
- [ ] `GET /api/sources` — Liste aller aktiven Quellen (read-only für User)
  - Response: `{ data: Source[] }`

### Allgemein

- [ ] Alle Endpunkte: `Authorization: Bearer <JWT>` erforderlich → 401 ohne Token
- [ ] Ungültiger/abgelaufener Token → 401 Unauthorized
- [ ] Fehlende Pflicht-Parameter → 400 Bad Request mit Fehlermeldung
- [ ] Artikel-Objekt enthält: `id`, `title`, `url`, `description`, `published_at`, `language`, `source_id`, `source_name`, `created_at`
- [ ] Sortierung: Standard `published_at DESC`
- [ ] Alle Queries nutzen `.limit()` (kein unbegrenztes SELECT)
- [ ] API-Fehler geben strukturiertes JSON zurück: `{ error: string, code: string }`

## Edge Cases

- `limit` > 100 → wird auf 100 gedeckelt (kein Fehler)
- `page` < 1 → wird auf 1 gesetzt
- `source_id` existiert nicht → leere Liste (kein 404)
- `from` > `to` → 400 Bad Request
- `search` mit Sonderzeichen (SQL Injection) → Zod-Validierung + parametrisierte Queries
- Keine Artikel in DB → leere Liste `{ data: [], total: 0 }`
- Sehr viele Ergebnisse → Pagination verhindert Performance-Probleme

## Out of Scope
- Artikel schreiben/löschen über die API (read-only für User)
- Webhook-Subscriptions für neue Artikel (v2)
- GraphQL (v2)
- API-Keys als Alternative zu JWT (v2)

---

## Tech Design (Solution Architect)

**Implementierung:** Next.js App Router API Routes (`src/app/api/articles/route.ts`, etc.)

**Auth:** Jeder Request prüft `Authorization: Bearer <JWT>` via Supabase Server Client. Ungültige/fehlende Tokens → 401.

**Paginierung:** `?page=1&limit=20` — serverseitig via `.range()` auf Supabase Query. Antwort enthält `{ data, total, page, limit }`.

**Filter:** `source_id`, `language`, `category_id`, `from`, `to` — alle via Supabase Query-Builder zusammengebaut. `search` via Postgres `ILIKE` auf `articles.title`.

**Performance:** Indexes auf `articles.source_id`, `articles.published_at`, `articles.language` sichern schnelle Abfragen unter 300ms.

**Neue Packages:** Keine

---

## QA Test Results

**Tested:** 2026-03-06
**App URL:** http://localhost:3000
**Tester:** QA Engineer (AI)
**Build Status:** PASS (Next.js 16.1.1 compiles successfully, all routes registered)

### Acceptance Criteria Status

#### AC-1: GET /api/articles -- Paginated article list
- [x] Route exists at `src/app/api/articles/route.ts` and is registered in build output
- [x] Query parameters implemented: `page`, `limit`, `source_id`, `language`, `from`, `to`, `search`
- [x] Additional filter `category_id` supported (beyond spec, good)
- [x] Response shape matches: `{ data: Article[], total: number, page: number, limit: number }`
- [x] Pagination via Supabase `.range()` with correct offset calculation
- [x] Default page=1, default limit=20 applied via Zod schema transforms

#### AC-2: GET /api/articles/[id] -- Single article by UUID
- [x] Route exists at `src/app/api/articles/[id]/route.ts`
- [x] UUID format validated via regex before DB query
- [x] Returns `{ data: Article }` on success
- [x] Returns 404 with structured error when article not found (checks PGRST116 error code)

#### AC-3: GET /api/sources -- List active sources (read-only for users)
- [x] Route exists at `src/app/api/sources/route.ts`
- [ ] BUG: Response format does not match spec. Spec requires `{ data: Source[] }` but actual response is `{ sources: Source[], pagination: { page, pageSize, total, totalPages } }` (see BUG-1)

#### AC-4: Authentication required on all endpoints
- [x] `GET /api/articles` calls `requireAuth()` which verifies Supabase JWT
- [x] `GET /api/articles/[id]` calls `requireAuth()`
- [x] `GET /api/sources` calls `requireAuth()`
- [ ] BUG: Middleware redirects unauthenticated API requests to `/login` (HTTP 302) instead of returning 401 JSON. External API consumers receive an HTML redirect, not a JSON error (see BUG-2)

#### AC-5: Invalid/expired token returns 401 Unauthorized
- [x] `requireAuth()` throws `{ status: 401, error: 'Nicht authentifiziert' }` when `getUser()` fails
- [x] Caught in route handler and returned as JSON `{ error, code: 'AUTH_ERROR' }`
- [ ] BUG: See BUG-2 -- middleware intercepts before route handler can return 401 JSON

#### AC-6: Missing required parameters return 400 Bad Request
- [x] Zod validation returns 400 with `{ error, code: 'VALIDATION_ERROR', details }` for invalid params
- [x] Invalid UUID format for `source_id` returns Zod validation error
- [x] Invalid ISO date for `from`/`to` returns Zod validation error
- [x] Search string exceeding 200 chars returns validation error

#### AC-7: Article object contains required fields
- [x] `id`, `title`, `url`, `description`, `published_at`, `language`, `source_id`, `created_at` all selected
- [x] `source_name` flattened from joined `sources` table
- [x] Additional fields beyond spec: `image_url`, `category_id`, `source_slug`, `category_name`, `source_category_raw`, `categorization_status`

#### AC-8: Default sort order published_at DESC
- [x] `.order('published_at', { ascending: false })` applied in list query

#### AC-9: All queries use .limit() -- no unbounded SELECT
- [x] List query uses `.range(rangeFrom, rangeTo)` which bounds results
- [x] Detail query uses `.single()` which returns exactly one row
- [x] Sources query uses `.range(from, to)` with PAGE_SIZE=25

#### AC-10: Structured JSON error responses
- [x] All error responses include `{ error: string, code: string }`
- [x] Consistent error codes: `RATE_LIMIT_EXCEEDED`, `VALIDATION_ERROR`, `DB_ERROR`, `AUTH_ERROR`, `NOT_FOUND`, `INTERNAL_ERROR`

### Edge Cases Status

#### EC-1: limit > 100 capped to 100
- [x] Zod transform: `parsed > 100 ? 100 : parsed` -- correctly caps without error

#### EC-2: page < 1 set to 1
- [x] Zod transform: `isNaN(parsed) || parsed < 1 ? 1 : parsed` -- correctly defaults to 1

#### EC-3: Non-existent source_id returns empty list
- [x] No special handling needed -- Supabase `.eq('source_id', source_id)` naturally returns empty list

#### EC-4: from > to returns 400 Bad Request
- [x] Zod `.refine()` checks `new Date(data.from) <= new Date(data.to)` and rejects with 400

#### EC-5: Search with special characters (SQL injection)
- [x] Supabase client uses parameterized queries, preventing SQL injection
- [ ] BUG: ILIKE wildcard characters `%` and `_` in search input are not escaped. A user searching for `%` or `_` gets unintended wildcard matches (see BUG-3)

#### EC-6: No articles in DB returns empty list
- [x] Returns `{ data: [], total: 0, page: 1, limit: 20 }` -- null-safe via `articles ?? []`

#### EC-7: Many results handled via pagination
- [x] `.range()` ensures only `limit` items per page
- [x] `count: 'exact'` provides total for pagination metadata

### Security Audit Results

#### Authentication & Authorization
- [x] All article endpoints require authentication via `requireAuth()`
- [x] DELETE endpoint requires admin role via `requireAdmin()`
- [x] RLS enabled on `articles` table with policy for authenticated SELECT
- [x] RLS policies restrict INSERT/UPDATE/DELETE to admin role
- [ ] BUG: Middleware returns 302 redirect for unauthenticated API calls instead of 401 (see BUG-2)

#### Input Validation
- [x] All query parameters validated via Zod schema
- [x] UUID format validated via regex before database query
- [x] Search string length capped at 200 characters
- [x] Date strings validated against ISO 8601 regex
- [ ] BUG: ILIKE wildcard injection possible in search parameter (see BUG-3)

#### Rate Limiting
- [x] Rate limiting implemented: 60 req/min for list, 120 req/min for detail, 30 deletes/min
- [x] Rate limit headers returned in responses
- [ ] BUG: `X-RateLimit-Limit` header always shows `remaining` value instead of the configured max (see BUG-4)
- [x] In-memory rate limiter has periodic cleanup to prevent memory leaks

#### Data Exposure
- [x] No secrets or credentials exposed in API responses
- [x] No sensitive user data leaked in article responses
- [x] Error messages are generic -- no stack traces or internal details exposed

#### Security Headers
- [ ] BUG: No security headers configured in `next.config.ts`. Missing X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security as required by project security rules (see BUG-5)

#### Database Schema
- [ ] BUG: `category_id` column referenced in API code and indexed in migration but not defined in `sql/003-articles.sql` CREATE TABLE statement. Schema files are incomplete (see BUG-6)

### Cross-Browser Testing (Dashboard UI)

Testing covers the News Dashboard page (`/dashboard/news`) which consumes the API.

#### Chrome (Desktop 1440px)
- [x] Article feed renders with cards, filters, pagination
- [x] Search, source filter, language filter all functional
- [x] Pagination navigation works correctly

#### Firefox (Desktop 1440px)
- [x] Code review confirms no browser-specific APIs used
- [x] All components use standard HTML/CSS via Tailwind + shadcn/ui

#### Safari (Desktop 1440px)
- [x] No Safari-incompatible features detected in code review

#### Responsive: Mobile (375px)
- [x] Filters stack vertically (`flex-col sm:flex-row`)
- [x] Source/language dropdowns expand to full width on mobile (`w-full sm:w-[180px]`)
- [x] Article cards use single column grid
- [x] Pagination "Zurueck"/"Weiter" labels hidden on mobile, icons remain
- [x] Reset button text hidden on mobile (`hidden sm:inline`)

#### Responsive: Tablet (768px)
- [x] Filters switch to horizontal layout at `sm:` breakpoint (640px)
- [x] Article cards remain single column (appropriate for content-heavy cards)

#### Responsive: Desktop (1440px)
- [x] Filters in single horizontal row
- [x] Full pagination with page numbers visible

### Bugs Found

#### BUG-1: GET /api/sources response format deviates from spec
- **Severity:** Medium
- **Steps to Reproduce:**
  1. Call `GET /api/sources` with valid authentication
  2. Expected response: `{ data: Source[] }`
  3. Actual response: `{ sources: Source[], pagination: { page, pageSize, total, totalPages } }`
- **Impact:** External API consumers relying on the spec will fail to parse the response. The frontend (`article-filters.tsx` line 56) already uses `json.sources` so the UI works, but the API contract is inconsistent with the spec and with the articles endpoints which use `data`.
- **Priority:** Fix before deployment

#### BUG-2: Middleware returns 302 redirect instead of 401 JSON for unauthenticated API requests
- **Severity:** High
- **Steps to Reproduce:**
  1. Send `GET /api/articles` without any authentication cookie/token
  2. Expected: HTTP 401 with `{ error: 'Nicht authentifiziert', code: 'AUTH_ERROR' }`
  3. Actual: HTTP 302 redirect to `/login`
- **Impact:** External API consumers (bots, integrations, CLI tools) receive an HTML page redirect instead of a machine-readable JSON error. This breaks the API contract for non-browser consumers. The middleware at `middleware.ts:35` redirects all unauthenticated `/api/*` requests before route handlers can respond.
- **File:** `/Users/michaelmollath/projects/news-scraper/middleware.ts` line 35
- **Priority:** Fix before deployment

#### BUG-3: ILIKE wildcard characters not escaped in search parameter
- **Severity:** Low
- **Steps to Reproduce:**
  1. Call `GET /api/articles?search=%25` (URL-encoded `%`)
  2. Expected: Search for articles with literal `%` in title
  3. Actual: The `%` is treated as a wildcard, matching all articles
- **Impact:** Not a security vulnerability (Supabase parameterizes the query), but a functional correctness issue. Users searching for strings containing `%` or `_` will get unexpected results. The wrapping in `%${search}%` at line 122 of `route.ts` does not escape these characters.
- **File:** `/Users/michaelmollath/projects/news-scraper/src/app/api/articles/route.ts` line 122
- **Priority:** Fix in next sprint

#### BUG-4: X-RateLimit-Limit header shows incorrect value
- **Severity:** Low
- **Steps to Reproduce:**
  1. Send any authenticated request to `GET /api/articles`
  2. Check `X-RateLimit-Limit` response header
  3. Expected: Shows configured max (e.g., `60`)
  4. Actual: Shows `remaining` value (e.g., `59` on first request), due to the expression `result.remaining + (result.allowed ? 0 : 0)` which always evaluates to `result.remaining`
- **Impact:** API consumers cannot determine the actual rate limit ceiling from headers. The ternary `result.allowed ? 0 : 0` is effectively a no-op.
- **File:** `/Users/michaelmollath/projects/news-scraper/src/lib/rate-limit.ts` line 84
- **Priority:** Fix in next sprint

#### BUG-5: Missing security headers in next.config.ts
- **Severity:** Medium
- **Steps to Reproduce:**
  1. Check response headers from any page/API route
  2. Expected: X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: origin-when-cross-origin, Strict-Transport-Security with includeSubDomains
  3. Actual: None of these headers are configured. `next.config.ts` is empty.
- **Impact:** Violates project security rules (`.claude/rules/security.md`). Missing clickjacking protection, MIME-sniffing protection, and HSTS.
- **File:** `/Users/michaelmollath/projects/news-scraper/next.config.ts`
- **Priority:** Fix before deployment

#### BUG-6: Schema files missing category_id column on articles table
- **Severity:** Medium
- **Steps to Reproduce:**
  1. Review `sql/003-articles.sql` -- no `category_id` column in CREATE TABLE
  2. Review `supabase/migrations/20260306_news6_articles_api_indexes.sql` -- creates index on `articles.category_id`
  3. Review `src/app/api/articles/route.ts` -- selects `category_id` from articles
- **Impact:** If the schema files are used to provision a new database, the `category_id` column will be missing, causing the index creation and API queries to fail. The column likely exists in the live database via a manual ALTER TABLE or Supabase UI change that was never captured in migration files.
- **Files:** `/Users/michaelmollath/projects/news-scraper/sql/003-articles.sql`, `/Users/michaelmollath/projects/news-scraper/supabase/migrations/20260306_news6_articles_api_indexes.sql`
- **Priority:** Fix before deployment

#### BUG-7: npm run lint is broken
- **Severity:** Low
- **Steps to Reproduce:**
  1. Run `npm run lint`
  2. Expected: ESLint runs successfully
  3. Actual: "Invalid project directory provided, no such directory: .../lint"
- **Impact:** Cannot run automated linting. CI/CD lint checks will fail.
- **Priority:** Fix in next sprint

### Summary
- **Acceptance Criteria:** 8/10 passed (AC-3 and AC-4/AC-5 have issues)
- **Edge Cases:** 6/7 passed (EC-5 has minor wildcard issue)
- **Bugs Found:** 7 total (0 critical, 1 high, 3 medium, 3 low)
- **Security:** Issues found (missing security headers, middleware auth redirect, wildcard injection)
- **Production Ready:** NO
- **Recommendation:** Fix BUG-2 (high: middleware 302 vs 401), BUG-1 (medium: sources response format), BUG-5 (medium: security headers), and BUG-6 (medium: schema completeness) before deployment. BUG-3, BUG-4, and BUG-7 can be addressed in the next sprint.
